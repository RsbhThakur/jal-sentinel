"""
Public Citizen-Facing Repair Tickets Router.
Provides public read access to open hazard counts and municipal repair progress
without administrative authentication.
"""
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.models.entities import RepairTicket
from backend.models.schemas import RepairTicketResponse

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("/open", response_model=dict, status_code=status.HTTP_200_OK)
async def get_open_tickets_summary(
    db: AsyncSession = Depends(get_db)
):
    """
    Public endpoint for citizen dashboard telemetry:
    Returns count and breakdown of currently active municipal work-orders.
    """
    query = select(RepairTicket).where(RepairTicket.status != "DONE").order_by(RepairTicket.urgency.desc())
    result = await db.execute(query)
    open_tickets = result.scalars().all()

    by_status: Dict[str, int] = {}
    by_class: Dict[str, int] = {}
    critical_count = 0

    tickets_data = []
    for t in open_tickets:
        by_status[t.status] = by_status.get(t.status, 0) + 1
        by_class[t.hazard_class] = by_class.get(t.hazard_class, 0) + 1
        if t.urgency == 3:
            critical_count += 1

        tickets_data.append({
            "id": t.id,
            "h3_hex_id": t.h3_hex_id,
            "hazard_class": t.hazard_class,
            "status": t.status,
            "urgency": t.urgency,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "admin_notes": t.admin_notes
        })

    return {
        "total_open": len(open_tickets),
        "critical_urgency_count": critical_count,
        "by_status": by_status,
        "by_hazard_class": by_class,
        "tickets": tickets_data
    }
