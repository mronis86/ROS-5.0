// src/services/socket-client.ts
import { io, Socket } from 'socket.io-client';

const API_BASE_URL = process.env.VITE_API_BASE_URL || 
  (process.env.NODE_ENV === 'production' 
    ? 'https://your-app.railway.app'  // Replace with your Railway URL
    : 'http://localhost:3001');

interface SocketCallbacks {
  onRunOfShowDataUpdated?: (data: any) => void;
  onCompletedCuesUpdated?: (data: any) => void;
  onTimerUpdated?: (data: any) => void;
  onTimerStopped?: (data: any) => void;
  onTimersStopped?: (data: any) => void;
  onTimerStarted?: (data: any) => void;
  onConnectionChange?: (connected: boolean) => void;
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
}

export const socketClient = new SocketClient();
