# =============================================================================
# QCF News — one switch between development and production
# =============================================================================
# Every target below takes the same ENV variable.  It picks the compose overlay
# and the env file together, so the two can never be mismatched:
#
#   ENV=dev   →  docker-compose.yml + docker-compose.dev.yml  + .env.development
#   ENV=prod  →  docker-compose.yml + docker-compose.prod.yml + .env.production
#
# ENV defaults to dev, so day-to-day work is just:
#
#   make up                  make logs                make migrate
#   make down                make test                make superuser
#
# and a deploy is the same verbs with ENV=prod:
#
#   make ENV=prod build      make ENV=prod migrate    make ENV=prod up
#
# `make dev` and `make prod` are shorthands for the common case.
# Run `make help` for the full list.
# =============================================================================

ENV ?= dev

ifeq ($(ENV),dev)
  COMPOSE_FILES := -f docker-compose.yml -f docker-compose.dev.yml
  ENV_FILE      := .env.development
  ENV_TEMPLATE  := .env.development.example
else ifeq ($(ENV),prod)
  COMPOSE_FILES := -f docker-compose.yml -f docker-compose.prod.yml
  ENV_FILE      := .env.production
  ENV_TEMPLATE  := .env.production.example
else
  $(error ENV must be 'dev' or 'prod' (got '$(ENV)'))
endif

# LOWMEM=1 appends the small-host overlay: memory ceilings, fewer workers, a
# smaller Postgres and Redis, and pinned image names so nothing is built here.
# Intended for the 2 GiB production box — see docker-compose.lowmem.yml.
#
#   make ENV=prod LOWMEM=1 up
ifdef LOWMEM
  COMPOSE_FILES += -f docker-compose.lowmem.yml
endif

DC := docker compose --env-file $(ENV_FILE) $(COMPOSE_FILES)

# Every target that talks to Docker depends on this, so a missing env file is
# a clear message rather than a wall of "variable is not set" warnings and a
# half-started stack.
.PHONY: require-env
require-env:
	@test -f $(ENV_FILE) || { \
	  echo ""; \
	  echo "  Missing $(ENV_FILE)"; \
	  echo ""; \
	  echo "  Create it from the template, then fill it in:"; \
	  echo "      cp $(ENV_TEMPLATE) $(ENV_FILE)"; \
	  echo ""; \
	  exit 1; \
	}

# ── Shorthands ───────────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start the development stack in the foreground (Ctrl-C to stop)
	@$(MAKE) ENV=dev up-fg

.PHONY: prod
prod: ## Start the production stack detached
	@$(MAKE) ENV=prod up

# ── Lifecycle ────────────────────────────────────────────────────────────────

.PHONY: up
up: require-env ## Start the stack detached
	$(DC) up -d

.PHONY: up-fg
up-fg: require-env ## Start the stack in the foreground with logs attached
	$(DC) up

.PHONY: build
build: require-env ## Rebuild images (needed after NEXT_PUBLIC_* changes; use `make deps` after package.json changes)
	$(DC) build

.PHONY: rebuild
rebuild: require-env ## Rebuild images from scratch, ignoring the layer cache
	$(DC) build --no-cache

# After a package.json / package-lock.json change, rebuilding the image is only
# half the job in dev.  The frontend keeps its node_modules in an *anonymous*
# volume (see docker-compose.dev.yml) so the host tree can't shadow it — and
# Compose carries that volume forward onto every recreated container.  A freshly
# built image therefore still gets the *old* node_modules mounted over it, and
# the app 500s on the newly added package with a "Module not found" that no
# amount of rebuilding clears.  Renewing the anonymous volume is what actually
# picks up the new dependency, so `deps` does both steps in the right order.
.PHONY: deps
deps: require-env ## Rebuild the frontend image AND reset its node_modules volume (run after any package.json change)
	$(DC) build frontend
	$(DC) up -d --renew-anon-volumes --force-recreate frontend

.PHONY: down
down: require-env ## Stop and remove containers (volumes are kept)
	$(DC) down

