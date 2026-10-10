/**
 * JAL-SENTINEL Frontend API Client Library
 * Provides typed fetchers and REST helpers for all backend endpoints.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
  timestamp: string;
  database: string;
  services: {
    database: boolean;
    version: string;
  };
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ApiError(response.status, `API Error [${response.status}] ${url}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return apiClient<HealthResponse>('/api/health');
}

export async function fetchRootStatus(): Promise<Record<string, unknown>> {
  return apiClient<Record<string, unknown>>('/');
}


export interface EvacuationRouteRequest {
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  vehicle_class: 'walker' | 'scooty' | 'sedan' | 'suv';
}

export interface EvacuationRouteResponse {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    vehicle_class: string;
    clearance_threshold_cm: number;
    distance_meters: number;
    estimated_minutes: number;
    submerged_hazards_avoided?: number;
    clearance_status: string;
    cached?: boolean;
    origin_hex?: string;
    dest_hex?: string;
    nodes_count?: number;
  };
}

export async function fetchEvacuationRoute(
  payload: EvacuationRouteRequest
): Promise<EvacuationRouteResponse> {
  return apiClient<EvacuationRouteResponse>('/api/route', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ==============================================================================
// Flood Inundation Prediction Types and API Calls (Issue #3)
// ==============================================================================

export interface FloodPredictionResponse {
  type: 'FeatureCollection';
  horizon: string;
  timestamp: string;
  features: Array<{
    type: 'Feature';
    id: string;
    geometry: {
      type: 'Polygon';
      coordinates: [number, number][][];
    };
    properties: {
      zone_name: string;
      depth_cm: number;
      surge_velocity_mm_min: number;
      manning_roughness: number;
      clearance_blocked: boolean;
      horizon: string;
      predicted_at?: string;
    };
  }>;
}

export async function fetchFloodPrediction(
  horizonMinutes: number | string = 15,
  recompute: boolean = false
): Promise<FloodPredictionResponse> {
  const t = String(horizonMinutes).replace('T+', '');
  return apiClient<FloodPredictionResponse>(`/api/flood/prediction?t=${t}&recompute=${recompute}`);
}

// ==============================================================================
// Citizen Video Upload API (Issue #12)
// ==============================================================================

export interface VideoUploadSubmissionResponse {
  id: string;
  filename: string;
  lat: number;
  lng: number;
  h3_hex_id: string;
  recorded_at: string;
  status: string;
  created_at: string;
  description?: string;
}

export async function uploadCitizenVideoFile(formData: FormData): Promise<VideoUploadSubmissionResponse> {
  const url = `${API_BASE_URL}/api/video/upload`;
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ApiError(response.status, `Upload Error [${response.status}]: ${errorBody}`);
  }

  return response.json() as Promise<VideoUploadSubmissionResponse>;
}

// ==============================================================================
// Admin Gate & Kanban Work-Order Types and API Calls (Issue #8)
// ==============================================================================

export interface VideoUploadItem {
  id: string;
  filename: string;
  lat: number;
  lng: number;
  h3_hex_id: string;
  recorded_at: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  description?: string;
  created_at: string;
}

export interface RepairTicketItem {
  id: string;
  h3_hex_id: string;
  hazard_class: string;
  status: 'REQUIRED' | 'DOING' | 'DONE_CANDIDATE' | 'DONE' | 'ESCALATED';
  urgency: number; // 1: Low, 2: Medium, 3: Critical
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  admin_notes?: string;
}

export interface AuditLogItem {
  id: string;
  ticket_id?: string;
  hazard_event_id?: string;
  action: string;
  confidence_at_action?: number;
  upload_timestamp?: string;
  performed_by: string;
  reason?: string;
  created_at: string;
}

const DEFAULT_ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'sentinel_admin_secret_token_2026';

export async function fetchAdminUploads(status?: string, token: string = DEFAULT_ADMIN_TOKEN): Promise<VideoUploadItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient<VideoUploadItem[]>(`/api/admin/uploads${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function approveUpload(uploadId: string, token: string = DEFAULT_ADMIN_TOKEN): Promise<Record<string, unknown>> {
  return apiClient<Record<string, unknown>>(`/api/admin/uploads/${uploadId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function rejectUpload(uploadId: string, reason?: string, token: string = DEFAULT_ADMIN_TOKEN): Promise<Record<string, unknown>> {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  return apiClient<Record<string, unknown>>(`/api/admin/uploads/${uploadId}/reject${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function fetchAdminTickets(status?: string, token: string = DEFAULT_ADMIN_TOKEN): Promise<RepairTicketItem[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiClient<RepairTicketItem[]>(`/api/admin/tickets${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function updateAdminTicket(
  ticketId: string,
  update: { status?: string; urgency?: number; admin_notes?: string },
  token: string = DEFAULT_ADMIN_TOKEN
): Promise<RepairTicketItem> {
  return apiClient<RepairTicketItem>(`/api/admin/tickets/${ticketId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(update)
  });
}

export async function fetchAdminAuditLogs(limit: number = 20, token: string = DEFAULT_ADMIN_TOKEN): Promise<AuditLogItem[]> {
  return apiClient<AuditLogItem[]>(`/api/admin/audit-logs?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

export async function fetchPublicOpenTickets(): Promise<{
  total_open: number;
  critical_urgency_count: number;
  by_status: Record<string, number>;
  by_hazard_class: Record<string, number>;
  tickets: RepairTicketItem[];
}> {
  return apiClient('/api/tickets/open');
}

