"""
Comprehensive Unit and Integration Test Suite for Dynamic A* Evacuation Routing.
Validates:
1. Blocked-edge avoidance: Dynamic rerouting when previously dry edges flood.
2. Vehicle clearance threshold enforcement (walker=15cm, scooty=20cm, sedan=35cm, SUV=55cm).
3. Redis cache hit latency reduction >= 80% on repeat routes.
4. Benchmark for close: P95 route calculation < 500ms on Guwahati-scale graph.
5. End-to-end FastAPI POST /api/route REST contract compliance.
"""
import time
import pytest
from httpx import AsyncClient

from backend.workers.routing import (
    get_evacuation_router,
    compute_edge_weight,
    CLEARANCE_THRESHOLDS
)
from backend.cache import get_redis_client
from backend.routers.routing import build_route_cache_key
from backend.utils.geospatial import geo_to_h3


@pytest.mark.asyncio
async def test_clearance_threshold_enforcement():
    """
    Verify vehicle-class clearance thresholds block edges when depth exceeds limit:
    walker=15cm, scooty=20cm, sedan=35cm, SUV=55cm.
    """
    assert CLEARANCE_THRESHOLDS["walker"] == 15.0
    assert CLEARANCE_THRESHOLDS["scooty"] == 20.0
    assert CLEARANCE_THRESHOLDS["sedan"] == 35.0
    assert CLEARANCE_THRESHOLDS["suv"] == 55.0

    length = 100.0
    # At 14.9cm: passable for all vehicles
    for v in ["walker", "scooty", "sedan", "suv"]:
        weight = compute_edge_weight(length, 14.9, 0, v)
        assert weight < float("inf")

    # At 18.0cm: blocked for walker (>15cm), passable for scooty, sedan, suv
    assert compute_edge_weight(length, 18.0, 0, "walker") == float("inf")
    assert compute_edge_weight(length, 18.0, 0, "scooty") < float("inf")
    assert compute_edge_weight(length, 18.0, 0, "sedan") < float("inf")
    assert compute_edge_weight(length, 18.0, 0, "suv") < float("inf")

    # At 25.0cm: blocked for walker and scooty, passable for sedan and suv
    assert compute_edge_weight(length, 25.0, 0, "walker") == float("inf")
    assert compute_edge_weight(length, 25.0, 0, "scooty") == float("inf")
    assert compute_edge_weight(length, 25.0, 0, "sedan") < float("inf")
    assert compute_edge_weight(length, 25.0, 0, "suv") < float("inf")

    # At 40.0cm: blocked for walker, scooty, sedan; passable for suv
    assert compute_edge_weight(length, 40.0, 0, "walker") == float("inf")
    assert compute_edge_weight(length, 40.0, 0, "scooty") == float("inf")
    assert compute_edge_weight(length, 40.0, 0, "sedan") == float("inf")
    assert compute_edge_weight(length, 40.0, 0, "suv") < float("inf")

    # At 60.0cm: blocked for ALL vehicles
    for v in ["walker", "scooty", "sedan", "suv"]:
        assert compute_edge_weight(length, 60.0, 0, v) == float("inf")
@pytest.mark.asyncio
async def test_blocked_edge_avoidance_dynamic_reroute():
    """
    Verify route changes dynamically when a previously dry edge is marked flooded
    with depth > vehicle clearance threshold.
    """
    router = get_evacuation_router()

    orig_lat, orig_lng = 26.1448, 91.7365  # Christian Basti
    dest_lat, dest_lng = 26.1380, 91.7890  # Dispur Supermarket

    # 1. Base dry-condition route
    base_res = router.compute_route(orig_lat, orig_lng, dest_lat, dest_lng, "walker")
    assert base_res["success"] is True
    base_coords = base_res["route_geojson"]["geometry"]["coordinates"]
    base_dist = base_res["distance_meters"]

    # 2. Block direct Christian Basti -> ABC Point corridor with 18cm flood (> walker 15cm)
    corridor_edge = ("christian_basti", "abc_point")
    reverse_edge = ("abc_point", "christian_basti")
    flood_override = {
        corridor_edge: {"h_pred": 18.0, "hazard_flag": 0},
        reverse_edge: {"h_pred": 18.0, "hazard_flag": 0}
    }

    detour_res = router.compute_route(
        orig_lat, orig_lng, dest_lat, dest_lng, "walker",
        edge_weight_overrides=flood_override
    )
    assert detour_res["success"] is True
    detour_coords = detour_res["route_geojson"]["geometry"]["coordinates"]
    detour_dist = detour_res["distance_meters"]

    assert detour_coords != base_coords
    assert detour_dist != base_dist