.PHONY: restart
restart: require-env ## Restart every service
	$(DC) restart

.PHONY: ps
ps: require-env ## Show container status
	$(DC) ps

.PHONY: logs
logs: require-env ## Follow logs for all services (or one: make logs SERVICE=backend)
	$(DC) logs -f --tail=100 $(SERVICE)

.PHONY: config
config: require-env ## Print the fully merged compose configuration
	$(DC) config

# ── Database ─────────────────────────────────────────────────────────────────

# `run --rm` starts db and redis, waits for their health checks, runs alembic to
# completion and propagates its exit code — so a release step can gate on this
# rather than hoping a post-start command succeeded.
.PHONY: migrate
migrate: require-env ## Apply all pending migrations, then exit
	$(DC) run --rm backend alembic upgrade head

.PHONY: migration
migration: require-env ## Autogenerate a revision: make migration M="add x to y"
	@test -n "$(M)" || { echo "Usage: make migration M=\"describe the change\""; exit 1; }
	$(DC) run --rm backend alembic revision --autogenerate -m "$(M)"

.PHONY: downgrade
downgrade: require-env ## Roll back one migration
	$(DC) run --rm backend alembic downgrade -1

.PHONY: superuser
superuser: require-env ## Create an admin user (interactive)
	$(DC) run --rm backend python manage.py createsuperuser

.PHONY: seed
seed: require-env ## Load the dummy article/category fixtures
	$(DC) run --rm backend python seed_dummy_data.py

.PHONY: psql
psql: require-env ## Open a psql shell on the running database
	$(DC) exec db sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

.PHONY: dbdump
dbdump: require-env ## Dump the database to backups/<timestamp>.sql.gz
	@mkdir -p backups
	$(DC) exec -T db sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' \
	  | gzip > backups/$(ENV)-$$(date +%Y%m%d-%H%M%S).sql.gz
	@ls -lh backups | tail -1

# ── Shells ───────────────────────────────────────────────────────────────────

.PHONY: sh-backend
sh-backend: require-env ## Shell into the backend container
	$(DC) exec backend bash

.PHONY: sh-frontend
sh-frontend: require-env ## Shell into the frontend container
	$(DC) exec frontend sh

# ── Quality gates ────────────────────────────────────────────────────────────
# These run against the dev images, which are the ones carrying the toolchain.

.PHONY: test
test: ## Run the backend test suite
	@$(MAKE) ENV=dev _test

.PHONY: _test
_test: require-env
	$(DC) run --rm backend pytest tests -v

.PHONY: lint
lint: ## Lint and typecheck both applications
	@$(MAKE) ENV=dev _lint-backend
	npm run lint
	npm run typecheck

.PHONY: _lint-backend
_lint-backend: require-env
	$(DC) run --rm backend flake8 src
	$(DC) run --rm backend mypy src

# nginx is not in the stack — it runs on the host from /home/conf/qcfnews.conf,
# included by /etc/nginx/nginx.conf.  This checks the whole host config, which
# is the only thing `systemctl reload` will accept.
.PHONY: nginx-check
nginx-check: ## Validate the HOST nginx config (needs sudo)
	sudo nginx -t

.PHONY: nginx-reload
nginx-reload: ## Test then reload the host nginx (needs sudo)
	sudo nginx -t && sudo systemctl reload nginx

# ── Housekeeping ─────────────────────────────────────────────────────────────

.PHONY: clean
clean: require-env ## Stop the stack and DELETE its volumes (database, media, cache)
	@echo "This deletes the $(ENV) database, uploaded media and Redis data."
	@printf 'Type the environment name to confirm [%s]: ' "$(ENV)"; \
	  read ans; [ "$$ans" = "$(ENV)" ] || { echo "Aborted."; exit 1; }
	$(DC) down -v

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "  QCF News — make targets     (ENV=$(ENV), using $(ENV_FILE))"
	@echo ""
	@grep -hE '^[a-z][a-zA-Z0-9_-]*:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "    \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Add ENV=prod to any target to act on the production stack."
	@echo ""

.DEFAULT_GOAL := help
