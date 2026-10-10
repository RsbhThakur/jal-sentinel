"""
JAL-SENTINEL: Citizen SOS & Emergency SDRF Dispatch Router (Issue #11).
Provides:
1. POST /api/sos: Citizen one-tap emergency broadcast endpoint
2. Spatial haversine matching with nearest SDRF staging unit
3. Fast2SMS emergency alert dispatch (with demo console fallback)
4. Immutable audit ledger recording under action='SOS_DISPATCHED'
5. GET /api/sos/units: List all active regional SDRF staging posts
"""
import os
import json
import math
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings
from backend.database import get_db
from backend.models.entities import AuditLog, generate_uuid, utc_now
from backend.models.schemas import CitizenSosRequest, CitizenSosResponse, SdrfUnitInfo

logger = logging.getLogger("jal_sentinel.sos")

router = APIRouter(prefix="/api/sos", tags=["sos"])

# Path to static SDRF staging catalog
CATALOG_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "cline-agent", "data", "sdrf_staging.json")
)

FALLBACK_SDRF_UNITS = [
    {
        "id": "sdrf-kamrup-01",
        "name": "SDRF Guwahati Central Staging (Paltan Bazaar)",
        "lat": 26.1795,
        "lng": 91.7523,
        "contact": "+91-361-2237001",
        "boats_available": 6,
        "personnel_count": 24
    },
    {
        "id": "sdrf-kamrup-02",
        "name": "SDRF Dispur Emergency Post (GS Road Chokepoint)",
        "lat": 26.1415,
        "lng": 91.7905,
        "contact": "+91-361-2237002",
        "boats_available": 4,
        "personnel_count": 16
    },
    {
        "id": "sdrf-kamrup-03",
        "name": "SDRF Bharalu Basin Flood Relief Camp (Bharalumukh)",
        "lat": 26.1738,
        "lng": 91.7314,
        "contact": "+91-361-2237003",
        "boats_available": 8,
        "personnel_count": 30
    },
    {
        "id": "sdrf-kamrup-04",
        "name": "SDRF Jalukbari Transit Outpost",
        "lat": 26.1482,
        "lng": 91.6625,
        "contact": "+91-361-2237004",
        "boats_available": 4,
        "personnel_count": 18
    },
    {
        "id": "sdrf-kamrup-05",
        "name": "SDRF Basistha / Khanapara Rapid Action Unit",
        "lat": 26.1150,
        "lng": 91.8020,
        "contact": "+91-361-2237005",
        "boats_available": 5,
        "personnel_count": 20
    }
]


