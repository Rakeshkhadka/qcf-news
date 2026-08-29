"""
High-level caching service that wraps Redis operations
with JSON serialization and TTL management.
"""
import json
import logging
from typing import Any, Optional

from src.utils.cache.client import RedisClient

logger = logging.getLogger(__name__)

DEFAULT_TTL = 300  # 5 minutes


class CacheService:
    def __init__(self, redis_client: RedisClient):
        self.redis = redis_client

    async def get(self, key: str) -> Optional[Any]:
        """Get a JSON-deserialized value from cache."""
        try:
            raw = await self.redis.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            logger.warning("Cache GET failed for key=%s", key, exc_info=True)
            return None

    async def set(self, key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
        """Store a JSON-serialized value with TTL."""
        try:
            await self.redis.set(key, json.dumps(value, default=str), ex=ttl)
        except Exception:
            logger.warning("Cache SET failed for key=%s", key, exc_info=True)

    async def delete(self, key: str) -> None:
        """Remove a key from cache."""
        try:
            await self.redis.delete(key)
        except Exception:
            logger.warning("Cache DELETE failed for key=%s", key, exc_info=True)

    async def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching a glob pattern. Returns count deleted."""
        keys = await self.scan_keys(pattern)
        if not keys:
            return 0
        try:
            return await self.redis.delete(*keys)
        except Exception:
            logger.warning("Cache DELETE_PATTERN failed for %s", pattern, exc_info=True)
            return 0

    async def scan_keys(self, pattern: str) -> list[str]:
        """Collect every key matching a glob pattern."""
        try:
            return [key async for key in self.redis.scan_iter(match=pattern)]
        except Exception:
            logger.warning("Cache SCAN failed for %s", pattern, exc_info=True)
            return []
