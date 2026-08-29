"""
Per-IP rate limiting middleware.

Every client IP gets a global budget of `RATE_LIMIT_REQUESTS` per
`RATE_LIMIT_WINDOW_SECONDS`. Individual endpoints can be held to a tighter
budget through `RATE_LIMIT_RULES` — credential and upload endpoints ship
throttled to 5/minute, because those are the ones worth brute-forcing.

A rule is enforced *in addition to* the global budget, not instead of it:
if the per-endpoint limit replaced the global one, an attacker could spend a
fresh 5 requests on each of a dozen endpoints and never touch the 20 they are
actually allowed. Breaching either budget blocks that budget's key for
`RATE_LIMIT_BLOCK_SECONDS`; every request in that period is answered with a 429
without touching the database or any downstream service.

Counters live in Redis so the limit holds across workers and processes. Redis
being down must not take the site down — the same trade-off the cache makes —
so a Redis failure fails *open* and the request is served.
"""
import logging
from dataclasses import dataclass

from fastapi import Request
from fastapi.responses import JSONResponse

from src.config.settings import settings
from src.utils.cache.client import RedisClient
from src.utils.client_ip import get_client_ip
from src.utils.exceptions import ErrorCode

logger = logging.getLogger(__name__)

ANY_METHOD = "*"

# Counts every applicable budget and trips the block in one atomic round trip,
# so two concurrent requests can never both read "19" and both be allowed.
#
# Buckets are passed as pairs: KEYS[2i-1] is the block key, KEYS[2i] the
# counter, and ARGV[3i-2..3i] the limit, window and block duration.
# Returns {blocked, retry_after, remaining}.
_LIMIT_SCRIPT = """
local buckets = #KEYS / 2

-- Nothing is counted while a budget is already blocked: a caller serving out
-- its ban must not extend the ban by continuing to hammer the endpoint.
for i = 1, buckets do
    local block_key = KEYS[i * 2 - 1]
    if redis.call('EXISTS', block_key) == 1 then
        local ttl = redis.call('TTL', block_key)
        if ttl < 0 then ttl = tonumber(ARGV[i * 3]) end
        return {1, ttl, 0}
    end
end

local remaining = -1
local reset = 0

for i = 1, buckets do
    local count_key = KEYS[i * 2]
    local limit = tonumber(ARGV[i * 3 - 2])
    local window = tonumber(ARGV[i * 3 - 1])
    local block = tonumber(ARGV[i * 3])

    local count = redis.call('INCR', count_key)
    if count == 1 then
        redis.call('EXPIRE', count_key, window)
    end

    if count > limit then
        redis.call('SET', KEYS[i * 2 - 1], 1, 'EX', block)
        redis.call('DEL', count_key)
        return {1, block, 0}
    end

    local left = limit - count
    if remaining < 0 or left < remaining then remaining = left end

    local ttl = redis.call('TTL', count_key)
    if ttl < 0 then ttl = window end
    if ttl > reset then reset = ttl end
end

return {0, reset, remaining}
"""


@dataclass(frozen=True)
class RateLimitRule:
    """A tighter budget for one endpoint or path prefix."""

    method: str
    path: str
    limit: int
    window: int
    block_seconds: int

    @property
    def scope(self) -> str:
        """Redis key segment; each rule counts in its own bucket."""
        return f"{self.method}:{self.path}"

    @property
    def specificity(self) -> tuple[int, int]:
        """Longest path wins; a named method beats a wildcard one."""
        return len(self.path), 0 if self.method == ANY_METHOD else 1

    def matches(self, method: str, path: str) -> bool:
        if self.method != ANY_METHOD and self.method != method:
            return False
        return path == self.path or path.startswith(self.path.rstrip("/") + "/")

    @classmethod
    def parse(cls, spec: str) -> "RateLimitRule":
        """
        Parse one `[METHOD ]PATH=LIMIT/WINDOW[/BLOCK]` entry.

        A malformed rule raises rather than being skipped: silently dropping it
        would leave the endpoint on the loose global budget while the config
        claims it is protected.
        """
        target, _, budget = spec.partition("=")
        if not budget:
            raise ValueError(
                f"Invalid rate limit rule {spec!r}: expected 'PATH=LIMIT/WINDOW'"
            )

        parts = target.split()
        if len(parts) == 2:
            method, path = parts[0].upper(), parts[1]
        elif len(parts) == 1:
            method, path = ANY_METHOD, parts[0]
        else:
            raise ValueError(f"Invalid rate limit rule target {target!r}")

        if not path.startswith("/"):
            raise ValueError(f"Rate limit rule path must be absolute: {path!r}")

        numbers = budget.split("/")
        if len(numbers) not in (2, 3):
            raise ValueError(
                f"Invalid rate limit budget {budget!r}: expected 'LIMIT/WINDOW[/BLOCK]'"
            )
        try:
            limit, window = int(numbers[0]), int(numbers[1])
            block = int(numbers[2]) if len(numbers) == 3 else window
        except ValueError as exc:
            raise ValueError(f"Invalid rate limit budget {budget!r}") from exc

        if limit < 1 or window < 1 or block < 1:
            raise ValueError(f"Rate limit budget must be positive: {budget!r}")

        return cls(method, path.rstrip("/") or "/", limit, window, block)


