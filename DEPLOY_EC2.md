# Deploying QCF News to EC2 behind Cloudflare

**Target origin:** `https://news.quickcelebfacts.com`
**Topology:** Cloudflare (Universal SSL) → EC2 host nginx (Cloudflare Origin CA) → Docker containers on loopback
**Companion docs:** [ENVIRONMENTS.md](ENVIRONMENTS.md) (what dev and prod differ on), [DEPLOYMENT_AUDIT.md](DEPLOYMENT_AUDIT.md) (the open findings this guide closes), [nginx/qcfnews.conf.example](nginx/qcfnews.conf.example) (the routing contract).

This is a first-deploy runbook, start to finish. Every command is meant to be
pasted. Where a step closes a finding from the audit it says so, so you can tell
what is hardening and what is merely setup.

---

## 0 · The shape of it

```
                       visitor
                          │  https  (Universal SSL — browser-trusted)
              ┌───────────▼────────────┐
              │   Cloudflare edge      │   WAF · cache · bot rules · 100 MB body cap
              └───────────┬────────────┘
                          │  https  (Origin CA cert — NOT browser-trusted)
                          │  Full (strict)
    ══════════════════════╪══════════════════ EC2 security group: 80/443 from
              ┌───────────▼────────────┐      Cloudflare ranges only
              │   nginx  (host, :443)  │      real_ip ← CF-Connecting-IP
              └──┬──────────────────┬──┘
       127.0.0.1:3000        127.0.0.1:8000
              │                     │
        ┌─────▼─────┐        ┌──────▼──────┐
        │ frontend  │        │  backend    │   gunicorn + uvicorn workers
        │ Next 16   │        │  FastAPI    │
        └───────────┘        └──────┬──────┘
                                    │  docker bridge, nothing published
                          ┌─────────▼─────────┐
                          │  postgres · redis │
                          └───────────────────┘
```

Three things this diagram is asserting, all of which you have to actually make true:

1. **Nothing but nginx can reach the containers.** They publish on `127.0.0.1`, so
   even a wide-open security group would not expose them.
2. **Nothing but Cloudflare can reach nginx.** Enforced in the security group, not
   just in ufw — Docker writes NAT rules ahead of ufw's `INPUT` chain, so ufw alone
   is not a guarantee you want to lean on.
3. **The real visitor IP survives both hops.** Without that, every rate limit in the
   app applies to Cloudflare's ~15 edge ranges instead of to visitors, and five
   failed logins anywhere on earth lock out the whole site.

---

## 1 · Before you leave your laptop

### 1.1 Commit and push — the repo has no commits yet

`git log` on this working tree reports *"your current branch 'master' does not have
any commits yet"*, with 210 staged paths. There is nothing to clone. Fix that first:

