# =============================================================================
# QCF News — FastAPI Backend (multi-stage, dev and production)
# =============================================================================
#   builder — compile C extensions in a full image (gcc, headers, etc.)
#   dev     — uvicorn --reload plus the test/lint toolchain  (target: dev)
#   runner  — slim gunicorn runtime, non-root                (target: runner)
#
# The stage is chosen by the compose overlay via BACKEND_TARGET, so both
# environments share one dependency build and one base image.
# =============================================================================

# ── Stage 1 — builder ───────────────────────────────────────────────────────
FROM python:3.13-slim AS builder

WORKDIR /build

# System deps needed to compile C extensions (asyncpg, psycopg2, bcrypt, etc.)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 1b — dev ──────────────────────────────────────────────────────────
# Used only by docker-compose.dev.yml, which bind-mounts ./Backend over /app.
#
# Two deliberate differences from `runner`:
#   • It stays root.  The bind-mounted tree is owned by the host user, and a
#     uid-1001 process could not write migrations or uploads into it.
#   • It installs requirements-dev.txt, so `make test` and `make lint` run in
#     the same interpreter the app runs in.
FROM python:3.13-slim AS dev

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt

COPY . .

RUN mkdir -p /app/media

# Unbuffered so uvicorn's reload messages and tracebacks reach `docker logs`
# the moment they happen instead of sitting in a pipe buffer.
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", \
     "--reload", "--reload-dir", "/app/src"]

# ── Stage 2 — runner ────────────────────────────────────────────────────────
FROM python:3.13-slim AS runner

WORKDIR /app

# Runtime-only lib for psycopg2 (no gcc)
RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq5 curl && \
    rm -rf /var/lib/apt/lists/*

# Copy pre-built Python packages from builder
COPY --from=builder /install /usr/local

# Non-root user for security
RUN groupadd --system --gid 1001 appuser && \
    useradd  --system --uid 1001 --gid appuser --home /app appuser

# Copy application code
COPY . .

# Create media directory and give ownership to appuser
RUN mkdir -p /app/media && chown -R appuser:appuser /app/media

USER appuser

EXPOSE 8000

# Health check against the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Production server: gunicorn with uvicorn workers
# Falls back to the BACKEND_WORKERS env var, default 4
CMD ["sh", "-c", "gunicorn app:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers ${BACKEND_WORKERS:-4} \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile -"]
