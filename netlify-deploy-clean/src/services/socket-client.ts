// src/services/socket-client.ts
import { io, Socket } from 'socket.io-client';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.PROD 
    ? 'https://ros-50-production.up.railway.app'  // Your Railway URL
    : 'http://localhost:3001');

// Log the API URL for debugging
console.log('🔗 Socket API Base URL:', API_BASE_URL);

interface SocketCallbacks {
  onRunOfShowDataUpdated?: (data: any) => void;
  onCompletedCuesUpdated?: (data: any) => void;
  onTimerUpdated?: (data: any) => void;
  onTimerStopped?: (data: any) => void;
  onTimersStopped?: (data: any) => void;
  onTimerStarted?: (data: any) => void;
  onSubCueTimerStarted?: (data: any) => void;
  onSubCueTimerStopped?: (data: any) => void; // NEW!
  onActiveTimersUpdated?: (data: any) => void; // NEW!
  onResetAllStates?: (data: any) => void; // NEW! For reset events
  onConnectionChange?: (connected: boolean) => void;
  onInitialSync?: () => Promise<void>; // NEW! For initial sync on connect
  onTimerMessageUpdated?: (data: any) => void; // NEW! For ClockPage messages
}

class SocketClient {
  private socket: Socket | null = null;
  private eventId: string | null = null;
  private callbacks: SocketCallbacks = {};
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  connect(eventId: string, callbacks: SocketCallbacks) {
    if (this.socket && this.eventId === eventId) {
      console.log('Socket.IO already connected for this event.');
      return;
    }

    this.disconnect(); // Disconnect any existing connection

    this.eventId = eventId;
    this.callbacks = callbacks;
    
    this.socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      console.log(`✅ Socket.IO connected for event: ${eventId}`);
      this.reconnectAttempts = 0;
      this.callbacks.onConnectionChange?.(true);
      
      // Join the event room
      this.socket?.emit('joinEvent', eventId);
      
      // CRITICAL: Immediately sync current state on connect/reconnect
      this.performInitialSync(eventId);
    });

    this.socket.on('update', (message: any) => {
      console.log('📡 Socket.IO update received:', message.type);
      
      switch (message.type) {
        case 'runOfShowDataUpdated':
          this.callbacks.onRunOfShowDataUpdated?.(message.data);
          break;
        case 'completedCuesUpdated':
          this.callbacks.onCompletedCuesUpdated?.(message.data);
          break;
        case 'timerUpdated':
          console.log('📡 SocketClient: Received timerUpdated event:', message.data);
          this.callbacks.onTimerUpdated?.(message.data);
          break;
        case 'timerStopped':
          this.callbacks.onTimerStopped?.(message.data);
          break;
        case 'timersStopped':
          this.callbacks.onTimersStopped?.(message.data);
          break;
        case 'timerStarted':
          this.callbacks.onTimerStarted?.(message.data);
          break;
        case 'subCueTimerStarted':
          this.callbacks.onSubCueTimerStarted?.(message.data);
          break;
        case 'subCueTimerStopped':
          this.callbacks.onSubCueTimerStopped?.(message.data);
          break;
        case 'activeTimersUpdated': // NEW!
          console.log('📡 SocketClient: Received activeTimersUpdated event:', message.data);
          this.callbacks.onActiveTimersUpdated?.(message.data);
          break;
        case 'resetAllStates': // NEW!
          this.callbacks.onResetAllStates?.(message.data);
          break;
        case 'timerMessageUpdated': // NEW! For ClockPage messages
          console.log('📡 SocketClient: Received timerMessageUpdated event:', message.data);
          this.callbacks.onTimerMessageUpdated?.(message.data);
          break;
        default:
          console.log('Unknown Socket.IO message type:', message.type, message);
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`❌ Socket.IO disconnected: ${reason}`);
      this.callbacks.onConnectionChange?.(false);
      
      // Attempt to reconnect if it wasn't intentional
      if (reason !== 'io client disconnect' && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`🔄 Attempting to reconnect Socket.IO (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(() => {
          if (this.eventId) {
            this.connect(this.eventId, this.callbacks);
          }
        }, 2000 * this.reconnectAttempts);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket.IO connection error:', error);
      this.callbacks.onConnectionChange?.(false);
    });
  }

  disconnect(eventId?: string) {
    if (this.socket) {
      if (eventId && this.eventId !== eventId) {
        console.log(`Socket.IO: Not disconnecting, current eventId (${this.eventId}) does not match requested eventId (${eventId}).`);
        return;
      }
      
      console.log(`🔌 Disconnecting Socket.IO for event: ${this.eventId}`);
      
      if (this.eventId) {
        this.socket.emit('leaveEvent', this.eventId);
      }
      
      this.socket.disconnect();
      this.socket = null;
      this.eventId = null;
      this.callbacks.onConnectionChange?.(false);
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getEventId(): string | null {
    return this.eventId;
  }

  // Emit reset all states event
  emitResetAllStates() {
    if (this.socket && this.eventId) {
      console.log('📡 Emitting reset all states event');
      this.socket.emit('resetAllStates', { eventId: this.eventId });
    }
  }

  emitSyncRequest() {
    if (this.socket && this.eventId) {
      console.log('📡 Emitting sync request event');
      this.socket.emit('requestSync', { eventId: this.eventId });
    }
  }

  /**
   * Perform initial sync when WebSocket connects
   * This ensures we get current state when reconnecting or joining mid-timer
   */
  private async performInitialSync(eventId: string) {
    try {
      console.log('🔄 Performing initial sync on WebSocket connect...');
      
      // Call the initial sync callback if provided
      if (this.callbacks.onInitialSync) {
        await this.callbacks.onInitialSync();
        console.log('✅ Initial sync completed via callback');
      } else {
        console.log('⚠️ No initial sync callback provided');
      }
    } catch (error) {
      console.error('❌ Initial sync failed:', error);
    }
  }
}

export const socketClient = new SocketClient();
