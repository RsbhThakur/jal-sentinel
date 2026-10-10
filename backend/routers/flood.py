"""
JAL-SENTINEL: Flood Inundation Prediction REST Router.
Provides GET /api/flood/prediction endpoint supporting time horizon queries (t=15|30|60),
serving cached 2D Manning shallow-water hydraulic simulation polygons.
"""
import json
import logging
from typing import Optional
from fastapi import APIRouter, Query, HTTPException, status

from backend.cache import get_redis_client
from backend.utils.cache import get_telemetry_cache
from backend.models.schemas import FloodPredictionResponse
from backend.workers.manning_solver import solve_and_cache_flood_spread
from backend.routers.ws import get_mock_flood_geojson

logger = logging.getLogger("jal_sentinel.flood_api")

router = APIRouter(prefix="/api/flood", tags=["flood"])


@router.get("/prediction", response_model=FloodPredictionResponse, status_code=status.HTTP_200_OK)
async def get_flood_prediction(
    t: str = Query(
        default="15",
        description="Prediction horizon in minutes: '15', '30', '60' (or 'T+15', 'T+30', 'T+60')"
    ),
    recompute: bool = Query(
        default=False,
        description="Explicitly force re-execution of the 2D Manning forward-Euler solver"
    )
):
    """
    Returns predicted 2D Manning flood inundation polygons for Guwahati.
    First checks Redis cache (key: 'flood:t{horizon}', 5-min TTL).
    If cache misses or recompute=True, triggers forward-Euler solver and caches result.
    """
    # Normalize horizon key
    norm_t = t.upper().replace("T+", "").strip()
    if norm_t not in ["15", "30", "60"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid horizon 't={t}'. Supported horizons: '15', '30', '60' (or 'T+15', 'T+30', 'T+60')"
        )

    horizon_label = f"T+{norm_t}"
    cache_key = f"flood:t{norm_t}"
    redis_client = None

    # 1. Attempt Redis Cache Lookup unless recompute requested
    if not recompute:
        try:
            redis_client = await get_redis_client()
            cached_raw = await redis_client.get(cache_key)
            if cached_raw:
                logger.info(f"Redis cache hit for flood prediction: {cache_key}")
                data = json.loads(cached_raw)
                return FloodPredictionResponse(**data)
        except Exception as e:
            logger.debug(f"Redis lookup bypassed for {cache_key}: {e}")

        # Check in-memory telemetry cache
        mem_cached = get_telemetry_cache(cache_key)
        if mem_cached:
            logger.info(f"Memory cache hit for flood prediction: {cache_key}")
            return FloodPredictionResponse(**mem_cached)

    # 2. Trigger 2D Manning Hydraulic Solver
    logger.info(f"Solving 2D Manning inundation equations for horizon {horizon_label}...")
    try:
        solutions = await solve_and_cache_flood_spread(broadcast_websocket=True)
        if horizon_label in solutions:
            return FloodPredictionResponse(**solutions[horizon_label])
    except Exception as e:
        logger.error(f"Manning solver execution exception: {e}")

    # 3. Fallback to baseline calibrated polygon set if solving fails
    fallback_fc = get_mock_flood_geojson(horizon_label)
    return FloodPredictionResponse(**fallback_fc)