def load_sdrf_staging_units() -> List[Dict[str, Any]]:
    """Loads SDRF staging posts from static JSON with robust fallback."""
    if os.path.exists(CATALOG_PATH):
        try:
            with open(CATALOG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data
        except Exception as e:
            logger.warning(f"Error loading {CATALOG_PATH}: {e}. Using fallback SDRF catalog.")
    return FALLBACK_SDRF_UNITS


def calculate_haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes great-circle distance between two WGS-84 coordinate points in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(R * c, 1)


def find_nearest_sdrf_unit(lat: float, lng: float) -> Dict[str, Any]:
    """Identifies the closest SDRF unit to the citizen's GPS coordinates."""
    units = load_sdrf_staging_units()
    nearest = units[0]
    min_dist = calculate_haversine_distance_meters(lat, lng, nearest["lat"], nearest["lng"])

    for u in units:
        d = calculate_haversine_distance_meters(lat, lng, u["lat"], u["lng"])
        if d < min_dist:
            min_dist = d
            nearest = u

    result = dict(nearest)
    result["distance_meters"] = min_dist
    return result


def send_fast2sms_alert(phone_number: str, alert_text: str) -> str:
    """Dispatches SMS alert via Fast2SMS gateway or logs to console in demo mode."""
    if settings.fast2sms_api_key:
        try:
            import httpx
            resp = httpx.post(
                "https://www.fast2sms.com/dev/bulkV2",
                headers={"authorization": settings.fast2sms_api_key},
                json={
                    "route": "v3",
                    "sender_id": "TXTIND",
                    "message": alert_text,
                    "numbers": phone_number.replace("+", "").replace("-", "")
                },
                timeout=2.0
            )
            if resp.status_code == 200:
                logger.info(f"Fast2SMS live alert successfully sent to {phone_number}")
                return "SENT"
        except Exception as e:
            logger.warning(f"Fast2SMS gateway error: {e}. Falling back to simulated mode.")

    logger.warning(f"[FAST2SMS CONSOLE DISPATCH] Phone: {phone_number} | Payload: {alert_text}")
    return "SIMULATED"


# ==============================================================================
# Citizen SOS Endpoints
# ==============================================================================

@router.post("", response_model=CitizenSosResponse, status_code=status.HTTP_201_CREATED)
async def dispatch_citizen_sos(
    req: CitizenSosRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    One-tap citizen emergency SOS broadcast endpoint.
    1. Captures GPS location
    2. Finds nearest regional SDRF staging post
    3. Calculates rescue ETA
    4. Dispatches SMS alert via Fast2SMS
    5. Immutably records incident in audit_log
    """
    nearest = find_nearest_sdrf_unit(req.lat, req.lng)
    distance_m = nearest["distance_meters"]

    # Calculate realistic urban flood rescue boat transit ETA (5 to 45 mins)
    eta_min = max(5, min(45, round((distance_m / 1000.0) * 4.5 + 4)))

    incident_id = f"sos-ghy-{generate_uuid()[:8]}"
    alert_message = (
        f"ALERT: JAL-SENTINEL SOS at [{req.lat:.4f}, {req.lng:.4f}]. "
        f"Respond immediately. SDRF Unit: {nearest['name']} ({nearest['contact']}). "
        f"ETA: {eta_min} min. Incident: {incident_id}"
    )

    if req.message:
        alert_message += f" | Message: {req.message}"

    sms_status = send_fast2sms_alert(nearest["contact"], alert_message)

    # Record incident into audit_log
    audit_entry = AuditLog(
        id=generate_uuid(),
        action="SOS_DISPATCHED",
        performed_by="CITIZEN_SOS",
        reason=alert_message,
        created_at=utc_now()
    )
    db.add(audit_entry)
    await db.commit()
    await db.refresh(audit_entry)

    logger.info(f"Citizen SOS incident recorded: {incident_id} -> {nearest['name']} ({distance_m}m)")

    return CitizenSosResponse(
        incident_id=incident_id,
        status="DISPATCHED",
        sdrf_unit=SdrfUnitInfo(
            id=nearest["id"],
            name=nearest["name"],
            contact=nearest["contact"],
            lat=nearest["lat"],
            lng=nearest["lng"],
            distance_meters=distance_m,
            boats_available=nearest.get("boats_available"),
            personnel_count=nearest.get("personnel_count")
        ),
        eta_min=eta_min,
        sms_gateway_status=sms_status,
        alert_message=alert_message,
        timestamp=utc_now().isoformat(),
        audit_log_id=audit_entry.id
    )


@router.get("/units", response_model=List[SdrfUnitInfo])
async def list_sdrf_staging_units():
    """Lists all active SDRF regional staging posts in Guwahati."""
    units = load_sdrf_staging_units()
    return [
        SdrfUnitInfo(
            id=u["id"],
            name=u["name"],
            contact=u["contact"],
            lat=u["lat"],
            lng=u["lng"],
            distance_meters=0.0,
            boats_available=u.get("boats_available"),
            personnel_count=u.get("personnel_count")
        )
        for u in units
    ]


@router.get("/nearest", response_model=SdrfUnitInfo)
async def get_nearest_sdrf_unit(
    lat: float = Query(..., description="Query latitude"),
    lng: float = Query(..., description="Query longitude")
):
    """Finds the closest SDRF staging unit to given coordinates without triggering SMS."""
    nearest = find_nearest_sdrf_unit(lat, lng)
    return SdrfUnitInfo(
        id=nearest["id"],
        name=nearest["name"],
        contact=nearest["contact"],
        lat=nearest["lat"],
        lng=nearest["lng"],
        distance_meters=nearest["distance_meters"],
        boats_available=nearest.get("boats_available"),
        personnel_count=nearest.get("personnel_count")
    )
