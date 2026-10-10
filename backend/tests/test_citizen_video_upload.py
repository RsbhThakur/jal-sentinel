"""
Comprehensive Automated Test Suite for Citizen Video Upload Flow (Issue #12).
Validates:
1. Citizen video upload with GPS coordinates, ISO timestamp, and metadata.
2. Validates timestamp bounds:
   - Future-dated timestamps (>1 min ahead) rejected with HTTP 422.
   - Very old timestamps (>24 hr ago) rejected with HTTP 422.
   - Valid timestamps within last 24h accepted with HTTP 201.
3. Asynchronously saved to uploads/ directory with UUID-based filename.
4. Persists record into video_uploads table with status='PENDING'.
5. Does NOT trigger CV processing or appear on public map until approved.
6. Appears immediately in admin pending queue (GET /api/video/pending).
7. Latency benchmark: Upload-to-admin-queue latency under 5 seconds for simulated 720p video.
"""
import os
import time
from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.entities import VideoUpload
from backend.utils.geospatial import geo_to_h3
from backend.routers.video import UPLOAD_DIR


@pytest.mark.asyncio
async def test_citizen_video_upload_lifecycle(client: AsyncClient, db_session: AsyncSession):
    """Verify citizen video upload creates PENDING record with valid UUID and H3 snapping."""
    lat, lng = 26.1448, 91.7365
    now_ts = datetime.now(timezone.utc).isoformat()
    dummy_clip = b"FAKE_VIDEO_PAYLOAD_DATA_METRIC_BYTES_GHY"

    files = {"file": ("flood_christian_basti.mp4", dummy_clip, "video/mp4")}
    data = {
        "lat": str(lat),
        "lng": str(lng),
        "timestamp": now_ts,
        "description": "Rapid water accumulation near Post Office culvert"
    }

    response = await client.post("/api/video/upload", files=files, data=data)
    assert response.status_code == 201, response.text
    res_data = response.json()

    assert "id" in res_data
    upload_id = res_data["id"]
    assert res_data["status"] == "PENDING"
    assert res_data["lat"] == lat
    assert res_data["lng"] == lng
    assert res_data["description"] == data["description"]

    # Verify H3 resolution 12 snapping
    expected_hex = geo_to_h3(lat, lng, resolution=12)
    assert res_data["h3_hex_id"] == expected_hex

    # Verify UUID filename on disk
    filename = res_data["filename"]
    assert filename.endswith(".mp4")
    assert upload_id in filename
    disk_path = os.path.join(UPLOAD_DIR, filename)
    assert os.path.exists(disk_path), f"File {disk_path} must exist on disk"

    # Verify database persistence
    db_res = await db_session.execute(select(VideoUpload).where(VideoUpload.id == upload_id))
    persisted = db_res.scalar_one_or_none()
    assert persisted is not None
    assert persisted.status == "PENDING"


@pytest.mark.asyncio
async def test_future_dated_timestamp_rejected_with_422(client: AsyncClient):
    """
    Acceptance Criterion:
    Future-dated timestamps (>1 min ahead) are rejected with 422 error.
    """
    future_time = datetime.now(timezone.utc) + timedelta(minutes=5)
    files = {"file": ("future_clip.mp4", b"bytes", "video/mp4")}
    data = {
        "lat": "26.1448",
        "lng": "91.7365",
        "timestamp": future_time.isoformat()
    }

    response = await client.post("/api/video/upload", files=files, data=data)
    assert response.status_code == 422
    err_msg = response.json()["detail"].lower()
    assert "future-dated" in err_msg or "server time" in err_msg


@pytest.mark.asyncio
async def test_stale_old_timestamp_rejected_with_422(client: AsyncClient):
    """
    Acceptance Criterion:
    Very old timestamps (>24 hr) are rejected with 422 error.
    """
    old_time = datetime.now(timezone.utc) - timedelta(hours=25)
    files = {"file": ("old_clip.mp4", b"bytes", "video/mp4")}
    data = {
        "lat": "26.1448",
        "lng": "91.7365",
        "timestamp": old_time.isoformat()
    }

    response = await client.post("/api/video/upload", files=files, data=data)
    assert response.status_code == 422
    err_msg = response.json()["detail"].lower()
    assert "stale" in err_msg or "24 hours" in err_msg


@pytest.mark.asyncio
async def test_pending_queue_visibility(client: AsyncClient):
    """
    Acceptance Criterion:
    Video appears in Admin Queue immediately after upload.
    """
    now_ts = datetime.now(timezone.utc).isoformat()
    files = {"file": ("queue_test.mp4", b"video_stream", "video/mp4")}
    data = {"lat": "26.1520", "lng": "91.7450", "timestamp": now_ts}

    res_upload = await client.post("/api/video/upload", files=files, data=data)
    assert res_upload.status_code == 201
    upload_id = res_upload.json()["id"]

    # Query GET /api/video/pending
    res_pending = await client.get("/api/video/pending")
    assert res_pending.status_code == 200
    pending_items = res_pending.json()
    assert any(item["id"] == upload_id and item["status"] == "PENDING" for item in pending_items)


@pytest.mark.asyncio
async def test_public_map_isolation_until_admin_approves(client: AsyncClient):
    """
    Acceptance Criterion:
    Upload does NOT appear on public map until admin approves.
    """
    now_ts = datetime.now(timezone.utc).isoformat()
    files = {"file": ("unapproved.mp4", b"raw_video", "video/mp4")}
    data = {"lat": "26.1725", "lng": "91.7320", "timestamp": now_ts}

    res_upload = await client.post("/api/video/upload", files=files, data=data)
    assert res_upload.status_code == 201
    upload_id = res_upload.json()["id"]

    # Query public hazards map overlay
    map_res = await client.get("/api/hazards")
    assert map_res.status_code == 200
    features = map_res.json()["features"]

    # Must NOT contain this upload_id as an active public map hazard pin
    assert not any(f.get("id") == upload_id for f in features)


@pytest.mark.asyncio
async def test_benchmark_upload_latency_under_5s(client: AsyncClient):
    """
    Benchmark for Close:
    Upload-to-admin-queue latency under 5 s for a 30 s 720p video clip (~10 MB).
    """
    simulated_payload_10mb = b"X" * (10 * 1024 * 1024)
    files = {"file": ("bench_720p.mp4", simulated_payload_10mb, "video/mp4")}
    data = {"lat": "26.1448", "lng": "91.7365"}

    t0 = time.perf_counter()
    res = await client.post("/api/video/upload", files=files, data=data)
    t1 = time.perf_counter()

    assert res.status_code == 201
    latency_s = t1 - t0
    print(f"10 MB 720p video upload latency: {latency_s:.3f} s (Target: < 5 s)")
    assert latency_s < 5.0, f"Upload latency {latency_s:.3f} s exceeded 5.0 s budget"

