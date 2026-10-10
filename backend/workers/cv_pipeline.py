"""
JAL-SENTINEL: Gauge-Free Optical Waterline Metric Tracking Engine.
Computes metric depth and dh/dt rise rates using Planar Inverse Perspective Mapping (IPM).
"""
import math
import time
import logging
from typing import List, Tuple, Optional, Dict
from datetime import datetime, timezone
import numpy as np
import cv2

from backend.utils.cache import set_telemetry_cache

logger = logging.getLogger("jal_sentinel.cv_pipeline")

# Standard 15 cm urban road kerb calibration coordinates for Guwahati
# Image plane points (u, v) -> Metric Ground Plane (X cm, Y cm)
DEFAULT_SRC_PTS = np.array([
    [100.0, 400.0],  # Bottom Left Kerb Base
    [500.0, 400.0],  # Bottom Right Kerb Base
    [150.0, 200.0],  # Top Left Kerb Crest (15 cm elevated)
    [450.0, 200.0],  # Top Right Kerb Crest (15 cm elevated)
], dtype=np.float32)

DEFAULT_DST_PTS_CM = np.array([
    [0.0, 0.0],       # Ground Base (0 cm)
    [100.0, 0.0],     # 1 meter along curb base (0 cm)
    [0.0, 15.0],      # Curb Top elevation (15 cm)
    [100.0, 15.0]     # Curb Top 1 meter along (15 cm)
], dtype=np.float32)


def calibrate_homography(
    src_points: np.ndarray = DEFAULT_SRC_PTS,
    dst_points_cm: np.ndarray = DEFAULT_DST_PTS_CM
) -> np.ndarray:
    """
    Computes the 3x3 planar perspective homography matrix H mapping image
    coordinates (u, v) to metric real-world coordinates (X_cm, Y_cm).
    """
    if len(src_points) < 4 or len(dst_points_cm) < 4:
        raise ValueError("At least 4 correspondence points required for homography.")

    H, _ = cv2.findHomography(src_points, dst_points_cm, cv2.RANSAC, 5.0)
    if H is None:
        # Fallback to affine or direct transform
        H = cv2.getPerspectiveTransform(src_points[:4], dst_points_cm[:4])

    return H


def extract_frames(video_path: str, fps: float = 2.0) -> List[Tuple[float, np.ndarray]]:
    """
    Extracts frames sampled at specified fps from a monocular video file.
    Returns list of (timestamp_seconds, frame_bgr).
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.error(f"Cannot open video source: {video_path}")
        return []

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_interval = max(1, int(round(native_fps / fps)))

    frames: List[Tuple[float, np.ndarray]] = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            timestamp_sec = frame_idx / native_fps
            frames.append((timestamp_sec, frame))

        frame_idx += 1

    cap.release()
    return frames


def segment_waterline(frame: np.ndarray) -> np.ndarray:
    """
    Extracts the reflective water surface boundary using HSV color segmentation,
    morphological smoothing, and Canny gradient refinement.
    Returns a binary mask where 255 represents water.
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    # Brownish/turbid floodwater & gray asphalt reflection HSV bounds
    # Hue: 10-40 (muddy brown/yellow), Saturation: 20-220, Value: 30-220
    lower_mud = np.array([5, 15, 25], dtype=np.uint8)
    upper_mud = np.array([45, 230, 220], dtype=np.uint8)
    mask_mud = cv2.inRange(hsv, lower_mud, upper_mud)

    # Specular reflections / white water foam
    lower_foam = np.array([0, 0, 180], dtype=np.uint8)
    upper_foam = np.array([180, 50, 255], dtype=np.uint8)
    mask_foam = cv2.inRange(hsv, lower_foam, upper_foam)

    mask = cv2.bitwise_or(mask_mud, mask_foam)

    # Morphological noise removal
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    return mask


def compute_metric_depth(
    waterline_mask: np.ndarray,
    H: np.ndarray,
    ref_ground_y_cm: float = 0.0
) -> float:
    """
    Transforms the segmented waterline boundary into the metric ground plane
    via homography matrix H to derive vertical water depth in centimeters.
    """
    # Find all water pixels
    y_indices, x_indices = np.where(waterline_mask > 0)
    if len(y_indices) == 0:
        return 0.0

    # The optical waterline is the topmost surface boundary of the water mask.
    # We sample the 1st percentile to accurately pinpoint the waterline crest while discarding isolated single-pixel noise
    top_water_y = float(np.percentile(y_indices, 1.0))
    mean_x = float(np.mean(x_indices))

    # Pixel coordinate of waterline
    pt_img = np.array([[[mean_x, top_water_y]]], dtype=np.float32)

    # Project to metric plane via H
    pt_metric = cv2.perspectiveTransform(pt_img, H)
    metric_y = float(pt_metric[0][0][1])

    depth_cm = max(0.0, metric_y - ref_ground_y_cm)
    return round(depth_cm, 2)


