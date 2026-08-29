# QCF News — Backend API

A production-grade **FastAPI** backend for the QCF News platform, built with clean architecture principles.

## Architecture

```
src/
├── apps/v1/              # Versioned application modules
│   ├── users/            # Auth: register, login, JWT, refresh tokens
│   │   ├── models/       # SQLAlchemy ORM models
│   │   ├── schemas/      # Pydantic request/response DTOs
│   │   ├── repositories/ # Data access (interface + SQLAlchemy impl)
│   │   ├── unit_of_work/ # Transaction boundaries (interface + impl)
│   │   ├── services/     # Business logic orchestration
│   │   └── routes/       # FastAPI route handlers
│   ├── news/             # Categories & Articles (same structure)
│   └── newsletter/      # Double opt-in mailing list (same structure)
├── config/               # Pydantic settings
├── db/                   # Base models, session, Alembic migrations
├── shared/               # Cross-cutting: audit events, user context
├── utils/                # Exceptions, response wrappers, cache, filters, mailer
├── container.py          # Dependency Injector (DI) wiring
├── dependencies.py       # FastAPI auth dependencies
├── routes.py             # Centralized route registration
└── main.py               # App factory
```

## Key Patterns

| Pattern                | Implementation                                |
|------------------------|-----------------------------------------------|
| **Repository**         | ABC interface → SQLAlchemy implementation      |
| **Unit of Work**       | ABC interface → Session-scoped implementation  |
| **Service Layer**      | Business logic; receives UoW via DI            |
| **Dependency Injection** | `dependency-injector` DeclarativeContainer   |
| **Soft Delete**        | Global ORM event listener on `SoftDeleteMixin` |
| **Audit Fields**       | Auto `created_by`/`updated_by` via ORM events  |
| **Rate Limiting**      | Per-IP Redis counter in an HTTP middleware     |

## Quick Start

> **Working on the whole product?** Don't use this section. The repository root
> runs the backend and frontend together, in either environment:
>
> ```bash
> cp .env.development.example .env.development && make dev
> ```
>
> See [ENVIRONMENTS.md](../ENVIRONMENTS.md). The steps below are for running
> the API on its own in a virtualenv.

```bash
# 1. Clone and enter the project
cd Backend

# 2. Create virtual environment
python -m venv venv && source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt   # tests and linters

# 4. Copy environment template
cp .env.example .env   # Edit with your DB credentials

# 5. Run database migrations
alembic upgrade head

# 6. Create a superuser
python manage.py createsuperuser

# 7. Start the dev server
python app.py
# → http://localhost:8000/docs
```

## Docker

`Backend/docker-compose.yaml` brings up the API, PostgreSQL and Redis alone —
no frontend. Its container names are namespaced so it can run alongside the
root development stack.

```bash
docker compose up --build
```

For the full stack, use the root `Makefile` instead — see
[ENVIRONMENTS.md](../ENVIRONMENTS.md).

## Scaffolding a New App Module

```bash
python manage.py startapp <app_name>
```

This creates the full directory structure with `models/`, `schemas/`, `repositories/`, `services/`, `unit_of_work/`, `routes/`, and `utils/`.

## API Endpoints

### Health
- `GET /health`

### Users (`/api/v1/users`)
- `POST /register`
- `POST /login`
- `POST /refresh-token`
- `POST /logout`
- `GET /me`
- `PUT /profile`
- `POST /change-password`

### Categories (`/api/v1/categories`)
- `GET /` — List all categories
- `GET /{id}` — Category detail
- `POST /` — Create (auth required)
- `PUT /{id}` — Update (auth required)
- `DELETE /{id}` — Soft delete (auth required)

### Articles (`/api/v1/articles`)
- `GET /` — List with pagination & filtering (`category_id`, `is_published`)
- `GET /{id}` — Article detail
- `GET /by-slug/{slug}` — Lookup by slug
- `POST /` — Create (auth required)
- `PUT /{id}` — Update (auth required)
- `DELETE /{id}` — Soft delete (auth required)

Article read responses include `created_at` / `updated_at` (ISO-8601) alongside
`images`, so clients can render relative timestamps without a second lookup.

Anonymous article reads return published stories only, even if a caller sends
`is_published=false`. A valid bearer token with `ART.READ` can list and retrieve
unpublished stories for the editorial UI. A draft requested anonymously returns
the same 404 response as a missing story.

### Newsletter (`/api/v1/newsletter`)
- `POST /subscribe` — Record a signup and email a confirmation link.
- `POST /confirm?token=…` — Complete the double opt-in. Idempotent.
- `POST /unsubscribe?token=…` — Opt out. Idempotent, and the URL named in the
  `List-Unsubscribe` header, so it works with nothing but the token.
- `GET /subscribers` — List subscribers (`SUB.READ`). Filter by `status`,
  search by email.
- `DELETE /subscribers/{id}` — Erase a subscriber outright (`SUB.DEL`), for a
  right-to-be-forgotten request. Not the opt-out path: unsubscribing keeps the
  row as proof of the opt-out, and this destroys it.

All three public endpoints are POST, including the two reached from a link in
an email. A GET that changes state is a trap here: mail clients and security
gateways fetch every URL in a message before the reader sees it, and a GET
unsubscribe would empty the list on its own. The links point at pages on the
site, and those pages post here.

