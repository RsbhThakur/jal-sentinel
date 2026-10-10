"""
Automated Test Suite for Citizen Emergency SOS Flow & SDRF SMS Dispatch (Issue #11).
Validates Acceptance Criteria:
1. POST /api/sos returns nearest SDRF staging unit info within 3 s
2. Fast2SMS dispatch (or console fallback in demo mode) with correct location
3. Incident immutably recorded into audit_log with action='SOS_DISPATCHED'
4. GET /api/sos/units lists all 5 Guwahati regional posts
5. Nearest SDRF unit calculation accuracy across Guwahati coordinates
"""
import time
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.models.entities import AuditLog


@pytest.mark.asyncio
async def test_citizen_sos_dispatch_creates_audit_log_and_finds_nearest_sdrf(client: AsyncClient, db_session: AsyncSession):
    """
    Acceptance Criteria:
    - POST /api/sos returns SDRF unit info within 3 s
    - SMS sent (or console-logged) with correct location string
    - Incident recorded in audit_log with action='SOS_DISPATCHED'
    """
    t0 = time.perf_counter()
    resp = await client.post(
        "/api/sos",
        json={
            "lat": 26.1448,
            "lng": 91.7365,
            "message": "Water rising above car hood near Christian Basti",
            "citizen_phone": "+91-9864012345"
        }
    )
    t_elapsed = time.perf_counter() - t0

    assert resp.status_code == 201, f"Expected 201 Created, got {resp.status_code}: {resp.text}"
    assert t_elapsed < 3.0, f"SOS response latency exceeded 3s budget: {t_elapsed:.3f}s"

    data = resp.json()
    assert data["status"] == "DISPATCHED"
    assert data["incident_id"].startswith("sos-ghy-")
    assert "sdrf_unit" in data
    assert data["sdrf_unit"]["id"] in ["sdrf-kamrup-01", "sdrf-kamrup-02", "sdrf-kamrup-03"]
    assert "SDRF" in data["sdrf_unit"]["name"]
    assert data["sdrf_unit"]["contact"].startswith("+91")
    assert data["eta_min"] > 0
    assert data["sms_gateway_status"] in ["SIMULATED", "SENT"]
    assert "ALERT: JAL-SENTINEL SOS" in data["alert_message"]

    # Verify incident recorded in audit_log
    audit_id = data.get("audit_log_id")
    assert audit_id is not None

    stmt = select(AuditLog).where(AuditLog.id == audit_id)
    result = await db_session.execute(stmt)
    audit_record = result.scalar_one_or_none()

    assert audit_record is not None, "Incident must be recorded in audit_log"
    assert audit_record.action == "SOS_DISPATCHED"
    assert audit_record.performed_by == "CITIZEN_SOS"
    assert "ALERT: JAL-SENTINEL SOS" in audit_record.reason
    assert "26.1448" in audit_record.reason


@pytest.mark.asyncio
async def test_list_sdrf_units_returns_5_guwahati_posts(client: AsyncClient):
    """Verify GET /api/sos/units returns the 5 regional SDRF posts in Guwahati."""
    resp = await client.get("/api/sos/units")
    assert resp.status_code == 200
    units = resp.json()

    assert isinstance(units, list)
    assert len(units) >= 5, "Expected at least 5 SDRF staging units"

    unit_ids = [u["id"] for u in units]
    assert "sdrf-kamrup-01" in unit_ids  # Paltan Bazaar
    assert "sdrf-kamrup-02" in unit_ids  # Dispur
    assert "sdrf-kamrup-03" in unit_ids  # Bharalu
    assert "sdrf-kamrup-04" in unit_ids  # Jalukbari
    assert "sdrf-kamrup-05" in unit_ids  # Basistha


@pytest.mark.asyncio
async def test_get_nearest_sdrf_unit_spatial_accuracy(client: AsyncClient):
    """Verify nearest unit calculation matches coordinates closest to Jalukbari outpost."""
    # Near Jalukbari Flyover (26.1482, 91.6625)
    resp = await client.get("/api/sos/nearest?lat=26.1485&lng=91.6630")
    assert resp.status_code == 200
    unit = resp.json()

    assert unit["id"] == "sdrf-kamrup-04"
    assert "Jalukbari" in unit["name"]
    assert unit["distance_meters"] < 500  # under 500 meters away


@pytest.mark.asyncio
async def test_invalid_sos_coordinates_rejected(client: AsyncClient):
    """Verify out-of-range coordinates are rejected with HTTP 422 Unprocessable Entity."""
    resp = await client.post(
        "/api/sos",
        json={"lat": 105.0, "lng": 91.7365}
    )
    assert resp.status_code == 422
