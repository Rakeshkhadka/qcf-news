"""Policy behaviour of the per-IP rate-limit middleware.

The Lua counter itself is exercised against a real Redis; these tests pin the
middleware's decisions around it: which requests are counted, against which
budgets and which IP, what a blocked caller receives, and that a broken Redis
never takes an endpoint offline.
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.config.settings import settings
from src.utils.rate_limit import RateLimitMiddleware, RateLimitRule, parse_rules


class _FakeRedis:
    """Records calls to `eval` and replays the script's return contract."""

    def __init__(self, returns=None, raises=False):
        self.returns = returns or [0, 60, 19]
        self.raises = raises
        self.calls: list[dict] = []

    async def eval(self, script, numkeys, *args):
        keys, argv = list(args[:numkeys]), list(args[numkeys:])
        self.calls.append({"keys": keys, "argv": argv})
        if self.raises:
            raise ConnectionError("redis is down")
        return self.returns

    @property
    def counted_ips(self) -> list[str]:
        return [call["keys"][0].rsplit(":", 1)[1] for call in self.calls]

    def budgets(self, index: int = 0) -> list[tuple]:
        """The (scope, limit, window, block) each call asked Redis to enforce."""
        call = self.calls[index]
        return [
            (
                call["keys"][i * 2].split(":", 2)[2].rsplit(":", 1)[0],
                *call["argv"][i * 3: i * 3 + 3],
            )
            for i in range(len(call["keys"]) // 2)
        ]


def _client(redis, **headers):
    app = FastAPI()
    app.middleware("http")(RateLimitMiddleware(redis))

    @app.get("/api/v1/articles")
    async def articles():
        return {"ok": True}

    @app.post("/api/v1/users/login")
    async def login():
        return {"ok": True}

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    return TestClient(app, headers=headers)


class RateLimitMiddlewareTests(unittest.TestCase):
    def test_allowed_request_carries_budget_headers(self):
        redis = _FakeRedis(returns=[0, 42, 7])
        response = _client(redis).get("/api/v1/articles")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["X-RateLimit-Limit"],
            str(settings.RATE_LIMIT_REQUESTS),
        )
        self.assertEqual(response.headers["X-RateLimit-Remaining"], "7")
        self.assertEqual(response.headers["X-RateLimit-Reset"], "42")

    def test_blocked_request_returns_429_without_reaching_the_route(self):
        redis = _FakeRedis(returns=[1, 60, 0])
        response = _client(redis).get("/api/v1/articles")

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["Retry-After"], "60")
        body = response.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error_code"], "GEN_003")
        self.assertEqual(body["data"], {"retry_after": 60})

    def test_unruled_request_is_held_to_the_global_budget_only(self):
        redis = _FakeRedis()
        _client(redis).get("/api/v1/articles")

        self.assertEqual(
            redis.budgets(),
            [
                (
                    "global",
                    settings.RATE_LIMIT_REQUESTS,
                    settings.RATE_LIMIT_WINDOW_SECONDS,
                    settings.RATE_LIMIT_BLOCK_SECONDS,
                )
            ],
        )

    def test_exempt_paths_and_preflights_are_never_counted(self):
        redis = _FakeRedis(returns=[1, 60, 0])
        client = _client(redis)

        self.assertEqual(client.get("/health").status_code, 200)
        client.options("/api/v1/articles")
        self.assertEqual(redis.calls, [])

    def test_redis_failure_fails_open(self):
        redis = _FakeRedis(raises=True)
        response = _client(redis).get("/api/v1/articles")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["X-RateLimit-Remaining"],
            str(settings.RATE_LIMIT_REQUESTS),
        )

    def test_forwarded_header_is_ignored_unless_the_proxy_is_trusted(self):
        redis = _FakeRedis()
        _client(redis, **{"X-Forwarded-For": "9.9.9.9"}).get("/api/v1/articles")

        # Spoofing the header must not hand the caller a fresh budget.
        self.assertEqual(redis.counted_ips, ["testclient"])

    def test_forwarded_header_is_used_when_the_proxy_is_trusted(self):
        redis = _FakeRedis()
        original = settings.RATE_LIMIT_TRUST_PROXY
        settings.RATE_LIMIT_TRUST_PROXY = True
        try:
            _client(
                redis, **{"X-Forwarded-For": "9.9.9.9, 10.0.0.1"}
            ).get("/api/v1/articles")
        finally:
            settings.RATE_LIMIT_TRUST_PROXY = original

        self.assertEqual(redis.counted_ips, ["9.9.9.9"])


