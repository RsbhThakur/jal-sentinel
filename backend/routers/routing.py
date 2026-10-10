"""
Dynamic Evacuation Corridor REST API Router.
Handles POST /api/route requests, queries active flood depths and hazards,
runs vehicle-clearance-aware A* routing, and caches computed corridors in Redis.
"""
import json
import logging
from typing import Dict, Tuple, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.cache import get_redis_client
from backend.models.entities import HazardEvent
from backend.models.schemas import RouteRequest, RouteResponse
from backend.workers.routing import get_evacuation_router, CLEARANCE_THRESHOLDS
from backend.utils.geospatial import geo_to_h3
from backend.routers.ws import get_mock_flood_geojson
from backend.routers.hazards import GUWAHATI_BASELINE_HAZARDS

logger = logging.getLogger("jal_sentinel.routing_api")

router = APIRouter(prefix="/api/route", tags=["routing"])

ROUTE_CACHE_TTL_SECONDS: int = 60


def build_route_cache_key(origin_hex: str, dest_hex: str, vehicle_class: str) -> str:
    """Generates canonical Redis key: route:{origin_hex}:{dest_hex}:{vehicle_class}"""
    return f"route:{origin_hex}:{dest_hex}:{vehicle_class.lower()}"


async def get_active_flood_and_hazard_overrides(
    db: AsyncSession,
    router_instance
) -> Dict[Tuple[str, str], Dict[str, float]]:
    """
    Queries current flood polygons and structural hazard database to produce
    dynamic edge weight overrides for the road network graph.
    """
    overrides: Dict[Tuple[str, str], Dict[str, float]] = {}

    # 1. Fetch active inundation polygons
    try:
        flood_geojson = get_mock_flood_geojson("T+15")
        for feature in flood_geojson.get("features", []):
            props = feature.get("properties", {})
            depth_cm = float(props.get("depth_cm", 0.0))
            geom = feature.get("geometry", {})
            coords = geom.get("coordinates", [[]])[0]

            if not coords or depth_cm <= 0:
                continue

            avg_lng = sum(pt[0] for pt in coords) / len(coords)
            avg_lat = sum(pt[1] for pt in coords) / len(coords)

            try:
                nearest_nid = router_instance.find_nearest_node(avg_lat, avg_lng)
                for neighbor in router_instance.graph.neighbors(nearest_nid):
                    overrides[(nearest_nid, neighbor)] = {
                        "h_pred": depth_cm,
                        "hazard_flag": overrides.get((nearest_nid, neighbor), {}).get("hazard_flag", 0)
                    }
                    overrides[(neighbor, nearest_nid)] = {
                        "h_pred": depth_cm,
                        "hazard_flag": overrides.get((neighbor, nearest_nid), {}).get("hazard_flag", 0)
                    }
            except Exception as e:
                logger.debug(f"Could not map flood polygon to street graph: {e}")
    except Exception as e:
        logger.warning(f"Error reading flood polygons: {e}")

    # 2. Query structural hazards
    try:
        hazards_query = select(HazardEvent).where(HazardEvent.false_positive_flag == False)
        hazards_res = await db.execute(hazards_query)
        active_hazards = hazards_res.scalars().all()
    except Exception as e:
        logger.warning(f"Error querying DB hazard events, using baseline pins: {e}")
        active_hazards = []

    hazard_coords = []
    if active_hazards:
        for h in active_hazards:
            hazard_coords.append((h.lat, h.lng))
    else:
        for h in GUWAHATI_BASELINE_HAZARDS:
            hazard_coords.append((h["lat"], h["lng"]))

    for hlat, hlng in hazard_coords:
        try:
            hnid = router_instance.find_nearest_node(hlat, hlng)
            for neighbor in router_instance.graph.neighbors(hnid):
                curr = overrides.get((hnid, neighbor), {"h_pred": 0.0, "hazard_flag": 0})
                curr["hazard_flag"] = 1
                overrides[(hnid, neighbor)] = curr

                curr_rev = overrides.get((neighbor, hnid), {"h_pred": 0.0, "hazard_flag": 0})
                curr_rev["hazard_flag"] = 1
                overrides[(neighbor, hnid)] = curr_rev
        except Exception as e:
            logger.debug(f"Could not map hazard to street graph: {e}")

    return overrides



@router.post("", response_model=RouteResponse, status_code=status.HTTP_200_OK)
async def compute_evacuation_route(
    req: RouteRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Computes safest, dry evacuation path bypassing flooded edges and hazards.
    Caches calculated corridors in Redis for 60 seconds per (origin_hex, dest_hex, vehicle_class).
    """
    vehicle = req.vehicle_class.lower()
    if vehicle not in CLEARANCE_THRESHOLDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported vehicle class '{req.vehicle_class}'. Valid classes: {list(CLEARANCE_THRESHOLDS.keys())}"
        )

    origin_hex = geo_to_h3(req.origin_lat, req.origin_lng, resolution=12)
    dest_hex = geo_to_h3(req.destination_lat, req.destination_lng, resolution=12)

    cache_key = build_route_cache_key(origin_hex, dest_hex, vehicle)
    redis_client = None

    # 1. Attempt Redis Cache Lookup
    try:
        redis_client = await get_redis_client()
        cached_data = await redis_client.get(cache_key)
        if cached_data:
            route_dict = json.loads(cached_data)
            route_dict["properties"]["cached"] = True
            logger.info(f"Redis cache hit for route {cache_key}")
            return RouteResponse(**route_dict)
    except Exception as e:
        logger.warning(f"Redis cache lookup error: {e}")

    # 2. Acquire Router & Dynamic Overrides
    router_instance = get_evacuation_router()
    overrides = await get_active_flood_and_hazard_overrides(db, router_instance)

    # 3. Compute Dynamic Route
    try:
        route_result = router_instance.compute_route(
            origin_lat=req.origin_lat,
            origin_lng=req.origin_lng,
            dest_lat=req.destination_lat,
            dest_lng=req.destination_lng,
            vehicle_class=vehicle,
            edge_weight_overrides=overrides
        )
    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve)
        )
    except Exception as e:
        logger.error(f"Routing computation exception: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to solve evacuation route."
        )

    if not route_result.get("success") or not route_result.get("route_geojson"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=route_result.get(
                "message",
                f"No safe corridor found for {vehicle} due to severe inundation or hazard blockage."
            )
        )

    route_geojson = route_result["route_geojson"]

    # 4. Cache Route in Redis for 60 seconds
    if redis_client:
        try:
            await redis_client.set(
                cache_key,
                json.dumps(route_geojson),
                ex=ROUTE_CACHE_TTL_SECONDS
            )
        except Exception as e:
            logger.warning(f"Failed to store route in Redis cache: {e}")

    return RouteResponse(**route_geojson)
