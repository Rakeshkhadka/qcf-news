# =============================================================================
# QCF News — Next.js Frontend (multi-stage, dev and production)
# =============================================================================
#   deps    — install node_modules once, shared by every later stage
#   dev     — `next dev` with HMR, for docker-compose.dev.yml  (target: dev)
#   builder — produce the standalone production build
#   runner  — minimal runtime image                            (target: runner)
#
# The stage is chosen by the compose overlay via FRONTEND_TARGET, so the same
# Dockerfile serves both environments and dev never drifts from the base image
# production is built on.
# =============================================================================

# ── Stage 1 — deps ───────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Install only production + dev deps needed for the build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── Stage 1b — dev ───────────────────────────────────────────────────────────
# Used only by docker-compose.dev.yml, which bind-mounts the source over /app
# and keeps this image's node_modules alive behind an anonymous volume.  The
# COPY below is what makes the image runnable on its own; in practice the mount
# supersedes it a moment later.
#
# NEXT_PUBLIC_* are deliberately absent: `next dev` reads them at startup, so a
# changed public URL costs a container restart rather than an image rebuild.
FROM node:22-alpine AS dev
WORKDIR /app

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# Note: file-change polling is deliberately NOT forced on here. On a Linux host
# inotify events cross a bind mount fine and polling just burns CPU. On Docker
# Desktop (macOS/Windows) they do not, and HMR goes quiet — set WATCHPACK_POLLING
# in .env.development there; the compose overlay passes it straight through.

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]

# ── Stage 2 — builder ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
# they arrive as build args from docker-compose.  Both are browser-facing.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_MEDIA_BASE_URL
# Whether the newsletter signup form is rendered.  Defaults to off, so an image
# built without it shows no signup box rather than a form the API refuses.
ARG NEXT_PUBLIC_NEWSLETTER_ENABLED=false

ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_MEDIA_BASE_URL=${NEXT_PUBLIC_MEDIA_BASE_URL}
ENV NEXT_PUBLIC_NEWSLETTER_ENABLED=${NEXT_PUBLIC_NEWSLETTER_ENABLED}

# The internal API origin is needed at build time as well, because Next
# resolves `rewrites()` into routes-manifest.json during the build — the
# /media rewrite destination is frozen there.  It stays a *server-side* value:
# it is never inlined into the client bundle (no NEXT_PUBLIC_ prefix), and the
# runtime env of the same name still drives SSR fetches and the BFF routes.
ARG API_INTERNAL_ORIGIN=http://backend:8000

ENV API_INTERNAL_ORIGIN=${API_INTERNAL_ORIGIN}

# Enable Next.js standalone output for the smallest possible runtime image
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Stage 3 — runner ────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy only the pieces the standalone server needs.
# next.config.js is read at startup; public/ and .next/static are served
# directly by Next.js and must sit alongside the server bundle.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# The standalone output includes its own minimal server.js
CMD ["node", "server.js"]
