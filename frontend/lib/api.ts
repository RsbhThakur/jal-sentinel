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