def parse_rules(raw: str) -> tuple[RateLimitRule, ...]:
    """Parse the comma-separated rule table, most specific first."""
    rules = [
        RateLimitRule.parse(spec.strip())
        for spec in raw.split(",")
        if spec.strip()
    ]
    return tuple(sorted(rules, key=lambda r: r.specificity, reverse=True))


class RateLimitMiddleware:
    def __init__(self, redis_client: RedisClient):
        self.redis = redis_client
        self.limit = settings.RATE_LIMIT_REQUESTS
        self.window = settings.RATE_LIMIT_WINDOW_SECONDS
        self.block_seconds = settings.RATE_LIMIT_BLOCK_SECONDS
        self.rules = parse_rules(settings.RATE_LIMIT_RULES)
        # Static media is fetched many times per page view; counting those
        # images against the API budget would throttle ordinary readers.
        self.exempt_paths = settings.rate_limit_exempt_paths + (
            settings.MEDIA_URL,
        )

    async def __call__(self, request: Request, call_next):
        if not settings.RATE_LIMIT_ENABLED or self._is_exempt(request):
            return await call_next(request)

        client_ip = self._client_ip(request)
        if not client_ip:
            return await call_next(request)

        rule = self.match_rule(request.method, request.url.path)
        # Report the budget that actually binds this request, so a caller
        # reading the headers sees the endpoint's 5/min, not the global 20.
        if rule and rule.limit <= self.limit:
            effective_limit, effective_window = rule.limit, rule.window
        else:
            effective_limit, effective_window = self.limit, self.window

        blocked, reset, remaining = await self._check(client_ip, rule)
        if blocked:
            logger.warning(
                "Rate limit exceeded for ip=%s on %s %s (limit %s); blocked for %ss",
                client_ip,
                request.method,
                request.url.path,
                effective_limit,
                reset,
            )
            return self._too_many_requests(
                effective_limit, effective_window, reset
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(effective_limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset)
        return response

    def match_rule(self, method: str, path: str) -> RateLimitRule | None:
        """The tightest-scoped rule covering this request, if any."""
        for rule in self.rules:
            if rule.matches(method, path):
                return rule
        return None

    # ── Internals ─────────────────────────────────────────────────────────

    async def _check(
        self, client_ip: str, rule: RateLimitRule | None
    ) -> tuple[bool, int, int]:
        """Returns (blocked, reset_or_retry_after, remaining)."""
        keys: list[str] = [
            f"ratelimit:block:global:{client_ip}",
            f"ratelimit:count:global:{client_ip}",
        ]
        args: list[int] = [self.limit, self.window, self.block_seconds]

        if rule:
            keys += [
                f"ratelimit:block:{rule.scope}:{client_ip}",
                f"ratelimit:count:{rule.scope}:{client_ip}",
            ]
            args += [rule.limit, rule.window, rule.block_seconds]

        try:
            blocked, reset, remaining = await self.redis.eval(
                _LIMIT_SCRIPT, len(keys), *keys, *args
            )
            return bool(blocked), int(reset), int(remaining)
        except Exception:
            logger.warning(
                "Rate limit check failed for ip=%s; allowing request",
                client_ip,
                exc_info=True,
            )
            return False, self.window, self.limit

    def _is_exempt(self, request: Request) -> bool:
        # CORS preflights are issued by the browser, not the caller, and
        # answering them with a 429 hides the real error from the client.
        if request.method == "OPTIONS":
            return True
        path = request.url.path
        return any(
            path == exempt or path.startswith(exempt.rstrip("/") + "/")
            for exempt in self.exempt_paths
        )

    @staticmethod
    def _client_ip(request: Request) -> str | None:
        # Shared with the newsletter signup, which records the same address as
        # consent evidence: both have to agree on when a forwarded header may
        # be believed, so the rule lives in one place.
        return get_client_ip(request)

    def _too_many_requests(
        self, limit: int, window: int, retry_after: int
    ) -> JSONResponse:
        return JSONResponse(
            status_code=ErrorCode.RATE_LIMIT_EXCEEDED.status_code,
            content={
                "success": False,
                # The budget itself is deliberately not quoted here: the
                # X-RateLimit-Limit header already carries it for a legitimate
                # client, and the body is the part a scripted caller reads.
                "message": (
                    f"Too many requests. "
                    f"Try again in {retry_after} seconds."
                ),
                "error_code": ErrorCode.RATE_LIMIT_EXCEEDED.code,
                "data": {"retry_after": retry_after},
            },
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
            },
        )