def compute_dhdt(depth_series: List[float], timestamps: List[float]) -> float:
    """
    Computes metric rate-of-rise (dh/dt) in mm/minute from timestamped depths.
    Uses least-squares linear regression for noise rejection.
    """
    if len(depth_series) < 2 or len(timestamps) < 2:
        return 0.0

    t = np.array(timestamps, dtype=np.float64)
    h = np.array(depth_series, dtype=np.float64)

    dt = t[-1] - t[0]
    if dt <= 0:
        return 0.0

    # Linear slope: dh/dt (cm per second)
    A = np.vstack([t, np.ones(len(t))]).T
    slope_cm_per_sec, _ = np.linalg.lstsq(A, h, rcond=None)[0]

    # Convert cm/sec -> mm/min
    # 1 cm = 10 mm; 1 sec = 1/60 min -> * 10 * 60 = 600
    dhdt_mm_min = slope_cm_per_sec * 600.0

    return round(float(dhdt_mm_min), 2)


def compute_temporal_decay(delta_t_min: float, tau: float = 20.0) -> float:
    """
    Calculates exponential decay weighting for citizen crowd-gauged video uploads:
    w(t) = exp(-delta_t / tau), where tau = 20 minutes.
    At delta_t = 60 min, weight = exp(-3) = 0.0498 (< 0.05, expired).
    """
    if delta_t_min <= 0:
        return 1.0
    weight = math.exp(-delta_t_min / tau)
    return round(weight, 4)


def process_video_waterline(
    video_path: str,
    camera_id: str = "CAM-GHY-04",
    recorded_at: Optional[datetime] = None,
    H_matrix: Optional[np.ndarray] = None
) -> Dict[str, Any]:
    """
    End-to-end video pipeline: extracts frames, runs waterline segmentation,
    computes metric depth series, calculates dh/dt, applies temporal decay,
    and updates the Redis telemetry cache.
    """
    start_time = time.time()
    H = H_matrix if H_matrix is not None else calibrate_homography()

    frames = extract_frames(video_path, fps=2.0)
    if not frames:
        return {
            "error": "No valid frames extracted from video",
            "camera_id": camera_id,
            "depth_cm": 0.0,
            "dhdt_mm_min": 0.0,
            "status": "OFFLINE"
        }

    depth_series: List[float] = []
    timestamps: List[float] = []

    for t_sec, frame in frames:
        mask = segment_waterline(frame)
        depth = compute_metric_depth(mask, H)
        depth_series.append(depth)
        timestamps.append(t_sec)

    # Current instantaneous depth is the latest frame's measurement
    latest_depth_cm = depth_series[-1] if depth_series else 0.0
    dhdt_mm_min = compute_dhdt(depth_series, timestamps)

    # Compute temporal age decay
    now = datetime.now(timezone.utc)
    if recorded_at:
        delta_t_min = max(0.0, (now - recorded_at).total_seconds() / 60.0)
    else:
        delta_t_min = 0.0

    temporal_weight = compute_temporal_decay(delta_t_min, tau=20.0)

    # Status determination based on rise rate and depth
    if latest_depth_cm >= 30.0:
        status = "CRITICAL_INUNDATION"
    elif dhdt_mm_min > 2.0:
        status = "RAPID_SURGE"
    elif dhdt_mm_min > 0.5:
        status = "RISING"
    elif dhdt_mm_min < -0.5:
        status = "RECEDING"
    else:
        status = "STABLE"

    processing_time_ms = int((time.time() - start_time) * 1000)

    result = {
        "camera_id": camera_id,
        "depth_cm": latest_depth_cm,
        "dhdt_mm_min": dhdt_mm_min,
        "temporal_weight": temporal_weight,
        "status": status,
        "frame_count": len(frames),
        "recorded_at": recorded_at.isoformat() if recorded_at else now.isoformat(),
        "processed_at": now.isoformat(),
        "processing_time_ms": processing_time_ms,
        "expired": temporal_weight < 0.05
    }

    # Store into Redis / in-memory cache with 20-min TTL
    cache_key = f"depth:{camera_id}"
    set_telemetry_cache(cache_key, result, ttl_seconds=1200)

    return result
