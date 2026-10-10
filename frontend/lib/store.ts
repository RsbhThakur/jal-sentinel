/**
 * JAL-SENTINEL Global Telemetry State Store (Zustand)
 * Manages real-time flood polygons, optical waterline depth metrics,
 * active hazard pin telemetry, and dynamic evacuation corridors.
 */
import { create } from 'zustand';

export interface FloodPolygonFeature {
  type: string;
  id: string;
  properties: {
    zone_name: string;
    depth_cm: number;
    surge_velocity_mm_min: number;
    manning_roughness: number;
    clearance_blocked: boolean;
    horizon: string;
    predicted_at?: string;
  };
  geometry: {
    type: string;
    coordinates: number[][][];
  };
}

export interface FloodGeoJson {
  type: string;
  horizon: string;
  timestamp: string;
  features: FloodPolygonFeature[];
}

export interface DepthTelemetry {
  depth_cm: number;
  dhdt_mm_min: number;
  status: string;
  camera_id: string;
  location: string;
  temporal_weight?: number;
}

import type { HazardPinData, HazardClass } from '../components/HazardPin';
export type { HazardPinData, HazardClass };

export type TelemetryMessageType = 'flood' | 'depth' | 'hazard' | 'route' | 'ping';

export interface TelemetryMessage<T = unknown> {
  type: TelemetryMessageType;
  payload: T;
  timestamp: string;
}

export interface TelemetryState {
  connected: boolean;
  horizon: 'T+0' | 'T+15' | 'T+30' | 'T+60';
  floodData: FloodGeoJson | null;
  depthData: DepthTelemetry;
  hazards: HazardPinData[];
  routeData: any | null;
  lastMessageTimestamp: string | null;

  setConnected: (connected: boolean) => void;
  setHorizon: (horizon: 'T+0' | 'T+15' | 'T+30' | 'T+60') => void;
  setFloodData: (data: FloodGeoJson) => void;
  setDepthData: (data: DepthTelemetry) => void;
  setHazards: (hazards: HazardPinData[]) => void;
  setRouteData: (data: any) => void;
  dispatchMessage: (message: TelemetryMessage) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  connected: false,
  horizon: 'T+15',
  floodData: null,
  depthData: {
    depth_cm: 18.2,
    dhdt_mm_min: 2.4,
    status: 'SURGING',
    camera_id: 'CAM-GHY-04',
    location: 'GS Road Christian Basti'
  },
  hazards: [],
  routeData: null,
  lastMessageTimestamp: null,

  setConnected: (connected) => set({ connected }),
  setHorizon: (horizon) => set({ horizon }),
  setFloodData: (floodData) => set({ floodData, connected: true }),
  setDepthData: (depthData) => set({ depthData, connected: true }),
  setHazards: (hazards) => set({ hazards }),
  setRouteData: (routeData) => set({ routeData }),

  dispatchMessage: (msg: TelemetryMessage) => {
    set((state) => {
      const updates: Partial<TelemetryState> = {
        lastMessageTimestamp: msg.timestamp || new Date().toISOString()
      };

      if (msg.type === 'ping') {
        const p = msg.payload as { connected?: boolean } | undefined;
        updates.connected = p?.connected !== undefined ? Boolean(p.connected) : true;
      } else if (msg.type === 'flood') {
        updates.floodData = msg.payload as FloodGeoJson;
        updates.connected = true;
      } else if (msg.type === 'depth') {
        updates.depthData = msg.payload as DepthTelemetry;
        updates.connected = true;
      } else if (msg.type === 'hazard') {
        if (Array.isArray(msg.payload)) {
          updates.hazards = msg.payload as HazardPinData[];
        } else if (msg.payload && typeof msg.payload === 'object' && 'features' in (msg.payload as any)) {
          const features = (msg.payload as any).features;
          updates.hazards = features.map((f: any) => ({
            id: f.id || f.properties?.id,
            hazard_class: (f.properties?.hazard_class as HazardClass) || 'manhole',
            lat: f.geometry?.coordinates?.[1],
            lng: f.geometry?.coordinates?.[0],
            confidence_score: f.properties?.confidence_score,
            h3_hex_id: f.properties?.h3_hex_id,
            submerged: f.properties?.submerged,
            depth_cm: f.properties?.depth_cm,
            notes: f.properties?.notes
          }));
        }
        updates.connected = true;
      } else if (msg.type === 'route') {
        updates.routeData = msg.payload;
        updates.connected = true;
      }

      return updates;
    });
  }
}));
