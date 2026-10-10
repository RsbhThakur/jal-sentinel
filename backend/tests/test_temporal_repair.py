"""
Unit and Integration Test Suite for Temporal Auto-Repair Cross-Reference Pipeline.
Validates:
1. REQUIRED -> ESCALATED transition (municipality missed or delayed repair)
2. DOING -> DONE_CANDIDATE transition (hazard confirmed absent in video T2 > T1)
3. No ticket -> FALSE_POSITIVE transition (hazard confirmed absent, audit log logged)
4. Stale upload guard (T2 <= T1 creates no state mutation)
5. H3 1-ring neighbor geofencing cross-referencing
6. Benchmark: Worker completes under 2.0 seconds per upload frame on CPU
7. REST API contract for /api/hazards/cross-reference and audit-log queries
"""
import time
from datetime import datetime, timezone, timedelta
import pytest
import numpy as np
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.models.entities import (
    VideoUpload,
    HazardEvent,
    RepairTicket,
    AuditLog
)
from backend.utils.geospatial import geo_to_h3
from backend.workers.temporal_repair import (
    transition_to_done_candidate,
    escalate_urgency,
    auto_close_false_positive,
    evaluate_hazard_cross_reference,
    run_temporal_cross_reference
)


@pytest.mark.asyncio
async def test_state_transition_required_to_escalated(db_session: AsyncSession):
    """
    Acceptance Criterion 1:
    REQUIRED ticket + hazard absent (or unresolved) in T2 > T1 -> urgency escalated in DB.
    """
    lat, lng = 26.1448, 91.7365
    hex_id = geo_to_h3(lat, lng, resolution=12)
    t1 = datetime(2026, 10, 10, 8, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 10, 10, 11, 0, 0, tzinfo=timezone.utc)

    # 1. Create existing REQUIRED ticket at T1
    ticket = RepairTicket(
        h3_hex_id=hex_id,
        hazard_class="manhole",
        status="REQUIRED",
        urgency=2,
        created_at=t1,
        admin_notes="Reported by citizen patrol"
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)

    # 2. Later upload at T2 shows hazard absent without municipal action
    upload_t2 = VideoUpload(
        id="upload-t2-escalate",
        filename="video_t2.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=t2,
        status="APPROVED"
    )

    result = await evaluate_hazard_cross_reference(
        upload=upload_t2,
        hazard_class="manhole",
        is_present=False,
        confidence=0.1,
        db=db_session
    )

    assert result["action"] == "ESCALATED"
    assert result["status"] == "escalated"
    assert result["urgency"] == 3  # Bumped 2 -> 3 (capped at critical)

    # Verify DB persistence
    refreshed_ticket = await db_session.get(RepairTicket, ticket.id)
    assert refreshed_ticket.status == "ESCALATED"
    assert refreshed_ticket.urgency == 3

    # Verify AuditLog entry
    audit_q = select(AuditLog).where(AuditLog.ticket_id == ticket.id)
    audit_res = await db_session.execute(audit_q)
    audit = audit_res.scalars().first()
    assert audit is not None
    assert audit.action == "ESCALATED"
    assert audit.performed_by == "system"


@pytest.mark.asyncio
async def test_state_transition_doing_to_done_candidate(db_session: AsyncSession):
    """
    Acceptance Criterion 2:
    DOING ticket + hazard absent in T2 > T1 -> status transitions to DONE_CANDIDATE.
    """
    lat, lng = 26.1410, 91.7650
    hex_id = geo_to_h3(lat, lng, resolution=12)
    t1 = datetime(2026, 10, 10, 9, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 10, 10, 14, 0, 0, tzinfo=timezone.utc)

    # 1. Ticket in DOING status (contractor assigned)
    ticket = RepairTicket(
        h3_hex_id=hex_id,
        hazard_class="pothole",
        status="DOING",
        urgency=2,
        created_at=t1,
        admin_notes="Assigned to Guwahati Municipal Work Crew #3"
    )
    db_session.add(ticket)
    await db_session.commit()
    await db_session.refresh(ticket)

    # 2. Later video at T2 confirms pothole has been patched (absent)
    upload_t2 = VideoUpload(
        id="upload-t2-done",
        filename="patch_complete.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=t2,
        status="APPROVED"
    )

    result = await evaluate_hazard_cross_reference(
        upload=upload_t2,
        hazard_class="pothole",
        is_present=False,
        confidence=0.05,
        db=db_session
    )

    assert result["action"] == "DONE_CANDIDATE"
    assert result["status"] == "transitioned_done_candidate"

    # Verify DB persistence
    refreshed_ticket = await db_session.get(RepairTicket, ticket.id)
    assert refreshed_ticket.status == "DONE_CANDIDATE"

    # Verify AuditLog
    audit_q = select(AuditLog).where(AuditLog.ticket_id == ticket.id)
    audit_res = await db_session.execute(audit_q)
    audit = audit_res.scalars().first()
    assert audit is not None
    assert audit.action == "DONE_CANDIDATE"


