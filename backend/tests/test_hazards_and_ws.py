import pytest
import json
from httpx import AsyncClient
from backend.main import app


@pytest.mark.asyncio
async def test_list_hazards_geojson(client: AsyncClient):
    """Verify GET /api/hazards returns GeoJSON FeatureCollection with hazard properties."""
    response = await client.get("/api/hazards")
    assert response.status_code == 200
    data = response.json()

    assert data["type"] == "FeatureCollection"
    assert "features" in data
    assert len(data["features"]) > 0

    first = data["features"][0]
    assert first["type"] == "Feature"
    assert first["geometry"]["type"] == "Point"
    assert len(first["geometry"]["coordinates"]) == 2
    assert "hazard_class" in first["properties"]
    assert "submerged" in first["properties"]
    assert "h3_hex_id" in first["properties"]


@pytest.mark.asyncio
async def test_list_hazards_filter_by_class(client: AsyncClient):
    """Verify filtering hazards by hazard_class query parameter."""
    response = await client.get("/api/hazards?hazard_class=manhole")
    assert response.status_code == 200
    data = response.json()

    assert data["type"] == "FeatureCollection"
    for feature in data["features"]:
        assert feature["properties"]["hazard_class"] == "manhole"


@pytest.mark.asyncio
async def test_websocket_telemetry_stream():
    """Verify WebSocket telemetry broadcast format using FastAPI TestClient."""
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws/telemetry") as websocket:
            # 1. First frame: flood GeoJSON
            msg1 = websocket.receive_json()
            assert msg1["type"] == "flood"
            assert msg1["payload"]["type"] == "FeatureCollection"
            assert "horizon" in msg1["payload"]

            # 2. Second frame: depth telemetry
            msg2 = websocket.receive_json()
            assert msg2["type"] == "depth"
            assert "depth_cm" in msg2["payload"]
            assert "dhdt_mm_min" in msg2["payload"]

            # 3. Request horizon shift to T+30
            websocket.send_json({"action": "set_horizon", "horizon": "T+30"})
            msg3 = websocket.receive_json()
            assert msg3["type"] == "flood"
            assert msg3["payload"]["horizon"] == "T+30"
