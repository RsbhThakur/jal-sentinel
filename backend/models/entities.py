from datetime import datetime, timezone
import uuid
from sqlalchemy import (
    Column,
    String,
    Float,
    Boolean,
    SmallInteger,
    Text,
    DateTime,
    ForeignKey
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


def generate_uuid() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class VideoUpload(Base):
    __tablename__ = "video_uploads"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    filename = Column(String(255), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    h3_hex_id = Column(String(20), nullable=False, index=True)
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(20), nullable=False, default="PENDING", index=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)


class HazardEvent(Base):
    __tablename__ = "hazard_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    h3_hex_id = Column(String(20), nullable=False, index=True)
    hazard_class = Column(String(50), nullable=False, index=True)
    confidence_score = Column(Float, nullable=False, default=1.0)
    false_positive_flag = Column(Boolean, nullable=False, default=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    first_detected_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    last_seen_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

    audit_logs = relationship("AuditLog", back_populates="hazard_event")


class RepairTicket(Base):
    __tablename__ = "repair_tickets"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    h3_hex_id = Column(String(20), nullable=False, index=True)
    hazard_class = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="REQUIRED", index=True)
    urgency = Column(SmallInteger, nullable=False, default=2)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    admin_notes = Column(Text, nullable=True)

    audit_logs = relationship("AuditLog", back_populates="ticket")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    ticket_id = Column(String(36), ForeignKey("repair_tickets.id"), nullable=True, index=True)
    hazard_event_id = Column(String(36), ForeignKey("hazard_events.id"), nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)
    confidence_at_action = Column(Float, nullable=True)
    upload_timestamp = Column(DateTime(timezone=True), nullable=True)
    performed_by = Column(String(60), nullable=False, default="system")
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utc_now)

    ticket = relationship("RepairTicket", back_populates="audit_logs")
    hazard_event = relationship("HazardEvent", back_populates="audit_logs")
