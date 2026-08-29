#!/usr/bin/env bash
#
# Build the production images on THIS machine and load them onto the server.
#
#   ./scripts/ship-images.sh ubuntu@1.2.3.4 [~/.ssh/key.pem]
#
# Why: the 2 GiB production host cannot run `next build` — it wants ~2 GiB on
# its own and gets OOM-killed with a bare "Killed". Building here also keeps the
# 4-6 GiB of intermediate layers off the server's 8 GiB of free disk.
#
# What ends up in the image, and what does not:
#
#   BAKED IN at build time — these must be correct in the local .env.production:
#       NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_MEDIA_BASE_URL,
#       NEXT_PUBLIC_NEWSLETTER_ENABLED, API_INTERNAL_ORIGIN
#
#   NOT in the image — injected at runtime from the SERVER's .env.production:
#       every secret. Database password, JWT keys, SMTP credentials.
#
# So the local .env.production needs the four build values to be real and can
# leave every secret as a placeholder. Keep the real secrets on the server only.
#
set -euo pipefail

HOST="${1:?usage: ship-images.sh user@host [ssh-key]}"
KEY="${2:-}"
SSH=(ssh)
[ -n "$KEY" ] && SSH+=(-i "$KEY")
SSH+=("$HOST")

IMAGES=(qcfnews/backend:latest qcfnews/frontend:latest)
COMPOSE=(docker compose --env-file .env.production
         -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.lowmem.yml)

cd "$(dirname "$0")/.."

[ -f .env.production ] || {
  echo "error: .env.production missing here. Copy .env.production.example and set"
  echo "       the four build-time values; placeholders are fine for the secrets."
  exit 1
}

echo "==> checking architectures match"
LOCAL_ARCH=$(docker version --format '{{.Server.Arch}}')
REMOTE_ARCH=$("${SSH[@]}" "docker version --format '{{.Server.Arch}}'")
if [ "$LOCAL_ARCH" != "$REMOTE_ARCH" ]; then
  echo "error: local=$LOCAL_ARCH remote=$REMOTE_ARCH"
  echo "       A mismatch loads fine and then fails at runtime with"
  echo "       'exec format error'. Rebuild with --platform linux/$REMOTE_ARCH."
  exit 1
fi
echo "    both $LOCAL_ARCH"

echo "==> verifying the canonical origin about to be baked in"
grep -E '^NEXT_PUBLIC_SITE_URL=' .env.production || true
case "$(grep -E '^NEXT_PUBLIC_SITE_URL=' .env.production | cut -d= -f2-)" in
  https://*) ;;
  *) echo "error: NEXT_PUBLIC_SITE_URL must be the https:// origin before the build."
     echo "       It is inlined into the client bundle; an http:// value publishes"
     echo "       wrong canonical URLs, sitemap entries, RSS links and social cards."
     exit 1 ;;
esac

echo "==> building"
"${COMPOSE[@]}" build

echo "==> shipping $(printf '%s ' "${IMAGES[@]}")"
docker save "${IMAGES[@]}" | gzip -1 | "${SSH[@]}" 'gunzip | docker load'

echo "==> loaded on the server:"
"${SSH[@]}" "docker images --filter=reference='qcfnews/*' --format '    {{.Repository}}:{{.Tag}}  {{.Size}}'"

cat <<'NEXT'

Next, on the server:

    cd ~/qcf-news && git pull          # code, migrations, compose files
    make ENV=prod LOWMEM=1 migrate
    make ENV=prod LOWMEM=1 up
    make ENV=prod LOWMEM=1 ps

`up` will NOT rebuild: the tagged images are already present.
NEXT