class PerEndpointRuleTests(unittest.TestCase):
    def test_ruled_endpoint_is_charged_to_both_budgets(self):
        redis = _FakeRedis()
        _client(redis).post("/api/v1/users/login")

        scopes = [budget[0] for budget in redis.budgets()]
        self.assertEqual(scopes, ["global", "POST:/api/v1/users/login"])
        # The endpoint rule adds to the global budget rather than replacing it,
        # so many cheap endpoints can't be combined into an unlimited total.
        self.assertEqual(redis.budgets()[0][1], settings.RATE_LIMIT_REQUESTS)
        self.assertEqual(redis.budgets()[1][1], 5)

    def test_headers_report_the_budget_that_actually_binds(self):
        redis = _FakeRedis(returns=[0, 60, 3])
        response = _client(redis).post("/api/v1/users/login")

        self.assertEqual(response.headers["X-RateLimit-Limit"], "5")

    def test_blocked_response_reports_the_endpoint_budget(self):
        """
        The retry delay goes in the body; the budget goes in the header.

        The message deliberately does not quote the limit, so this pins where
        each number actually surfaces rather than asserting on prose.
        """
        redis = _FakeRedis(returns=[1, 60, 0])
        response = _client(redis).post("/api/v1/users/login")

        self.assertEqual(response.json()["message"],
                         "Too many requests. Try again in 60 seconds.")
        self.assertEqual(response.json()["data"]["retry_after"], 60)
        self.assertEqual(response.headers["Retry-After"], "60")
        self.assertEqual(response.headers["X-RateLimit-Limit"], "5")

    def test_rules_are_ordered_most_specific_first(self):
        rules = parse_rules("/api=30/60,POST /api/v1/uploads=5/60,/api/v1=20/60")

        self.assertEqual(
            [(r.method, r.path) for r in rules],
            [("POST", "/api/v1/uploads"), ("*", "/api/v1"), ("*", "/api")],
        )

    def test_rule_matches_the_prefix_and_its_children_only(self):
        rule = RateLimitRule.parse("POST /api/v1/uploads=5/60")

        self.assertTrue(rule.matches("POST", "/api/v1/uploads"))
        self.assertTrue(rule.matches("POST", "/api/v1/uploads/images"))
        self.assertFalse(rule.matches("GET", "/api/v1/uploads"))
        self.assertFalse(rule.matches("POST", "/api/v1/uploads-archive"))

    def test_rule_accepts_an_explicit_block_duration(self):
        rule = RateLimitRule.parse("POST /api/v1/users/login=5/60/900")

        self.assertEqual((rule.limit, rule.window, rule.block_seconds), (5, 60, 900))

    def test_method_is_optional(self):
        rule = RateLimitRule.parse("/api/v1/uploads=5/60")

        self.assertTrue(rule.matches("DELETE", "/api/v1/uploads"))
        self.assertEqual(rule.block_seconds, 60)

    def test_malformed_rules_are_rejected_rather_than_skipped(self):
        # Dropping a bad rule would leave the endpoint on the loose global
        # budget while the config claims it is protected.
        for spec in (
            "/api/v1/uploads",
            "/api/v1/uploads=5",
            "/api/v1/uploads=abc/60",
            "/api/v1/uploads=0/60",
            "relative/path=5/60",
            "POST GET /api=5/60",
        ):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                RateLimitRule.parse(spec)

    def test_shipped_rules_protect_the_credential_endpoints(self):
        protected = {
            (r.method, r.path): r.limit
            for r in parse_rules(settings.RATE_LIMIT_RULES)
        }

        self.assertEqual(protected[("POST", "/api/v1/users/login")], 5)
        self.assertEqual(protected[("POST", "/api/v1/users/register")], 5)
        self.assertEqual(protected[("*", "/api/v1/uploads")], 5)


if __name__ == "__main__":
    unittest.main()
