# Deploying QCF News to a 2 GB server

**Companion to [DEPLOY_EC2.md](DEPLOY_EC2.md).** That guide targets a 4 GiB
t3.medium that builds its own images. This one targets a 2 GiB box — including a
box that already runs something else, such as MySQL — and it changes exactly one
architectural thing:

> **The server never builds. You build on your laptop and ship the images in.**

Everything else — Cloudflare, the origin certificate, the nginx site config, the
security group, backups — is identical, and this guide links to DEPLOY_EC2.md
rather than repeating it. Follow the steps here in order; where a step says
"unchanged", the linked section is the authority.

---

## 0 · Why the server can't build, and what the budget looks like

`next build` alone wants ~2 GiB of resident memory. On a 2 GiB host it does not
fail gracefully — it dies with a bare `Killed` from the kernel OOM killer, often
after ten minutes, and often taking Postgres with it. Adding swap makes it
*finish* rather than makes it *work*: a swap-thrashing build takes 30+ minutes and
pins the box. The building also writes 4–6 GiB of intermediate layers, which is
most of a small instance's free disk.

So the split is: **build where there's RAM, run where there isn't.**

The runtime side genuinely fits. `docker-compose.lowmem.yml` sets a hard ceiling
on every service, and the steady state sits well under each one:

| Service | Typical | Ceiling (`mem_limit`) |
|---|---:|---:|
| backend (2 gunicorn workers) | ~330 M | 420 M |
| frontend (Next standalone) | ~170 M | 260 M |
| postgres (64 M shared_buffers) | ~130 M | 220 M |
| redis (48 M maxmemory) | ~60 M | 96 M |
| **stack total** | **~690 M** | ~1.0 G |
| host nginx + dockerd + Ubuntu | ~250 M | — |
| **committed** | **~940 M** | |

That leaves roughly 1 GB of headroom on a 2 GiB box. The ceilings are not
reservations — they exist so that a spike (an image upload is the realistic one)
kills **one container**, which restarts in seconds, instead of letting the kernel
pick an OOM victim anywhere on the host.

**If the box also runs MySQL**, budget for it before you start. A default MySQL
8 sits at ~400 M resident, and its default `innodb_buffer_pool_size=128M` assumes
it owns the machine:

```bash
# /etc/mysql/mysql.conf.d/mysqld.cnf
[mysqld]
innodb_buffer_pool_size = 128M
max_connections         = 30
performance_schema      = OFF      # saves ~200 M on its own
```

`performance_schema = OFF` is the single biggest win. With that, MySQL lands
near 200 M and 940 M + 200 M still leaves headroom. Check with
`ps -o rss= -C mysqld` before and after.

---

## 1 · On your laptop — commit the low-memory files first

These four changes are what make the deployment work, and three of them have to
reach the server through git. **Nothing below will work until they are pushed.**

```bash
cd "/home/rakesh/Desktop/QCF News"
git status --short
#   M Backend/src/db/session.py      ← env-tunable DB pool  (server needs this)
#   M Makefile                       ← the LOWMEM=1 switch  (server needs this)
#   ?? docker-compose.lowmem.yml     ← the overlay          (server needs this)
#   ?? scripts/                      ← ship-images.sh       (laptop only)

git add Backend/src/db/session.py Makefile docker-compose.lowmem.yml scripts/ DEPLOY_2GB.md
git commit -m "Add low-memory deployment path for a 2 GiB host"
git push
```

The `session.py` change is the one that is easy to underestimate. Every gunicorn
worker imports that module **and** runs `db_lifespan`, so a worker holds *two*
pools, and the host opens

```
workers × 2 × (DB_POOL_SIZE + DB_MAX_OVERFLOW)
```

connections at full stretch. At the old hard-coded `10 + 20` that is **120
connections for 2 workers** — past PostgreSQL's default `max_connections` of 100,
and ~5–10 MB of server memory each. The overlay sets `DB_POOL_SIZE=3` and
`DB_MAX_OVERFLOW=2`, giving `2 × 2 × 5 = 20` against the `max_connections=40` it
also configures. Deploy the overlay without the `session.py` change and the
backend will exhaust the pool and start returning 500s under mild load.

---

## 2 · On your laptop — a local `.env.production` for the build

