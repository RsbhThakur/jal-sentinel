"""
Unit and Integration Test Suite for Admin Gate and Municipal Work-Order Kanban.
Validates:
1. Admin auth guard (401 on missing token, 403 on invalid token, 200 with valid bearer token)
2. Admin Gate Approve: marks upload APPROVED, triggers temporal repair, logs audit entry
3. Admin Gate Reject: marks upload REJECTED (quarantined), logs audit entry
4. Work-Order Kanban PATCH: updates ticket status and urgency within <1 s, logs audit entry
5. Urgency escalation to CRITICAL (3) triggers SDRF SMS dispatch alert stub
6. Public citizen endpoint: GET /api/tickets/open accessible without auth
"""
import time
from datetime import datetime, timezone, timedelta
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.config import settings
from backend.models.entities import (
    VideoUpload,
    RepairTicket,
    AuditLog,
    utc_now
)
from backend.utils.geospatial import geo_to_h3


ADMIN_HEADERS = {
    "Authorization": f"Bearer {settings.admin_token}"
}


@pytest.mark.asyncio
async def test_admin_auth_guard(client: AsyncClient):
    """Verify 401 on missing token and 403 on invalid token."""
    # 1. Missing token -> 401
    r_missing = await client.get("/api/admin/uploads")
    assert r_missing.status_code == 401
    assert "Missing administrative authorization token" in r_missing.json()["detail"]

    # 2. Invalid token -> 403
    r_invalid = await client.get("/api/admin/uploads", headers={"Authorization": "Bearer bad-token-xyz"})
    assert r_invalid.status_code == 403
    assert "Invalid administrative credentials" in r_invalid.json()["detail"]

    # 3. Valid token -> 200
    r_valid = await client.get("/api/admin/uploads", headers=ADMIN_HEADERS)
    assert r_valid.status_code == 200
    assert isinstance(r_valid.json(), list)


@pytest.mark.asyncio
async def test_admin_gate_login(client: AsyncClient):
    """Verify hardcoded admin login credentials (admin / admin)."""
    # 1. Invalid credentials -> 401
    r_invalid = await client.post("/api/admin/login", json={"username": "admin", "password": "wrongpassword"})
    assert r_invalid.status_code == 401
    assert "Invalid administrative credentials" in r_invalid.json()["detail"]

    r_invalid_user = await client.post("/api/admin/login", json={"username": "guest", "password": "admin"})
    assert r_invalid_user.status_code == 401

    # 2. Valid credentials -> 200 and returns settings.admin_token
    r_valid = await client.post("/api/admin/login", json={"username": "admin", "password": "admin"})
    assert r_valid.status_code == 200
    data = r_valid.json()
    assert data["status"] == "authenticated"
    assert data["username"] == "admin"
    assert data["token"] == settings.admin_token


