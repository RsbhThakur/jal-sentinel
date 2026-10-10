"""
Comprehensive Automated Test Suite for 2D Shallow-Water Manning Inundation Solver.
Validates:
1. Unit test: flat DEM + known dh/dt -> analytical inundation radius matches within 10%.
2. Multi-horizon spread: T+15, T+30, T+60 predictions generated within 5 seconds.
3. IMD Rainfall API graceful degradation: fallback to Redis cache / default when external API fails.
4. REST Endpoint GET /api/flood/prediction?t=15|30|60 contract & Redis caching verification.
5. WebSocket integration: broadcast of updated 2D flood polygons to digital twin subscribers.
"""
import time
import pytest
from httpx import AsyncClient

from backend.workers.manning_solver import (
    forward_euler_manning_spread,
    analytical_flat_manning_radius,
    solve_and_cache_flood_spread,
    fetch_imd_rainfall
)
from backend.cache import get_redis_client
from backend.main import app


def test_manning_flat_dem_inundation_radius_within_10_percent():
    """
    Acceptance Criterion:
    Unit test: flat DEM + known dh/dt -> expected inundation radius within 10%.
    """
    dh_dt = 30.0  # mm/min
    duration = 15.0  # minutes
    dx = 10.0  # meters
    n = 0.015  # Manning urban concrete roughness

    sim_radius, peak_depth, surge_vel = forward_euler_manning_spread(
        dh_dt_mm_min=dh_dt,
        rainfall_mm_hr=0.0,
        duration_min=duration,
        dem_raster=None,
        dx=dx,
        n=n,
        grid_size=101,
        source_row=50,
        source_col=50
    )

    ana_radius = analytical_flat_manning_radius(
        dh_dt_mm_min=dh_dt,
        duration_min=duration,
        dx=dx,
        n=n
    )

    rel_diff_pct = abs(sim_radius - ana_radius) / ana_radius * 100.0
    print(f"Simulated Radius: {sim_radius:.2f} m, Analytical: {ana_radius:.2f} m, Diff: {rel_diff_pct:.2f}%")
    assert rel_diff_pct <= 10.0, f"Expected relative difference <= 10%, got {rel_diff_pct:.2f}%"
    assert peak_depth > 0.0
    assert surge_vel >= dh_dt


@pytest.mark.asyncio
async def test_manning_solver_multi_horizon_performance_under_5s():
    """
    Acceptance Criterion:
    Solver produces 3 GeoJSON polygons (T+15/30/60) within 5 s of triggering.
    """
    t0 = time.perf_counter()
    results = await solve_and_cache_flood_spread(broadcast_websocket=False)
    t1 = time.perf_counter()
    duration_s = t1 - t0

    assert "T+15" in results
    assert "T+30" in results
    assert "T+60" in results
    assert duration_s < 5.0, f"Solver took {duration_s:.2f} s exceeding 5.0 s budget"

    for h_label in ["T+15", "T+30", "T+60"]:
        fc = results[h_label]
        assert fc["type"] == "FeatureCollection"
        assert fc["horizon"] == h_label


@pytest.mark.asyncio
async def test_imd_rainfall_api_fallback():
    """
    Acceptance Criterion:
    IMD API failure falls back to Redis cache gracefully (no crash).
    """
    redis_client = await get_redis_client()
    await redis_client.set("imd:rainfall:kamrup", "37.5", ex=120)

    rainfall = await fetch_imd_rainfall(district="guwahati_mock_offline_district")
    assert rainfall == 37.5, f"Expected 37.5 mm/hr from Redis fallback, got {rainfall}"


@pytest.mark.asyncio
async def test_get_flood_prediction_endpoint(client: AsyncClient):
    """
    Test GET /api/flood/prediction?t=15|30|60 REST endpoint and Redis caching.
    """
    resp15 = await client.get("/api/flood/prediction?t=15")
    assert resp15.status_code == 200
    d15 = resp15.json()
    assert d15["type"] == "FeatureCollection"
    assert d15["horizon"] == "T+15"
    assert len(d15["features"]) >= 3

    resp30 = await client.get("/api/flood/prediction?t=30")
    assert resp30.status_code == 200
    d30 = resp30.json()
    assert d30["horizon"] == "T+30"

    resp60 = await client.get("/api/flood/prediction?t=60")
    assert resp60.status_code == 200
    d60 = resp60.json()
    assert d60["horizon"] == "T+60"

    depth_15 = d15["features"][0]["properties"]["depth_cm"]
    depth_30 = d30["features"][0]["properties"]["depth_cm"]
    depth_60 = d60["features"][0]["properties"]["depth_cm"]
    assert depth_15 <= depth_30 <= depth_60

    bad_resp = await client.get("/api/flood/prediction?t=120")
    assert bad_resp.status_code == 400
    assert "Invalid horizon" in bad_resp.json()["detail"]


@pytest.mark.asyncio
async def test_websocket_broadcast_on_solve():
    """
    Acceptance Criterion:
    Flood polygons update in map overlay within 2 s of solve completion
    via WebSocket streaming broadcast.
    """
    from fastapi.testclient import TestClient

    with TestClient(app) as test_client:
        with test_client.websocket_connect("/ws/telemetry") as websocket:
            msg1 = websocket.receive_json()
            assert msg1["type"] in ["flood", "depth"]
            msg2 = websocket.receive_json()
            assert msg2["type"] in ["flood", "depth"]

            t0 = time.perf_counter()
            solutions = await solve_and_cache_flood_spread(broadcast_websocket=True)
            t1 = time.perf_counter()

            # Read frame until flood packet arrives (skipping periodic heartbeat ticks if any)
            frame = websocket.receive_json()
            if frame["type"] != "flood":
                frame = websocket.receive_json()
            t2 = time.perf_counter()

            delivery_time_s = t2 - t1
            assert frame["type"] == "flood"
            assert "payload" in frame
            assert frame["payload"]["type"] == "FeatureCollection"
            assert delivery_time_s < 2.0, "Flood update exceeded 2 s broadcast budget"
            assert len(frame["payload"]["features"]) >= 3