`ship-images.sh` refuses to run without one, and so does Compose itself — the
production overlay puts `env_file: .env.production` on the backend service, so
*every* compose command fails with `env file ... not found` until it exists. A
`--env-file` flag does not substitute for it. Four of its values are also **baked
into the frontend image** and cannot be fixed later with a restart:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Only these four have to be real locally:

```ini
NEXT_PUBLIC_SITE_URL=https://news.quickcelebfacts.com
NEXT_PUBLIC_MEDIA_BASE_URL=
NEXT_PUBLIC_NEWSLETTER_ENABLED=false
API_INTERNAL_ORIGIN=http://backend:8000
```

Every secret in the local copy can stay a placeholder — **the real secrets live
only on the server**, and are injected at runtime from the server's own
`.env.production`. Nothing secret enters the image.

> `NEXT_PUBLIC_SITE_URL` must be `https://` in the *first* build. Next inlines it
> into the client bundle, so an image built with `http://` publishes wrong
> canonical URLs, sitemap entries, RSS links and social cards — and search engines
> index them before you notice. `ship-images.sh` hard-fails if it is not `https://`.

Generate the real secrets now and keep them in your password manager; you paste
them into the server's file in step 5. See
[DEPLOY_EC2.md §1.3](DEPLOY_EC2.md) — unchanged:

```bash
echo "POSTGRES_PASSWORD / DB_PASS   : $(openssl rand -hex 32)"
echo "JWT_SECRET_KEY                : $(openssl rand -hex 64)"
echo "JWT_REFRESH_SECRET_KEY        : $(openssl rand -hex 64)"
echo "REVALIDATION_SECRET           : $(openssl rand -hex 32)"
echo "NEWSLETTER_TOKEN_SECRET       : $(openssl rand -hex 32)"
```

---

## 3 · On the server — bootstrap

Skip whatever the box already has. **Check the CPU architecture first** — a
mismatch between your laptop and the server loads without complaint and then fails
at runtime with `exec format error`:

```bash
uname -m          # x86_64 → build normally.  aarch64 → see §6, you need --platform
free -h
df -h /
```

### 3.1 Swap — 2 GB, and it is not optional

The build is gone, but swap still matters here: it absorbs `docker load`, the
migration run, and upload spikes that push a container against its ceiling.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
free -h
```

`swappiness=10` tells the kernel to prefer reclaiming page cache over swapping
anonymous memory — you want swap as a safety net, not as working storage.

### 3.2 Docker, nginx, log caps, ufw — unchanged

Follow [DEPLOY_EC2.md §4.2–4.5](DEPLOY_EC2.md) exactly. The daemon-wide log cap
in §4.3 matters more here, not less: an unrotated `json-file` log fills a small
disk, and Postgres is the first thing to fall over when it does.

One addition for a small box — put a ceiling on the builder cache that `docker
load` and image churn leave behind:

```bash
docker system df                    # check before
docker builder prune -af            # the server never builds; this should be ~0
```

### 3.3 Cloudflare, the origin certificate, the nginx site config — unchanged

[DEPLOY_EC2.md §3](DEPLOY_EC2.md) and [§5](DEPLOY_EC2.md). Nothing about the
routing table, TLS, or the real-IP chain changes on a smaller box:

```bash
sudo install -d /home/conf
sudo cp ~/qcf-news/nginx/news.quickcelebfacts.com.conf /home/conf/qcfnews.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4 · On the server — get the code

Unchanged from [DEPLOY_EC2.md §6.1](DEPLOY_EC2.md): a read-only deploy key, then

```bash
git clone git@github.com:Rakeshkhadka/qcf-news.git ~/qcf-news
cd ~/qcf-news
ls docker-compose.lowmem.yml        # must exist — if not, step 1 was not pushed
```

The server clones the code for the *compose files and the migrations*, not to
build from. That is why the repo still has to be current.

---

## 5 · On the server — `.env.production`

