from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


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
