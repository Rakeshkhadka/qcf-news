# Deployment Audit — QCF News

**Date:** 2026-08-29
**Scope:** FastAPI backend, Next.js 16 frontend, Docker Compose, the new host-nginx + Cloudflare topology, CI, and crawler-facing routes.
**Supersedes:** the 2026-08-25 audit. A "Closed since the last audit" section at the bottom records what was fixed.
**Release decision:** **Code is go; the host is not yet.**

P1-4, P1-5 and P1-7 are **fixed in the repo** and verified — see each finding. What
remains before the site is public is no longer code you can change from a laptop;
it is configuration on the box and in the Cloudflare dashboard:

| | Blocker | Where it lives |
|---|---|---|
| P1-1 | `set_real_ip_from` + `real_ip_header CF-Connecting-IP` must both be present | `/home/conf/qcfnews.conf` |
| P1-2 | SSL/TLS mode `Full (strict)`, proxied DNS record, origin firewalled to Cloudflare ranges | Cloudflare dashboard, `ufw` |
| P1-3 | `ss -ltnp \| grep -E ':(3000\|8000)'` shows `127.0.0.1`, never `0.0.0.0` | verify after every deploy |
| P1-6 | Backups do not exist — no schedule, no off-host copy, no rehearsed restore | [DEPLOY_EC2.md §9](DEPLOY_EC2.md) |
| P1-8 | `MAX_IMAGES_PER_UPLOAD=9` ships in the template; decide whether 9 suits the editorial workflow | `.env.production`, admin UI |

P1-2's fourth item deserves repeating because it is the one that is expensive to
undo: **`NEXT_PUBLIC_SITE_URL` must be the `https://` origin before the first
build.** It is compiled into the client bundle, so a stack built with `http://`
keeps publishing `http://` canonical URLs, sitemap entries and RSS links. Fixing
it later is `make ENV=prod build`, not a restart.

---

## 1. What changed in this pass

nginx has been removed from the Docker stack. It now runs on the host, from a
config you own at `/home/conf/qcfnews.conf`, `include`d from the `http { }`
block of `/etc/nginx/nginx.conf`, terminating TLS with a **Cloudflare Origin CA
certificate** behind the Cloudflare proxy.

```
BEFORE                              AFTER

                                      visitor
  :80 ┌──────────────┐                   │ https (Universal SSL)
  ────┤ nginx (cont.)│              ┌────▼─────────────┐
      └──┬────────┬──┘              │ Cloudflare edge  │  WAF · cache · bots
         │        │                 └────┬─────────────┘
   ┌─────▼──┐ ┌───▼─────┐                │ https (Origin CA), Full (strict)
   │frontend│ │ backend │           ┌────▼─────────────┐
   └────────┘ └────┬────┘           │  nginx (host)    │  real_ip ← CF-Connecting-IP
                   │                └──┬────────────┬──┘
            ┌──────▼──────┐   127.0.0.1:3000   127.0.0.1:8000
            │  db · redis │            │            │
            └─────────────┘      ┌─────▼──┐   ┌─────▼───┐
                                 │frontend│   │ backend │
   all four on one bridge net    └────────┘   └────┬────┘
   nothing published but :80                       │
                                          ┌────────▼────────┐
                                          │   db  ·  redis  │
                                          └─────────────────┘
                                    internal network, nothing published
```

| File | Change |
|---|---|
| `docker-compose.yml` | `nginx` service deleted. Four services remain. |
| `docker-compose.prod.yml` | `nginx` service deleted; `frontend` and `backend` publish on **`127.0.0.1`** only. |
| `docker-compose.dev.yml` | `nginx` service deleted; `RATE_LIMIT_TRUST_PROXY` pinned `False` (nothing proxies locally). |
| `nginx/nginx.conf`, `nginx/nginx.dev.conf`, `nginx/certs/` | Deleted. |
| `nginx/qcfnews.conf.example` | **New.** Reference implementation of the routing contract, for `/home/conf/qcfnews.conf`. TLS on by default with the Cloudflare Origin CA cert, `real_ip` restoration from `CF-Connecting-IP`, and no certbot. Validated and behaviourally tested against live nginx — §7. |
| `Makefile` | `sh-nginx` removed; `nginx-check` now tests the *host* config; `nginx-reload` added. |
| `.env.production.example` | `NGINX_PORT` → `FRONTEND_PUBLISHED_PORT` / `BACKEND_PUBLISHED_PORT`. |
| `.env.development.example` | `NGINX_PORT` removed; site origin moved to `:3000`; trust-proxy off. |
| `ENVIRONMENTS.md`, `Backend/README.md`, code comments | Updated to the host-nginx topology. |

