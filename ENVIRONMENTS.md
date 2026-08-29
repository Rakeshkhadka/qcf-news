# Environments

The stack runs in two configurations from one set of sources. Which one you get
is decided by a single variable, `ENV`:

```bash
make dev                 # development, foreground, hot reload
make prod                # production, detached

make ENV=prod migrate    # any target, against either environment
```

`ENV` defaults to `dev`, so ordinary work is just `make up`, `make logs`,
`make test`. Run `make help` for the full list of targets.

## How the switch works

`ENV` selects a compose overlay and an env file **together**, so the two can
never be mismatched:

| | development | production |
|---|---|---|
| Compose | `docker-compose.yml` + `docker-compose.dev.yml` | `docker-compose.yml` + `docker-compose.prod.yml` |
| Env file | `.env.development` | `.env.production` |
| Template | `.env.development.example` | `.env.production.example` |
| Project name | `qcf_news_dev` | `qcf_news` |
| Front door | `http://localhost:3000` (Next directly) | host nginx → `127.0.0.1:3000` |

`docker-compose.yml` is the base and is never used alone. It describes the
*shape* of the stack — four services, one network, three volumes — and nothing
environment-specific. Every difference lives in an overlay you can read end to
end in under a minute.

**There is no reverse proxy in the stack.** nginx runs on the host, outside
Docker, from a config you maintain at `/home/conf/qcfnews.conf` and `include`
from `/etc/nginx/nginx.conf`. See [Routing](#routing) below and
`nginx/qcfnews.conf.example`, which is the reference that config has to
implement.

Because the two environments use different Compose project names, their
containers, networks and volumes are namespaced apart. **A dev stack and a prod
stack can run on the same host without sharing a database, a Redis or a media
volume.**

## First run

### Development

```bash
cp .env.development.example .env.development
make dev
```

Then, in another terminal:

```bash
make migrate
make superuser
make seed          # optional: dummy articles and categories
```

Open **http://localhost:3000** — the Next server itself. Nothing proxies for
you locally, and nothing needs to: every browser-side call the app makes goes
to a Next route on the same origin, and `/media/*` is covered by the rewrite in
`next.config.js`.

The template needs no editing. Every value in it is a working local default and
the secrets are deliberately weak and public, because nothing there is worth
protecting. Nothing in it may ever be reused in production.

### Production

```bash
cp .env.production.example .env.production
$EDITOR .env.production          # replace every CHANGE_ME

make ENV=prod build
make ENV=prod migrate            # fails the command if alembic fails
make ENV=prod up
make ENV=prod superuser
```

Then wire up the host nginx — the containers are listening on loopback but
nothing is serving the public port yet:

```bash
sudo install -d /home/conf
sudo cp nginx/qcfnews.conf.example /home/conf/qcfnews.conf
sudo $EDITOR /home/conf/qcfnews.conf        # server_name, TLS paths

# then, inside the http { } block of /etc/nginx/nginx.conf:
#     include /home/conf/qcfnews.conf;

make nginx-reload                            # nginx -t && systemctl reload
```

## What actually differs

### Development

- **Source is bind-mounted** and both apps run their reload servers, so an edit
  on the host is live without a rebuild. `next dev` for the frontend,
  `uvicorn --reload` for the API.
- **No proxy.** You browse the Next server directly. The routing the host
  nginx performs is therefore *not* exercised locally — see the warning under
  [Routing](#routing).
- **Every service publishes a port** (`3000` frontend, `8000` API, `5434`
  PostgreSQL, `6382` Redis) so you can attach `psql`, `redis-cli` or an HTTP
  client directly. The datastore numbers avoid the defaults on purpose, so a
  locally installed PostgreSQL or Redis can keep running.
- **`RATE_LIMIT_TRUST_PROXY` is `False`**, unlike production. Nothing sets
  `X-Forwarded-For` for you here, so believing it would let any caller choose
  their own rate-limit bucket.
- **Nothing restarts automatically.** A crash should stay visible.
- **Rate limiting is off.** The production rules cap logins at 5/minute, which
  locks you out of your own admin panel within a minute of testing it. Set
  `RATE_LIMIT_ENABLED=True` when you want to exercise the limiter — the rules
  are identical to production's, so the behaviour you see is what you ship.
- **API docs are on** at `/docs`, `/redoc`, `/openapi.json`.
- **Admin cookies are not `Secure`,** which is what lets admin login work over
  plain `http://localhost`. That follows from `NODE_ENV`; see below.

### Production

- **The two app services publish on `127.0.0.1` only** — `3000` and `8000` —
  for the host nginx to proxy to. PostgreSQL and Redis publish nothing.
  The loopback binding is load-bearing: Docker's published ports are NAT rules
  inserted *ahead* of the firewall's INPUT chain, so `0.0.0.0:8000` would be
  reachable from off-host even under `ufw default deny incoming`.
- **Both apps run their real servers from an immutable image** — gunicorn and
  the Next standalone build. No source is mounted; a change means a build.
- **Everything restarts unless explicitly stopped,** and every service has a
  health check.
- **Media lives in a named volume,** not on the host tree.
- **API docs are off.** They publish a complete, machine-readable map of every
  route and payload; the paths return 404.
- **CORS is an explicit origin list** from `CORS_ALLOW_ORIGINS`.
- **Migrations are a gated step,** not a post-start afterthought. `make
  ENV=prod migrate` runs alembic to completion and propagates its exit code, so
  a release script can branch on it.

## Variables that need a rebuild, not a restart

Next.js inlines `NEXT_PUBLIC_*` into the **client bundle at build time**. In
production these are passed as build args, so changing one in
`.env.production` and restarting does nothing — the old value is already
compiled into the JavaScript the browser downloads:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_MEDIA_BASE_URL`
- `NEXT_PUBLIC_NEWSLETTER_ENABLED`

```bash
make ENV=prod build && make ENV=prod up
```

`API_INTERNAL_ORIGIN` is in the same position for a subtler reason: it is a
*server-side* value, never inlined into the client bundle, but Next resolves
`rewrites()` during the build and freezes the `/media` destination into
`routes-manifest.json`.

In development none of this applies — `next dev` reads all four at startup, so
a container restart is enough.

## Two variables that are load-bearing

**`NODE_ENV`** is not cosmetic. The BFF session routes
(`app/api/admin/session/*`) set the `Secure` flag on admin cookies only when it
is exactly `production`. Setting it to `production` in development would break
admin login over `http://localhost`; leaving it unset in production would ship
admin session cookies that a plaintext connection can read.

**`PUBLIC_BASE_URL`** is empty in both environments and should stay that way.
It is prepended to media paths *as they are written to the database*, so a host
set here outlives the environment that set it — the rows keep pointing at a
dev machine or an old domain long after. `/media` is served from the site's own
origin — by the host nginx in production, by the `next.config.js` rewrite
locally — so a relative path is correct for the browser, for `next/image`, and
for any future move to a CDN.

## The newsletter

Off by default. `NEWSLETTER_ENABLED=False` (backend) and
`NEXT_PUBLIC_NEWSLETTER_ENABLED=false` (frontend) mean the signup form is not
rendered at all and the API refuses signups — which is the right state for a
deployment with no mail relay, and the reason the form can no longer sit on the
page quietly discarding addresses.

**The two flags have to agree.** Frontend on with backend off renders a form
whose every submission 503s. Backend on with frontend off is harmless but
pointless. And the frontend one is inlined at build time, so flipping it needs
`make ENV=prod build`.

Turning it on requires four more values, and the backend **refuses to start**
without them rather than accepting addresses it cannot mail:

| Variable | Why it is mandatory |
|---|---|
| `NEWSLETTER_FROM_EMAIL` | Nothing can be sent without a sender |
| `SITE_BASE_URL` | Confirm and unsubscribe links must be absolute |
| `POSTAL_ADDRESS` | CAN-SPAM §7704(a)(5) requires one in commercial mail |
| `SMTP_HOST` | Exempt in `DEBUG`, where the mailer logs instead of sending |

How it works, end to end:

1. The form posts to `/api/newsletter/subscribe` (Next), which forwards to
   `POST /api/v1/newsletter/subscribe` (FastAPI) with the reader's IP and user
   agent attached.
2. The backend writes a **pending** row to `newsletter_subscribers` and emails
   a confirmation link. The email is sent inside the same transaction, so a
   relay failure rolls the signup back instead of leaving a subscription
   nobody was told about.
3. Clicking the link lands on `/newsletter/confirm`, which posts the token back
   and flips the row to **confirmed**. Only now is anyone subscribed.
4. Every message carries an unsubscribe link and `List-Unsubscribe` /
   `List-Unsubscribe-Post` headers, so a mail client can opt out in one click.

Two details worth knowing before you touch it:

- **`NEWSLETTER_TOKEN_SECRET` is effectively write-once.** Unsubscribe tokens
  are derived from it — `<id>.<HMAC(secret, id)>`, stored nowhere — so rotating
  it invalidates every unsubscribe link already sitting in a reader's inbox.
  Left empty it falls back to `JWT_SECRET_KEY`, which then inherits the same
  constraint; set it explicitly to keep the two rotatable independently.
- **Signup responses are deliberately uninformative.** New address, throttled
  resend, already subscribed — all three return the same 202 and the same
  sentence, so the form cannot be used to test whether somebody is on the list.
  If you reword it, reword it in both places: the backend's `SIGNUP_ACCEPTED`
  and the honeypot's `SIGNUP_ACCEPTED_MESSAGE` in `lib/newsletter.ts`.

Locally, `DEBUG=True` with no `SMTP_HOST` logs the messages instead of sending
them — `make logs` and copy the confirmation URL out of the message body to
walk the whole flow without a mail server.

The subscriber list lives in this app's own database. `GET
/api/v1/newsletter/subscribers` reads it behind the `SUB.READ` permission, and
`DELETE /api/v1/newsletter/subscribers/{id}` erases a row outright behind
`SUB.DEL`, for a right-to-be-forgotten request. Run
`python -m src.scripts.seed_permissions` after deploying to register both.

## Routing

This is the contract `/home/conf/qcfnews.conf` has to implement.
`nginx/qcfnews.conf.example` is a working copy of it.

| Path | Upstream | Why |
|---|---|---|
| `/api/admin/*` | `127.0.0.1:3000` | Next.js BFF — session cookies and the admin proxy |
| `/api/revalidate` | `127.0.0.1:3000` | Next.js on-demand cache invalidation |
| `/api/newsletter/*` | `127.0.0.1:3000` | Next.js BFF — newsletter signup and unsubscribe |
| `/api/*` | `127.0.0.1:8000` | FastAPI, everything under `/api/v1` |
| `/media/*` | `127.0.0.1:8000` | Uploaded files from disk |
| `/health` | `127.0.0.1:8000` | |
| `/_next/static/*` | `127.0.0.1:3000` | Immutable assets |
| everything else | `127.0.0.1:3000` | |

The first three rows are the ones that break things. Those routes live in the
Next.js app, not in FastAPI, so a blanket `/api/ → backend` rule 404s admin
login, cache invalidation and newsletter signup — silently, with nothing in any
log to say why. nginx picks the *longest* matching prefix, so the carve-outs win
over `/api/` regardless of the order they appear in the file.

Note what is *not* in that list: nothing in the browser calls `/api/v1`
directly. Every client-side `fetch` in this app targets a Next route
(`lib/admin-api.ts`, `components/newsletter.tsx`). The `/api/*` → backend row
exists only for API clients outside the site; if you have none, deleting it
shrinks the public surface.

⚠️ **Nothing exercises this locally any more.** With the proxy on the host,
`make dev` reaches Next directly and a wrong `location` block cannot fail on
your machine — it fails in production. After changing a BFF route's path,
re-read `/home/conf/qcfnews.conf` by hand and `make nginx-check`.

## TLS and Cloudflare

TLS is terminated twice: Cloudflare's Universal SSL faces the visitor, and a
**Cloudflare Origin CA certificate** secures the edge→origin hop.
`nginx/qcfnews.conf.example` ships with that configured — TLS on by default, no
certbot, no renewal job (Origin CA certs last up to 15 years).

Four things the certificate does not do for you:

| | |
|---|---|
| **SSL/TLS mode = `Full (strict)`** | *Flexible* makes Cloudflare speak plain HTTP to the origin, which turns the `:80 → :443` redirect into an `ERR_TOO_MANY_REDIRECTS` loop. *Full* accepts any certificate. |
| **Keep the orange cloud on** | An Origin CA certificate is trusted by Cloudflare, not by browsers. Grey-clouding the record produces a certificate error, not a warning. |
| **Firewall `:80`/`:443` to Cloudflare's ranges** | The origin IP is otherwise a complete bypass of the WAF, bot rules and edge rate limits. |
| **Restore the visitor IP** | `set_real_ip_from` + `real_ip_header CF-Connecting-IP` — without it `$remote_addr` is a Cloudflare edge address and every rate limit in the stack becomes global. This is in the reference config; do not drop it. |

**`NEXT_PUBLIC_SITE_URL` must be the `https://` origin before the first build.**
It is compiled into the client bundle, so a stack built with `http://` publishes
wrong canonical URLs, sitemap entries and social cards until you run
`make ENV=prod build` — a restart does nothing.

Prefer Cloudflare's HSTS toggle over the origin header: the edge certificate is
the one browsers validate, and the toggle is reversible in a way the header is
not.

### One Cloudflare limit that will bite

Cloudflare rejects request bodies over **100 MB** (Free/Pro/Business), but
`MAX_IMAGES_PER_UPLOAD` × `MAX_IMAGE_SIZE_MB` allows **200 MB** in a single
multipart upload. A large batch gets a 413 *at the edge* — nothing reaches nginx
or FastAPI, and nothing appears in any log you control. Keep the product under
100, or upload in smaller batches. See `DEPLOYMENT_AUDIT.md` P1-8.

## Backups

```bash
make ENV=prod dbdump     # → backups/prod-<timestamp>.sql.gz
```

This is a manual dump, not a backup strategy. Off-host storage, encryption,
retention and a rehearsed restore are still required before launch — see
`DEPLOYMENT_AUDIT.md`.

## Quality gates

```bash
make test    # backend suite, in the dev image
make lint    # flake8 + mypy on the backend, eslint + tsc on the frontend
```

Both run against the dev image, which is the one carrying the toolchain —
`Backend/requirements-dev.txt` is installed into the `dev` stage only and never
reaches the production image.

## Running a service outside Docker

- **Backend alone in a virtualenv:** `Backend/.env.example` → `Backend/.env`.
  See `Backend/README.md`. The `DB_HOST`/`DB_PORT`/`REDIS_URL` in
  `.env.development` already point at the dev stack's published ports, so host
  tooling can talk to the containers.
- **Backend, PostgreSQL and Redis without the frontend:**
  `Backend/docker-compose.yaml`. Its container names are namespaced, so it can
  run alongside `make dev`.

Neither goes through the host nginx, so neither will catch a routing mistake —
but neither does `make dev` any more. See the warning under
[Routing](#routing).
