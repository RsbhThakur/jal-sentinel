-- =============================================================================
-- JAL-SENTINEL: Core Geospatial & Hazard Lifecycle Database Schema
-- Compatible with PostgreSQL 15+ / PostGIS and SQLite fallback for local test
-- =============================================================================

-- Enable UUID extension if running in PostgreSQL
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. Video Uploads Table (Crowd-sourced & CCTV Ingestion Queue)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS video_uploads (
    id              VARCHAR(36) PRIMARY KEY,
    filename        VARCHAR(255) NOT NULL,
    lat             DOUBLE PRECISION NOT NULL,
    lng             DOUBLE PRECISION NOT NULL,
    h3_hex_id       VARCHAR(20) NOT NULL,
    recorded_at     TIMESTAMP WITH TIME ZONE NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
    description     TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_video_uploads_h3 ON video_uploads(h3_hex_id);
CREATE INDEX IF NOT EXISTS idx_video_uploads_status ON video_uploads(status);

-- -----------------------------------------------------------------------------
-- 2. Hazard Events Ledger (Active & Historical Hazard Pins)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hazard_events (
    id                  VARCHAR(36) PRIMARY KEY,
    h3_hex_id           VARCHAR(20) NOT NULL,
    hazard_class        VARCHAR(50) NOT NULL, -- manhole, pothole, live_wire, debris, vehicle
    confidence_score    DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    false_positive_flag BOOLEAN NOT NULL DEFAULT FALSE,
    lat                 DOUBLE PRECISION NOT NULL,
    lng                 DOUBLE PRECISION NOT NULL,
    first_detected_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hazard_events_h3 ON hazard_events(h3_hex_id);
CREATE INDEX IF NOT EXISTS idx_hazard_events_class ON hazard_events(hazard_class);

-- -----------------------------------------------------------------------------
-- 3. Municipal Repair Tickets (Kanban Lifecycle Engine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repair_tickets (
    id              VARCHAR(36) PRIMARY KEY,
    h3_hex_id       VARCHAR(20) NOT NULL,
    hazard_class    VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'REQUIRED', -- REQUIRED, DOING, DONE_CANDIDATE, DONE, ESCALATED
    urgency         SMALLINT NOT NULL DEFAULT 2,             -- 1=Low, 2=Medium, 3=Critical
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at     TIMESTAMP WITH TIME ZONE,
    admin_notes     TEXT
);

CREATE INDEX IF NOT EXISTS idx_repair_tickets_h3 ON repair_tickets(h3_hex_id);
CREATE INDEX IF NOT EXISTS idx_repair_tickets_status ON repair_tickets(status);

-- -----------------------------------------------------------------------------
-- 4. Immutable Audit Log (Temporal State Transitions & Admin Actions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id                      VARCHAR(36) PRIMARY KEY,
    ticket_id               VARCHAR(36),
    hazard_event_id         VARCHAR(36),
    action                  VARCHAR(50) NOT NULL, -- ESCALATED, AUTO_CLOSED, DONE_CANDIDATE, FALSE_POSITIVE, APPROVED, REJECTED
    confidence_at_action    DOUBLE PRECISION,
    upload_timestamp        TIMESTAMP WITH TIME ZONE,
    performed_by            VARCHAR(60) NOT NULL DEFAULT 'system',
    reason                  TEXT,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES repair_tickets(id) ON DELETE SET NULL,
    FOREIGN KEY (hazard_event_id) REFERENCES hazard_events(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ticket ON audit_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_hazard ON audit_log(hazard_event_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
