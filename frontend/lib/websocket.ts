/**
 * JAL-SENTINEL WebSocket Telemetry Client
 * Manages low-latency real-time telemetry connections with auto-reconnect backoff.
 */

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
