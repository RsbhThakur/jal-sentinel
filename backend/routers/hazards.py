import shutil
import tempfile
import os
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, UploadFile, File, Form, status, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
import cv2

from backend.database import get_db
from backend.models.entities import HazardEvent, RepairTicket, AuditLog, VideoUpload
from backend.models.schemas import RepairTicketResponse, AuditLogResponse
from backend.utils.geospatial import geo_to_h3
from backend.workers.yolo_detector import (
    detector,
    consensus_engine,
    persist_hazard_detection,
    HazardDetection
)
from backend.workers.temporal_repair import evaluate_hazard_cross_reference

router = APIRouter(prefix="/api/hazards", tags=["hazards"])

# Canonical Guwahati baseline hazard pins for initial digital twin hydration
GUWAHATI_BASELINE_HAZARDS = [
    {
        "id": "hazard-ghy-01",
        "hazard_class": "manhole",
        "lat": 26.1448,
        "lng": 91.7365,
        "confidence_score": 0.96,
        "false_positive_flag": False,
        "submerged": True,
        "depth_cm": 22.0,
        "notes": "Uncovered sewer drain manhole near Christian Basti post office."
    },
    {
        "id": "hazard-ghy-02",
        "hazard_class": "live_wire",
        "lat": 26.1520,
        "lng": 91.7450,
        "confidence_score": 0.91,
        "false_positive_flag": False,
        "submerged": False,
        "depth_cm": 8.5,
        "notes": "Exposed low-hanging 440V distribution wire near Zoo Road tiniali."
    },
    {
        "id": "hazard-ghy-03",
        "hazard_class": "pothole",
        "lat": 26.1380,
        "lng": 91.7890,
        "confidence_score": 0.89,
        "false_positive_flag": False,
        "submerged": True,
        "depth_cm": 31.0,
        "notes": "Severe road crater submerged under 30cm floodwater at Dispur Supermarket."
    },
    {
        "id": "hazard-ghy-04",
        "hazard_class": "debris",
        "lat": 26.1725,
        "lng": 91.7320,
        "confidence_score": 0.94,
        "false_positive_flag": False,
        "submerged": True,
        "depth_cm": 18.0,
        "notes": "Silt, plastic waste, and tree branch blockage at Bharalu Sluice entrance."
    },
    {
        "id": "hazard-ghy-05",
        "hazard_class": "vehicle",
        "lat": 26.1410,
        "lng": 91.7650,
        "confidence_score": 0.88,
        "false_positive_flag": False,
        "submerged": True,
        "depth_cm": 42.0,
        "notes": "Stalled hatchback hydro-locked in flooded dip under Ganeshguri Flyover."
    }
]


class HazardRegistrationRequest(BaseModel):
    hazard_class: str
    lat: float
    lng: float
    confidence_score: float = 0.9
    notes: Optional[str] = None


