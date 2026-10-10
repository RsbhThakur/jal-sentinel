"""
Admin Gate & Municipal Work-Order Management Router.
Provides administrative endpoints for:
1. Citizen video upload moderation (Approve / Reject quarantine gate)
2. Work-Order Kanban state transitions (REQUIRED -> DOING -> DONE_CANDIDATE -> DONE)
3. Emergency SMS dispatch stub (Fast2SMS integration when urgency escalates to CRITICAL)
4. Comprehensive audit log ledger recording every administrative action
"""
import logging
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Header, Query, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from backend.config import settings
from backend.database import get_db
from backend.models.entities import (
    VideoUpload,
    RepairTicket,
    AuditLog,
    utc_now
)
from backend.models.schemas import (
    VideoUploadResponse,
    RepairTicketResponse,
    RepairTicketUpdate,
    AuditLogResponse,
    AdminLoginRequest,
    AdminLoginResponse
)
from backend.workers.temporal_repair import run_temporal_cross_reference

logger = logging.getLogger("jal_sentinel.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/login", response_model=AdminLoginResponse, status_code=status.HTTP_200_OK)
async def admin_login(creds: AdminLoginRequest):
    """
    Admin Gate Authentication Endpoint:
    Validates hardcoded municipal credentials (admin / admin).
    Returns the administrative bearer token upon success.
    """
    if creds.username == "admin" and creds.password == "admin":
        logger.info("Admin successfully authenticated via Admin Gate.")
        return AdminLoginResponse(
            status="authenticated",
            username="admin",
            token=settings.admin_token,
            message="Municipal clearance authorized. Welcome to JAL-SENTINEL Admin Console."
        )

    logger.warning(f"Failed admin authentication attempt for username: {creds.username}")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid administrative credentials. Access restricted to authorized personnel."
    )


def verify_admin_token(
    authorization: Optional[str] = Header(None),
    x_admin_token: Optional[str] = Header(None, alias="X-Admin-Token")
) -> str:
    """
    Validates administrative bearer token or X-Admin-Token header.
    Rejects unauthorized access with 401 or 403 HTTP status.
    """
    token = None
    if authorization:
        parts = authorization.split(" ")
        token = parts[1] if len(parts) == 2 else parts[0]
    elif x_admin_token:
        token = x_admin_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing administrative authorization token."
        )

    if token != settings.admin_token:
        logger.warning(f"Unauthorized admin access attempt with token: {token[:8]}...")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid administrative credentials."
        )

    return token


def dispatch_sdrf_emergency_sms(ticket: RepairTicket) -> Dict[str, Any]:
    """
    Emergency broadcast stub: Dispatches SMS alert to SDRF and Municipal
    Rapid Action Teams when a hazard escalates to CRITICAL (urgency = 3).
    """
    msg = (
        f"[JAL-SENTINEL EMERGENCY ALERT] CRITICAL hazard detected! "
        f"Class: {ticket.hazard_class.upper()} | Location H3: {ticket.h3_hex_id} | "
        f"Urgency: CRITICAL (3/3). Immediate SDRF barricade / deployment requested."
    )
    logger.warning(f"[SMS DISPATCH STUB - Fast2SMS API] {msg}")

    # If Fast2SMS API key is provided, a real HTTP POST to Fast2SMS would occur here:
    dispatched = True
    provider = "Fast2SMS (Demo Sandbox Mode)" if not settings.fast2sms_api_key else "Fast2SMS Live Gateway"

    return {
        "dispatched": dispatched,
        "provider": provider,
        "alert_message": msg,
        "ticket_id": ticket.id,
        "hazard_class": ticket.hazard_class,
        "urgency": ticket.urgency,
        "timestamp": utc_now().isoformat()
    }


# ==============================================================================
# 1. Citizen Video Upload Moderation (Admin Gate)
# ==============================================================================

