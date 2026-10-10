/**
 * JAL-SENTINEL WebSocket Telemetry Client & React Hook
 * Manages low-latency real-time telemetry connections with auto-reconnect backoff.
 */
import { useEffect, useState, useCallback, useRef } from 'react';

export type TelemetryMessageType = 'flood' | 'depth' | 'hazard' | 'route' | 'ping';

export interface TelemetryMessage<T = unknown> {
  type: TelemetryMessageType;
  payload: T;
  timestamp: string;
}

export type MessageHandler = (message: TelemetryMessage) => void;

export class TelemetryWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseDelayMs = 1000;
  private shouldReconnect = true;

  constructor(url?: string) {
    this.url = url || (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/telemetry');
  }

  public connect(): void {
    if (typeof window === 'undefined') return;
    this.shouldReconnect = true;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WS] Connected to JAL-SENTINEL telemetry stream');
        this.reconnectAttempts = 0;
        this.handlers.forEach((h) => h({ type: 'ping', payload: { connected: true }, timestamp: new Date().toISOString() }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data: TelemetryMessage = JSON.parse(event.data);
          this.handlers.forEach((handler) => handler(data));
        } catch (err) {
          console.warn('[WS] Failed to parse telemetry packet:', err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[WS] Telemetry socket disconnected');
        this.handlers.forEach((h) => h({ type: 'ping', payload: { connected: false }, timestamp: new Date().toISOString() }));
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Telemetry socket error:', err);
        this.ws?.close();
      };
    } catch (err) {
      console.error('[WS] Connection exception:', err);
      this.scheduleReconnect();
    }
  }

  public send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  public subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts exceeded.');
      return;
    }

    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    setTimeout(() => this.connect(), delay);
  }
}

// Global Singleton for React Client
let sharedClient: TelemetryWebSocketClient | null = null;

export function getSharedTelemetryClient(): TelemetryWebSocketClient {
  if (!sharedClient) {
    sharedClient = new TelemetryWebSocketClient();
    sharedClient.connect();
  }
  return sharedClient;
}

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
}

export function useFloodTelemetry() {
  const [connected, setConnected] = useState<boolean>(false);
  const [horizon, setHorizonState] = useState<'T+0' | 'T+15' | 'T+30' | 'T+60'>('T+15');
  const [floodData, setFloodData] = useState<FloodGeoJson | null>(null);
  const [depthData, setDepthData] = useState<DepthTelemetry>({
    depth_cm: 18.2,
    dhdt_mm_min: 2.4,
    status: 'SURGING',
    camera_id: 'CAM-GHY-04',
    location: 'GS Road Christian Basti'
  });

  const clientRef = useRef<TelemetryWebSocketClient | null>(null);

  useEffect(() => {
    const client = getSharedTelemetryClient();
    clientRef.current = client;

    const unsubscribe = client.subscribe((msg) => {
      if (msg.type === 'ping') {
        const payload = msg.payload as { connected: boolean };
        setConnected(Boolean(payload.connected));
      } else if (msg.type === 'flood') {
        setFloodData(msg.payload as FloodGeoJson);
        setConnected(true);
      } else if (msg.type === 'depth') {
        setDepthData(msg.payload as DepthTelemetry);
        setConnected(true);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const setHorizon = useCallback((newHorizon: 'T+0' | 'T+15' | 'T+30' | 'T+60') => {
    setHorizonState(newHorizon);
    if (clientRef.current) {
      clientRef.current.send({ action: 'set_horizon', horizon: newHorizon });
    }
  }, []);

  return {
    connected,
    horizon,
    floodData,
    depthData,
    setHorizon
  };
}