```bash
cd ~/qcf-news
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

Fill it exactly as in [DEPLOY_EC2.md §6.2](DEPLOY_EC2.md), with the real secrets
from step 2. **Two values from that section behave differently under `LOWMEM=1`:**

```ini
# Both of these are OVERRIDDEN by docker-compose.lowmem.yml. Leave them; they
# are what the stack falls back to if you ever drop the overlay.
BACKEND_WORKERS=3          # overlay forces 2   (compose `environment:` beats `env_file:`)
REDIS_MAXMEMORY=128mb      # overlay forces 48mb (overlay replaces redis `command:` wholesale)
```

Do not try to set `DB_POOL_SIZE` here — the overlay sets it, and the two would
silently disagree about which one won.

Keep `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MEDIA_BASE_URL`,
`NEXT_PUBLIC_NEWSLETTER_ENABLED` and `API_INTERNAL_ORIGIN` **identical** to the
laptop copy from step 2. They are already frozen inside the image; a server value
that disagrees does not take effect, and reading the two files later will mislead
you about what the site is actually serving.

---

## 6 · On your laptop — build and ship the images

```bash
cd "/home/rakesh/Desktop/QCF News"
./scripts/ship-images.sh ubuntu@<server-ip> ~/.ssh/<key>.pem
```

The script, in order: verifies your Docker arch matches the server's, verifies
`NEXT_PUBLIC_SITE_URL` is `https://`, builds `qcfnews/backend:latest` and
`qcfnews/frontend:latest` through the same three-file compose chain the server
uses, then streams them over SSH:

```
docker save qcfnews/backend:latest qcfnews/frontend:latest \
  | gzip -1 | ssh <host> 'gunzip | docker load'
```

Most of the wall time is transfer, not build. Check the real size before you
commit to it on a slow link:

```bash
docker images --filter=reference='qcfnews/*'    # uncompressed, after the build
```

Subsequent ships are much cheaper: `docker load` skips every layer the server
already has, so a code-only change moves the top layer and little else.

> **ARM server (`aarch64`, e.g. t4g/Graviton) with an x86 laptop:** the script
> stops you rather than shipping a broken image. Build cross-platform first:
> ```bash
> docker buildx build --platform linux/arm64 -t qcfnews/backend:latest --load ./Backend
> docker buildx build --platform linux/arm64 -t qcfnews/frontend:latest --load \
>   --build-arg NEXT_PUBLIC_SITE_URL=https://news.quickcelebfacts.com .
> ```
> then re-run the ship script, which will now find matching architectures.

Confirm on the server:

```bash
docker images --filter=reference='qcfnews/*'
```

---

## 7 · On the server — migrate, seed, start

Every command from here on carries **`ENV=prod LOWMEM=1`**. Miss it and you get
the 4 GiB profile: 3 workers, a 128 MB Redis, a full-size Postgres, no ceilings —
and on this box, an OOM kill.

```bash
cd ~/qcf-news

make ENV=prod LOWMEM=1 config | head -40     # sanity: check the merged result first
make ENV=prod LOWMEM=1 migrate               # alembic; exits non-zero on failure
make ENV=prod LOWMEM=1 up
make ENV=prod LOWMEM=1 ps
```

The first `up` pulls `postgres:16-alpine` (~294 MB) and `redis:7-alpine`
(~39 MB) from Docker Hub — `ship-images.sh` only carries the two images you build,
so the server does need outbound access for these. If it is firewalled off,
add them to `IMAGES` in the script and ship them the same way.

`up` will **not** rebuild your two images: Compose only builds when the tagged
image is absent, and step 6 loaded both. If you ever see it start a build on this box, stop it —
the images did not land.

Seed the permission registry and create the first admin:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.lowmem.yml \
  run --rm backend python -m src.scripts.seed_permissions

make ENV=prod LOWMEM=1 superuser             # interactive
```

---

## 8 · Verify

### 8.1 Memory is actually inside the budget

This is the check that is specific to this deployment. Run it after the site has
served real traffic for a few minutes, not immediately after `up`:

```bash
docker stats --no-stream \
  --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'
free -h
```

Read `MemPerc` as *percentage of the ceiling*, not of the host. Anything steady
above ~75% deserves attention before it becomes a restart loop. Then confirm the
ceilings are real:

```bash
docker inspect qcf_news_backend --format '{{.HostConfig.Memory}}'   # 440401920 = 420m
```

A `0` there means the overlay is not in the chain — you dropped `LOWMEM=1`.

And confirm the pool arithmetic landed, since it is the failure that shows up
days later under load rather than at deploy time:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.lowmem.yml \
  exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "SELECT count(*) AS open_connections FROM pg_stat_activity;" \
    -c "SHOW max_connections;"'
```

