import pytest
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.models.entities import (
    VideoUpload,
    HazardEvent,
    RepairTicket,
    AuditLog
)
from backend.utils.geospatial import geo_to_h3, k_ring


@pytest.mark.asyncio
async def test_video_upload_lifecycle(db_session: AsyncSession):
    """Verify video upload persistence and H3 spatial snapping."""
    lat, lng = 26.1445, 91.7362  # Guwahati coordinates
    hex_id = geo_to_h3(lat, lng, resolution=12)

    upload = VideoUpload(
        filename="guwahati_flood_gs_road.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=datetime.now(timezone.utc),
        description="Rapid water accumulation on GS Road near Christian Basti"
    )
    db_session.add(upload)
    await db_session.commit()
    await db_session.refresh(upload)

    assert upload.id is not None
    assert upload.status == "PENDING"
    assert upload.h3_hex_id == hex_id

    # Query back
    result = await db_session.execute(
        select(VideoUpload).where(VideoUpload.h3_hex_id == hex_id)
    )
    retrieved = result.scalar_one_or_none()
    assert retrieved is not None
    assert retrieved.filename == "guwahati_flood_gs_road.mp4"


@pytest.mark.asyncio
async def test_hazard_event_and_ticket_relationship(db_session: AsyncSession):
    """Verify hazard event, repair ticket creation, and audit logging."""
    lat, lng = 26.1450, 91.7370
    hex_id = geo_to_h3(lat, lng, resolution=12)

    # 1. Register Hazard
    hazard = HazardEvent(
        h3_hex_id=hex_id,
        hazard_class="manhole",
        confidence_score=0.94,
        false_positive_flag=False,
        lat=lat,
        lng=lng
    )
    db_session.add(hazard)
    await db_session.commit()
    await db_session.refresh(hazard)

    assert hazard.id is not None
    assert hazard.hazard_class == "manhole"

    # 2. Create Repair Ticket
    ticket = RepairTicket(
        h3_hex_id=hex_id,
        hazard_class="manhole",
        status="REQUIRED",
        urgency=3,
        admin_notes="Submerged open manhole reported near drainage culvert"
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)

    assert ticket.id is not None
    assert ticket.urgency == 3

    # 3. Create Audit Log
    audit = AuditLog(
        ticket_id=ticket.id,
        hazard_event_id=hazard.id,
        action="ESCALATED",
        confidence_at_action=0.94,
        performed_by="system_temporal_cv",
        reason="Persistent hazard confirmed in flood zone"
    )
    db_session.add(audit)
    await db_session.commit()
    await db_session.refresh(audit)

    assert audit.id is not None
    assert audit.action == "ESCALATED"
    assert audit.ticket_id == ticket.id
    assert audit.hazard_event_id == hazard.id


@pytest.mark.asyncio
async def test_h3_spatial_geofencing_resolution_12():
    """Verify H3 resolution 12 deduplication bounds (sub-15m accuracy)."""
    lat1, lng1 = 26.144510, 91.736210
    # Point ~8 meters away
    lat2, lng2 = 26.144560, 91.736240

    hex1 = geo_to_h3(lat1, lng1, resolution=12)
    hex2 = geo_to_h3(lat2, lng2, resolution=12)

    # Within same cell or adjacent 1-ring neighbor
    neighbors = k_ring(hex1, 1)
    assert hex2 in neighbors
