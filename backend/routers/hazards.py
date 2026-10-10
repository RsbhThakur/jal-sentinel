from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.models.entities import HazardEvent
from backend.utils.geospatial import geo_to_h3

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


@router.get("", response_model=dict)
async def list_hazards(
    hazard_class: Optional[str] = Query(None, description="Filter by hazard class"),
    db: AsyncSession = Depends(get_db)
):
    """
    Returns active hazard events as a GeoJSON FeatureCollection.
    Falls back to seeded Guwahati high-risk pins if database table is currently unpopulated.
    """
    query = select(HazardEvent).where(HazardEvent.false_positive_flag == False)
    if hazard_class:
        query = query.where(HazardEvent.hazard_class == hazard_class)
    
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
            hex_id = geo_to_h3(h["lat"], h["lng"], resolution=12)
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
                    "h3_hex_id": hex_id,
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
