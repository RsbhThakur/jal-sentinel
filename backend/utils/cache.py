import json
import logging
import time
from typing import Optional, Any
from backend.config import settings

logger = logging.getLogger("jal_sentinel.cache")

# In-memory TTL fallback dictionary: { key: (value_dict, expiry_timestamp) }
_in_memory_cache: dict[str, tuple[dict, float]] = {}
_redis_client: Optional[Any] = None
_redis_checked = False


def _get_redis_client():
    global _redis_client, _redis_checked
    if _redis_checked:
        return _redis_client

    _redis_checked = True
    try:
        import redis
        client = redis.from_url(
            settings.redis_url,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
            decode_responses=True
        )
        # Test ping
        client.ping()
        _redis_client = client
        logger.info(f"Connected to Redis cache at {settings.redis_url}")
    except Exception as e:
        logger.info(f"Redis unavailable ({e}). Using in-memory fallback cache.")
        _redis_client = None

    return _redis_client


def set_telemetry_cache(key: str, data: dict, ttl_seconds: int = 1200) -> bool:
    """
    Store telemetry data in Redis (or in-memory fallback) with TTL.
    Default TTL is 1200 seconds (20 minutes).
    """
    client = _get_redis_client()
    if client:
        try:
            client.set(key, json.dumps(data), ex=ttl_seconds)
            return True
        except Exception as e:
            logger.warning(f"Failed to set Redis key '{key}': {e}. Falling back to memory.")

    # In-memory store
    expiry = time.time() + ttl_seconds
    _in_memory_cache[key] = (data, expiry)
    return True


def get_telemetry_cache(key: str) -> Optional[dict]:
    """
    Retrieve telemetry data from Redis (or in-memory fallback).
    Returns None if missing or expired.
    """
    client = _get_redis_client()
    if client:
        try:
            raw = client.get(key)
            if raw:
                return json.loads(raw)
        except Exception as e:
            logger.warning(f"Failed to read Redis key '{key}': {e}. Falling back to memory.")

    # Check in-memory store
    item = _in_memory_cache.get(key)
    if not item:
        return None

    data, expiry = item
    if time.time() > expiry:
        del _in_memory_cache[key]
        return None

    return data


def clear_telemetry_cache():
    """Clear in-memory cache for clean testing."""
    global _in_memory_cache
    _in_memory_cache.clear()