@pytest.mark.asyncio
async def test_admin_gate_approve_upload(client: AsyncClient, db_session: AsyncSession):
    """
    Acceptance Criterion:
    Approve marks video APPROVED, triggers temporal_repair, and creates an audit_log entry.
    """
    lat, lng = 26.1448, 91.7365
    hex_id = geo_to_h3(lat, lng, resolution=12)

    upload = VideoUpload(
        id="upload-pending-01",
        filename="citizen_manhole.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=utc_now(),
        status="PENDING",
        description="Hazard footage uploaded by citizen"
    )
    db_session.add(upload)
    await db_session.commit()

    # Admin approves upload
    r = await client.post(f"/api/admin/uploads/{upload.id}/approve", headers=ADMIN_HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "APPROVED"
    assert "audit_log_id" in data
    assert "cross_reference" in data

    # Verify DB state
    refreshed_upload = await db_session.get(VideoUpload, upload.id)
    assert refreshed_upload.status == "APPROVED"

    # Verify AuditLog entry
    audit = await db_session.get(AuditLog, data["audit_log_id"])
    assert audit is not None
    assert audit.action == "ADMIN_APPROVED"
    assert audit.performed_by == "admin"


@pytest.mark.asyncio
async def test_admin_gate_reject_upload(client: AsyncClient, db_session: AsyncSession):
    """
    Acceptance Criterion:
    Reject marks video REJECTED (quarantined) and logs an audit_log entry.
    """
    lat, lng = 26.1520, 91.7450
    hex_id = geo_to_h3(lat, lng, resolution=12)

    upload = VideoUpload(
        id="upload-pending-02",
        filename="blurry_glitch.mp4",
        lat=lat,
        lng=lng,
        h3_hex_id=hex_id,
        recorded_at=utc_now(),
        status="PENDING",
        description="Camera dropped in mud"
    )
    db_session.add(upload)
    await db_session.commit()

    # Admin rejects / quarantines upload
    r = await client.post(
        f"/api/admin/uploads/{upload.id}/reject?reason=Blurred camera footage",
        headers=ADMIN_HEADERS
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "REJECTED"
    assert "audit_log_id" in data

    # Verify DB state
    refreshed_upload = await db_session.get(VideoUpload, upload.id)
    assert refreshed_upload.status == "REJECTED"

    # Verify AuditLog
    audit = await db_session.get(AuditLog, data["audit_log_id"])
    assert audit is not None
    assert audit.action == "ADMIN_REJECTED"
    assert audit.reason == "Blurred camera footage"


@pytest.mark.asyncio
async def test_kanban_ticket_drag_status_and_urgency_update(client: AsyncClient, db_session: AsyncSession):
    """
    Acceptance Criterion:
    PATCH updates ticket status and urgency within <1 s with audit logging.
    """
    ticket = RepairTicket(
        id="ticket-kanban-01",
        h3_hex_id="8c3ce15715349ff",
        hazard_class="pothole",
        status="REQUIRED",
        urgency=1,
        admin_notes="Initial report"
    )
    db_session.add(ticket)
    await db_session.commit()

    t0 = time.perf_counter()
    patch_payload = {
        "status": "DOING",
        "urgency": 2,
        "admin_notes": "Assigned to PWD Rapid Road Repair Crew"
    }
    r = await client.patch(
        f"/api/admin/tickets/{ticket.id}",
        json=patch_payload,
        headers=ADMIN_HEADERS
    )
    duration_s = time.perf_counter() - t0

    assert duration_s < 1.0, f"PATCH took {duration_s:.3f} s, expected <1.0 s"
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "DOING"
    assert data["urgency"] == 2
    assert "PWD Rapid Road Repair" in data["admin_notes"]

    # Verify DB persistence
    refreshed = await db_session.get(RepairTicket, ticket.id)
    assert refreshed.status == "DOING"
    assert refreshed.urgency == 2

    # Verify AuditLog
    audit_q = select(AuditLog).where(AuditLog.ticket_id == ticket.id)
    audit_res = await db_session.execute(audit_q)
    audit_logs = audit_res.scalars().all()
    assert len(audit_logs) >= 1
    assert any("DOING" in a.action for a in audit_logs)


@pytest.mark.asyncio
async def test_urgency_escalation_triggers_sms_dispatch(client: AsyncClient, db_session: AsyncSession):
    """
    Acceptance Criterion:
    Escalating urgency to CRITICAL (3) triggers the SDRF SMS dispatch alert stub.
    """
    ticket = RepairTicket(
        id="ticket-critical-sms",
        h3_hex_id="8c3ce15715349ff",
        hazard_class="live_wire",
        status="REQUIRED",
        urgency=1
    )
    db_session.add(ticket)
    await db_session.commit()

    # Escalate to CRITICAL (3)
    patch_payload = {
        "urgency": 3,
        "status": "ESCALATED"
    }
    r = await client.patch(
        f"/api/admin/tickets/{ticket.id}",
        json=patch_payload,
        headers=ADMIN_HEADERS
    )
    assert r.status_code == 200
    data = r.json()
    assert data["urgency"] == 3
    assert data["status"] == "ESCALATED"

    # Verify audit reason notes the SMS broadcast
    audit_q = select(AuditLog).where(AuditLog.ticket_id == ticket.id)
    audit_res = await db_session.execute(audit_q)
    audit = audit_res.scalars().first()
    assert audit is not None
    assert "SDRF Emergency SMS broadcast dispatched" in audit.reason


@pytest.mark.asyncio
async def test_public_open_tickets_summary(client: AsyncClient, db_session: AsyncSession):
    """
    Verify GET /api/tickets/open is public (accessible without admin auth)
    and returns open ticket telemetry.
    """
    t1 = RepairTicket(h3_hex_id="8c3ce15715349ff", hazard_class="manhole", status="REQUIRED", urgency=3)
    t2 = RepairTicket(h3_hex_id="8c3ce15715349ff", hazard_class="pothole", status="DOING", urgency=2)
    t3 = RepairTicket(h3_hex_id="8c3ce15715349ff", hazard_class="debris", status="DONE", urgency=1)
    db_session.add_all([t1, t2, t3])
    await db_session.commit()

    # Call public endpoint without auth headers
    r = await client.get("/api/tickets/open")
    assert r.status_code == 200
    data = r.json()

    assert data["total_open"] >= 2
    assert data["critical_urgency_count"] >= 1
    assert "by_status" in data
    assert "by_hazard_class" in data
    assert "tickets" in data
