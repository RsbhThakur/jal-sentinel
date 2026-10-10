import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.config import settings
from backend.database import init_db
from backend.routers import health, hazards, ws, video, routing, flood, admin, tickets, sos
from backend.cache import close_redis_client

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("jal_sentinel.app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager: initialize database tables and resources on startup."""
    logger.info(f"Starting {settings.app_name} v{settings.app_version} [{settings.environment}]")
    try:
        await init_db()
    except Exception as e:
        logger.warning(f"Database initialization deferred or failed: {e}")
    try:
        ws.start_broadcaster()
    except Exception as e:
        logger.warning(f"WebSocket telemetry broadcaster startup deferred: {e}")
    yield
    try:
        await ws.stop_broadcaster()
    except Exception as e:
        logger.debug(f"Broadcaster shutdown cleanup: {e}")
    try:
        await close_redis_client()
    except Exception as e:
        logger.debug(f"Redis shutdown cleanup: {e}")
    logger.info("Shutting down JAL-SENTINEL backend...")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Autonomous Gauge-Free Optical Drainage Inundation & Dynamic Evacuation Corridor Engine API",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Cross-Origin Resource Sharing (CORS) Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register route modules
app.include_router(health.router)
app.include_router(hazards.router)
app.include_router(ws.router)
app.include_router(video.router)
app.include_router(routing.router)
app.include_router(flood.router)
app.include_router(admin.router)
app.include_router(tickets.router)
app.include_router(sos.router)

# Mount static media directories for uploaded and sample demo videos
UPLOAD_DIR = os.path.join(os.getcwd(), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

SAMPLE_VIDEOS_DIR = os.path.join(os.getcwd(), "sample_videos")
if os.path.exists(SAMPLE_VIDEOS_DIR):
    app.mount("/sample_videos", StaticFiles(directory=SAMPLE_VIDEOS_DIR), name="sample_videos")



@app.get("/", tags=["root"])
async def root_index():
    """Root entrypoint describing service metadata and OpenAPI documentation links."""
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "status": "operational",
        "docs": "/docs",
        "health": "/api/health"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
