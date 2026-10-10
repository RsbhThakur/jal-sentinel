import time
import os
import tempfile
import pytest
import numpy as np
import cv2
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.workers.yolo_detector import (
    YOLOHazardDetector,
    ConsensusBuffer,
    HazardDetection,
    persist_hazard_detection
)
from backend.models.entities import HazardEvent
from backend.utils.geospatial import geo_to_h3, k_ring


def test_yolo_inference_speed_benchmark():
    """
    Acceptance criterion: YOLOv8 inference runs at >= 5 FPS on CPU (latency <= 200 ms).
    """
    detector = YOLOHazardDetector()
    synthetic_frame = np.ones((480, 640, 3), dtype=np.uint8) * 90

    # Warmup
    _ = detector.run_inference(synthetic_frame)

    # Measure across 5 iterations
    start = time.time()
    iterations = 5
    for _ in range(iterations):
        _ = detector.run_inference(synthetic_frame)
    duration = time.time() - start

    avg_latency_ms = (duration / iterations) * 1000
    fps = iterations / duration

    print(f"\n[BENCHMARK] YOLOv8 Avg Latency: {avg_latency_ms:.2f} ms | FPS: {fps:.2f}")
    assert fps >= 5.0, f"Inference speed {fps:.2f} FPS failed >= 5 FPS requirement"


def test_3_frame_consensus_buffer_prevents_false_positives():
    """
    Acceptance criterion: 3-frame consensus prevents single-frame false positives.
    Requires >= 3 consecutive detections before confirming.
    """
    buffer = ConsensusBuffer(required_consensus_frames=3)
    hex_id = "8c60e58688461ff"
    hazard_class = "manhole"

    # Frame 1: Detected -> NOT confirmed
    assert buffer.record_frame(hex_id, hazard_class, True) is False

    # Frame 2: Detected -> NOT confirmed
    assert buffer.record_frame(hex_id, hazard_class, True) is False

    # Frame 3: Detected -> CONFIRMED (3 consecutive positives)
    assert buffer.record_frame(hex_id, hazard_class, True) is True

    # Frame 4: Noise / Glitch (False) -> resets consensus
    assert buffer.record_frame(hex_id, hazard_class, False) is False

    # Frame 5: Detected again -> NOT confirmed (needs 3 consecutive anew)
    assert buffer.record_frame(hex_id, hazard_class, True) is False


@pytest.mark.asyncio
async def test_h3_spatial_deduplication_upsert(db_session: AsyncSession):
    """
    Acceptance criterion: Two uploads at GPS coordinates within 15 m of each other
    produce exactly 1 hazard record (H3 dedup works via upsert).
    """
    # Coordinate 1: Guwahati Christian Basti
    lat1, lng1 = 26.144800, 91.736500
    hex_id1 = geo_to_h3(lat1, lng1, resolution=12)

    detection1 = HazardDetection(
        hazard_class="manhole",
        confidence=0.88,
        bbox=[100, 200, 200, 300],
        lat=lat1,
        lng=lng1,
        h3_hex_id=hex_id1
    )

    # 1. First upload: must create new record
    event1, is_new1 = await persist_hazard_detection(detection1, db_session)
    assert is_new1 is True
    assert event1.id is not None
    assert event1.confidence_score == 0.88

    # Coordinates ~8 meters apart fall into same cell or adjacent 1-ring neighbor
    lat2, lng2 = 26.144860, 91.736540  # ~8 meters offset
    hex_id2 = geo_to_h3(lat2, lng2, resolution=12)
    assert (hex_id1 == hex_id2) or (hex_id2 in k_ring(hex_id1, 1)), "Coordinates must share or border H3 cell"

    detection2 = HazardDetection(
        hazard_class="manhole",
        confidence=0.96,  # Higher confidence from better angle
        bbox=[110, 205, 205, 305],
        lat=lat2,
        lng=lng2,
        h3_hex_id=hex_id2
    )

    # 2. Second upload: must UPDATE existing record, NOT insert duplicate
    event2, is_new2 = await persist_hazard_detection(detection2, db_session)
    assert is_new2 is False
    assert event2.id == event1.id
    assert event2.confidence_score == 0.96  # Updated to max confidence

    # 3. Verify exactly 1 record exists in database table
    result = await db_session.execute(
        select(HazardEvent).where(
            HazardEvent.h3_hex_id == hex_id1,
            HazardEvent.hazard_class == "manhole"
        )
    )
    records = result.scalars().all()
    assert len(records) == 1, f"Expected exactly 1 hazard record, got {len(records)}"


@pytest.mark.asyncio
async def test_hazards_geojson_bbox_filtering(client: AsyncClient):
    """
    Acceptance criterion: GET /api/hazards returns valid GeoJSON FeatureCollection
    and respects bounding box spatial query filters.
    """
    # Query within small bbox around Guwahati GS Road
    bbox_str = "91.7300,26.1400,91.7450,26.1550"
    response = await client.get(f"/api/hazards?bbox={bbox_str}")
    assert response.status_code == 200
    data = response.json()

    assert data["type"] == "FeatureCollection"
    assert "features" in data

    # Verify every returned feature falls inside the query bounding box
    for f in data["features"]:
        coords = f["geometry"]["coordinates"]
        lng, lat = coords[0], coords[1]
        assert 91.7300 <= lng <= 91.7450, f"Longitude {lng} outside bbox"
        assert 26.1400 <= lat <= 26.1550, f"Latitude {lat} outside bbox"


@pytest.mark.asyncio
async def test_hazard_registration_and_detect_api(client: AsyncClient):
    """Verify POST /api/hazards/register and POST /api/hazards/detect endpoints."""
    # 1. Register a hazard directly
    reg_payload = {
        "hazard_class": "live_wire",
        "lat": 26.1525,
        "lng": 91.7455,
        "confidence_score": 0.92,
        "notes": "Low-hanging power line touching puddle"
    }
    r = await client.post("/api/hazards/register", json=reg_payload)
    assert r.status_code == 201
    reg_data = r.json()
    assert reg_data["status"] == "created"
    assert "h3_hex_id" in reg_data

    # 2. Upload synthetic frame to detect endpoint
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_img = np.ones((480, 640, 3), dtype=np.uint8) * 80
        cv2.imwrite(tmp.name, tmp_img)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as f:
            files = {"file": ("frame.jpg", f, "image/jpeg")}
            data = {"lat": "26.1448", "lng": "91.7365", "require_consensus": "false"}
            detect_res = await client.post("/api/hazards/detect", files=files, data=data)

        assert detect_res.status_code == 200
        res_json = detect_res.json()
        assert "h3_hex_id" in res_json
        assert "raw_detections_count" in res_json

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