`open` should sit near 4–8 idle and stay well under 20; `cap` should read `40`.

### 8.2 Everything else — unchanged

[DEPLOY_EC2.md §7](DEPLOY_EC2.md) in full: containers private on loopback (§7.1),
nginx reaching both upstreams (§7.2), end to end through Cloudflare (§7.3), and
the visitor IP surviving both hops (§7.4). None of it is affected by the memory
profile, and all of it is worth running.

Watch for a restart loop in the first hour, which is how a too-tight ceiling
presents:

```bash
make ENV=prod LOWMEM=1 ps            # RESTARTS climbing = a ceiling was hit
docker events --filter event=oom --since 1h
```

---

## 9 · Deploying a change afterwards

The loop is now two machines, and which half you run depends on what changed.

**Backend or frontend code changed** — rebuild and ship:

```bash
# laptop
git push
./scripts/ship-images.sh ubuntu@<server-ip> ~/.ssh/<key>.pem

# server
cd ~/qcf-news && git pull
make ENV=prod LOWMEM=1 migrate       # if there are new migrations
make ENV=prod LOWMEM=1 up             # recreates containers on the new images
```

**Only a secret or a runtime value in `.env.production` changed** — server only,
no ship:

```bash
cd ~/qcf-news && nano .env.production
make ENV=prod LOWMEM=1 up             # recreate; `restart` does NOT re-read env
```

`make restart` reuses the existing container with its original environment. Use
`make ... up` (which runs `up -d`) whenever an env value changed.

**A `NEXT_PUBLIC_*` value changed** — that is a rebuild and a re-ship, always.
It is compiled into the client bundle; no server-side change touches it.

**Rollback.** Tag before you ship, so there is something to go back to:

```bash
# laptop, before shipping a risky change
docker tag qcfnews/frontend:latest qcfnews/frontend:$(git rev-parse --short HEAD)

# server, to roll back
docker tag qcfnews/frontend:<sha> qcfnews/frontend:latest
make ENV=prod LOWMEM=1 up
```

**Backups** — [DEPLOY_EC2.md §9](DEPLOY_EC2.md), unchanged, and more important on
a box with no build capacity: recovery here means restoring data, not rebuilding
from source on the host. `make ENV=prod LOWMEM=1 dbdump` writes to `backups/`.

---

## 10 · Troubleshooting, 2 GB edition

| Symptom | Cause | Fix |
|---|---|---|
| A container shows `Exited (137)` or RESTARTS climbing | OOM kill against its `mem_limit` | `docker events --filter event=oom`. Raise that one ceiling in the overlay and lower another; the totals have ~1 GB of slack. |
| `up` starts a **build** on the server | The tagged image is absent | Re-run `ship-images.sh`. Do not let it finish — it will OOM. |
| `exec format error` on start | Image architecture ≠ server architecture | Rebuild with `--platform`; see §6. |
| Backend 500s under load, `QueuePool limit ... overflow` | `session.py` pool change not deployed | `git pull` on the server, then `make ENV=prod LOWMEM=1 up`. See §1. |
| Backend won't start, `FATAL: sorry, too many clients` | Pool × workers × 2 exceeds `max_connections=40` | You raised `BACKEND_WORKERS` without raising `max_connections`. Both live in the overlay. |
| Postgres slow after the overlay | `work_mem=2MB` is per sort/hash *node* | Real fix is an index. Raising `work_mem` multiplies across nodes and workers. |
| Everything is slow, `free -h` shows swap in use | Something exceeded the real budget | `docker stats`; check MySQL with `ps -o rss= -C mysqld` (see §0). |
| Build killed with a bare `Killed` | You are building on the server | You are not meant to. See §0. |
| Site up but serving `http://` URLs | Image built with the wrong `NEXT_PUBLIC_SITE_URL` | Rebuild and re-ship. No server-side change can fix it. |

---

## 11 · The day the box gets more RAM

Drop `LOWMEM=1`. Nothing else changes — the overlay is purely additive, and every
value it sets falls back to the production defaults already in
`.env.production` and the base compose file. Delete
`docker-compose.lowmem.yml` from the chain, run `make ENV=prod up`, and the
stack returns to 3 workers, a 128 MB Redis and an uncapped Postgres. At that point
you can also build on the host again and retire `ship-images.sh`.
