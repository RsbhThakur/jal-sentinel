from datetime import datetime, timezone
from fastapi import APIRouter, status
from backend.config import settings
from backend.database import check_db_health
from backend.models.schemas import HealthResponse

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse, status_code=status.HTTP_200_OK)
async def get_system_health():
    """System health check endpoint verifying database connectivity."""
    db_ok = await check_db_health()
    
    return HealthResponse(
        status="ok" if db_ok else "degraded",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.environment,
        timestamp=datetime.now(timezone.utc),
        database="connected" if db_ok else "disconnected",
        services={
            "database": db_ok,
            "version": settings.app_version
        }
    )