```bash
cd "/home/rakesh/Desktop/QCF News"
git status --short | head                 # sanity: no .env.production in the list
git commit -m "Initial commit: QCF News full stack"
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `.env`, `.env.development`, `.env.production` and
`backups/`. Confirm with `git ls-files | grep -i env` — you should see only the
`*.example` templates.

### 1.2 Two edits that used to live here — both are now in the repo

This section previously asked you to hand-edit the compose files before
deploying. Both edits are committed, so there is nothing to do; they are
described here because you should recognise them in `make ENV=prod config`.

**(a) The frontend no longer receives the production secrets — audit P1-4.**
`docker-compose.prod.yml` no longer sets `env_file: .env.production` on the
`frontend` service. The Next server reads seven variables and the base compose
file passes six of them; it was previously being handed `POSTGRES_PASSWORD`,
`DB_PASS`, both JWT signing keys, `NEWSLETTER_TOKEN_SECRET` and `SMTP_PASSWORD`,
none of which it uses.

Verify on the server after the first `up`:

```bash
make ENV=prod config | less        # POSTGRES_PASSWORD must appear only under db: and backend:
```

**(b) The frontend waits for the backend to be *healthy* — audit P2-10.**
`docker-compose.yml` now has `depends_on: backend: condition: service_healthy`.
This matters more than it looks: `/article` and `/category` are prerendered at
container start, so a frontend that raced ahead of gunicorn cached placeholder
content until the next revalidation.

### 1.3 Generate the secrets

Do this locally and keep them in your password manager. You will paste them into
`.env.production` on the server.

```bash
echo "POSTGRES_PASSWORD / DB_PASS   : $(openssl rand -hex 32)"
echo "JWT_SECRET_KEY                : $(openssl rand -hex 64)"
echo "JWT_REFRESH_SECRET_KEY        : $(openssl rand -hex 64)"
echo "REVALIDATION_SECRET           : $(openssl rand -hex 32)"
echo "NEWSLETTER_TOKEN_SECRET       : $(openssl rand -hex 32)"
```

> **P1-5 is fixed — hex is now a preference, not a workaround.** Both database
> URLs are built with `sqlalchemy.engine.URL.create(...)`, which escapes every
> component, and `Backend/src/db/migrations/env.py` — which used to interpolate a
> *second* copy of the URL by hand, and so broke `alembic upgrade head` at deploy
> time even after the app was fixed — now delegates to the same builder. CI proves
> it: the backend job runs the suite and the migrations against a Postgres whose
> password is `p/a+s=w@rd`. Hex is still what these commands emit, and it stays
> easier to paste without quoting mistakes.

`POSTGRES_PASSWORD` and `DB_PASS` are the same value in two variables. So are
`POSTGRES_USER`/`DB_USER` and `POSTGRES_DB`/`DB_NAME`. If they drift, the database
starts with one password and the backend connects with another.

---

## 2 · AWS: the instance

### 2.1 Sizing

| | Choice | Why |
|---|---|---|
| Instance | **t3.medium** — 2 vCPU, 4 GiB | `next build` is the binding constraint, not steady-state traffic. On a 2 GiB t3.small it OOM-kills mid-build with an unhelpful `Killed`. Steady state fits comfortably in 4 GiB: ~3 gunicorn workers, the Next standalone server, Postgres and a 128 MB Redis. |
| Storage | **gp3, 30 GiB** | Images and layers are ~3 GiB; the rest is media uploads, Postgres and logs. gp3 is cheaper than gp2 at the same size and gives 3000 IOPS baseline. |
| AMI | **Ubuntu Server 24.04 LTS** | Ships nginx 1.24.0 and a current OpenSSL. 22.04's nginx 1.18 is from April 2020 and is what the audit flags in P2-11. Note that **1.24 still predates `http2 on;`** (that needs ≥ 1.25.1), so the config below keeps the `listen 443 ssl http2;` spelling. |
| Metadata | **IMDSv2 required** | One-click in the launch wizard; closes the classic SSRF-to-credentials path. |
| Elastic IP | **Yes, allocate and associate** | Without it, a stop/start changes the public IP and your Cloudflare A record points at someone else's instance. |

### 2.2 Security group

Two rules only.

**SSH** — port 22, source *your* IP as a `/32`. Not `0.0.0.0/0`. If you have Session
Manager set up, skip the SSH rule entirely.

**HTTP/HTTPS from Cloudflare only.** This is what makes the Origin CA certificate
and the `real_ip` block meaningful — an open 80/443 means anyone who learns the
Elastic IP bypasses the WAF, the bot rules and the edge rate limits in one request.

Cloudflare publishes 15 IPv4 and 7 IPv6 ranges, so pasting them as individual rules
costs 44 entries against a default limit of 60. A managed prefix list is cleaner and
survives Cloudflare adding a range:

```bash
# IPv4 prefix list
PLV4=$(aws ec2 create-managed-prefix-list \
  --prefix-list-name cloudflare-ipv4 --address-family IPv4 --max-entries 30 \
  --entries $(curl -s https://www.cloudflare.com/ips-v4 | awk '{printf "Cidr=%s ", $1}') \
  --query 'PrefixList.PrefixListId' --output text)

# IPv6 prefix list
PLV6=$(aws ec2 create-managed-prefix-list \
  --prefix-list-name cloudflare-ipv6 --address-family IPv6 --max-entries 20 \
  --entries $(curl -s https://www.cloudflare.com/ips-v6 | awk '{printf "Cidr=%s ", $1}') \
  --query 'PrefixList.PrefixListId' --output text)

SG=sg-xxxxxxxxxxxx            # your instance's security group

for PORT in 80 443; do
  aws ec2 authorize-security-group-ingress --group-id $SG \
    --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,PrefixListIds=[{PrefixListId=$PLV4}]"
  aws ec2 authorize-security-group-ingress --group-id $SG \
    --ip-permissions "IpProtocol=tcp,FromPort=$PORT,ToPort=$PORT,PrefixListIds=[{PrefixListId=$PLV6}]"
done
```

Console equivalent: **VPC → Managed prefix lists → Create**, paste the ranges from
`cloudflare.com/ips-v4` and `/ips-v6`, then in the security group add two inbound
rules with source *Prefix list*.

Re-check the ranges when you renew the Origin certificate. They change rarely, but
they do change, and a new range you have not allowed shows up as intermittent 522s
for a fraction of visitors — which looks like a flaky server, not a firewall.

### 2.3 First contact

```bash
ssh -i ~/.ssh/your-key.pem ubuntu@<ELASTIC_IP>
sudo apt-get update && sudo apt-get upgrade -y
sudo timedatectl set-timezone UTC          # logs and cron in one timezone
sudo hostnamectl set-hostname qcf-news
```

Enable unattended security updates — a public origin that nobody patches is the
slowest of all the failure modes here:

```bash
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes
```

---

## 3 · Cloudflare: DNS and the origin certificate

This assumes `quickcelebfacts.com` is **already** a zone on Cloudflare — its
nameservers point at Cloudflare and the dashboard shows it Active. If it is not,
add the zone and change nameservers at your registrar first; propagation is usually
minutes but can take hours, and nothing below works until it is done.

### 3.1 The DNS record

**DNS → Records → Add record**

| Field | Value |
|---|---|
| Type | `A` |
| Name | `news` |
| IPv4 address | your Elastic IP |
| Proxy status | **Proxied** (orange cloud) |
| TTL | Auto |

Do not add a `www.news` record. `www.news.quickcelebfacts.com` is a *second*-level
subdomain, and Cloudflare's Universal SSL certificate covers the apex and one level
of subdomain only — it would be the one hostname on your zone without a valid edge
certificate. The nginx config below drops the `www.` variant for this reason.

`news.quickcelebfacts.com`, being first-level, **is** covered by Universal SSL. You
need no browser-facing certificate of your own.

### 3.2 The Origin CA certificate

**SSL/TLS → Origin Server → Create Certificate**

- Private key type: **RSA (2048)** — universally compatible; ECDSA is fine too.
- Hostnames: **`news.quickcelebfacts.com`** only. Not `*.quickcelebfacts.com` — a
  wildcard on this box means a compromise of this box is a certificate valid for
  every hostname on the zone, including whatever serves the apex.
- Validity: 15 years.

Cloudflare shows the certificate and key **once**. Copy both into your password
manager before closing the dialog, then put them on the host:

```bash
sudo install -d -m 700 /etc/ssl/cloudflare

sudo tee /etc/ssl/cloudflare/qcfnews.pem >/dev/null <<'PEM'
-----BEGIN CERTIFICATE-----
...paste the origin certificate...
-----END CERTIFICATE-----
PEM

sudo tee /etc/ssl/cloudflare/qcfnews.key >/dev/null <<'KEY'
-----BEGIN PRIVATE KEY-----
...paste the private key...
-----END PRIVATE KEY-----
KEY

sudo chmod 644 /etc/ssl/cloudflare/qcfnews.pem
sudo chmod 600 /etc/ssl/cloudflare/qcfnews.key
sudo chown root:root /etc/ssl/cloudflare/qcfnews.*

# Confirm the key matches the certificate — these two hashes must be identical
sudo openssl x509 -noout -modulus -in  /etc/ssl/cloudflare/qcfnews.pem | openssl md5
sudo openssl rsa  -noout -modulus -in  /etc/ssl/cloudflare/qcfnews.key | openssl md5

# And note the expiry somewhere with a calendar reminder — nothing will remind you
sudo openssl x509 -noout -enddate -in /etc/ssl/cloudflare/qcfnews.pem
```

There is no certbot here and no renewal job. That is the trade for a 15-year
certificate: one calendar entry instead of a cron job that can silently stop.

### 3.3 SSL/TLS mode — check the apex before you change this

**SSL/TLS → Overview → Full (strict)**.

> **This setting is zone-wide.** If `quickcelebfacts.com` itself is currently served
> from somewhere on **Flexible**, switching the zone to Full (strict) will break the
> apex site — Cloudflare will start requiring a valid certificate from an origin
> that is only listening on plain HTTP. Look at what the apex is doing *before* you
> flip it.
>
> If the apex genuinely needs Flexible, do not compromise this subdomain to
> accommodate it. Use **Rules → Configuration Rules** to scope the SSL mode: a rule
> matching `Hostname equals news.quickcelebfacts.com` with the SSL setting set to
> *Full (strict)*, leaving the zone default alone. Then fix the apex separately —
> Flexible means Cloudflare speaks unencrypted HTTP to that origin across the public
> internet, which is not a configuration to leave running.

Why strict matters here specifically: in **Flexible**, Cloudflare talks HTTP to
port 80, our `:80 → :443` redirect sends it back, and the visitor sees
`ERR_TOO_MANY_REDIRECTS` — the classic symptom, and the one people misdiagnose as
an nginx bug. In **Full** (not strict), any certificate is accepted, including one
presented by whoever is between Cloudflare and you.

---

## 4 · Host bootstrap

### 4.1 Swap — do this before the first build

4 GiB of RAM plus `npm ci` plus `next build` plus a running Postgres is the exact
combination that gets the build OOM-killed. Swap costs nothing and removes the
failure mode:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo sysctl -w vm.swappiness=10                                  # prefer RAM
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
free -h
```

### 4.2 Docker

From Docker's own repository — Ubuntu's `docker.io` package lags and does not
include the Compose v2 plugin the Makefile requires:

```bash
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
                        docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker ubuntu
sudo systemctl enable --now docker
```

Log out and back in for the group to take effect, then `docker compose version`
must print v2.x.

### 4.3 Cap the container logs — audit P2-5

No compose file sets logging options, gunicorn runs `--access-logfile -` (one line
per request), and Docker's default `json-file` driver never rotates. On a 30 GiB
disk that is a slow-motion outage: the volume fills, Postgres cannot write, and the
site goes down for a reason that looks nothing like logging. Set it once,
daemon-wide, so it applies to every container including ones added later:

```bash
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
JSON
sudo systemctl restart docker
```

`live-restore` keeps containers running across a Docker daemon restart.

### 4.4 nginx

```bash
sudo apt-get install -y nginx
nginx -v                                    # expect 1.24.0 on Ubuntu 24.04
sudo systemctl enable nginx
```

### 4.5 ufw — belt to the security group's braces

```bash
sudo ufw allow 22/tcp
for c in $(curl -s https://www.cloudflare.com/ips-v4) \
         $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow proto tcp from $c to any port 80,443
done
sudo ufw --force enable
sudo ufw status numbered
```

> ufw is the second line, not the first. Docker publishes ports by writing NAT
> rules **ahead of** ufw's `INPUT` chain, so a container published on `0.0.0.0`
> is reachable from off-host even under `ufw default deny incoming`. Our containers
> publish on `127.0.0.1`, and the security group is the real boundary. Keep both.

---

## 5 · The nginx site config

A finished, deployment-specific config is committed at
[nginx/news.quickcelebfacts.com.conf](nginx/news.quickcelebfacts.com.conf). It has no
`CHANGE_ME` left in it — copy it up and reload:

```bash
sudo install -d /home/conf
sudo cp ~/qcf-news/nginx/news.quickcelebfacts.com.conf /home/conf/qcfnews.conf
sudo nginx -t && sudo systemctl reload nginx
```

It was validated and behaviourally tested against live nginx before being committed;
the results are in §7.6.

### How it differs from `nginx/qcfnews.conf.example`

| Change | Why |
|---|---|
| `server_name news.quickcelebfacts.com;` in both blocks, no `www.` variant | `www.news.quickcelebfacts.com` is a *second*-level subdomain, outside Universal SSL's coverage — §3.1. |
| Certificate paths point at `/etc/ssl/cloudflare/qcfnews.{pem,key}` | Where §3.2 installed them. |
| `listen 443 ssl http2;` kept, not `http2 on;` | Ubuntu 24.04 ships nginx 1.24.0; `http2 on;` needs ≥ 1.25.1 and makes nginx refuse to start with *"unknown directive"* — which on a first deploy reads as a broken config rather than a version mismatch. |
| **The general `location /api/` block is commented out** | Takes the whole FastAPI surface — including unauthenticated `POST /api/v1/users/register` — off the internet. Closes audit P2-2. |
| **New: `location = /api/v1/newsletter/unsubscribe`** → backend | The one `/api/v1` path that must stay public. See below. |
| **New: `location = /api/admin/session/login`** with a tight `qcfnews_login` zone (10 r/m, burst 5) | The application's own 5-per-minute login limit lives in Redis and **fails open** when Redis is down (audit P2-3). This is the layer that keeps working when that one doesn't. Placed on the *BFF* path, which is what a browser actually posts to — not on `/api/v1/users/login`, which no browser ever calls. |
| `server_tokens off;` and per-site `access_log` / `error_log` | Keeps the nginx version out of error pages, and keeps this site's requests out of the shared default log — which matters for the §7 checks. |

### One correction to the audit's P2-2 advice

`DEPLOYMENT_AUDIT.md` says deleting the `/api/` block is free because "nothing in a
browser ever calls `/api/v1` directly". That is true of browsers, and it is not the
whole story.

[`emails.py:41`](Backend/src/apps/v1/newsletter/emails.py#L41) builds the RFC 8058
one-click unsubscribe URL as `{SITE_BASE_URL}/api/v1/newsletter/unsubscribe`, and
ships it in a `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header. **Mail
providers POST to that URL directly** — no browser, no BFF hop — and Gmail and Yahoo
both require the header of bulk senders. Delete `/api/` wholesale and one-click
opt-out silently stops working, taking deliverability with it.

So the config keeps an exact-match carve-out for that single path and drops the rest.
That closes P2-2 without breaking the newsletter. It only matters once
`NEWSLETTER_ENABLED=True`, but it is correct from the first deploy.

Verified against the route table: `POST /api/v1/newsletter/unsubscribe` exists
([`subscriptions.py:72`](Backend/src/apps/v1/newsletter/routes/subscriptions.py#L72)),
the confirm page is a server component that calls the API over the Docker network,
and the unsubscribe form posts to the Next BFF route — so nothing else needs the
public API.

### Two parts worth understanding, not just copying

- **`set_real_ip_from` over Cloudflare's ranges plus `real_ip_header
  CF-Connecting-IP`.** Every request reaches you from a Cloudflare edge address.
  Without this, `$remote_addr` *is* Cloudflare: both `limit_req` zones bucket the
  entire internet into ~15 ranges, the backend's 5-per-minute login cap locks out
  every reader after five global attempts, and `newsletter_subscribers` records
  Cloudflare as the consenting party. It fails safe — a peer outside those ranges is
  not trusted to set `CF-Connecting-IP` — which is why it is not itself a bypass.
  A useful side effect: nginx's default `combined` log format logs `$remote_addr`,
  which realip has already rewritten, so the access log carries true visitor
  addresses with no custom `log_format`.
- **`proxy_set_header X-Forwarded-For $remote_addr;`** and *not*
  `$proxy_add_x_forwarded_for`. The backend runs `RATE_LIMIT_TRUST_PROXY=True` and
  reads the **left-most** entry
  ([`client_ip.py:34`](Backend/src/utils/client_ip.py#L34)). Cloudflare forwards the
  client's own `X-Forwarded-For` inside the chain it builds, so appending would put
  an attacker-chosen value in front of the real one — a fresh rate-limit bucket per
  request, which is the same thing as no rate limit at all. Overwriting is what makes
  the header worth trusting.

### Wire it in

`server`, `upstream` and `limit_req_zone` are all http-context directives. The
include must go **inside** `http { }` — at the top level nginx refuses to start with
*"server directive is not allowed here"*:

```bash
sudo nano /etc/nginx/nginx.conf
```

Add next to the existing `include /etc/nginx/sites-enabled/*;` line:

```nginx
http {
    ...
    include /etc/nginx/sites-enabled/*;
    include /home/conf/qcfnews.conf;
}
```

Optional but worth it — replace Ubuntu's default site with a catch-all that answers
nothing, so a request arriving with an unexpected `Host` header (a scanner hitting
the Elastic IP, say) gets no page and no information:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/sites-available/catch-all >/dev/null <<'CONF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}
CONF
sudo ln -sf /etc/nginx/sites-available/catch-all /etc/nginx/sites-enabled/catch-all
```

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

`nginx -t` failing with *"cannot load certificate"* means §3.2 did not land; failing
with *"unknown directive http2"* means you edited the `listen` line.

### The routing table it implements

nginx matches the **longest prefix**, and an exact (`=`) match beats every prefix, so
the order of the blocks in the file does not matter.

| Path | Upstream | Notes |
|---|---|---|
| `= /api/admin/session/login` | `:3000` Next | Tight `qcfnews_login` zone — beats the prefix below |
| `/api/admin/*` | `:3000` Next | BFF — admin session cookies, authenticated proxy |
| `/api/revalidate` | `:3000` Next | On-demand cache invalidation |
| `/api/newsletter/*` | `:3000` Next | BFF — signup and unsubscribe form |
| `= /api/v1/newsletter/unsubscribe` | `:8000` FastAPI | RFC 8058 one-click, POSTed by mail providers |
| `/api/*` | — | **Not proxied.** Commented out; restore only for a real API client |
| `/media/*` | `:8000` FastAPI | `immutable` is safe — filenames carry a uuid4 |
| `= /health` | `:8000` FastAPI | `access_log off` |
| `/_next/static/*` | `:3000` Next | Immutable build assets |
| everything else | `:3000` Next | Pages, `/admin`, feeds, `/og/*`, the image optimiser |

**The Next-app rows are the ones that break things.** `/api/admin/*`,
`/api/revalidate` and `/api/newsletter/*` live in the Next app, not FastAPI. A
blanket `/api/ → backend` rule 404s admin login, cache invalidation and newsletter
signup — silently, with nothing in any log naming the cause.

## 6 · Deploy the stack

### 6.1 Get the code onto the host

A read-only deploy key is the right shape — it cannot push, and revoking it does not
touch your own GitHub account:

```bash
ssh-keygen -t ed25519 -C "qcf-news-ec2-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that public key at **GitHub → your repo → Settings → Deploy keys → Add deploy
key**, leaving *Allow write access* unchecked. Then:

```bash
ssh -T git@github.com                       # accept the host key
git clone git@github.com:Rakeshkhadka/qcf-news.git ~/qcf-news
cd ~/qcf-news
```

### 6.2 `.env.production`

```bash
cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production
```

The values that are specific to this deployment — the rest of the template's
defaults are already correct:

```ini
COMPOSE_PROJECT_NAME=qcf_news
PROJECT_NAME=qcf_news
NODE_ENV=production
DEBUG=False
ENABLE_API_DOCS=False

# ── Database ── same value in both pairs, hex not base64 (§1.3)
POSTGRES_USER=qcf_news
POSTGRES_PASSWORD=<hex-32 from §1.3>
POSTGRES_DB=qcf_news
DB_NAME=qcf_news
DB_USER=qcf_news
DB_PASS=<the same hex-32>

# ── Secrets ──
JWT_SECRET_KEY=<hex-64>
JWT_REFRESH_SECRET_KEY=<a different hex-64>
REVALIDATION_SECRET=<hex-32>
NEWSLETTER_TOKEN_SECRET=<hex-32>

# ── Origins — all three are https, all three are the subdomain ──
NEXT_PUBLIC_SITE_URL=https://news.quickcelebfacts.com
SITE_BASE_URL=https://news.quickcelebfacts.com
CORS_ALLOW_ORIGINS=https://news.quickcelebfacts.com
API_INTERNAL_ORIGIN=http://backend:8000
NEXT_PUBLIC_MEDIA_BASE_URL=
PUBLIC_BASE_URL=

# ── Sizing for a 2-vCPU box sharing RAM with Next, Postgres and Redis ──
BACKEND_WORKERS=3
REDIS_MAXMEMORY=128mb

# ── Uploads: 9 × 10 MB = 90 MB, under Cloudflare's 100 MB cap (§8.3) ──
MAX_IMAGE_SIZE_MB=10
MAX_IMAGES_PER_UPLOAD=9

# ── Newsletter off until SMTP is real (see below) ──
NEWSLETTER_ENABLED=False
NEXT_PUBLIC_NEWSLETTER_ENABLED=false

SITE_NAME=Celeb Scoop
```

Three of these will cost you a rebuild rather than a restart if you get them wrong:

> **`NEXT_PUBLIC_SITE_URL` must be `https://` in the *first* build.** Next inlines
> `NEXT_PUBLIC_*` into the client bundle at build time. A stack built with `http://`
> keeps publishing `http://` canonical URLs, sitemap entries, RSS links and social
> cards no matter what nginx and Cloudflare are doing — and search engines will have
> indexed them before you notice. Same for `NEXT_PUBLIC_MEDIA_BASE_URL` and
> `NEXT_PUBLIC_NEWSLETTER_ENABLED`. Changing any of them later is
> `make ENV=prod build`, not `make ENV=prod restart`.

> **Leave `NEWSLETTER_ENABLED=False` until SMTP is genuinely configured.** The
> backend validates `NEWSLETTER_FROM_EMAIL`, `SITE_BASE_URL`, `POSTAL_ADDRESS` and
> `SMTP_HOST` at startup and **refuses to boot** if the set is incomplete. On a first
> deploy that reads as "the backend is broken". When you do turn it on, flip
> `NEXT_PUBLIC_NEWSLETTER_ENABLED=true` with it and rebuild — they must agree, or the
> form renders and the API refuses it. Set up SPF, DKIM and DMARC for whatever
> domain sends, or the confirmations land in spam.

> **`POSTAL_ADDRESS` must be a real address** when the newsletter is on. CAN-SPAM
> §7704(a)(5) requires one in every message, and the backend will not start without it.

### 6.3 Build, migrate, start

```bash
cd ~/qcf-news

make ENV=prod build            # 5–10 min on a t3.medium; this is what needs the swap
make ENV=prod migrate          # runs alembic to completion, exits non-zero on failure
make ENV=prod up
make ENV=prod ps               # db and redis healthy, backend healthy, frontend up
```

Seed the permission registry and create the first admin:

```bash
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm backend python -m src.scripts.seed_permissions

make ENV=prod superuser        # interactive
```

`make ENV=prod migrate` propagates alembic's exit code, so it is safe to gate a
release script on it. If it fails with a connection error, the odds are the
`POSTGRES_PASSWORD`/`DB_PASS` pair does not match, or a base64 password slipped
through §1.3.

---

## 7 · Verify

### 7.1 The containers are private — audit P1-3

```bash
ss -ltnp | grep -E ':(3000|8000)'
```

Every line must read `127.0.0.1:3000` / `127.0.0.1:8000`. If you see `0.0.0.0` or
`*`, stop: the site is being served on a second origin with no TLS, no Cloudflare,
no WAF, no security headers and no working rate limiting — and Google will index it.
Fix the `ports:` entry in `docker-compose.prod.yml` and recreate.

From your laptop, confirm the same thing from outside:

```bash
curl -sS --max-time 5 http://<ELASTIC_IP>:3000/ ; echo "exit=$?"   # must time out
curl -sS --max-time 5 http://<ELASTIC_IP>:8000/health ; echo "exit=$?"   # must time out
```

### 7.2 nginx reaches both upstreams

On the host, before involving Cloudflare:

```bash
curl -sS -o /dev/null -w '%{http_code}  %{url_effective}\n' \
  -k -H 'Host: news.quickcelebfacts.com' \
  https://127.0.0.1/ \
  https://127.0.0.1/health \
  https://127.0.0.1/feed.xml \
  https://127.0.0.1/sitemap.xml \
  https://127.0.0.1/robots.txt \
  https://127.0.0.1/api/admin/session/me \
  https://127.0.0.1/api/newsletter/subscribe \
  https://127.0.0.1/api/v1/categories
```

`-k` is correct here and only here: the Origin CA certificate is not browser-trusted
by design, and you are bypassing the edge on purpose to isolate the origin.

| Path | Expect | Meaning |
|---|---|---|
| `/`, `/health`, `/feed.xml`, `/sitemap.xml`, `/robots.txt` | `200` | Both upstreams answering |
| `/api/admin/session/me` | **`401`** | BFF reachable and correctly unauthenticated |
| `/api/newsletter/subscribe` | **`405`** | BFF reachable, POST-only |
| `/api/v1/categories` | **`404`** | Correct — the public API is deliberately not proxied (§5) |

> The 401 and the 405 are the meaningful ones. **A 404 on either means the routing
> table is wrong** — `/api/admin/*`, `/api/revalidate` and `/api/newsletter/*` live
> in the Next app, not FastAPI, and a blanket `/api/ → backend` rule 404s admin
> login, cache invalidation and newsletter signup silently, with nothing in any log
> naming the cause. It is the single most common way to break this deployment.
>
> The 404 on `/api/v1/categories` is the *opposite* — it is the P2-2 fix working.
> If you get a `200` or a `307` there, the general `location /api/` block is still
> active and FastAPI's unauthenticated `POST /api/v1/users/register` is on the
> public internet.

One more, only once the newsletter is switched on — the RFC 8058 path must stay
reachable while the rest of the API does not:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -k -X POST \
  -H 'Host: news.quickcelebfacts.com' \
  'https://127.0.0.1/api/v1/newsletter/unsubscribe?token=nonsense'
```

Anything but `404` is right here — `400`/`422` on a junk token is the expected
answer. A `404` means the exact-match carve-out is missing and one-click unsubscribe
is broken.

### 7.3 End to end, through Cloudflare

```bash
curl -sS -o /dev/null -w '%{http_code}  %{url_effective}\n' \
  https://news.quickcelebfacts.com/ \
  https://news.quickcelebfacts.com/health \
  https://news.quickcelebfacts.com/feed.xml \
  https://news.quickcelebfacts.com/sitemap.xml \
  https://news.quickcelebfacts.com/robots.txt

# Confirm the edge is actually in front
curl -sSI https://news.quickcelebfacts.com/ | grep -iE '^(cf-ray|server|cf-cache-status)'
```

Then check the canonical origin baked into the bundle is right — this is the one
that is expensive to fix later:

```bash
curl -sS https://news.quickcelebfacts.com/sitemap.xml | head -5
curl -sS https://news.quickcelebfacts.com/ | grep -o '<link rel="canonical"[^>]*>' | head -1
```

Both must say `https://news.quickcelebfacts.com`. Any `http://` here means the build
picked up the wrong `NEXT_PUBLIC_SITE_URL`; fix `.env.production` and
`make ENV=prod build && make ENV=prod up -d` before anything gets crawled.

### 7.4 The visitor IP survives both hops — audit P1-1

This is the test that separates a working rate limiter from a decorative one, and
nothing earlier in this list catches it:

```bash
make ENV=prod logs SERVICE=backend
```

With that tailing, load the site **from a phone on mobile data**. The address in the
access log must be the phone's public IP. If it is `172.x` or `104.x`, that is
Cloudflare — `real_ip` is not working, and every rate limit in the application is now
effectively global.

Prove the spoofing path is closed too:

```bash
curl -sS -H 'X-Forwarded-For: 1.2.3.4, 9.9.9.9' https://news.quickcelebfacts.com/health
```

The backend must log your real address, not `1.2.3.4`.

### 7.5 By hand

Admin login at `/admin`, a multi-image upload, publish an article, confirm it appears
on the homepage (the revalidate path), and open the article's social card in a
preview tool.

### 7.6 What was already tested before you started

`nginx/news.quickcelebfacts.com.conf` was run for real against nginx 1.18.0 on
`:8080`/`:8443` before being committed — loopback added to `set_real_ip_from` to
stand in for a Cloudflare edge, and both upstreams pointed at an echo server that
reports which one answered. `nginx -t` passes. These results are about the config
file, not about your host; the checks in 7.1–7.5 are still the ones that matter.

```
ROUTING — which upstream answers
  /api/admin/session/login          FRONTEND     exact match beats the prefix
  /api/admin/proxy/articles         FRONTEND
  /api/revalidate                   FRONTEND
  /api/newsletter/subscribe         FRONTEND
  /api/v1/newsletter/unsubscribe    BACKEND      RFC 8058 one-click carve-out
  /api/v1/users/register            FRONTEND     API is off the internet (P2-2)
  /api/v1/categories                FRONTEND     ditto
  /media/x.jpg                      BACKEND
  /health                           BACKEND
  /_next/static/a.js                FRONTEND
  /                                 FRONTEND
  /admin                            FRONTEND

REAL IP
  sent  CF-Connecting-IP: 203.0.113.9
        X-Forwarded-For:  1.2.3.4, 9.9.9.9        <- attacker-supplied
  got   xff=203.0.113.9  xreal=203.0.113.9  proto=https
        the spoofed chain was discarded entirely

  sent  X-Forwarded-For: 1.2.3.4  (no CF header, direct-to-origin)
  got   xff=127.0.0.1  xreal=127.0.0.1
        fails safe; an untrusted peer cannot name itself

RATE LIMIT ZONES
  12 rapid POSTs to /api/admin/session/login   200 x6, then 503 x6
  12 rapid GETs  to /                          200 x12   (not throttled)

CACHE HEADERS
  /media/x.jpg        public, max-age=2592000,  immutable
  /_next/static/a.js  public, max-age=31536000, immutable

:80 REDIRECT
  301 -> https://news.quickcelebfacts.com/some/path
```

The `/api/v1/users/register` row is the P2-2 fix working: the request reaches Next,
which 404s it, instead of reaching FastAPI's open registration endpoint. The two
real-IP results are the ones that matter most — together they are the difference
between a working login rate limit and one an attacker turns off by adding a header.

**Not covered by any of this:** real TLS behaviour through Cloudflare, the security
group, backup restore, and the contents of the `/home/conf/qcfnews.conf` you actually
end up with.

---

## 8 · The Cloudflare settings pass

The certificate does not give you any of these, and each one has a distinct failure
mode.

### 8.1 Cache Rules — audit P2-13

**Caching → Cache Rules**, in this order:

| Order | Match | Setting |
|---|---|---|
| 1 | URI Path starts with `/api/` **or** `/admin` | **Bypass cache** |
| 2 | URI Path starts with `/media/` | Cache · respect origin TTL |
| 3 | URI Path starts with `/_next/static/` | Cache · respect origin TTL |

Cloudflare does not cache HTML or `Set-Cookie` responses by default, so rule 1 is
belt-and-braces today. It stops being belt-and-braces the moment someone reaches for
"Cache Everything" to make the site feel faster — at which point, without it, one
reader's admin session is served to another.

### 8.2 HSTS

**SSL/TLS → Edge Certificates → HTTP Strict Transport Security**. Prefer the
dashboard toggle over the commented-out `add_header` in the nginx config: the edge
certificate is the one browsers actually validate, and the toggle is reversible in a
way a year-long header is not. Turn it on only *after* §7.3 passes.

Also on that page: **Always Use HTTPS** on, **Minimum TLS Version** 1.2.

### 8.3 The 100 MB body cap — audit P1-8

Cloudflare rejects request bodies over 100 MB on Free, Pro and Business. The default
`MAX_IMAGES_PER_UPLOAD=20 × MAX_IMAGE_SIZE_MB=10` is 200 MB in a single multipart
request — twice the cap.

The failure mode is the bad kind: **the edge answers 413 and the request never
reaches nginx or FastAPI**, so nothing appears in any log you control and the admin
UI shows an error with no cause. It looks exactly like a bug in the upload code.

§6.2 already sets `MAX_IMAGES_PER_UPLOAD=9` (90 MB worst case). `client_max_body_size
100M` in the nginx config matches the edge, so anything Cloudflare would forward,
your origin accepts. If you raise either value, keep the product under 100 — or have
the admin UI upload in smaller batches.

### 8.4 The 100 s timeout — audit P2-12

Cloudflare cuts a request off at 100 s on Free and shows the visitor a **524** the
origin never sees. The reference config's `proxy_read_timeout 90s` is deliberately
shorter, so a slow route fails at your origin where it is logged. Watch for 524s in
Cloudflare analytics: they indicate a slow route, not a network fault.

### 8.5 Optional: Authenticated Origin Pulls

Stronger than the IP allow-list, because it survives Cloudflare adding a range and
does not depend on your security group staying correct. Download Cloudflare's
origin-pull CA, then uncomment the two lines already present in the config:

```nginx
    ssl_client_certificate /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem;
    ssl_verify_client on;
```

Enable it in the dashboard at **SSL/TLS → Origin Server → Authenticated Origin Pulls**.

---

## 9 · Backups — audit P1-6

Right now `postgres_data` and `backend_media` are local named volumes on one EBS
volume, and `make ENV=prod dbdump` writes an unencrypted `.sql.gz` **to the same
host**, by hand. There is no media backup at all, no retention, no off-host copy and
no rehearsed restore. One disk or one `docker compose down -v` and every article and
every upload is gone permanently.

**Do this before launch, not after.**

### 9.1 A bucket and an instance role

```bash
aws s3 mb s3://qcfnews-backups --region <your-region>
aws s3api put-bucket-versioning --bucket qcfnews-backups \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket qcfnews-backups \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Attach an IAM role to the instance with `s3:PutObject`, `s3:GetObject` and
`s3:ListBucket` on `arn:aws:s3:::qcfnews-backups/*` — an instance role, not access
keys in a file. Add a lifecycle rule transitioning objects to Glacier at 30 days and
expiring them at 365.

### 9.2 The script

```bash
sudo tee /usr/local/bin/qcf-backup.sh >/dev/null <<'SH'
#!/usr/bin/env bash
set -euo pipefail

REPO=/home/ubuntu/qcf-news
BUCKET=s3://qcfnews-backups
STAMP=$(date -u +%Y%m%d-%H%M%S)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cd "$REPO"
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml"

# Database
$DC exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > "$TMP/db-$STAMP.sql.gz"

# Media volume
docker run --rm \
  -v qcf_news_backend_media:/data:ro \
  -v "$TMP":/backup \
  alpine tar czf "/backup/media-$STAMP.tar.gz" -C /data .

# Off-host, encrypted at rest with SSE-S3
aws s3 cp "$TMP/db-$STAMP.sql.gz"    "$BUCKET/db/"    --sse AES256
aws s3 cp "$TMP/media-$STAMP.tar.gz" "$BUCKET/media/" --sse AES256

echo "backup ok $STAMP  db=$(du -h "$TMP/db-$STAMP.sql.gz" | cut -f1)  media=$(du -h "$TMP/media-$STAMP.tar.gz" | cut -f1)"
SH

sudo chmod +x /usr/local/bin/qcf-backup.sh
sudo -u ubuntu /usr/local/bin/qcf-backup.sh          # run it once, now
```

Schedule it daily at 03:15 UTC:

```bash
sudo -u ubuntu crontab -e
# 15 3 * * * /usr/local/bin/qcf-backup.sh >> /home/ubuntu/backup.log 2>&1
```

`logrotate` the log, and — this is the part everyone skips — **alert on the absence
of a fresh object in the bucket**, not on the script erroring. A cron job that stopped
running produces no error at all.

### 9.3 Rehearse the restore

A backup you have not restored is a hypothesis. Do this once, on a throwaway
instance or a second compose project, and write down how long it took:

```bash
gunzip -c db-<stamp>.sql.gz | \
  docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml \
  exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

docker run --rm -v qcf_news_backend_media:/data \
  -v "$PWD":/backup alpine \
  sh -c 'tar xzf /backup/media-<stamp>.tar.gz -C /data'
```

---

## 10 · Day two

### Deploying a change

```bash
cd ~/qcf-news
git pull

make ENV=prod build            # required for any NEXT_PUBLIC_* change
make ENV=prod migrate          # gate on this; it exits non-zero on failure
make ENV=prod up               # recreates only what changed
make ENV=prod ps
curl -sS -o /dev/null -w '%{http_code}\n' https://news.quickcelebfacts.com/
```

nginx is untouched by an application deploy and needs no reload.

### Rollback

```bash
cd ~/qcf-news
git checkout <previous-good-sha>
make ENV=prod build && make ENV=prod up
```

A **schema** rollback is the hard case: `make ENV=prod downgrade` reverses one
migration, but if the new code has already written rows in the new shape, the
honest path is restoring the pre-deploy database dump. Take one before any deploy
that carries a migration — `/usr/local/bin/qcf-backup.sh` is one command.

### Logs and health

```bash
make ENV=prod logs SERVICE=backend
make ENV=prod logs SERVICE=frontend
sudo tail -f /var/log/nginx/error.log
docker stats --no-stream
df -h /
```

### Reboots

`restart: unless-stopped` plus `systemctl enable docker` brings the stack back by
itself; nginx comes back via its own unit. Verify after the first reboot rather than
assuming it. Note that `make ENV=prod down` leaves containers stopped until the next
`up` — `unless-stopped` means exactly that.

### Housekeeping

```bash
docker system prune -af --filter "until=168h"     # monthly; reclaims old build layers
```

---

## 11 · Troubleshooting

| Symptom | Almost always |
|---|---|
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare SSL mode is **Flexible**. It speaks HTTP to :80, our config redirects to :443, forever. Set Full (strict) — §3.3. |
| **521** Web server is down | nginx is not running, or the security group does not allow the Cloudflare range the request came from. `sudo systemctl status nginx`, then re-check §2.2. |
| **522** Connection timed out | Security group or ufw blocking 443, or the Elastic IP in the DNS record is stale. |
| **526** Invalid SSL certificate | Full (strict) with a bad or mismatched Origin CA cert. Re-run the modulus check in §3.2. |
| **524** Timeout occurred | The origin took over 100 s. A slow route, not a network fault — the 90 s `proxy_read_timeout` should be catching it in your own logs first. |
| **502** from nginx | Containers are down, or the published ports do not match the `upstream` blocks. `make ENV=prod ps` and `ss -ltnp \| grep -E ':(3000\|8000)'`. |
| **404 on admin login** / revalidate / newsletter signup | The `/api/admin/`, `/api/revalidate`, `/api/newsletter/` locations are missing or `/api/` is catching them. Those live in **Next**, not FastAPI — §7.2. |
| Upload fails, nothing in any log | Cloudflare's 100 MB cap, rejected at the edge. `MAX_IMAGES_PER_UPLOAD × MAX_IMAGE_SIZE_MB` must stay under 100 — §8.3. |
| Rate limits behave globally; everyone locked out after five logins | `real_ip` is not applying. Test with §7.4. |
| Canonical URLs / sitemap say `http://` | `NEXT_PUBLIC_SITE_URL` was wrong at **build** time. Fix `.env.production`, then `make ENV=prod build` — a restart will not do it. |
| Backend will not start, complains about newsletter config | `NEWSLETTER_ENABLED=True` without all of `NEWSLETTER_FROM_EMAIL`, `SITE_BASE_URL`, `POSTAL_ADDRESS`, `SMTP_HOST`. It refuses to boot half-configured on purpose. |
| Build killed with no message | OOM. Add the swap file from §4.1. |
| Old `*_nginx` container holds :80 | Leftover from the pre-host-nginx stack. `make ENV=prod down` once with `--remove-orphans`, then start host nginx. |

---

## 12 · Still open after this guide

This runbook closes P1-1 through P1-8 from [DEPLOYMENT_AUDIT.md](DEPLOYMENT_AUDIT.md).
What remains:

- **P2-7 — no observability.** No error tracking, no metrics, no uptime check, no
  alerting. At minimum: an external uptime check on `/health`, an alert on 5xx rate,
  and an alert on the backup object not appearing (§9.2). The rate limiter also
  **fails open** when Redis is unavailable (P2-3) — it logs a warning and allows the
  request, so that warning is worth alerting on specifically.
- **P2-4 — `/health` is liveness-only.** It returns `{"status":"ok"}` unconditionally
  and stays green with the database down, which is also what `depends_on:
  service_healthy` now gates on. Add `/health/ready` that checks Postgres and Redis.
- **Lint and type debt, currently advisory in CI.** `flake8 src tests` reports 15
  findings and `mypy src` reports 190; both run with `continue-on-error` so they are
  visible without being red on arrival. The frontend is the same story at 46 ESLint
  warnings. None blocks a deploy; all of it hides the next real finding.
- **P2-6 — nothing is reproducible.** `node:22-alpine`, `python:3.13-slim` and
  `postgres:16-alpine` float, and `Pillow>=11.0.0` is a floor. Pin by digest before
  you need to reproduce a build you have already shipped.
