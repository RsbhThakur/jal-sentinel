/**
 * JAL-SENTINEL WebSocket Telemetry Client & React Hook (Issue #9)
 * Manages low-latency real-time telemetry connections with auto-reconnect backoff
 * and dispatches all stream events into the Zustand global store.
 */
import { useEffect, useCallback, useRef } from 'react';
import {
  useTelemetryStore,
  TelemetryMessage,
  TelemetryMessageType,
  FloodGeoJson,
  FloodPolygonFeature,
  DepthTelemetry,
  HazardPinData
} from './store';

export type {
  TelemetryMessage,
  TelemetryMessageType,
  FloodGeoJson,
  FloodPolygonFeature,
  DepthTelemetry,
  HazardPinData
};
export { useTelemetryStore };

export type MessageHandler = (message: TelemetryMessage) => void;

export class TelemetryWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private baseDelayMs = 1000;
  private shouldReconnect = true;
  private reconnectTimer: NodeJS.Timeout | null = null;

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
        useTelemetryStore.getState().setConnected(true);
        const pingNotice: TelemetryMessage = {
          type: 'ping',
          payload: { connected: true },
          timestamp: new Date().toISOString()
        };
        this.handlers.forEach((h) => h(pingNotice));
      };

      this.ws.onmessage = (event) => {
        try {
          const data: TelemetryMessage = JSON.parse(event.data);

          // If ping packet received, send pong to update server activity timestamp
          if (data.type === 'ping') {
            this.send({ type: 'pong', timestamp: new Date().toISOString() });
          }

          // Dispatch to Zustand global store
          useTelemetryStore.getState().dispatchMessage(data);

          // Dispatch to external subscribers
          this.handlers.forEach((handler) => handler(data));
        } catch (err) {
          console.warn('[WS] Failed to parse telemetry packet:', err);
        }
      };

      this.ws.onclose = () => {
        console.warn('[WS] Telemetry socket disconnected');
        useTelemetryStore.getState().setConnected(false);
        const disconnectNotice: TelemetryMessage = {
          type: 'ping',
          payload: { connected: false },
          timestamp: new Date().toISOString()
        };
        this.handlers.forEach((h) => h(disconnectNotice));
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    useTelemetryStore.getState().setConnected(false);
  }

  public scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts exceeded.');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.reconnectAttempts),
      30000
    );
    this.reconnectAttempts++;
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  public getReconnectDelayForAttempt(attempt: number): number {
    return Math.min(this.baseDelayMs * Math.pow(2, attempt), 30000);
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

/**
 * Custom React Hook useFloodTelemetry()
 * Subscribes to real-time flood polygons, depth gauges, and hazard events
 * backed by the Zustand global store.
 */
export function useFloodTelemetry() {
  const connected = useTelemetryStore((s) => s.connected);
  const horizon = useTelemetryStore((s) => s.horizon);
  const floodData = useTelemetryStore((s) => s.floodData);
  const depthData = useTelemetryStore((s) => s.depthData);
  const hazards = useTelemetryStore((s) => s.hazards);
  const routeData = useTelemetryStore((s) => s.routeData);

  const clientRef = useRef<TelemetryWebSocketClient | null>(null);

  useEffect(() => {
    const client = getSharedTelemetryClient();
    clientRef.current = client;
  }, []);

  const setHorizon = useCallback((newHorizon: 'T+0' | 'T+15' | 'T+30' | 'T+60') => {
    useTelemetryStore.getState().setHorizon(newHorizon);
    if (clientRef.current) {
      clientRef.current.send({ action: 'set_horizon', horizon: newHorizon });
    }
  }, []);

  return {
    connected,
    horizon,
    floodData,
    depthData,
    hazards,
    routeData,
    setHorizon
  };
}
