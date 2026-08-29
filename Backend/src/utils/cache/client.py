"""
Async Redis client wrapper with connection pooling.
"""
import redis.asyncio as redis

from src.config.settings import settings


class RedisClient:
    def __init__(self, redis_url: str = settings.REDIS_URL):
        self.redis_url = redis_url
        self.client: redis.Redis | None = None

    async def connect(self) -> None:
        if not self.client:
            self.client = redis.Redis.from_url(
                self.redis_url, decode_responses=True
            )
        await self.client.ping()

    async def disconnect(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    def __getattr__(self, name):
        """Delegate Redis commands to the underlying client."""
        if self.client:
            return getattr(self.client, name)
        raise AttributeError(
            f"RedisClient not connected; call connect() first"
        )
