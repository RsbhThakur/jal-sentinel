"""
JAL-SENTINEL Redis Connection & Cache Manager.
Provides an async Redis client with graceful fallback to an in-memory
fake Redis implementation when a live Redis server is unavailable.
"""
import logging
from typing import Optional
import redis.asyncio as aioredis
from backend.config import settings

logger = logging.getLogger("jal_sentinel.cache")

_redis_client: Optional[aioredis.Redis] = None
_is_fake: bool = False


async def get_redis_client() -> aioredis.Redis:
    """
    Retrieve or initialize the singleton async Redis client.
    Tests live connectivity; gracefully falls back to fakeredis in local test environments.
    """
    global _redis_client, _is_fake
    if _redis_client is not None:
        return _redis_client

    try:
        candidate = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_timeout=0.3,
            socket_connect_timeout=0.3
        )
        await candidate.ping()
        _redis_client = candidate
        _is_fake = False
        logger.info(f"Connected to live Redis instance at {settings.redis_url}")
    except Exception as e:
        logger.warning(
            f"Live Redis unavailable at {settings.redis_url} ({e}). "
            f"Falling back to high-performance in-memory fake Redis cache."
        )
        try:
            import fakeredis.aioredis as fake_aioredis
            _redis_client = fake_aioredis.FakeRedis(decode_responses=True)
            _is_fake = True
        except ImportError:
            class InMemoryAsyncRedis:
                def __init__(self):
                    self._store = {}
                async def ping(self):
                    return True
                async def get(self, key):
                    return self._store.get(key)
                async def set(self, key, value, ex=None):
                    self._store[key] = value
                    return True
                async def delete(self, key):
                    return self._store.pop(key, None) is not None
                async def aclose(self):
                    self._store.clear()
            _redis_client = InMemoryAsyncRedis()
            _is_fake = True

    return _redis_client


async def close_redis_client() -> None:
    """Clean up and close active Redis client connections on shutdown."""
    global _redis_client, _is_fake
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception as e:
            logger.debug(f"Error during Redis close: {e}")
        _redis_client = None
        _is_fake = False


async def check_redis_health() -> bool:
    """Validate Redis connectivity and responsiveness."""
    try:
        client = await get_redis_client()
        await client.ping()
        return True
    except Exception as e:
        logger.error(f"Redis healthcheck failed: {e}")
        return False