`POST /subscribe` answers **202 with the same message every time** — new
address, throttled resend or already subscribed alike. Distinguishing them
would turn the form into a way of testing whether someone is on the list.

Nothing is mailed to an address that has not clicked a link sent to it. The
confirmation email goes out *inside* the same transaction as the pending row,
so a relay failure rolls the signup back rather than leaving a subscription
nobody was told about; the endpoint answers 503 and the reader is told to
retry.

The feature is off unless `NEWSLETTER_ENABLED=True`, and enabling it requires
`NEWSLETTER_FROM_EMAIL`, `SITE_BASE_URL`, `POSTAL_ADDRESS` and (outside
`DEBUG`) `SMTP_HOST` — the app refuses to start half-configured. See
`../ENVIRONMENTS.md` for the full picture.

### Uploads (`/api/v1/uploads`)
- `POST /images` — Upload one or many images (`multipart/form-data`, repeated
  `files` field). Returns `[{url, path, filename, size, content_type}]` in the
  order the files were sent. Requires `ART.CRT` or `ART.UPD`.
- `DELETE /images?path=…` — Remove a previously uploaded file by its storage path.

## Article Images

An article carries a **gallery** (`article_images`) on top of its single
`cover_image_url`. The gallery is what the front-end renders as a carousel in
place of the main image; the cover is the still used in lists and social cards.

- `POST/PUT /api/v1/articles/…` accept an `images: [{image_url, caption, alt_text, sort_order}]`
  array. On update, omitting `images` leaves the gallery untouched and sending
  `[]` clears it.
- Slides are stored in the order given; `sort_order` is renumbered server-side.
- When no `cover_image_url` is supplied the first gallery image becomes the cover.

Uploads are written to `MEDIA_ROOT` (default `Backend/media`) in `YYYY/MM`
folders and served from `MEDIA_URL` (default `/media`). File type is verified by
magic number, not by extension. Relevant settings: `MEDIA_ROOT`, `MEDIA_URL`,
`PUBLIC_BASE_URL`, `MAX_IMAGE_SIZE_MB`, `MAX_IMAGES_PER_UPLOAD`,
`ALLOWED_IMAGE_EXTENSIONS`.

## Rate Limiting

Every request is counted against its client IP by `RateLimitMiddleware`
(`src/utils/rate_limit.py`). An IP that exceeds **120 requests per 60 seconds**
is blocked for the next **60 seconds**: those requests are answered with a
`429` carrying `Retry-After` before any route, DB session or cache lookup runs.

- Counters live in Redis (`ratelimit:count:<ip>`, `ratelimit:block:<ip>`), so
  the budget is shared across workers. Counting and blocking happen in one Lua
  script, so concurrent requests can't slip past the limit together.
- If Redis is unavailable the limiter **fails open** — the same trade-off the
  cache makes; a Redis outage must not take the API down.
- Successful responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
  `X-RateLimit-Reset`.
- `/health`, the docs routes and `MEDIA_URL` are exempt, as are CORS preflights.
- Behind a reverse proxy set `RATE_LIMIT_TRUST_PROXY=True` so the limit applies
  to the real client IP rather than the proxy's. Leave it off otherwise —
  `X-Forwarded-For` is caller-supplied and trivially spoofed.

### Per-endpoint budgets

`RATE_LIMIT_RULES` holds tighter budgets for individual endpoints, as a
comma-separated list of `[METHOD ]PATH=LIMIT/WINDOW[/BLOCK]`. `PATH` is a
prefix, so `/api/v1/uploads` covers every route beneath it; `METHOD` is
optional and defaults to any. The most specific rule wins — longest path
first, and a named method beats a wildcard one.

```env
RATE_LIMIT_RULES=POST /api/v1/users/login=5/60,/api/v1/uploads=5/60/900
```

Shipping defaults hold the credential endpoints (`login`, `token`, `register`,
`refresh-token`, `change-password`) and all of `/api/v1/uploads` to **5 per
minute** — those are the brute-force targets and the expensive writes.

The newsletter's public routes get their own budgets: **5 per 5 minutes** for
`POST /newsletter/subscribe` and 10 for `confirm` and `unsubscribe`. Signup is
the tightest because each accepted request sends an email to an address the
caller chose. The three routes are named individually rather than by prefix so
the admin subscriber list underneath stays on the global budget. A per-IP limit
cannot stop the same abuse spread across many addresses, so it is paired with
`NEWSLETTER_RESEND_INTERVAL_SECONDS`, which throttles per *recipient*.

A rule is enforced **in addition to** the global budget, not instead of it. If
it replaced the global one, a caller could spend a fresh 5 requests on each of a
dozen endpoints and never touch the 20 they are actually allowed. Each budget
counts in its own Redis bucket and blocks on its own, so burning the login limit
does not lock the caller out of the rest of the API. Response headers report
whichever budget binds the request — a login reply says `X-RateLimit-Limit: 5`.

A malformed rule raises at startup rather than being skipped: silently dropping
it would leave the endpoint on the loose global budget while the config claims
it is protected.

Settings: `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS`,
`RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_BLOCK_SECONDS`,
`RATE_LIMIT_TRUST_PROXY`, `RATE_LIMIT_EXEMPT_PATHS`, `RATE_LIMIT_RULES`.
