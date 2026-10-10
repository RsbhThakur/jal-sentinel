"""
Automated Test Suite for FastAPI WebSocket Telemetry Broadcaster (Issue #9).
Validates Acceptance Criteria:
1. Pydantic schema validation across all message types (flood, depth, hazard, route, ping)
2. Immediate initial hydration sequence (flood FeatureCollection -> depth telemetry)
3. Dynamic horizon shifts (T+15 -> T+30 -> T+60)
4. Redis key update to client broadcast delivery under 3s budget
5. Stale client connection cleanup after 30s silence
6. Ping-pong liveness heartbeat handling
"""
import pytest
import json
import time
from datetime import datetime, timezone
from pydantic import ValidationError
from fastapi.testclient import TestClient

from backend.main import app
from backend.routers.ws import (
    manager,
    ConnectionManager,
    broadcast_tick,
    get_mock_flood_geojson
)
from backend.models.schemas import TelemetryMessage
from backend.cache import get_redis_client
from backend.utils.cache import set_telemetry_cache


def test_pydantic_telemetry_schema_validation():
    """Verify strict Pydantic validation across allowed and prohibited telemetry message types."""
    # 1. Valid types must succeed
    valid_types = ["flood", "depth", "hazard", "route", "ping"]
    for msg_type in valid_types:
        msg = TelemetryMessage(
            type=msg_type,
            payload={"test_key": "test_val"}
        )
        assert msg.type == msg_type
        assert msg.payload == {"test_key": "test_val"}
        assert msg.timestamp is not None

    # 2. Invalid types must raise ValidationError
    with pytest.raises(ValidationError):
        TelemetryMessage(type="invalid_telemetry_channel", payload={})

    with pytest.raises(ValidationError):
        TelemetryMessage(type="unknown_event", payload={})


def test_websocket_initial_hydration_and_horizon_switch():
    """
    Verify client connection receives immediate hydration burst:
    Frame 1: flood FeatureCollection (T+15)
    Frame 2: depth telemetry
    Frame 3 (on request): flood FeatureCollection shifted to T+30
    """
    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws/telemetry") as websocket:
            # Frame 1: Initial flood polygon
            frame1 = websocket.receive_json()
            assert frame1["type"] == "flood"
            assert frame1["payload"]["type"] == "FeatureCollection"
            assert frame1["payload"]["horizon"] == "T+15"
            assert len(frame1["payload"]["features"]) >= 3

            # Frame 2: Initial optical depth gauge
            frame2 = websocket.receive_json()
            assert frame2["type"] == "depth"
            assert frame2["payload"]["camera_id"] == "CAM-GHY-04"
            assert "depth_cm" in frame2["payload"]
            assert "dhdt_mm_min" in frame2["payload"]

            # Request horizon change to T+30
            websocket.send_json({"action": "set_horizon", "horizon": "T+30"})
            frame3 = websocket.receive_json()
            assert frame3["type"] == "flood"
            assert frame3["payload"]["horizon"] == "T+30"


def test_websocket_ping_pong_heartbeat():
    """Verify client ping request returns server pong frame."""
    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws/telemetry") as websocket:
            # Drain hydration frames
            _ = websocket.receive_json()
            _ = websocket.receive_json()

            # Client initiates ping
            websocket.send_json({"type": "ping"})
            resp = websocket.receive_json()
            assert resp["type"] == "ping"
            assert resp["payload"]["pong"] is True


@pytest.mark.asyncio
async def test_redis_key_update_to_client_broadcast_under_3s():
    """
    Acceptance Criterion:
    Flood polygon update arrives at client within 3 s of Redis key update.
    """
    redis_client = await get_redis_client()

    # Formulate updated flood polygon payload
    updated_flood = {
        "type": "FeatureCollection",
        "horizon": "T+15",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "features": [
            {
                "type": "Feature",
                "id": "flood-poly-test-rapid",
                "properties": {
                    "zone_name": "Test Surge Corridor",
                    "depth_cm": 35.5,
                    "surge_velocity_mm_min": 5.0,
                    "manning_roughness": 0.015,
                    "clearance_blocked": True,
                    "horizon": "T+15"
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[91.73, 26.14], [91.74, 26.14], [91.74, 26.15], [91.73, 26.14]]]
                }
            }
        ]
    }

    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws/telemetry") as websocket:
            # Drain hydration frames
            _ = websocket.receive_json()
            _ = websocket.receive_json()

            # Benchmark start
            t_start = time.perf_counter()

            # 1. Update Redis key
            await redis_client.set("flood:t15", json.dumps(updated_flood), ex=60)
            set_telemetry_cache("flood:t15", updated_flood, ttl_seconds=60)

            # 2. Trigger broadcaster polling tick (representing the 2s loop)
            stats = await broadcast_tick()
            assert stats["flood"] >= 1

            # 3. Client receives broadcasted payload
            received = websocket.receive_json()
            t_elapsed = time.perf_counter() - t_start

            assert received["type"] == "flood"
            assert received["payload"]["features"][0]["id"] == "flood-poly-test-rapid"
            assert received["payload"]["features"][0]["properties"]["depth_cm"] == 35.5
            assert t_elapsed < 3.0, f"Round-trip latency exceeded 3s budget: {t_elapsed:.3f}s"


@pytest.mark.asyncio
async def test_depth_redis_update_to_client_broadcast():
    """Verify depth telemetry update in Redis is pushed over WebSocket."""
    redis_client = await get_redis_client()

    updated_depth = {
        "camera_id": "CAM-GHY-04",
        "depth_cm": 31.2,
        "dhdt_mm_min": 3.8,
        "status": "CRITICAL_INUNDATION",
        "location": "GS Road Christian Basti"
    }

    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws/telemetry") as websocket:
            _ = websocket.receive_json()
            _ = websocket.receive_json()

            # Update Redis key
            await redis_client.set("depth:CAM-GHY-04", json.dumps(updated_depth), ex=60)
            set_telemetry_cache("depth:CAM-GHY-04", updated_depth, ttl_seconds=60)

            # Trigger broadcaster tick
            stats = await broadcast_tick()
            assert stats["depth"] >= 1

            received = websocket.receive_json()
            assert received["type"] == "depth"
            assert received["payload"]["camera_id"] == "CAM-GHY-04"
            assert received["payload"]["depth_cm"] == 31.2
            assert received["payload"]["status"] == "CRITICAL_INUNDATION"


@pytest.mark.asyncio
async def test_stale_connection_cleanup_after_30s_silence():
    """
    Acceptance Criterion:
    Stale client connections cleaned up after 30 s silence.
    """
    cm = ConnectionManager()

    class MockWebSocket:
        def __init__(self):
            self.closed = False
            self.close_code = None
        async def accept(self):
            pass
        async def close(self, code=1000, reason=""):
            self.closed = True
            self.close_code = code

    mock_ws = MockWebSocket()
    await cm.connect(mock_ws)
    assert mock_ws in cm.active_connections

    # Simulate 35 seconds of silence
    cm.last_activity[mock_ws] = time.time() - 35.0

    stale = await cm.cleanup_stale_connections(max_silence_seconds=30.0)
    assert len(stale) == 1
    assert mock_ws in stale
    assert mock_ws.closed is True
    assert mock_ws not in cm.active_connections
