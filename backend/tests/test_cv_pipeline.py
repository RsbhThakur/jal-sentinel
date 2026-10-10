import os
import tempfile
import pytest
import numpy as np
import cv2
from httpx import AsyncClient

from backend.workers.cv_pipeline import (
    calibrate_homography,
    segment_waterline,
    compute_metric_depth,
    compute_dhdt,
    compute_temporal_decay,
    process_video_waterline
)
from backend.utils.cache import get_telemetry_cache, clear_telemetry_cache


def create_synthetic_test_video(path: str, num_frames: int = 10, fps: int = 2):
    """Generates a synthetic MP4 test video with simulated rising water."""
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(path, fourcc, float(fps), (640, 480))

    for i in range(num_frames):
        frame = np.ones((480, 640, 3), dtype=np.uint8) * 80  # Dry dark gray asphalt
        # Draw curb line across middle
        cv2.line(frame, (100, 300), (540, 300), (180, 180, 180), 4)

        # Rising water level (brownish color in HSV range)
        water_height = int(120 + i * 8)
        water_color = (40, 90, 140)  # BGR for turbid muddy water
        cv2.rectangle(frame, (80, 480 - water_height), (560, 480), water_color, -1)

        writer.write(frame)

    writer.release()


def test_homography_calibration_and_metric_depth_accuracy():
    """
    Acceptance criterion: On a calibration test frame with a 15 cm kerb visible,
    computed depth error <= +/- 2 cm.
    """
    # Calibration correspondence: Image (u, v) -> Metric (X cm, Y cm)
    src_pts = np.array([
        [100.0, 400.0],
        [500.0, 400.0],
        [150.0, 200.0],
        [450.0, 200.0]
    ], dtype=np.float32)

    dst_pts_cm = np.array([
        [0.0, 0.0],
        [100.0, 0.0],
        [0.0, 15.0],
        [100.0, 15.0]
    ], dtype=np.float32)

    H = calibrate_homography(src_pts, dst_pts_cm)
    assert H is not None
    assert H.shape == (3, 3)

    # Synthetic mask where water reached exactly the 15 cm curb height (v=200)
    synthetic_mask = np.zeros((480, 640), dtype=np.uint8)
    synthetic_mask[200:400, 150:450] = 255

    computed_depth = compute_metric_depth(synthetic_mask, H, ref_ground_y_cm=0.0)

    # Expected depth is 15.0 cm; verify tolerance within +/- 2.0 cm
    error = abs(computed_depth - 15.0)
    assert error <= 2.0, f"Computed depth {computed_depth} cm exceeds +/- 2 cm tolerance (error={error})"


def test_compute_dhdt_rising_series():
    """
    Acceptance criterion: dh/dt computed correctly for a 5-frame mock series (rising water).
    """
    # 5 frames over 2 seconds with constant rising rate of 2 cm/sec
    timestamps = [0.0, 0.5, 1.0, 1.5, 2.0]
    depths = [10.0, 11.0, 12.0, 13.0, 14.0]

    dhdt = compute_dhdt(depths, timestamps)

    # Slope = 2.0 cm/sec -> * 600 = 1200 mm/min
    assert dhdt > 0, "dh/dt must be strictly positive for rising water"
    assert abs(dhdt - 1200.0) < 5.0, f"Expected 1200 mm/min, got {dhdt}"


def test_temporal_decay_weighting():
    """
    Acceptance criterion: Older upload (Delta_t > 60 min) has weight < 0.05 (effectively expired).
    """
    w_fresh = compute_temporal_decay(0.0)
    assert w_fresh == 1.0

    w_20m = compute_temporal_decay(20.0, tau=20.0)
    assert 0.35 <= w_20m <= 0.38  # exp(-1) approx 0.3679

    w_60m = compute_temporal_decay(60.0, tau=20.0)
    assert w_60m < 0.05, f"Expected weight < 0.05 for 60 min upload, got {w_60m}"


def test_process_video_waterline_end_to_end():
    """
    Test end-to-end video pipeline: frame extraction, segmentation, depth,
    dh/dt, and Redis caching. Processing must complete in < 3 s.
    """
    clear_telemetry_cache()
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        create_synthetic_test_video(tmp_path, num_frames=8, fps=2)

        result = process_video_waterline(
            video_path=tmp_path,
            camera_id="CAM-TEST-GHY",
            recorded_at=None
        )

        assert "error" not in result
        assert result["camera_id"] == "CAM-TEST-GHY"
        assert result["frame_count"] > 0
        assert result["processing_time_ms"] < 3000, "Processing must complete under 3 seconds"

        # Verify cached in Redis / memory
        cached = get_telemetry_cache("depth:CAM-TEST-GHY")
        assert cached is not None
        assert cached["camera_id"] == "CAM-TEST-GHY"
        assert "depth_cm" in cached

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@pytest.mark.asyncio
async def test_video_api_endpoints(client: AsyncClient):
    """Verify POST /api/video/process and GET /api/video/depth endpoints."""
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        create_synthetic_test_video(tmp_path, num_frames=6, fps=2)

        with open(tmp_path, "rb") as video_file:
            files = {"file": ("test_clip.mp4", video_file, "video/mp4")}
            data = {"camera_id": "CAM-API-TEST", "lat": "26.1448", "lng": "91.7365"}
            response = await client.post("/api/video/process", files=files, data=data)

        assert response.status_code == 200
        res_data = response.json()
        assert res_data["camera_id"] == "CAM-API-TEST"
        assert "depth_cm" in res_data
        assert "dhdt_mm_min" in res_data
        assert res_data["processing_time_ms"] < 3000

        # Query GET /api/video/depth/CAM-API-TEST
        depth_res = await client.get("/api/video/depth/CAM-API-TEST")
        assert depth_res.status_code == 200
        assert depth_res.json()["camera_id"] == "CAM-API-TEST"

        # Query GET /api/video/cameras
        cameras_res = await client.get("/api/video/cameras")
        assert cameras_res.status_code == 200
        assert cameras_res.json()["total"] >= 4

    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