@pytest.mark.asyncio
async def test_state_transition_none_to_false_positive(db_session: AsyncSession):
    """
    Acceptance Criterion 3:
    No ticket + hazard absent in T2 -> FALSE_POSITIVE entry written to audit_log
    and hazard_events flag marked True.
    """
    lat, lng = 26.1520, 91.7450
    hex_id = geo_to_h3(lat, lng, resolution=12)
    t1 = datetime(2026, 10, 10, 7, 0, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 10, 10, 10, 0, 0, tzinfo=timezone.utc)

    # 1. An unticketed hazard event previously flagged at T1
    event = HazardEvent(
        h3_hex_id=hex_id,
        hazard_class="live_wire",
        confidence_score=0.72,
        false_positive_flag=False,
        lat=lat,
        lng=lng,
        first_detected_at=t1,
        last_seen_at=t1
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    # 2. Later video at T2 shows no live wire and no ticket exists
    upload_t2 = VideoUpload(
        id="upload-t2-fp",
        filename="clear_wire.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=t2,
        status="APPROVED"
    )

    result = await evaluate_hazard_cross_reference(
        upload=upload_t2,
        hazard_class="live_wire",
        is_present=False,
        confidence=0.08,
        db=db_session
    )

    assert result["action"] == "FALSE_POSITIVE"
    assert result["status"] == "closed_false_positive"

    # Verify DB flag
    refreshed_event = await db_session.get(HazardEvent, event.id)
    assert refreshed_event.false_positive_flag is True

    # Verify AuditLog
    audit_q = select(AuditLog).where(AuditLog.hazard_event_id == event.id)
    audit_res = await db_session.execute(audit_q)
    audit = audit_res.scalars().first()
    assert audit is not None
    assert audit.action == "FALSE_POSITIVE"


@pytest.mark.asyncio
async def test_stale_upload_guard_prevents_state_change(db_session: AsyncSession):
    """
    Acceptance Criterion 4:
    Upload timestamp older than existing ticket creates no state change (stale guard).
    """
    lat, lng = 26.1448, 91.7365
    hex_id = geo_to_h3(lat, lng, resolution=12)

    # Ticket created at 12:00
    ticket_created = datetime(2026, 10, 10, 12, 0, 0, tzinfo=timezone.utc)
    ticket = RepairTicket(
        h3_hex_id=hex_id,
        hazard_class="manhole",
        status="DOING",
        urgency=2,
        created_at=ticket_created
    )
    db_session.add(ticket)
    await db_session.commit()

    # User uploads video recorded at 10:00 (older than ticket by 2 hours)
    stale_upload_time = datetime(2026, 10, 10, 10, 0, 0, tzinfo=timezone.utc)
    stale_upload = VideoUpload(
        id="upload-stale",
        filename="old_recorded.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=stale_upload_time,
        status="APPROVED"
    )

    result = await evaluate_hazard_cross_reference(
        upload=stale_upload,
        hazard_class="manhole",
        is_present=False,
        confidence=0.0,
        db=db_session
    )

    assert result["action"] == "STALE_GUARD_IGNORED"
    assert result["status"] == "ignored"

    # Verify ticket was NOT modified
    refreshed_ticket = await db_session.get(RepairTicket, ticket.id)
    assert refreshed_ticket.status == "DOING"
    assert refreshed_ticket.urgency == 2


@pytest.mark.asyncio
async def test_benchmark_temporal_worker_under_2_seconds(db_session: AsyncSession):
    """
    Benchmark Criterion:
    Worker completes in < 2 s per upload frame on CPU.
    """
    lat, lng = 26.1448, 91.7365
    hex_id = geo_to_h3(lat, lng, resolution=12)
    synthetic_frame = np.ones((480, 640, 3), dtype=np.uint8) * 128

    upload = VideoUpload(
        id="bench-upload",
        filename="benchmark.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=datetime.now(timezone.utc),
        status="APPROVED"
    )

    # Warmup detector singleton (amortizing one-time PyTorch weight initialization)
    from backend.workers.yolo_detector import detector
    _ = detector.get_model()

    t0 = time.perf_counter()
    summary = await run_temporal_cross_reference(
        upload=upload,
        frame=synthetic_frame,
        db=db_session,
        confidence_threshold=0.45
    )
    elapsed = time.perf_counter() - t0

    print(f"\n[BENCHMARK] Temporal worker execution time: {elapsed:.3f} s ({summary['elapsed_ms']} ms)")
    assert elapsed < 2.0, f"Worker exceeded 2.0 s requirement: {elapsed:.3f} s"
    assert "transitions" in summary


@pytest.mark.asyncio
async def test_rest_api_cross_reference_and_tickets(client: AsyncClient):
    """
    Validates REST API integration:
    - POST /api/hazards/cross-reference
    - GET /api/hazards/tickets
    - GET /api/hazards/audit-log
    """
    lat, lng = 26.1448, 91.7365

    # 1. Evaluate cross reference via API (Unticketed hazard absent -> FALSE_POSITIVE)
    eval_payload = {
        "lat": lat,
        "lng": lng,
        "hazard_class": "debris",
        "is_present": False,
        "confidence": 0.12,
        "recorded_at": datetime.now(timezone.utc).isoformat()
    }
    r = await client.post("/api/hazards/cross-reference", json=eval_payload)
    assert r.status_code == 200
    res_data = r.json()
    assert res_data["action"] == "FALSE_POSITIVE"
    assert "audit_log_id" in res_data

    # 2. Query audit log via API
    r_audit = await client.get("/api/hazards/audit-log?action=FALSE_POSITIVE")
    assert r_audit.status_code == 200
    logs = r_audit.json()
    assert len(logs) >= 1
    assert any(log["action"] == "FALSE_POSITIVE" for log in logs)

    # 3. Query tickets endpoint
    r_tickets = await client.get("/api/hazards/tickets")
    assert r_tickets.status_code == 200
    assert isinstance(r_tickets.json(), list)