**Three consequences worth stating plainly.**

1. **You now own the routing table.** It is not in this repo, not in CI, and
   not exercised by any test. Section 5 is the contract.
2. **`make dev` no longer catches routing mistakes.** That was the stated
   purpose of the dev nginx container. Losing it is a real regression, not a
   neutral simplification — see P2-8.
3. **Cloudflare is now part of the security model, not a CDN bolted on.** The
   rate limiter's correctness depends on `real_ip` (P1-1), the certificate is
   only valid behind the proxy (P1-2), and the edge silently caps uploads at
   half what the app allows (P1-8). Grey-clouding the DNS record breaks all
   three at once.

---

## 2. P1 — resolve before the site is public

### P1-1 · `X-Forwarded-For` is trusted and was spoofable

| | |
|---|---|
| **Evidence** | The deleted `nginx/nginx.conf:25` set `X-Forwarded-For $proxy_add_x_forwarded_for`. [`Backend/src/utils/client_ip.py:34`](Backend/src/utils/client_ip.py#L34) takes `forwarded.split(",")[0]` — the **left-most** entry. `RATE_LIMIT_TRUST_PROXY=True` in production. |
| **Why it breaks** | `$proxy_add_x_forwarded_for` *appends* the real address to whatever the client sent. A request carrying `X-Forwarded-For: 1.2.3.4` arrives at FastAPI as `1.2.3.4, <real ip>`, and the backend trusts `1.2.3.4`. |
| **Impact** | A fresh header value per request means a fresh rate-limit bucket per request. The 5-per-minute caps on `/users/login`, `/users/register` and `/uploads` stop applying — brute force is unbounded. The same address is written to `newsletter_subscribers` as consent evidence, so the consent record becomes attacker-chosen. |
| **Cloudflare makes this worse before it makes it better** | Behind the proxy, every request reaches nginx from a Cloudflare edge address. Without `real_ip`, `$remote_addr` *is* Cloudflare — so `X-Forwarded-For $remote_addr` would report a CF edge IP for every visitor on earth, and the backend's 5-per-minute login cap would lock out the whole internet after five global attempts. The nginx `limit_req` zone, keyed on `$binary_remote_addr`, would throttle site-wide for the same reason. |
| **Status** | **Fixed and tested.** `nginx/qcfnews.conf.example` restores the visitor address with `set_real_ip_from` over Cloudflare's published ranges plus `real_ip_header CF-Connecting-IP`, then sets `X-Forwarded-For $remote_addr`. Verified against live nginx — see §7. |
| **Action** | Keep both halves in `/home/conf/qcfnews.conf`; either alone is wrong. **Then harden the backend too**, so the config is not the only thing standing between you and this: prefer `X-Real-IP` (nginx always sets it to the resolved `$remote_addr`), or read the right-most `X-Forwarded-For` entry with a configured hop count. One correct layer is not defence in depth. |

### P1-2 · TLS — four Cloudflare settings the certificate alone does not give you

You are terminating with a **Cloudflare Origin CA certificate**, so
`nginx/qcfnews.conf.example` now ships TLS on by default, no certbot, and a
`:80 → :443` redirect. Four things still have to be true, and none of them is
in the certificate:

1. **SSL/TLS mode must be `Full (strict)`.** In *Flexible*, Cloudflare speaks
   plain HTTP to the origin, the `:80 → :443` redirect becomes an infinite
   loop, and visitors get `ERR_TOO_MANY_REDIRECTS`. In *Full* (not strict) any
   certificate is accepted, including an attacker's.
2. **The orange cloud is not optional.** An Origin CA certificate is signed by
   Cloudflare's private origin CA — no browser trusts it. Grey-clouding the
   record, or anyone reaching the origin IP directly, produces a certificate
   error rather than a click-through warning.
3. **Firewall `:80` and `:443` to Cloudflare's ranges.** Otherwise the origin IP
   is a complete bypass of the WAF, the bot rules and the edge rate limits. The
   `real_ip` block fails safe here — a non-Cloudflare peer is not trusted to set
   `CF-Connecting-IP`, verified in §7 test 2 — but everything Cloudflare does
   *for* you is skipped. Better still, enable Authenticated Origin Pulls (mTLS);
   the config has the two lines commented in.
4. **`NEXT_PUBLIC_SITE_URL` must be the `https://` origin before the first
   build.** It is compiled into the client bundle, so a stack built with
   `http://` keeps publishing `http://` canonical URLs, sitemap entries, RSS
   links and social cards no matter what nginx and Cloudflare are doing. Fixing
   it later is `make ENV=prod build`, not a restart.

Prefer Cloudflare's dashboard toggle for HSTS over the origin header — the edge
certificate is the one browsers validate, and the toggle is reversible in a way
the header is not.

### P1-3 · The loopback binding is load-bearing, and Docker will not warn you

`docker-compose.prod.yml` publishes `127.0.0.1:3000` and `127.0.0.1:8000`.
Changing either to a bare `3000:3000` does three things at once:

- Docker publishes ports by inserting NAT rules **ahead of** the firewall's
  `INPUT` chain. `ufw default deny incoming` does not cover them. The port is
  reachable from off-host.
- P1-1's mitigation collapses: anyone can reach FastAPI directly and set their
  own `X-Forwarded-For`, with no nginx to overwrite it.
- The site is served on a second origin with **no TLS, no Cloudflare, no WAF,
  no security headers and no rate limiting** — and Google may index it. Every
  protection you are buying at the edge is bypassed by a port number.

Verify after every deploy: `ss -ltnp | grep -E ':(3000|8000)'` must show
`127.0.0.1`, never `0.0.0.0` or `*`.

### P1-4 · The frontend container was handed every production secret — FIXED

`docker-compose.prod.yml` gave the Next container `env_file: .env.production`, so
it received `POSTGRES_PASSWORD`, `DB_PASS`, `JWT_SECRET_KEY`,
`JWT_REFRESH_SECRET_KEY`, `NEWSLETTER_TOKEN_SECRET` and `SMTP_PASSWORD`. It uses
**none** of them — `grep -rhoE "process\.env\.[A-Z_0-9]+" app/ lib/ components/`
returns exactly seven names. Any SSRF or dependency compromise in the larger of
the two attack surfaces yielded the database password and the keys that sign
admin tokens.

**Fixed.** The `env_file` is gone from the `frontend` service, replaced by an
explicit `NODE_ENV: production` (load-bearing — the BFF session routes set
`Secure` on the admin cookie only when it is exactly that). The base compose file
already passed the other six. Verified in the merged config: the frontend now
resolves 6 variables, of which the only secret is `REVALIDATION_SECRET`, which it
genuinely needs.

### P1-5 · Database URLs were built by string interpolation — FIXED, in both places

`settings.py` interpolated `DB_USER` and `DB_PASS` straight into a URL, and
`.env.production.example:35` instructed `openssl rand -base64 36`, whose alphabet
includes `/`, `+` and `=`. A password containing `/` produced
`postgresql+asyncpg://qcf_news:ab/cd@db:5432/qcf_news`, where the `/` ends the
authority section — the connection fails, or parses to a different target. That is
what the documented command produces roughly half the time.

**Fixed, and the second copy mattered more than the first.**
`Settings._database_url` now builds both URLs with
`sqlalchemy.engine.URL.create(...)`, which escapes each component. But
`src/db/migrations/env.py` held an independent hand-interpolated copy, so
`make ENV=prod migrate` — step 2 of the deploy — still failed after the app was
fixed, and failed *confusingly*: a password of `p/a+s=w@rd` produced
`could not translate host name "rd@qcfci-db"`, which names no host you would
recognise. It now delegates to the same builder.

Verified end to end against a live Postgres with that password: all five
migrations apply, `downgrade -1` and re-upgrade round-trip, and asyncpg connects.
The CI job added for P1-7 uses that password permanently, so the bug cannot
return silently. The template now says `openssl rand -hex 32`.

### P1-6 · Backups do not exist

`postgres_data` and `backend_media` are local named volumes. `make ENV=prod
dbdump` writes an unencrypted `.sql.gz` **to the same host**, by hand. There is
no media backup at all, no retention, no off-host copy, and no rehearsed
restore. A single disk or operator error loses every article and every upload
permanently.

**Action:** scheduled encrypted `pg_dump` to off-host storage; `backend_media`
to object storage or a second host; a restore drill executed once before launch
and recorded.

### P1-7 · Nothing gated the backend — FIXED, and it was already red

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) ran frontend lint,
typecheck and build only. `Backend/tests/` existed and `requirements-dev.txt`
declared pytest, flake8 and mypy, but no workflow invoked any of them.

