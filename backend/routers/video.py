import os
import shutil
import tempfile
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status
from pydantic import BaseModel

from backend.workers.cv_pipeline import process_video_waterline
from backend.utils.cache import get_telemetry_cache

router = APIRouter(prefix="/api/video", tags=["video"])

UPLOAD_DIR = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


class VideoProcessResponse(BaseModel):
    camera_id: str
    depth_cm: float
    dhdt_mm_min: float
    temporal_weight: float
    status: str
    frame_count: int
    recorded_at: str
    processed_at: str
    processing_time_ms: int
    expired: bool


@router.post("/process", response_model=VideoProcessResponse, status_code=status.HTTP_200_OK)
async def process_video_feed(
    file: UploadFile = File(..., description="Monocular road/drainage video clip (mp4, avi, mov)"),
    camera_id: str = Form("CAM-GHY-04"),
    lat: float = Form(26.1445),
    lng: float = Form(91.7362),
    recorded_at: Optional[str] = Form(None)
):
    """
    Accepts crowd-gauged or CCTV video clips, runs the gauge-free optical waterline engine,
    derives metric depth and rate-of-rise (dh/dt), applies temporal decay, and caches
    the result in Redis.
    """
    # Validate extension
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv"]:
        ext = ".mp4"

    # Save to disk
    temp_path = os.path.join(UPLOAD_DIR, f"temp_{camera_id}_{int(datetime.now().timestamp())}{ext}")
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Parse recorded_at timestamp if provided
        parsed_recorded_at = None
        if recorded_at:
            try:
                parsed_recorded_at = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
            except Exception:
                parsed_recorded_at = datetime.now(timezone.utc)

        result = process_video_waterline(
            video_path=temp_path,
            camera_id=camera_id,
            recorded_at=parsed_recorded_at
        )

        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        return VideoProcessResponse(**result)

    finally:
        # Clean up temporary video file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@router.get("/depth/{camera_id}", response_model=dict)
async def get_latest_camera_depth(camera_id: str = "CAM-GHY-04"):
    """
    Retrieves the latest cached optical depth and dh/dt rate of rise for a specified camera.
    """
    cached = get_telemetry_cache(f"depth:{camera_id}")
    if cached:
        return cached

    # Default fallback telemetry for active Guwahati stations
    return {
        "camera_id": camera_id,
        "depth_cm": 18.2,
        "dhdt_mm_min": 2.4,
        "temporal_weight": 1.0,
        "status": "SURGING",
        "location": "GS Road Christian Basti Culvert #4",
        "cached": False,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.get("/cameras", response_model=dict)
async def list_registered_cameras():
    """
    Lists registered optical CCTV stations across Guwahati metropolitan chokepoints.
    """
    cameras = [
        {
            "camera_id": "CAM-GHY-01",
            "name": "Bharalu River Outfall Sluice",
            "lat": 26.1738,
            "lng": 91.7314,
            "status": "SURGING",
            "current_depth_cm": 24.5,
            "dhdt_mm_min": 3.8
        },
        {
            "camera_id": "CAM-GHY-02",
            "name": "Zoo Road Tiniali Chokepoint",
            "lat": 26.1520,
            "lng": 91.7450,
            "status": "RISING",
            "current_depth_cm": 14.0,
            "dhdt_mm_min": 1.6
        },
        {
            "camera_id": "CAM-GHY-03",
            "name": "Ganeshguri Flyover Underpass",
            "lat": 26.1410,
            "lng": 91.7650,
            "status": "CRITICAL_INUNDATION",
            "current_depth_cm": 36.2,
            "dhdt_mm_min": 4.1
        },
        {
            "camera_id": "CAM-GHY-04",
            "name": "GS Road Christian Basti",
            "lat": 26.1448,
            "lng": 91.7365,
            "status": "SURGING",
            "current_depth_cm": 18.2,
            "dhdt_mm_min": 2.4
        }
    ]
    return {
        "total": len(cameras),
        "cameras": cameras
    }
