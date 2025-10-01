// Server-Sent Events client for real-time updates
const API_BASE_URL = import.meta.env.PROD 
  ? 'https://ros-50-production.up.railway.app'  // Your Railway URL
  : 'http://localhost:3001';

interface SSEEvent {
  type: string;
  eventId: string;
  data?: any;
  timestamp: string;
}

interface SSECallbacks {
  onRunOfShowDataUpdated?: (data: any) => void;
  onCompletedCuesUpdated?: (data: any) => void;
  onTimerUpdated?: (data: any) => void;
  onConnectionChange?: (connected: boolean) => void;
}

class SSEClient {
  private connections: Map<string, EventSource> = new Map();
  private callbacks: Map<string, SSECallbacks> = new Map();

  connect(eventId: string, callbacks: SSECallbacks): void {
    // Disconnect existing connection if any
    this.disconnect(eventId);

    const url = `${API_BASE_URL}/api/events/${eventId}/stream`;
    console.log(`🔌 Connecting to SSE for event: ${eventId}`);

    const eventSource = new EventSource(url);
    
    // Store connection and callbacks
    this.connections.set(eventId, eventSource);
    this.callbacks.set(eventId, callbacks);

    eventSource.onopen = () => {
      console.log(`✅ SSE connected for event: ${eventId}`);
      callbacks.onConnectionChange?.(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const sseEvent: SSEEvent = JSON.parse(event.data);
        console.log(`📡 SSE event received for ${eventId}:`, sseEvent.type);

        switch (sseEvent.type) {
          case 'connected':
            console.log(`🔌 SSE connection established for event: ${eventId}`);
            break;
          case 'heartbeat':
            // Just keep connection alive
            break;
          case 'runOfShowDataUpdated':
            callbacks.onRunOfShowDataUpdated?.(sseEvent.data);
            break;
          case 'completedCuesUpdated':
            callbacks.onCompletedCuesUpdated?.(sseEvent.data);
            break;
          case 'timerUpdated':
            callbacks.onTimerUpdated?.(sseEvent.data);
            break;
          default:
            console.log(`📡 Unknown SSE event type: ${sseEvent.type}`);
        }
      } catch (error) {
        console.error('Error parsing SSE event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error(`❌ SSE error for event ${eventId}:`, error);
      callbacks.onConnectionChange?.(false);
      
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (this.connections.has(eventId)) {
          console.log(`🔄 Attempting to reconnect SSE for event: ${eventId}`);
          this.connect(eventId, callbacks);
        }
      }, 5000);
    };
  }

  disconnect(eventId: string): void {
    const connection = this.connections.get(eventId);
    if (connection) {
      console.log(`🔌 Disconnecting SSE for event: ${eventId}`);
      connection.close();
      this.connections.delete(eventId);
      this.callbacks.delete(eventId);
    }
  }

  disconnectAll(): void {
    console.log('🔌 Disconnecting all SSE connections');
    for (const eventId of this.connections.keys()) {
      this.disconnect(eventId);
    }
  }

  isConnected(eventId: string): boolean {
    const connection = this.connections.get(eventId);
    return connection ? connection.readyState === EventSource.OPEN : false;
  }
}

// Export singleton instance
export const sseClient = new SSEClient();
