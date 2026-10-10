"""
JAL-SENTINEL: Real-Time WebSocket Telemetry Broadcaster (Issue #9).
Pushes live hydraulic simulations (flood polygons), optical metric depths (dh/dt),
hazard event alerts, dynamic route updates, and keepalive pings over ws://localhost:8000/ws/telemetry.
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import List, Set, Dict, Optional, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.cache import get_redis_client
from backend.utils.cache import get_telemetry_cache, set_telemetry_cache
from backend.models.schemas import TelemetryMessage

logger = logging.getLogger("jal_sentinel.ws")
router = APIRouter(tags=["telemetry"])


class ConnectionManager:
    """
    Manages active WebSocket client connections, heartbeat pings,
    stale connection pruning, and schema-validated JSON broadcasts.
    """

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.last_activity: Dict[WebSocket, float] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        self.last_activity[websocket] = time.time()
        logger.info(f"WebSocket client connected. Active connections: {len(self.active_connections)}")

    def record_activity(self, websocket: WebSocket):
        """Update activity timestamp upon receiving client message or pong."""
        if websocket in self.active_connections:
            self.last_activity[websocket] = time.time()

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        self.last_activity.pop(websocket, None)
        logger.info(f"WebSocket client disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast_json(self, data: dict) -> int:
        """
        Validate data against Pydantic TelemetryMessage schema and broadcast to all clients.
        Returns the count of successful deliveries.
        """
        if not self.active_connections:
            return 0

        # Enforce Pydantic schema validation
        validated = TelemetryMessage.model_validate(data)
        serialized = json.dumps(validated.model_dump())

        delivered = 0
        dead_connections: List[WebSocket] = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(serialized)
                delivered += 1
            except Exception as e:
                logger.warning(f"Error sending telemetry packet to client: {e}")
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)

        return delivered

    async def send_ping(self) -> int:
        """Broadcasts a periodic keepalive ping to all connected clients."""
        ping_packet = {
            "type": "ping",
            "payload": {
                "server_time": datetime.now(timezone.utc).isoformat(),
                "active_clients": len(self.active_connections)
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        return await self.broadcast_json(ping_packet)

    async def cleanup_stale_connections(self, max_silence_seconds: float = 30.0) -> List[WebSocket]:
        """
        Prunes inactive connections that have been silent for longer than max_silence_seconds.
        """
        now = time.time()
        stale: List[WebSocket] = [
            ws for ws, last_seen in list(self.last_activity.items())
            if (now - last_seen) > max_silence_seconds
        ]
        for ws in stale:
            logger.info(f"Pruning stale WebSocket connection after >{max_silence_seconds}s silence")
            try:
                await ws.close(code=1000, reason="Stale connection timeout")
            except Exception:
                pass
            self.disconnect(ws)
        return stale


# Backward-compatible alias
TelemetryConnectionManager = ConnectionManager
manager = ConnectionManager()


def get_mock_flood_geojson(horizon: str = "T+15") -> dict:
    """
    Generates realistic hydraulic inundation polygon polygons around Guwahati's
    GS Road and Bharalu Basin based on horizon T+0, T+15, T+30, T+60.
    """
    depth_multipliers = {
        "T+0": 8.0,
        "T+15": 16.5,
        "T+30": 26.0,
        "T+60": 38.0
    }
    base_depth = depth_multipliers.get(horizon, 16.5)

    return {
        "type": "FeatureCollection",
        "horizon": horizon,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "features": [
            {
                "type": "Feature",
                "id": "flood-poly-gs-road",
                "properties": {
                    "zone_name": "GS Road Christian Basti - ABC Corridor",
                    "depth_cm": round(base_depth * 1.1, 1),
                    "surge_velocity_mm_min": 2.4,
                    "manning_roughness": 0.015,
                    "clearance_blocked": base_depth * 1.1 > 20.0,
                    "horizon": horizon
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [91.7340, 26.1420],
                        [91.7390, 26.1420],
                        [91.7410, 26.1480],
                        [91.7360, 26.1480],
                        [91.7340, 26.1420]
                    ]]
                }
            },
            {
                "type": "Feature",
                "id": "flood-poly-bharalu",
                "properties": {
                    "zone_name": "Bharalu Drainage Canal Spillover #2",
                    "depth_cm": round(base_depth * 1.35, 1),
                    "surge_velocity_mm_min": 3.8,
                    "manning_roughness": 0.018,
                    "clearance_blocked": base_depth * 1.35 > 20.0,
                    "horizon": horizon
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [91.7280, 26.1510],
                        [91.7330, 26.1510],
                        [91.7350, 26.1580],
                        [91.7300, 26.1580],
                        [91.7280, 26.1510]
                    ]]
                }
            },
            {
                "type": "Feature",
                "id": "flood-poly-zoo-road",
                "properties": {
                    "zone_name": "RG Baruah (Zoo) Road Chokepoint",
                    "depth_cm": round(base_depth * 0.75, 1),
                    "surge_velocity_mm_min": 1.2,
                    "manning_roughness": 0.015,
                    "clearance_blocked": base_depth * 0.75 > 20.0,
                    "horizon": horizon
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [91.7420, 26.1500],
                        [91.7470, 26.1500],
                        [91.7485, 26.1560],
                        [91.7435, 26.1560],
                        [91.7420, 26.1500]
                    ]]
                }
            }
        ]
    }


# ==============================================================================
# Broadcaster Coroutine & Redis Poller Engine
# ==============================================================================

_broadcaster_task: Optional[asyncio.Task] = None
_broadcaster_running: bool = False
_last_flood_state: Dict[str, str] = {}
_last_depth_state: Dict[str, str] = {}
_last_hazard_hash: str = ""
_last_route_hash: str = ""
_last_ping_time: float = 0.0

DEFAULT_MONITORED_CAMERAS = ["CAM-GHY-04", "CAM-GHY-01", "CAM-GHY-02"]


async def broadcast_tick() -> Dict[str, int]:
    """
    Executes a single polling and broadcast cycle:
    1. Checks Redis/cache for updated flood predictions ('flood:t15', 'flood:t30', 'flood:t60')
    2. Checks Redis/cache for camera metric depths ('depth:{camera_id}')
    3. Checks Redis/cache for hazard updates ('hazards:latest')
    4. Checks Redis/cache for route updates ('route:latest')
    5. Dispatches keepalive ping if 10 s have elapsed
    6. Prunes stale client connections (>30 s silence)
    """
    global _last_flood_state, _last_depth_state, _last_hazard_hash, _last_route_hash, _last_ping_time

    now = time.time()
    broadcast_stats = {"flood": 0, "depth": 0, "hazard": 0, "route": 0, "ping": 0, "stale_cleaned": 0}

    # Only query and broadcast if there are connected clients
    if not manager.active_connections:
        return broadcast_stats

    redis_client = None
    try:
        redis_client = await get_redis_client()
    except Exception as e:
        logger.debug(f"Redis unavailable during broadcast_tick: {e}")

    # 1. Check Flood Polygons (t15, t30, t60)
    for horizon in ["15", "30", "60"]:
        key = f"flood:t{horizon}"
        data_str = None
        if redis_client:
            try:
                data_str = await redis_client.get(key)
            except Exception:
                data_str = None

        if not data_str:
            cached_obj = get_telemetry_cache(key)
            if cached_obj:
                data_str = json.dumps(cached_obj)

        if data_str:
            if _last_flood_state.get(key) != data_str:
                _last_flood_state[key] = data_str
                try:
                    payload = json.loads(data_str)
                    delivered = await manager.broadcast_json({
                        "type": "flood",
                        "payload": payload,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                    broadcast_stats["flood"] += delivered
                except Exception as e:
                    logger.warning(f"Error broadcasting flood update: {e}")

    # 2. Check Depth Telemetry
    for cam_id in DEFAULT_MONITORED_CAMERAS:
        key = f"depth:{cam_id}"
        data_str = None
        if redis_client:
            try:
                data_str = await redis_client.get(key)
            except Exception:
                data_str = None

        if not data_str:
            cached_obj = get_telemetry_cache(key)
            if cached_obj:
                data_str = json.dumps(cached_obj)

        if data_str:
            if _last_depth_state.get(key) != data_str:
                _last_depth_state[key] = data_str
                try:
                    payload = json.loads(data_str)
                    delivered = await manager.broadcast_json({
                        "type": "depth",
                        "payload": payload,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    })
                    broadcast_stats["depth"] += delivered
                except Exception as e:
                    logger.warning(f"Error broadcasting depth update: {e}")

    # 3. Check Hazards Update
    hazard_str = None
    if redis_client:
        try:
            hazard_str = await redis_client.get("hazards:latest")
        except Exception:
            hazard_str = None
    if not hazard_str:
        cached_hazard = get_telemetry_cache("hazards:latest")
        if cached_hazard:
            hazard_str = json.dumps(cached_hazard)

    if hazard_str and hazard_str != _last_hazard_hash:
        _last_hazard_hash = hazard_str
        try:
            payload = json.loads(hazard_str)
            delivered = await manager.broadcast_json({
                "type": "hazard",
                "payload": payload,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            broadcast_stats["hazard"] += delivered
        except Exception as e:
            logger.warning(f"Error broadcasting hazard update: {e}")

    # 4. Check Route Update
    route_str = None
    if redis_client:
        try:
            route_str = await redis_client.get("route:latest")
        except Exception:
            route_str = None
    if not route_str:
        cached_route = get_telemetry_cache("route:latest")
        if cached_route:
            route_str = json.dumps(cached_route)

    if route_str and route_str != _last_route_hash:
        _last_route_hash = route_str
        try:
            payload = json.loads(route_str)
            delivered = await manager.broadcast_json({
                "type": "route",
                "payload": payload,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            broadcast_stats["route"] += delivered
        except Exception as e:
            logger.warning(f"Error broadcasting route update: {e}")

    # 5. Heartbeat ping every 10 seconds
    if (now - _last_ping_time) >= 10.0:
        _last_ping_time = now
        ping_delivered = await manager.send_ping()
        broadcast_stats["ping"] += ping_delivered

    # 6. Cleanup stale client connections (>30 seconds of inactivity)
    cleaned = await manager.cleanup_stale_connections(max_silence_seconds=30.0)
    broadcast_stats["stale_cleaned"] = len(cleaned)

    return broadcast_stats


async def broadcaster_loop(interval_seconds: float = 2.0):
    """Continuous polling background coroutine running every 2.0 seconds."""
    global _broadcaster_running
    logger.info("Started WebSocket telemetry broadcaster background worker.")
    while _broadcaster_running:
        try:
            await broadcast_tick()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.warning(f"Unexpected exception in broadcaster tick: {e}")
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            break
    logger.info("WebSocket telemetry broadcaster background worker terminated.")


def start_broadcaster(interval_seconds: float = 2.0) -> Optional[asyncio.Task]:
    """Launch the broadcaster loop if not already running."""
    global _broadcaster_task, _broadcaster_running
    if _broadcaster_running and _broadcaster_task and not _broadcaster_task.done():
        return _broadcaster_task

    _broadcaster_running = True
    try:
        loop = asyncio.get_running_loop()
        _broadcaster_task = loop.create_task(broadcaster_loop(interval_seconds))
        return _broadcaster_task
    except RuntimeError:
        return None


async def stop_broadcaster():
    """Stop the broadcaster background task."""
    global _broadcaster_task, _broadcaster_running
    _broadcaster_running = False
    if _broadcaster_task and not _broadcaster_task.done():
        _broadcaster_task.cancel()
        try:
            await _broadcaster_task
        except asyncio.CancelledError:
            pass
        _broadcaster_task = None


# ==============================================================================
# WebSocket Telemetry Endpoint
# ==============================================================================

@router.websocket("/ws/telemetry")
async def telemetry_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket streaming endpoint for real-time flood polygons, depth gauges,
    hazard alerts, and dynamic route updates.
    """
    await manager.connect(websocket)
    try:
        # Immediate hydration burst upon client connection
        cached_flood = None
        try:
            redis_client = await get_redis_client()
            raw_flood = await redis_client.get("flood:t15")
            if raw_flood:
                cached_flood = json.loads(raw_flood)
        except Exception:
            cached_flood = None
        if not cached_flood:
            cached_flood = get_telemetry_cache("flood:t15") or get_mock_flood_geojson("T+15")

        initial_flood = {
            "type": "flood",
            "payload": cached_flood,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        cached_depth = None
        try:
            redis_client = await get_redis_client()
            raw_depth = await redis_client.get("depth:CAM-GHY-04")
            if raw_depth:
                cached_depth = json.loads(raw_depth)
        except Exception:
            cached_depth = None
        if not cached_depth:
            cached_depth = get_telemetry_cache("depth:CAM-GHY-04") or {
                "depth_cm": 18.2,
                "dhdt_mm_min": 2.4,
                "status": "SURGING",
                "camera_id": "CAM-GHY-04",
                "location": "GS Road Christian Basti"
            }

        initial_depth = {
            "type": "depth",
            "payload": cached_depth,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        await websocket.send_text(json.dumps(initial_flood))
        await websocket.send_text(json.dumps(initial_depth))

        # Main bidirectional loop
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=4.0)
                manager.record_activity(websocket)
                msg = json.loads(data)

                # Handle client horizon toggle requests
                if msg.get("action") == "set_horizon":
                    horizon = msg.get("horizon", "T+15")
                    norm_h = horizon.replace("T+", "")
                    cache_key = f"flood:t{norm_h}"
                    h_flood = None
                    try:
                        redis_client = await get_redis_client()
                        raw_h = await redis_client.get(cache_key)
                        if raw_h:
                            h_flood = json.loads(raw_h)
                    except Exception:
                        pass
                    if not h_flood:
                        h_flood = get_telemetry_cache(cache_key) or get_mock_flood_geojson(horizon)

                    flood_update = {
                        "type": "flood",
                        "payload": h_flood,
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    await websocket.send_text(json.dumps(flood_update))

                elif msg.get("action") == "ping" or msg.get("type") == "ping":
                    pong_msg = {
                        "type": "ping",
                        "payload": {"pong": True},
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    await websocket.send_text(json.dumps(pong_msg))

                elif msg.get("type") == "pong" or msg.get("action") == "pong":
                    # Activity already recorded!
                    pass

            except asyncio.TimeoutError:
                # Timeout tick: keep loop alive, client activity will be monitored
                continue

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket session terminated: {e}")
        manager.disconnect(websocket)