@pytest.mark.asyncio
async def test_impassable_flood_returns_clean_rejection():
    """Verify route returns graceful failure when all escape corridors are submerged."""
    router = get_evacuation_router()

    overrides = {}
    for neighbor in router.graph.neighbors("christian_basti"):
        overrides[("christian_basti", neighbor)] = {"h_pred": 30.0, "hazard_flag": 0}
        overrides[(neighbor, "christian_basti")] = {"h_pred": 30.0, "hazard_flag": 0}

    res_scooty = router.compute_route(26.1448, 91.7365, 26.1380, 91.7890, "scooty", edge_weight_overrides=overrides)
    res_sedan = router.compute_route(26.1448, 91.7365, 26.1380, 91.7890, "sedan", edge_weight_overrides=overrides)

    assert res_scooty["success"] is False
    assert res_scooty["route_geojson"] is None
    assert res_sedan["success"] is True

@pytest.mark.asyncio
async def test_redis_cache_hit_latency_reduction(client: AsyncClient):
    """
    Verify Redis caching reduces repeat-route latency by >= 80% and respects
    per (origin_hex, dest_hex, vehicle_class) caching contract.
    """
    payload = {
        "origin_lat": 26.1448,
        "origin_lng": 91.7365,
        "destination_lat": 26.1380,
        "destination_lng": 91.7890,
        "vehicle_class": "sedan"
    }

    redis_client = await get_redis_client()
    orig_hex = geo_to_h3(payload["origin_lat"], payload["origin_lng"], resolution=12)
    dest_hex = geo_to_h3(payload["destination_lat"], payload["destination_lng"], resolution=12)
    cache_key = build_route_cache_key(orig_hex, dest_hex, payload["vehicle_class"])
    await redis_client.delete(cache_key)

    # 1. Cold invocation (Cache Miss)
    t0 = time.perf_counter()
    resp1 = await client.post("/api/route", json=payload)
    t1 = time.perf_counter()
    cold_latency = (t1 - t0) * 1000

    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["type"] == "Feature"
    assert data1["geometry"]["type"] == "LineString"
    assert data1["properties"]["cached"] is False

    # 2. Warm invocation (Cache Hit)
    t2 = time.perf_counter()
    resp2 = await client.post("/api/route", json=payload)
    t3 = time.perf_counter()
    warm_latency = (t3 - t2) * 1000

    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["properties"]["cached"] is True
    assert data2["geometry"]["coordinates"] == data1["geometry"]["coordinates"]

    # 3. Third invocation for reliable average
    t4 = time.perf_counter()
    resp3 = await client.post("/api/route", json=payload)
    t5 = time.perf_counter()
    repeat_latency = (t5 - t4) * 1000
    assert resp3.status_code == 200

    avg_warm = (warm_latency + repeat_latency) / 2.0
    latency_reduction_pct = ((cold_latency - avg_warm) / cold_latency) * 100.0

    assert latency_reduction_pct >= 80.0, f"Expected >= 80% reduction, achieved {latency_reduction_pct:.1f}%"


@pytest.mark.asyncio
async def test_benchmark_p95_under_500ms():
    """
    Benchmark for Issue Close:
    Route calculation P95 < 500 ms on a 10,000-node city graph.
    """
    router = get_evacuation_router()
    assert router.graph.number_of_nodes() >= 10000

    latencies = []
    for _ in range(50):
        t0 = time.perf_counter()
        res = router.compute_route(26.1448, 91.7365, 26.1380, 91.7890, "sedan")
        t1 = time.perf_counter()
        assert res["success"] is True
        latencies.append((t1 - t0) * 1000)

    latencies.sort()
    p95 = latencies[int(len(latencies) * 0.95)]
    assert p95 < 500.0, f"P95 latency {p95:.2f} ms exceeded 500 ms threshold"


@pytest.mark.asyncio
async def test_route_api_invalid_vehicle_class(client: AsyncClient):
    """Verify 400 Bad Request on unknown vehicle class."""
    payload = {
        "origin_lat": 26.1448,
        "origin_lng": 91.7365,
        "destination_lat": 26.1380,
        "destination_lng": 91.7890,
        "vehicle_class": "submarine"
    }
    response = await client.post("/api/route", json=payload)
    assert response.status_code == 400
    assert "Unsupported vehicle class" in response.json()["detail"]


@pytest.mark.asyncio
async def test_route_api_hazard_penalization():
    """Verify edge transit cost penalization formula W(e) = d(e) * (1 + 0.05*h + 10*hazard)."""
    length = 200.0
    h_pred = 10.0
    w_clean = compute_edge_weight(length, h_pred, 0, "sedan")
    expected_clean = length * (1.0 + 0.05 * 10.0 + 10.0 * 0)
    assert abs(w_clean - expected_clean) < 1e-4

    w_hazard = compute_edge_weight(length, h_pred, 1, "sedan")
    expected_hazard = length * (1.0 + 0.05 * 10.0 + 10.0 * 1)
    assert abs(w_hazard - expected_hazard) < 1e-4

    assert w_hazard > w_clean

