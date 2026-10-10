from datetime import datetime, timezone
from typing import Optional, List, Any, Union, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator


class HealthResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    status: str
    app: str
    version: str
    environment: str
    timestamp: datetime
    database: str
    services: dict = Field(default_factory=dict)


class VideoUploadBase(BaseModel):
    lat: float
    lng: float
    h3_hex_id: str
    recorded_at: datetime
    description: Optional[str] = None


class VideoUploadCreate(VideoUploadBase):
    filename: str


class VideoUploadResponse(VideoUploadBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    status: str
    created_at: datetime


class HazardEventBase(BaseModel):
    h3_hex_id: str
    hazard_class: str
    lat: float
    lng: float
    confidence_score: float = 1.0
    false_positive_flag: bool = False


class HazardEventCreate(HazardEventBase):
    pass


class HazardEventResponse(HazardEventBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    first_detected_at: datetime
    last_seen_at: datetime


class RepairTicketBase(BaseModel):
    h3_hex_id: str
    hazard_class: str
    urgency: int = 2
    admin_notes: Optional[str] = None


class RepairTicketCreate(RepairTicketBase):
    pass


class RepairTicketUpdate(BaseModel):
    status: Optional[str] = None
    urgency: Optional[int] = None
    admin_notes: Optional[str] = None


class RepairTicketResponse(RepairTicketBase):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    ticket_id: Optional[str] = None
    hazard_event_id: Optional[str] = None
    action: str
    confidence_at_action: Optional[float] = None
    upload_timestamp: Optional[datetime] = None
    performed_by: str
    reason: Optional[str] = None
    created_at: datetime



# ==============================================================================
# Dynamic Evacuation Routing Schemas (Sprint 1: Issue #3)
# ==============================================================================

class RouteRequest(BaseModel):
    """Payload for evacuation route queries."""
    origin_lat: float = Field(..., description="Origin latitude in WGS-84 decimal degrees", ge=-90.0, le=90.0)
    origin_lng: float = Field(..., description="Origin longitude in WGS-84 decimal degrees", ge=-180.0, le=180.0)
    destination_lat: float = Field(..., description="Destination latitude in WGS-84 decimal degrees", ge=-90.0, le=90.0)
    destination_lng: float = Field(..., description="Destination longitude in WGS-84 decimal degrees", ge=-180.0, le=180.0)
    vehicle_class: str = Field(default="sedan", description="Vehicle type: walker, scooty, sedan, or suv")
    timestamp: Optional[datetime] = Field(default=None, description="Query timestamp; defaults to UTC now")


class RouteGeometry(BaseModel):
    type: str = "LineString"
    coordinates: List[List[float]] = Field(..., description="List of [lng, lat] coordinate pairs")


class RouteProperties(BaseModel):
    vehicle_class: str
    distance_meters: float
    estimated_minutes: float
    submerged_hazards_avoided: int
    clearance_threshold_cm: float
    max_flood_depth_encountered_cm: float
    clearance_status: str
    nodes_count: int
    cached: bool = False
    origin_hex: str
    dest_hex: str


class RouteResponse(BaseModel):
    """GeoJSON Feature representation of computed evacuation corridor."""
    type: str = "Feature"
    geometry: RouteGeometry
    properties: RouteProperties



# ==============================================================================
# Inundation & Hydraulic Modeling Schemas (Sprint 2: Issue #6)
# ==============================================================================

class FloodPolygonGeometry(BaseModel):
    type: str = "Polygon"
    coordinates: List[List[List[float]]] = Field(..., description="Polygon boundary coordinate rings [ [ [lng, lat], ... ] ]")


class FloodPolygonProperties(BaseModel):
    zone_name: str
    depth_cm: float
    surge_velocity_mm_min: float
    manning_roughness: float
    clearance_blocked: bool
    horizon: str
    predicted_at: Optional[str] = None


class FloodPolygonFeature(BaseModel):
    type: str = "Feature"
    id: str
    properties: FloodPolygonProperties
    geometry: FloodPolygonGeometry


class FloodPredictionResponse(BaseModel):
    """GeoJSON FeatureCollection representing predicted inundation boundaries."""
    type: str = "FeatureCollection"
    horizon: str
    timestamp: str
    features: List[FloodPolygonFeature]


# ==============================================================================
# WebSocket Telemetry Broadcaster Schemas (Sprint 5: Issue #9)
# ==============================================================================

class DepthTelemetryPayload(BaseModel):
    """Real-time optical depth gauge measurement packet."""
    camera_id: str
    depth_cm: float
    dhdt_mm_min: float
    status: str
    location: Optional[str] = None
    temporal_weight: Optional[float] = None
    recorded_at: Optional[str] = None


class TelemetryMessage(BaseModel):
    """
    Unified real-time streaming telemetry message format pushed over
    ws://localhost:8000/ws/telemetry.
    """
    model_config = ConfigDict(extra="ignore")

    type: str = Field(
        ...,
        description="Packet category: 'flood', 'depth', 'hazard', 'route', or 'ping'"
    )
    payload: Any = Field(
        default_factory=dict,
        description="Arbitrary typed telemetry payload (GeoJSON, Gauge metrics, or system status)"
    )
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO-8601 UTC timestamp of packet emission"
    )

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        allowed = {"flood", "depth", "hazard", "route", "ping"}
        if v not in allowed:
            raise ValueError(f"Invalid telemetry message type '{v}'. Allowed types: {sorted(allowed)}")
        return v


class WebSocketClientAction(BaseModel):
    """Client request packet sent to /ws/telemetry."""
    action: Optional[str] = None
    type: Optional[str] = None
    horizon: Optional[str] = None
    camera_id: Optional[str] = None