@router.get("/uploads", response_model=List[VideoUploadResponse])
async def list_uploads_for_review(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by upload status: PENDING, APPROVED, REJECTED"),
    admin_auth: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """Lists citizen crowd-gauged video uploads awaiting administrative review."""
    query = select(VideoUpload)
    if status_filter:
        query = query.where(VideoUpload.status == status_filter.upper())
    query = query.order_by(VideoUpload.created_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.post("/uploads/{upload_id}/approve", response_model=dict, status_code=status.HTTP_200_OK)
async def approve_upload(
    upload_id: str,
    admin_auth: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin Gate Approve:
    Marks video as APPROVED, publishes to map, records an audit log entry,
    and runs the temporal auto-repair cross-reference state machine.
    """
    result = await db.execute(select(VideoUpload).where(VideoUpload.id == upload_id))
    upload = result.scalars().first()
    if not upload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload record not found.")

    upload.status = "APPROVED"

    audit_entry = AuditLog(
        ticket_id=None,
        hazard_event_id=None,
        action="ADMIN_APPROVED",
        confidence_at_action=1.0,
        upload_timestamp=upload.recorded_at,
        performed_by="admin",
        reason=f"Administrator verified and approved citizen upload {upload.filename}"
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(upload)
    await db.refresh(audit_entry)

    # Execute temporal auto-repair cross-reference pipeline
    cross_ref_result = await run_temporal_cross_reference(upload=upload, frame=None, db=db)

    logger.info(f"Admin approved upload {upload_id}. Cross-reference executed.")
    return {
        "status": "APPROVED",
        "upload_id": upload.id,
        "audit_log_id": audit_entry.id,
        "cross_reference": cross_ref_result
    }


@router.post("/uploads/{upload_id}/reject", response_model=dict, status_code=status.HTTP_200_OK)
async def reject_upload(
    upload_id: str,
    reason: Optional[str] = Query("Quarantined by municipal admin review", description="Rejection rationale"),
    admin_auth: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin Gate Reject:
    Marks video as REJECTED (quarantined), ensuring it never mutates live telemetry
    or the public flood map, and logs an audit trail record.
    """
    result = await db.execute(select(VideoUpload).where(VideoUpload.id == upload_id))
    upload = result.scalars().first()
    if not upload:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload record not found.")

    upload.status = "REJECTED"

    audit_entry = AuditLog(
        ticket_id=None,
        hazard_event_id=None,
        action="ADMIN_REJECTED",
        confidence_at_action=0.0,
        upload_timestamp=upload.recorded_at,
        performed_by="admin",
        reason=reason
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(upload)
    await db.refresh(audit_entry)

    logger.info(f"Admin quarantined/rejected upload {upload_id}: {reason}")
    return {
        "status": "REJECTED",
        "upload_id": upload.id,
        "audit_log_id": audit_entry.id,
        "message": "Video successfully quarantined from public map."
    }


# ==============================================================================
# 2. Municipal Work-Order Kanban (Tickets Management)
# ==============================================================================

@router.get("/tickets", response_model=List[RepairTicketResponse])
async def list_admin_tickets(
    status_filter: Optional[str] = Query(None, alias="status", description="REQUIRED, DOING, DONE_CANDIDATE, DONE, ESCALATED"),
    admin_auth: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """Lists municipal repair tickets formatted for Kanban column display."""
    query = select(RepairTicket)
    if status_filter:
        query = query.where(RepairTicket.status == status_filter.upper())
    query = query.order_by(RepairTicket.updated_at.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.patch("/tickets/{ticket_id}", response_model=RepairTicketResponse)
async def update_ticket_status_and_urgency(
    ticket_id: str,
    update_data: RepairTicketUpdate,
    admin_auth: str = Depends(verify_admin_token),
    db: AsyncSession = Depends(get_db)
):
    """
    PATCH /api/admin/tickets/{id}:
    Updates ticket status, urgency, or notes (e.g. dragging card in Kanban).
    Triggers SDRF SMS dispatch when urgency is set to CRITICAL (3).
    Logs an immutable audit log entry for the state transition.
    """
    result = await db.execute(select(RepairTicket).where(RepairTicket.id == ticket_id))
    ticket = result.scalars().first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Repair ticket not found.")

    old_status = ticket.status
    old_urgency = ticket.urgency
    now = utc_now()

    if update_data.status is not None:
        ticket.status = update_data.status.upper()
        if ticket.status == "DONE":
            ticket.resolved_at = now

    if update_data.urgency is not None:
        ticket.urgency = int(update_data.urgency)

    if update_data.admin_notes is not None:
        ticket.admin_notes = update_data.admin_notes

    ticket.updated_at = now

    # Check for Critical Urgency escalation -> SMS broadcast trigger
    sms_dispatched = False
    if ticket.urgency == 3 and old_urgency != 3:
        dispatch_sdrf_emergency_sms(ticket)
        sms_dispatched = True

    # Record Audit Log
    action_name = f"ADMIN_MOVE_{ticket.status}"
    audit_reason = (
        f"Admin transitioned ticket from {old_status} -> {ticket.status} "
        f"(Urgency {old_urgency} -> {ticket.urgency})"
    )
    if sms_dispatched:
        audit_reason += " [SDRF Emergency SMS broadcast dispatched]"

    audit_entry = AuditLog(
        ticket_id=ticket.id,
        hazard_event_id=None,
        action=action_name,
        confidence_at_action=1.0,
        upload_timestamp=now,
        performed_by="admin",
        reason=audit_reason
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(ticket)
    await db.refresh(audit_entry)

    logger.info(f"Ticket {ticket.id} updated: {old_status} -> {ticket.status}, urgency={ticket.urgency}")
    return ticket


@router.get("/audit-logs", response_model=List[AuditLogResponse])
async def list_admin_audit_logs(
    admin_auth: str = Depends(verify_admin_token),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db)
):
    """Retrieves immutable audit trail of administrative and automated actions."""
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()