**This was not hypothetical.** The first run of `pytest tests` found the suite
**red**: `test_blocked_message_quotes_the_endpoint_budget` asserted a message the
code had stopped emitting, because the limit had been commented out of the 429
body. The remaining fragments then concatenated without a space, so every
rate-limited caller was reading `Too many requests.Try again in 60 seconds.` —
a user-visible defect that shipped precisely because nothing ran the tests.

**Fixed.** A `backend` job runs on Python 3.13 against a `postgres:16-alpine`
service container: `pytest tests` (61 passing), `alembic upgrade head`, and a
`downgrade -1` / re-upgrade round-trip. `flake8` and `mypy` run
`continue-on-error` — 15 and 190 existing findings respectively, and a gate that
is red on arrival gets ignored. Drive them to zero, then drop the flag.

### P1-8 · Image uploads exceed Cloudflare's request-body cap by 2×

`MAX_IMAGES_PER_UPLOAD=20` × `MAX_IMAGE_SIZE_MB=10` = **200 MB**, and
[`uploads.py:27-47`](Backend/src/apps/v1/news/routes/uploads.py#L27-L47) accepts
the whole batch as one multipart request. Cloudflare rejects request bodies over
**100 MB** on Free, Pro and Business plans.

The failure mode is the bad kind: Cloudflare answers **413 at the edge**, so the
request never reaches nginx or FastAPI. Nothing appears in any log you control,
and the admin UI shows an error with no cause. It will look like a bug in the
upload code.

**Partially applied.** `.env.production.example` now ships
`MAX_IMAGES_PER_UPLOAD=9` (90 MB worst case), and the nginx reference config
drops `client_max_body_size` from 200 M to **100 M** — matching Cloudflare's cap
exactly, so an oversized batch fails at your origin with a message you can read
rather than at an edge you cannot log.

**Still yours to decide:** whether 9 images per request is enough for the
editorial workflow. If not, have the admin UI upload in chunks rather than
raising the limit — no origin setting can lift the edge's 100 MB cap.

---

## 3. P2 — first hardening release

| # | Finding | Evidence | Action |
|---|---|---|---|
| P2-1 | **Account enumeration, two ways.** `/register` answers `"User already exists"` for a known address; `/login` distinguishes `"User not found"` from `"Incorrect email or password"`. | [`user_service.py:64`](Backend/src/apps/v1/users/services/user_service.py#L64), [`user_service.py:81`](Backend/src/apps/v1/users/services/user_service.py#L81) | Return one generic failure externally, log the specific reason. The `/register` leak is the sharper one — it needs no password guess. |
| P2-2 | **Public self-registration on an editorial CMS.** `POST /api/v1/users/register` is unauthenticated. Accounts land with no roles, so privilege impact is nil, but the table is an open write endpoint. | [`users.py:25-31`](Backend/src/apps/v1/users/routes/users.py#L25-L31) | Cheapest fix, given the new topology: **delete the `location /api/` block** from `/home/conf/qcfnews.conf`. Nothing in the browser calls `/api/v1` directly (§6), so the site keeps working and the whole FastAPI surface leaves the internet. Otherwise, gate registration behind invitation. |
| P2-3 | **Rate limiting fails open.** A Redis error logs a warning and allows the request. | [`rate_limit.py:245-251`](Backend/src/utils/rate_limit.py#L245-L251) | The nginx `limit_req` zone is the only backstop, and at 30 r/s it does not approximate the 5/60 login rule. Add a tight `limit_req` on `/api/v1/users/login` in the host config, and alert on the warning. |
| P2-4 | **Health check is liveness-only.** `/health` returns `{"status":"ok"}` unconditionally — it stays green with the database down. | [`main.py:155-157`](Backend/src/main.py#L155-L157) | Add `/health/ready` that checks the DB and Redis; keep `/health` cheap for the container probe. |
| P2-5 | ~~**Container logs are unbounded.**~~ **Fixed.** `docker-compose.yml` now defines an `x-logging` anchor (`json-file`, `max-size: 10m`, `max-file: "5"`) and every one of the four services references it — 50 MB apiece instead of unbounded. Confirmed in the merged config. | `docker-compose.yml` | Done. |
| P2-6 | **Nothing is reproducible.** `node:22-alpine`, `python:3.13-slim` and `postgres:16-alpine` float; `Pillow>=11.0.0` is a floor. | `Dockerfile`, `Backend/Dockerfile`, `Backend/requirements.txt:32` | Pin images by digest, pin Pillow, add automated dependency and image scanning. |
| P2-7 | **No observability.** No error tracking, metrics, uptime check or alerting anywhere in the repo. | — | 5xx rate, p95 latency, disk, cert expiry, backup success, and the Redis warning from P2-3. |
| P2-8 | **Routing is no longer verifiable before deploy.** Introduced by this change: the dev nginx existed so a misrouted `/api/admin` failed locally. | `docker-compose.dev.yml` | Add a smoke script that curls the eight paths in §6 against the deployed host and asserts which upstream answered. That restores the check at the only place it now exists — production. |
| P2-9 | **`.env.development` on this machine has drifted from its template.** It is missing every `NEWSLETTER_*`, `SITE_*` and `SMTP_*` key. | local file, gitignored | Re-copy from `.env.development.example`. The backend boots (the flag defaults `False`), but the newsletter flow cannot be exercised. |
| P2-10 | ~~**`frontend` waits for the backend container, not its health.**~~ **Fixed.** Now `depends_on: backend: condition: service_healthy`, using the `HEALTHCHECK` the backend image already defined. This mattered more than it looked: `/article` and `/category` prerender at container start, so a frontend racing ahead of gunicorn cached placeholder content until the next revalidation. Note the gate is only as good as `/health`, which is liveness-only — see P2-4. | `docker-compose.yml` | Done. |
| P2-11 | **nginx on this host is 1.18.0** (Ubuntu 20.04's default, released April 2020). It has `http_realip` and `http_v2` compiled in, so the config works — but `http2 on;` is unsupported, hence the older `listen 443 ssl http2;` spelling in the reference config. Upstream stopped patching the 1.18 branch years ago; you are relying on distro backports. | `nginx -v` | Confirm the *production* host's version before deploying. Consider `nginx` from the official upstream repo, or at minimum an OS still receiving security updates. |
| P2-12 | **Cloudflare cuts a request off at 100 s** (Free plan) and shows the visitor a 524 the origin never sees. | — | Origin timeouts in the reference config are set to 90 s so slow requests fail where they are logged. Watch for 524s in the Cloudflare analytics — they indicate a slow route, not a network fault. |
| P2-13 | **A "Cache Everything" rule would serve one reader's admin session to another.** Cloudflare does not cache HTML or `Set-Cookie` responses by default, so this is latent rather than live. | Cloudflare dashboard | Add an explicit Cache Rule bypassing `/api/*` and `/admin*` before anyone reaches for Cache Everything to speed the site up. |
| P2-14 | **46 lint warnings, ungated.** Verified on Node 22.23.0: 0 errors, 46 warnings — `any`, unused vars, `react-hooks/set-state-in-effect`, and three `window.location.href` navigations in `lib/admin-api.ts`. `eslint .` exits 0 on warnings, so CI passes regardless. Up from 43 at the last audit. | `npm run lint` | Fix the `set-state-in-effect` and `exhaustive-deps` ones first — those are latent behaviour bugs, not style. Then add `--max-warnings <current count>` to the script so the number can only go down. |

---

## 4. SEO — carried forward, still open

| Priority | Finding | Evidence | Action |
|---|---|---|---|
| P1 at scale | Sitemap silently truncates at 2,000 articles. | [`lib/api.ts:217`](lib/api.ts#L217) | Move to a sitemap index with segmented children before the archive reaches it. |
| P2 | `lastmod` claims changes that did not happen — `new Date()` fallbacks, and empty categories borrowing the site-wide latest timestamp. | `app/sitemap.ts` | Omit `lastModified` when there is no truthful value. |
| P2 | No Google News sitemap. | — | A `news:`-extension sitemap of the last 48 hours. |
| P2 | Social card dimensions are hard-coded 1200×630 regardless of the uploaded image. | `app/article/[slug]/page.tsx:90` | Emit real dimensions, or generate a 1200×630 OG route. |
| P2 | Author markup is a desk, not a verifiable `Person`. | `lib/seo.ts:194-200` | Author profile pages for bylined work. |

One new item from this change: **the canonical origin has to be right in the
first production build.** `NEXT_PUBLIC_SITE_URL` is baked into the client bundle,
and with Cloudflare the site is `https://` from the moment it is public — so a
stack built with an `http://` value publishes wrong canonical URLs, sitemap
entries, RSS links and social cards immediately, not eventually. See P1-2 item 4.

---

## 5. The host nginx contract

This is what `/home/conf/qcfnews.conf` has to implement.
`nginx/qcfnews.conf.example` is a validated implementation of it.

| Path | Upstream | Why |
|---|---|---|
| `/api/admin/*` | `127.0.0.1:3000` | Next BFF — admin session cookies and the authenticated proxy |
| `/api/revalidate` | `127.0.0.1:3000` | Next on-demand cache invalidation |
| `/api/newsletter/*` | `127.0.0.1:3000` | Next BFF — signup and unsubscribe |
| `/api/*` | `127.0.0.1:8000` | FastAPI. **Optional** — see P2-2 |
| `/media/*` | `127.0.0.1:8000` | Uploaded files; `immutable` is safe, filenames carry a uuid4 |
| `/health` | `127.0.0.1:8000` | |
| `/_next/static/*` | `127.0.0.1:3000` | Immutable build assets |
| everything else | `127.0.0.1:3000` | |

**The first three rows are the ones that break things.** Those routes live in
the Next app, not FastAPI. A blanket `/api/ → backend` rule 404s admin login,
cache invalidation and newsletter signup — silently, with nothing in any log
naming the cause. nginx matches the longest prefix, so the carve-outs win over
`/api/` regardless of their order in the file.

**What is *not* in that table matters too:** nothing in a browser ever calls
`/api/v1` directly. Every client-side `fetch` in this app targets a Next route
(`lib/admin-api.ts`, `components/newsletter.tsx`, `app/newsletter/unsubscribe/`).
That is what makes P2-2's fix free.

### Five traps in a host-nginx setup

1. **The `include` must be inside `http { }`.** `server`, `upstream`, `map` and
   `limit_req_zone` are http-context directives. Included at the top level of
   `nginx.conf`, nginx refuses to start with *"server directive is not allowed
   here"*.
2. **`proxy_set_header` at http level leaks to every other site** this nginx
   serves. Keep them inside the `server` block — the reference config does.
3. **Zone names are global.** `limit_req_zone ... zone=global` collides with any
   other site using the same name. The reference uses `qcfnews_global`.
4. **`proxy_cache_valid` without `proxy_cache` does nothing.** The deleted
   config had `proxy_cache_valid 200 30d` on `/media/` with no
   `proxy_cache_path` anywhere — it never cached a byte. Don't reproduce it; the
   `Cache-Control: immutable` header is what was actually doing the work.
5. **SELinux hosts** (`getenforce` returns `Enforcing`) block nginx from
   proxying to a local port until `setsebool -P httpd_can_network_connect 1`.
   The symptom is a 502 with `Permission denied` in the error log.
6. **`real_ip` is not optional behind Cloudflare** — see P1-1. Without it every
   visitor shares ~15 addresses and both rate limiters go global.
7. **`http2 on;` needs nginx ≥ 1.25.1.** On 1.18 (this host) it is an unknown
   directive and nginx refuses to start; use `listen 443 ssl http2;`.

---

## 6. Deploy runbook

```bash
# 0a — Cloudflare dashboard, before anything else
#      SSL/TLS → Overview        → Full (strict)
#      SSL/TLS → Origin Server   → Create Certificate  (save cert + key)
#      DNS                       → the record is PROXIED (orange cloud)
#      Caching → Cache Rules     → bypass /api/* and /admin*

# 0b — one time, on the host
sudo install -d -m 700 /etc/ssl/cloudflare
sudo install -m 644 /path/to/origin.pem /etc/ssl/cloudflare/qcfnews.pem
sudo install -m 600 /path/to/origin.key /etc/ssl/cloudflare/qcfnews.key

sudo install -d /home/conf
sudo cp nginx/qcfnews.conf.example /home/conf/qcfnews.conf
sudo $EDITOR /home/conf/qcfnews.conf                 # server_name, cert paths
#    then add to the http { } block of /etc/nginx/nginx.conf:
#        include /home/conf/qcfnews.conf;
sudo nginx -t

# 0c — lock the origin to Cloudflare (P1-2 item 3)
for c in $(curl -s https://www.cloudflare.com/ips-v4) \
         $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow proto tcp from $c to any port 80,443
done

# 1 — configuration
cp .env.production.example .env.production
$EDITOR .env.production                              # every CHANGE_ME
#    NEXT_PUBLIC_SITE_URL and SITE_BASE_URL must be https:// from the start
#    use `openssl rand -hex 32` for the DB password until P1-5 is fixed
#    MAX_IMAGES_PER_UPLOAD now defaults to 9 — do not raise it past 9 (P1-8)

# 2 — build, migrate, start
make ENV=prod build
make ENV=prod migrate                                # exits non-zero on failure
make ENV=prod up
make ENV=prod superuser
docker compose --env-file .env.production -f docker-compose.yml \
  -f docker-compose.prod.yml run --rm backend python -m src.scripts.seed_permissions

# 3 — verify the containers are private
ss -ltnp | grep -E ':(3000|8000)'                    # must read 127.0.0.1

# 4 — bring up the proxy
make nginx-reload

# 5 — smoke the routing table (§5)
curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' \
  https://YOUR_DOMAIN/ \
  https://YOUR_DOMAIN/health \
  https://YOUR_DOMAIN/feed.xml \
  https://YOUR_DOMAIN/sitemap.xml \
  https://YOUR_DOMAIN/robots.txt

# 6 — confirm the visitor IP survives the edge.  Tail the backend and load a
#     page from a phone on mobile data; the logged address must be the phone's,
#     not 172.x / 104.x (Cloudflare).  If it is Cloudflare's, real_ip is not
#     working and every rate limit in the app is now global — see P1-1.
make ENV=prod logs SERVICE=backend

#    then, by hand: admin login, a multi-image upload, a publish, a revalidate
```

Rollback is `make ENV=prod build` on the previous commit plus a restore from the
P1-5b backup; nginx is unaffected by an application rollback and needs no touch.

---

## 7. Validation performed for this audit

| Check | Result |
|---|---|
| `nginx -t` against `nginx/qcfnews.conf.example` | **Passed** on nginx 1.18.0, TLS enabled, config included into a synthetic `http { }` block. (`http2 on;` was rejected at first — see P2-11.) |
| **Live behavioural test of the Cloudflare real-IP chain** | **Passed** — 4 tests, results below. |
| `docker compose config` — dev stack | **Passed.** |
| `docker compose config` — prod stack | **Passed.** Four services; `frontend` and `backend` show `host_ip: 127.0.0.1`. |
| Merged prod config inspected for secret spread | **Failed** — see P1-4. |
| `npm run typecheck` (Node 22.23.0) | **Passed.** |
| `npm run lint` (Node 22.23.0) | **0 errors, 46 warnings** — see P2-11. |
| `make dev` — full build, run, HTTP smoke | **Passed.** Four containers, no nginx. Results below. |
| Backend test suite | Not run in this pass. |
| npm audit / pip audit | Not run — belongs in CI (P1-7). |

> The default `node` on this machine is **v16.18.0**, which cannot run this
> toolchain at all (`structuredClone is not defined` from ESLint's config
> loader). The repo pins Node 22 in `.nvmrc`, `package.json` engines and the
> Dockerfile; use `nvm use` before any local frontend command.

### nginx real-IP and routing tests

nginx 1.18.0 run for real on `:8081`/`:8443` with the reference config, loopback
added to `set_real_ip_from` to stand in for a Cloudflare edge, and both upstreams
pointed at an echo server:

```
TEST 1 — spoofed XFF must lose to CF-Connecting-IP
  sent:  CF-Connecting-IP: 203.0.113.9
         X-Forwarded-For:  1.2.3.4, 9.9.9.9      ← attacker-supplied
  got:   xff=203.0.113.9  xreal=203.0.113.9  proto=https
         ✓ the spoofed chain was discarded entirely

TEST 2 — no CF header (direct-to-origin) must fall back to the real peer
  sent:  X-Forwarded-For: 1.2.3.4                ← attacker-supplied
  got:   xff=127.0.0.1  xreal=127.0.0.1
         ✓ fails safe; an untrusted peer cannot name itself

TEST 3 — every location reaches an upstream, cache headers land
  /api/admin/session/me       200
  /api/revalidate             200
  /api/newsletter/subscribe   200
  /api/v1/categories          200
  /media/x.jpg                200  public, max-age=2592000,  immutable
  /_next/static/a.js          200  public, max-age=31536000, immutable
  /                           200

TEST 4 — :80 redirects
  301 -> https://.../some/path
```

Test 1 is the one that matters: it is the difference between a working login
rate limit and one an attacker turns off by adding a header.

### Dev-stack smoke results

Built from scratch and run with the nginx service removed:

```
qcf_news_dev_frontend   Up   0.0.0.0:3000->3000/tcp
qcf_news_dev_backend    Up (healthy)   0.0.0.0:8000->8000/tcp
qcf_news_dev_db         Up (healthy)   0.0.0.0:5434->5432/tcp
qcf_news_dev_redis      Up (healthy)   0.0.0.0:6382->6379/tcp

200  :8000/health                    backend, direct
307  :8000/api/v1/categories         redirect to trailing slash — route present
200  :8000/docs                      ENABLE_API_DOCS=True in dev, as intended

200  :3000/                          homepage renders
200  :3000/feed.xml                  RSS
200  :3000/robots.txt
200  :3000/sitemap.xml
401  :3000/api/admin/session/me      BFF reachable and correctly unauthenticated
405  :3000/api/newsletter/subscribe  BFF reachable, POST-only
404  :3000/media/nope.jpg            `server: uvicorn` — the rewrite reached
                                     FastAPI, not Next's own 404 page
```

The 401 and 405 are the meaningful ones: a broken BFF route would answer 404.
The `server: uvicorn` header on the `/media` miss is what proves the
`next.config.js` rewrite still carries media to the backend now that no proxy
does it.

> **One cleanup the removal does not do for you.** `docker compose up` leaves
> the old `*_nginx` container behind as an orphan — it was still listed
> `Exited` after the new stack came up. Tear the stack down once with
> `--remove-orphans` (already done for the dev stack here; do the same on the
> production host):
>
> ```bash
> docker compose --env-file .env.production \
>   -f docker-compose.yml -f docker-compose.prod.yml down --remove-orphans
> ```
>
> On the production host, do this **before** starting the host nginx — the old
> container still holds `:80` and nginx will fail to bind.

**Not verified, and outside what source review can establish:** TLS behaviour,
backup restore, real crawl coverage, and the contents of the
`/home/conf/qcfnews.conf` you will actually write.

---

## 8. Closed since the 2026-08-25 audit

Verified fixed in the current tree, and no longer tracked above:

| Was | Now |
|---|---|
| `allow_origins=["*"]` with `allow_credentials=True` | Origin list from `CORS_ALLOW_ORIGINS`; credentials follow the list, and `*` forces them off. [`main.py:117-134`](Backend/src/main.py#L117-L134) |
| Disabled users could authenticate and keep active sessions | `is_active` enforced at login ([`user_service.py:89`](Backend/src/apps/v1/users/services/user_service.py#L89)), at refresh — which also revokes the sessions ([`:118`](Backend/src/apps/v1/users/services/user_service.py#L118)) — and on every authenticated request ([`dependencies.py:69`](Backend/src/dependencies.py#L69)). |
| Migrations were a manual post-start command | `make ENV=prod migrate` runs alembic via `run --rm` and propagates the exit code, so a release script can gate on it. |
| API docs publicly exposed | `ENABLE_API_DOCS=False` in production; `/docs`, `/redoc`, `/openapi.json` return 404 at the app, and the reference nginx config leaves them unproxied as well. |
| `pytest` not declared, suite could not start | `Backend/requirements-dev.txt` declares pytest, pytest-asyncio, flake8, isort and mypy, installed into the `dev` image stage only. **Still not run by CI — P1-7.** |
| Build required outbound access to Google Fonts | Self-hosted via `@fontsource-variable/*`; no `next/font/google` remains. |
| `npm run lint` was silently broken (it called the removed `next lint`) | It runs `eslint .` and is wired into CI. **Zero errors — but 46 warnings, and `eslint .` exits 0 on warnings, so CI does not actually gate them. See P2-14.** |