@router.get("", response_model=dict)
async def list_hazards(
    hazard_class: Optional[str] = Query(None, description="Filter by hazard class"),
    bbox: Optional[str] = Query(None, description="Bounding box: min_lng,min_lat,max_lng,max_lat"),
    hex_id: Optional[str] = Query(None, description="Filter by H3 hex cell index"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns active hazard events as a GeoJSON FeatureCollection.
    Supports spatial bounding box filtering and H3 cell queries.
    Falls back to seeded Guwahati high-risk pins if database table is currently unpopulated.
    """
    conditions = [HazardEvent.false_positive_flag == False]

    if hazard_class:
        conditions.append(HazardEvent.hazard_class == hazard_class)
    if hex_id:
        conditions.append(HazardEvent.h3_hex_id == hex_id)

    # Bbox filter parsing
    min_lng, min_lat, max_lng, max_lat = None, None, None, None
    if bbox:
        try:
            parts = [float(x.strip()) for x in bbox.split(",")]
            if len(parts) == 4:
                min_lng, min_lat, max_lng, max_lat = parts
                conditions.append(HazardEvent.lng >= min_lng)
                conditions.append(HazardEvent.lng <= max_lng)
                conditions.append(HazardEvent.lat >= min_lat)
                conditions.append(HazardEvent.lat <= max_lat)
        except Exception:
            pass

    query = select(HazardEvent).where(and_(*conditions))
    result = await db.execute(query)
    db_hazards = result.scalars().all()

    features = []

    if db_hazards:
        for h in db_hazards:
            features.append({
                "type": "Feature",
                "id": h.id,
                "geometry": {
                    "type": "Point",
                    "coordinates": [h.lng, h.lat]
                },
                "properties": {
                    "id": h.id,
                    "hazard_class": h.hazard_class,
                    "confidence_score": h.confidence_score,
                    "h3_hex_id": h.h3_hex_id,
                    "submerged": True,  # Submerged Pitfall Radar indicator
                    "first_detected_at": h.first_detected_at.isoformat() if h.first_detected_at else None,
                    "last_seen_at": h.last_seen_at.isoformat() if h.last_seen_at else None
                }
            })
    else:
        # Provide baseline Guwahati pins with computed H3 hex indexes
        for h in GUWAHATI_BASELINE_HAZARDS:
            if hazard_class and h["hazard_class"] != hazard_class:
                continue
            if bbox and (h["lng"] < min_lng or h["lng"] > max_lng or h["lat"] < min_lat or h["lat"] > max_lat):
                continue
            curr_hex = geo_to_h3(h["lat"], h["lng"], resolution=12)
            if hex_id and curr_hex != hex_id:
                continue

            features.append({
                "type": "Feature",
                "id": h["id"],
                "geometry": {
                    "type": "Point",
                    "coordinates": [h["lng"], h["lat"]]
                },
                "properties": {
                    "id": h["id"],
                    "hazard_class": h["hazard_class"],
                    "confidence_score": h["confidence_score"],
                    "h3_hex_id": curr_hex,
                    "submerged": h["submerged"],
                    "depth_cm": h["depth_cm"],
                    "notes": h["notes"],
                    "first_detected_at": datetime.now(timezone.utc).isoformat(),
                    "last_seen_at": datetime.now(timezone.utc).isoformat()
                }
            })

    return {
        "type": "FeatureCollection",
        "total": len(features),
        "features": features
    }


@router.post("/register", response_model=dict, status_code=status.HTTP_201_CREATED)
async def register_hazard(
    request: HazardRegistrationRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Directly registers or updates a hazard event using H3 Resolution-12 spatial deduplication.
    """
    hex_id = geo_to_h3(request.lat, request.lng, resolution=12)
    detection = HazardDetection(
        hazard_class=request.hazard_class,
        confidence=request.confidence_score,
        bbox=[0, 0, 0, 0],
        lat=request.lat,
        lng=request.lng,
        h3_hex_id=hex_id
    )

    event, is_new = await persist_hazard_detection(detection, db)
    return {
        "status": "created" if is_new else "updated",
        "id": event.id,
        "hazard_class": event.hazard_class,
        "h3_hex_id": event.h3_hex_id,
        "confidence_score": event.confidence_score,
        "lat": event.lat,
        "lng": event.lng
    }


@router.post("/detect", response_model=dict, status_code=status.HTTP_200_OK)
async def detect_hazards_in_frame(
    file: UploadFile = File(...),
    lat: float = Form(26.1448),
    lng: float = Form(91.7365),
    require_consensus: bool = Form(False),
    db: AsyncSession = Depends(get_db)
):
    """
    Runs YOLOv8 multi-class inference on an uploaded image/frame,
    evaluates consensus, deduplicates via H3, and persists confirmed hazards.
    """
    temp_fd, temp_path = tempfile.mkstemp(suffix=".jpg")
    try:
        with os.fdopen(temp_fd, "wb") as f:
            shutil.copyfileobj(file.file, f)

        frame = cv2.imread(temp_path)
        if frame is None:
            raise HTTPException(status_code=400, detail="Invalid image file format")

        hex_id = geo_to_h3(lat, lng, resolution=12)
        detections = detector.run_inference(frame=frame, lat=lat, lng=lng)

        confirmed_hazards = []

        for d in detections:
            is_confirmed = True
            if require_consensus:
                is_confirmed = consensus_engine.record_frame(hex_id, d.hazard_class, True)

            if is_confirmed:
                event, is_new = await persist_hazard_detection(d, db)
                confirmed_hazards.append({
                    "id": event.id,
                    "hazard_class": event.hazard_class,
                    "confidence": event.confidence_score,
                    "h3_hex_id": event.h3_hex_id,
                    "status": "created" if is_new else "updated"
                })

        return {
            "h3_hex_id": hex_id,
            "raw_detections_count": len(detections),
            "confirmed_hazards_count": len(confirmed_hazards),
            "hazards": confirmed_hazards
        }

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


class CrossReferenceRequest(BaseModel):
    lat: float
    lng: float
    hazard_class: str
    is_present: bool
    confidence: float = 0.9
    recorded_at: Optional[datetime] = None


@router.get("/tickets", response_model=List[RepairTicketResponse])
async def list_repair_tickets(
    status: Optional[str] = Query(None, description="Filter by ticket status: REQUIRED, DOING, ESCALATED, DONE_CANDIDATE, DONE"),
    hazard_class: Optional[str] = Query(None, description="Filter by hazard class"),
    h3_hex_id: Optional[str] = Query(None, description="Filter by H3 cell"),
    db: AsyncSession = Depends(get_db)
):
    """Lists municipal repair tickets with status and urgency."""
    conditions = []
    if status:
        conditions.append(RepairTicket.status == status)
    if hazard_class:
        conditions.append(RepairTicket.hazard_class == hazard_class)
    if h3_hex_id:
        conditions.append(RepairTicket.h3_hex_id == h3_hex_id)

    query = select(RepairTicket)
    if conditions:
        query = query.where(and_(*conditions))
    query = query.order_by(RepairTicket.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/audit-log", response_model=List[AuditLogResponse])
async def list_audit_logs(
    ticket_id: Optional[str] = Query(None, description="Filter by ticket UUID"),
    action: Optional[str] = Query(None, description="Filter by action: ESCALATED, DONE_CANDIDATE, FALSE_POSITIVE"),
    db: AsyncSession = Depends(get_db)
):
    """Lists audit trail entries for automated state transitions."""
    conditions = []
    if ticket_id:
        conditions.append(AuditLog.ticket_id == ticket_id)
    if action:
        conditions.append(AuditLog.action == action)

    query = select(AuditLog)
    if conditions:
        query = query.where(and_(*conditions))
    query = query.order_by(AuditLog.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/cross-reference", response_model=dict, status_code=status.HTTP_200_OK)
async def evaluate_cross_reference_endpoint(
    request: CrossReferenceRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Evaluates temporal auto-repair cross-reference state machine for a specific coordinate and class.
    """
    hex_id = geo_to_h3(request.lat, request.lng, resolution=12)
    upload_mock = VideoUpload(
        id=f"eval-{int(datetime.now(timezone.utc).timestamp())}",
        filename="eval_feed.mp4",
        lat=request.lat,
        lng=request.lng,
        h3_hex_id=hex_id,
        recorded_at=request.recorded_at or datetime.now(timezone.utc),
        status="APPROVED"
    )
    result = await evaluate_hazard_cross_reference(
        upload=upload_mock,
        hazard_class=request.hazard_class,
        is_present=request.is_present,
        confidence=request.confidence,
        db=db
    )
    return {"h3_hex_id": hex_id, **result}

