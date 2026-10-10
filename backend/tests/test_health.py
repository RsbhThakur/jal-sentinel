import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_root_index(client: AsyncClient):
    """Verify root index endpoint returns operational service metadata."""
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "JAL-SENTINEL API"
    assert data["status"] == "operational"
    assert data["docs"] == "/docs"
    assert data["health"] == "/api/health"


@pytest.mark.asyncio
async def test_system_health(client: AsyncClient):
    """Verify health endpoint verifies database state and returns compliant schema."""
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert "timestamp" in data
    assert data["services"]["database"] is True
