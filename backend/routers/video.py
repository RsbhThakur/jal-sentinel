import os
import shutil
import tempfile
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import aiofiles
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, status, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.models.entities import VideoUpload
from backend.models.schemas import VideoUploadResponse
from backend.utils.geospatial import geo_to_h3
from backend.workers.cv_pipeline import process_video_waterline
from backend.workers.temporal_repair import run_temporal_cross_reference
from backend.utils.cache import get_telemetry_cache

logger = logging.getLogger("jal_sentinel.video")


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


@router.post("/upload", response_model=VideoUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_citizen_video(
    file: UploadFile = File(..., description="Uploaded citizen or municipal patrol video clip"),
    lat: float = Form(..., description="Latitude coordinate from GPS"),
    lng: float = Form(..., description="Longitude coordinate from GPS"),
    timestamp: Optional[str] = Form(None, description="ISO 8601 recording timestamp embedded by client"),
    recorded_at: Optional[str] = Form(None, description="Legacy alias for timestamp"),
    description: Optional[str] = Form(None, description="Optional description of flood/hazard observed"),
    db: AsyncSession = Depends(get_db)
):
    """
    Ingests citizen crowd-gauged video uploads with GPS tagging and timestamp validation.
    Enforces validation:
      - Timestamp must be within the last 24 hours.
      - Future-dated timestamps (>1 minute ahead) rejected with HTTP 422.
      - Old timestamps (>24 hours ago) rejected with HTTP 422.
    Saves file asynchronously to uploads/ directory with UUID-based filename.
    Persists metadata with PENDING status awaiting administrative gate verification.
    Does NOT trigger CV processing yet.
    """
    # 1. Coordinate spatial validation
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid geographic coordinates: lat={lat}, lng={lng}"
        )

    # 2. Timestamp temporal validation
    ts_str = timestamp or recorded_at
    now_utc = datetime.now(timezone.utc)
    if ts_str:
        try:
            # Handle ISO formats, including trailing Z
            clean_ts = ts_str.replace("Z", "+00:00")
            parsed_ts = datetime.fromisoformat(clean_ts)
            if parsed_ts.tzinfo is None:
                parsed_ts = parsed_ts.replace(tzinfo=timezone.utc)
            else:
                parsed_ts = parsed_ts.astimezone(timezone.utc)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Invalid timestamp format '{ts_str}'. Expected valid ISO 8601 datetime: {str(e)}"
            )

        # Check future-dated (> 1 min ahead)
        if parsed_ts > now_utc + timedelta(minutes=1):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Future-dated uploads rejected: timestamp cannot be more than 1 minute ahead of server time."
            )

        # Check stale / old (> 24 hr ago)
        if parsed_ts < now_utc - timedelta(hours=24):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Stale uploads rejected: timestamp cannot be older than 24 hours."
            )
        effective_recorded_at = parsed_ts
    else:
        # Default to current time if no timestamp provided
        effective_recorded_at = now_utc

    # 3. File extension and async save to uploads/ directory with UUID filename
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in [".mp4", ".mov", ".avi", ".mkv", ".webm"]:
        ext = ".mp4"

    file_uuid = str(uuid.uuid4())
    saved_filename = f"{file_uuid}{ext}"
    destination_path = os.path.join(UPLOAD_DIR, saved_filename)

    try:
        async with aiofiles.open(destination_path, "wb") as out_file:
            while chunk := await file.read(1024 * 1024):  # 1MB chunks
                await out_file.write(chunk)
    except Exception as e:
        logger.error(f"Failed to save video upload to disk: {e}")
        # Synchronous fallback if needed
        try:
            with open(destination_path, "wb") as buffer:
                file.file.seek(0)
                shutil.copyfileobj(file.file, buffer)
        except Exception as err:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to save video file: {str(err)}"
            )

    # 4. Snap coordinates to H3 hex resolution 12 deduplication index
    hex_id = geo_to_h3(lat, lng, resolution=12)

    # 5. Persist record into video_uploads table with PENDING status
    upload = VideoUpload(
        id=file_uuid,
        filename=saved_filename,
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=effective_recorded_at,
        status="PENDING",
        description=description
    )
    db.add(upload)
    await db.commit()
    await db.refresh(upload)

    logger.info(f"Citizen video uploaded: id={upload.id}, file={saved_filename}, h3={hex_id}, status=PENDING")
    return upload


@router.get("/pending", response_model=List[VideoUploadResponse], status_code=status.HTTP_200_OK)
async def list_pending_uploads(
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """
    Returns list of citizen video uploads awaiting admin verification (status='PENDING').
    Used by the Admin Gate queue.
    """
    query = (
        select(VideoUpload)
        .where(VideoUpload.status == "PENDING")
        .order_by(VideoUpload.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()



@router.post("/{upload_id}/approve", response_model=dict, status_code=status.HTTP_200_OK)
async def approve_video_upload(
    upload_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Admin approval gate: approves a citizen video upload and executes
    the temporal auto-repair cross-reference state machine in the background.
    """
    result = await db.execute(select(VideoUpload).where(VideoUpload.id == upload_id))
    upload = result.scalars().first()
    if not upload:
        raise HTTPException(status_code=404, detail="Video upload record not found")

    upload.status = "APPROVED"
    await db.commit()
    await db.refresh(upload)

    # Execute temporal auto-repair cross reference
    cross_ref_result = await run_temporal_cross_reference(upload=upload, frame=None, db=db)
    return {
        "status": "APPROVED",
        "upload_id": upload.id,
        "cross_reference": cross_ref_result
    }

