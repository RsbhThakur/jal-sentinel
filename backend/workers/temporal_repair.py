"""
Temporal Auto-Repair Cross-Reference Pipeline & State Machine.
Tracks hazard evolution across time (T2 > T1) using planar H3 Resolution-12 geofencing.

State Machine transitions:
- REQUIRED / UNRESOLVED -> ESCALATED (Municipality missed required repair)
- DOING -> DONE_CANDIDATE (Hazard confirmed absent in follow-up video T2)
- UNTICKETED ABSENT -> FALSE_POSITIVE (Auto-closed with full audit log entry)
- T2 <= T1 -> STALE_GUARD_IGNORED (Protects against out-of-order uploads)
"""
import time
import logging
from datetime import datetime, timezone
from typing import List, Tuple, Optional, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
import numpy as np

from backend.models.entities import (
    VideoUpload,
    HazardEvent,
    RepairTicket,
    AuditLog,
    utc_now
)
from backend.utils.geospatial import geo_to_h3, k_ring
from backend.workers.yolo_detector import detector, HazardDetection

logger = logging.getLogger("jal_sentinel.temporal_repair")

DETECTABLE_CLASSES = ["manhole", "pothole", "live_wire", "debris", "vehicle"]


def normalize_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure datetime is timezone-aware UTC for safe comparisons."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def transition_to_done_candidate(
    ticket: RepairTicket,
    upload: VideoUpload,
    confidence: float,
    db: AsyncSession
) -> Tuple[RepairTicket, AuditLog]:
    """
    Transition 1: DOING -> DONE_CANDIDATE.
    When a citizen uploads a later video (T2 > T1) at the hazard geolocation,
    and the hazard is confirmed ABSENT while a repair ticket is in DOING status,
    promote the ticket to DONE_CANDIDATE for municipal admin confirmation.
    """
    now = utc_now()
    ticket.status = "DONE_CANDIDATE"
    ticket.updated_at = now

    audit_entry = AuditLog(
        ticket_id=ticket.id,
        hazard_event_id=None,
        action="DONE_CANDIDATE",
        confidence_at_action=confidence,
        upload_timestamp=upload.recorded_at,
        performed_by="system",
        reason="Auto-repair verification: Hazard absent in follow-up video T2 while ticket was DOING. Promoted to DONE_CANDIDATE."
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(ticket)
    await db.refresh(audit_entry)
    logger.info(f"Ticket {ticket.id} ({ticket.hazard_class}) transitioned to DONE_CANDIDATE.")
    return ticket, audit_entry


async def escalate_urgency(
    ticket: RepairTicket,
    upload: VideoUpload,
    confidence: float,
    db: AsyncSession,
    reason: Optional[str] = None
) -> Tuple[RepairTicket, AuditLog]:
    """
    Transition 2: REQUIRED / UNRESOLVED -> ESCALATED.
    Triggered when:
    (a) Ticket is REQUIRED, but a later video T2 shows hazard still PRESENT (municipality delayed)
    (b) Ticket is REQUIRED, but a later video T2 shows hazard ABSENT without any DOING work logged (unverified change)
    Bumps urgency (capped at 3 = critical) and sets status to ESCALATED.
    """
    now = utc_now()
    old_urgency = ticket.urgency
    ticket.urgency = min(3, ticket.urgency + 1)
    ticket.status = "ESCALATED"
    ticket.updated_at = now

    audit_reason = reason or (
        f"Auto-repair escalation: Follow-up upload T2 indicated unaddressed hazard. "
        f"Urgency bumped from {old_urgency} to {ticket.urgency}."
    )
    audit_entry = AuditLog(
        ticket_id=ticket.id,
        hazard_event_id=None,
        action="ESCALATED",
        confidence_at_action=confidence,
        upload_timestamp=upload.recorded_at,
        performed_by="system",
        reason=audit_reason
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(ticket)
    await db.refresh(audit_entry)
    logger.info(f"Ticket {ticket.id} ({ticket.hazard_class}) ESCALATED: urgency {old_urgency} -> {ticket.urgency}.")
    return ticket, audit_entry


async def auto_close_false_positive(
    hazard_event: Optional[HazardEvent],
    upload: VideoUpload,
    hazard_class: str,
    confidence: float,
    db: AsyncSession
) -> Tuple[Optional[HazardEvent], AuditLog]:
    """
    Transition 3: UNTICKETED HAZARD ABSENT -> FALSE_POSITIVE.
    When a citizen video at T2 shows a previously flagged hazard is ABSENT
    and NO active repair ticket exists, auto-close the hazard as a FALSE_POSITIVE
    with full audit trail.
    """
    now = utc_now()
    if hazard_event is not None:
        hazard_event.false_positive_flag = True
        hazard_event.last_seen_at = upload.recorded_at or now

    audit_entry = AuditLog(
        ticket_id=None,
        hazard_event_id=hazard_event.id if hazard_event else None,
        action="FALSE_POSITIVE",
        confidence_at_action=confidence,
        upload_timestamp=upload.recorded_at,
        performed_by="system",
        reason=f"Auto-repair auto-close: No active repair ticket exists and class '{hazard_class}' absent in video T2. Flagged as FALSE_POSITIVE."
    )
    db.add(audit_entry)
    await db.commit()
    if hazard_event is not None:
        await db.refresh(hazard_event)
    await db.refresh(audit_entry)
    logger.info(f"Hazard {hazard_event.id if hazard_event else 'N/A'} ({hazard_class}) auto-closed as FALSE_POSITIVE.")
    return hazard_event, audit_entry


async def evaluate_hazard_cross_reference(
    upload: VideoUpload,
    hazard_class: str,
    is_present: bool,
    confidence: float,
    db: AsyncSession
) -> Dict[str, Any]:
    """
    Cross-references a single hazard class detection from video T2 against the DB ledger.
    Applies H3 1-ring spatial snapping and the stale upload guard.
    """
    target_hexes = [upload.h3_hex_id] + list(k_ring(upload.h3_hex_id, 1))

    # Query for open/active repair ticket at this H3 cell
    ticket_query = select(RepairTicket).where(
        RepairTicket.h3_hex_id.in_(target_hexes),
        RepairTicket.hazard_class == hazard_class,
        RepairTicket.status.in_(["REQUIRED", "DOING", "ESCALATED", "DONE_CANDIDATE"])
    ).order_by(RepairTicket.created_at.desc())

    ticket_result = await db.execute(ticket_query)
    ticket = ticket_result.scalars().first()

    # Query for active hazard event at this H3 cell
    hazard_query = select(HazardEvent).where(
        HazardEvent.h3_hex_id.in_(target_hexes),
        HazardEvent.hazard_class == hazard_class,
        HazardEvent.false_positive_flag == False
    ).order_by(HazardEvent.first_detected_at.desc())

    hazard_result = await db.execute(hazard_query)
    hazard_event = hazard_result.scalars().first()

    upload_time = normalize_utc(upload.recorded_at)

    # 1. Stale Upload Guard:
    # If the video upload timestamp is older than or equal to existing ticket creation,
    # do NOT perform state changes!
    if ticket is not None:
        ticket_time = normalize_utc(ticket.created_at)
        if upload_time and ticket_time and upload_time <= ticket_time:
            logger.info(f"Stale upload guard triggered: upload ({upload_time}) <= ticket ({ticket_time}). No state change.")
            return {
                "action": "STALE_GUARD_IGNORED",
                "ticket_id": ticket.id,
                "status": "ignored",
                "message": "Upload timestamp is older than or equal to ticket creation."
            }

    # 2. Hazard is ABSENT (confidence < threshold or not detected)
    if not is_present:
        if ticket is None:
            # Case A: No ticket exists -> Auto-close as FALSE_POSITIVE
            he, audit = await auto_close_false_positive(hazard_event, upload, hazard_class, confidence, db)
            return {
                "action": "FALSE_POSITIVE",
                "hazard_event_id": he.id if he else None,
                "audit_log_id": audit.id,
                "status": "closed_false_positive"
            }
        elif ticket.status == "DOING":
            # Case B: Ticket in DOING -> Candidate for DONE
            t, audit = await transition_to_done_candidate(ticket, upload, confidence, db)
            return {
                "action": "DONE_CANDIDATE",
                "ticket_id": t.id,
                "audit_log_id": audit.id,
                "status": "transitioned_done_candidate"
            }
        elif ticket.status in ["REQUIRED", "ESCALATED"]:
            # Case C: Ticket was REQUIRED but absent without DOING ticket -> Escalate
            t, audit = await escalate_urgency(
                ticket, upload, confidence, db,
                reason="Hazard reported absent while ticket in REQUIRED status (no work logged by municipality)."
            )
            return {
                "action": "ESCALATED",
                "ticket_id": t.id,
                "audit_log_id": audit.id,
                "urgency": t.urgency,
                "status": "escalated"
            }

    # 3. Hazard is PRESENT (confidence >= threshold)
    else:
        if ticket is not None and ticket.status in ["REQUIRED", "DOING", "ESCALATED"]:
            # Case D: Hazard still present and ticket exists -> Escalate urgency
            t, audit = await escalate_urgency(
                ticket, upload, confidence, db,
                reason="Follow-up video T2 confirms hazard remains present; municipality response overdue."
            )
            return {
                "action": "ESCALATED",
                "ticket_id": t.id,
                "audit_log_id": audit.id,
                "urgency": t.urgency,
                "status": "escalated"
            }
        elif ticket is None:
            # Case E: Hazard present but no ticket exists -> Create REQUIRED ticket
            new_ticket = RepairTicket(
                h3_hex_id=upload.h3_hex_id,
                hazard_class=hazard_class,
                status="REQUIRED",
                urgency=2,
                admin_notes=f"Auto-generated from citizen video upload at {upload.lat}, {upload.lng}"
            )
            db.add(new_ticket)
            await db.commit()
            await db.refresh(new_ticket)
            return {
                "action": "CREATED_REQUIRED",
                "ticket_id": new_ticket.id,
                "status": "ticket_created"
            }

    return {"action": "NO_OP", "status": "no_change"}


async def run_temporal_cross_reference(
    upload: VideoUpload,
    frame: Optional[np.ndarray],
    db: AsyncSession,
    confidence_threshold: float = 0.45
) -> Dict[str, Any]:
    """
    FastAPI BackgroundTask entrypoint:
    Runs YOLO inference on video frame, then evaluates cross-reference state machine
    for all candidate hazard classes at upload's H3 cell.
    """
    t0 = time.perf_counter()
    hex_id = upload.h3_hex_id or geo_to_h3(upload.lat, upload.lng, resolution=12)

    detections = []
    if frame is not None:
        detections = detector.run_inference(
            frame=frame,
            confidence_threshold=confidence_threshold,
            lat=upload.lat,
            lng=upload.lng
        )

    # Map detected classes
    detected_classes = {d.hazard_class: d.confidence for d in detections if d.is_present}

    results = []
    target_hexes = [hex_id] + list(k_ring(hex_id, 1))

    active_tickets_q = select(RepairTicket.hazard_class).where(
        RepairTicket.h3_hex_id.in_(target_hexes),
        RepairTicket.status.in_(["REQUIRED", "DOING", "ESCALATED", "DONE_CANDIDATE"])
    )
    t_res = await db.execute(active_tickets_q)
    classes_to_check = set(t_res.scalars().all())

    active_events_q = select(HazardEvent.hazard_class).where(
        HazardEvent.h3_hex_id.in_(target_hexes),
        HazardEvent.false_positive_flag == False
    )
    e_res = await db.execute(active_events_q)
    classes_to_check.update(e_res.scalars().all())

    if not classes_to_check:
        classes_to_check = {"manhole", "pothole", "live_wire"}

    for hazard_cls in classes_to_check:
        is_pres = hazard_cls in detected_classes
        conf = detected_classes.get(hazard_cls, 0.0)
        res = await evaluate_hazard_cross_reference(
            upload=upload,
            hazard_class=hazard_cls,
            is_present=is_pres,
            confidence=conf,
            db=db
        )
        results.append({"hazard_class": hazard_cls, "is_present": is_pres, **res})

    elapsed_ms = (time.perf_counter() - t0) * 1000
    return {
        "upload_id": upload.id,
        "h3_hex_id": hex_id,
        "elapsed_ms": round(elapsed_ms, 2),
        "transitions": results
    }
