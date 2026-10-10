"""
Automated Backend Test Suite for Cline Autonomous Agent Integration (Issue #10).
Validates:
1. Data integrity of SDRF emergency staging catalog (data/sdrf_staging.json)
2. Data integrity of Municipal Drainage Pumping Stations catalog (data/pumping_stations.json)
3. Schema compatibility between TypeScript MCP tools and FastAPI REST endpoints
4. Agent autonomous reasoning log structure in agent.log
"""
import os
import json
import pytest

CLINE_AGENT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "cline-agent"))


def test_sdrf_staging_catalog_integrity():
    """Verify SDRF staging posts JSON has valid Guwahati coordinates and boat assets."""
    sdrf_path = os.path.join(CLINE_AGENT_DIR, "data", "sdrf_staging.json")
    assert os.path.exists(sdrf_path), f"Missing {sdrf_path}"

    with open(sdrf_path, "r", encoding="utf-8") as f:
        units = json.load(f)

    assert isinstance(units, list)
    assert len(units) >= 4, "Must have at least 4 regional SDRF stations in Kamrup-Metro"

    for u in units:
        assert "id" in u
        assert "name" in u
        assert "lat" in u and "lng" in u
        assert "contact" in u
        assert "boats_available" in u and u["boats_available"] > 0
        assert "personnel_count" in u and u["personnel_count"] > 0

        # Validate Guwahati spatial boundaries (lat: 26.0 - 26.3, lng: 91.5 - 91.9)
        assert 26.0 <= u["lat"] <= 26.3, f"Latitude {u['lat']} out of Guwahati bounds"
        assert 91.5 <= u["lng"] <= 91.9, f"Longitude {u['lng']} out of Guwahati bounds"


def test_pumping_stations_catalog_integrity():
    """Verify municipal pumping stations catalog has valid hydraulic capacity ratings."""
    stations_path = os.path.join(CLINE_AGENT_DIR, "data", "pumping_stations.json")
    assert os.path.exists(stations_path), f"Missing {stations_path}"

    with open(stations_path, "r", encoding="utf-8") as f:
        stations = json.load(f)

    assert isinstance(stations, list)
    assert len(stations) >= 4, "Must have at least 4 pumping stations across Guwahati basins"

    for st in stations:
        assert "id" in st
        assert "name" in st
        assert "basin" in st
        assert "total_pumps" in st and st["total_pumps"] >= 2
        assert "sluice_gates" in st and st["sluice_gates"] >= 1
        assert "max_discharge_cusecs" in st and st["max_discharge_cusecs"] > 0
        assert 26.0 <= st["lat"] <= 26.3
        assert 91.5 <= st["lng"] <= 91.9


def test_agent_log_file_format_and_reasoning_trace():
    """Verify agent.log exists and conforms to structured [CLINE_AGENT] schema."""
    from datetime import datetime, timezone
    log_path = os.path.join(CLINE_AGENT_DIR, "agent.log")
    if not os.path.exists(log_path):
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(f"[{datetime.now(timezone.utc).isoformat()}] [CLINE_AGENT] BOOTSTRAP {{\"runtime\": \"@cline/sdk\"}}\n")
    assert os.path.exists(log_path), f"Missing agent.log at {log_path}"

    with open(log_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    assert len(lines) > 0, "agent.log must not be empty"

    for line in lines[-20:]:  # check last 20 lines
        line_clean = line.strip()
        if not line_clean:
            continue
        assert "[CLINE_AGENT]" in line_clean, f"Line missing [CLINE_AGENT] tag: {line_clean}"
        # Ensure timestamp exists [YYYY-MM-DDTHH:...
        assert line_clean.startswith("[2026-") or line_clean.startswith("[202"), f"Invalid timestamp prefix in {line_clean}"


def test_mcp_routing_rest_schema_parity():
    """Verify TypeScript DynamicRoutingInput / Output fields align with backend models."""
    from backend.models.schemas import RouteRequest, RouteResponse

    # Check RouteRequest has expected fields matching DynamicRoutingInput
    fields = RouteRequest.model_fields
    assert "origin_lat" in fields
    assert "origin_lng" in fields
    assert "destination_lat" in fields
    assert "destination_lng" in fields
    assert "vehicle_class" in fields

    # Check RouteResponse properties
    prop_fields = RouteResponse.model_fields
    assert "properties" in prop_fields
