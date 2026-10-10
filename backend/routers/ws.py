import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import List, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("jal_sentinel.ws")
router = APIRouter(tags=["telemetry"])


class TelemetryConnectionManager:
    """Manages real-time WebSocket client connections and broadcasts."""

    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket client disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast_json(self, data: dict):
        if not self.active_connections:
            return
        dead_connections = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(json.dumps(data))
            except Exception as e:
                logger.warning(f"Error sending telemetry packet to client: {e}")
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)


manager = TelemetryConnectionManager()


def get_mock_flood_geojson(horizon: str = "T+15") -> dict:
    """
    Generates realistic hydraulic inundation polygon polygons around Guwahati's
    GS Road and Bharalu Basin based on horizon T+0, T+15, T+30, T+60.
    """
    # Scale depth by horizon
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


@router.websocket("/ws/telemetry")
async def telemetry_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket streaming endpoint for real-time flood polygons, depth gauges,
    and hazard alerts.
    """
    await manager.connect(websocket)
    try:
        # Immediate hydration burst upon client connection
        initial_flood = {
            "type": "flood",
            "payload": get_mock_flood_geojson("T+15"),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        initial_depth = {
            "type": "depth",
            "payload": {
                "depth_cm": 18.2,
                "dhdt_mm_min": 2.4,
                "status": "SURGING",
                "camera_id": "CAM-GHY-04",
                "location": "GS Road Christian Basti"
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await websocket.send_text(json.dumps(initial_flood))
        await websocket.send_text(json.dumps(initial_depth))

        # Main bidirectional loop
        while True:
            # Check for client messages with timeout to permit background telemetry ticks
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=4.0)
                msg = json.loads(data)
                
                # Handle client horizon toggle requests
                if msg.get("action") == "set_horizon":
                    horizon = msg.get("horizon", "T+15")
                    flood_update = {
                        "type": "flood",
                        "payload": get_mock_flood_geojson(horizon),
                        "timestamp": datetime.now(timezone.utc).isoformat()
                    }
                    await websocket.send_text(json.dumps(flood_update))

            except asyncio.TimeoutError:
                # Periodic heartbeat & telemetry tick every 4 seconds
                tick_msg = {
                    "type": "depth",
                    "payload": {
                        "depth_cm": round(18.2 + (asyncio.get_event_loop().time() % 3) * 0.4, 1),
                        "dhdt_mm_min": 2.4,
                        "status": "SURGING",
                        "camera_id": "CAM-GHY-04",
                        "location": "GS Road Christian Basti"
                    },
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                await websocket.send_text(json.dumps(tick_msg))

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WebSocket session terminated: {e}")
        manager.disconnect(websocket)
