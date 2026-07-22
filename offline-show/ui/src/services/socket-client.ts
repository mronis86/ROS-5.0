// src/services/socket-client.ts
import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api-client';
import { isCloudReconnecting } from './offline-sync-bridge';

export interface SocketCallbacks {
  onRunOfShowDataUpdated?: (data: any) => void;
  onCompletedCuesUpdated?: (data: any) => void;
  onTimerUpdated?: (data: any) => void;
  onTimerStopped?: (data: any) => void;
  onTimersStopped?: (data: any) => void;
  onTimerStarted?: (data: any) => void;
  onSubCueTimerStarted?: (data: any) => void;
  onSubCueTimerStopped?: (data: any) => void;
  onActiveTimersUpdated?: (data: any) => void;
  onResetAllStates?: (data: any) => void;
  onConnectionChange?: (connected: boolean) => void;
  onInitialSync?: () => Promise<void>;
  onTimerMessageUpdated?: (data: any) => void;
  onOvertimeUpdate?: (data: any) => void;
  onOvertimeReset?: (data: any) => void;
  onShowStartOvertimeUpdate?: (data: any) => void;
  onStartCueSelectionUpdate?: (data: any) => void;
  onShowModeUpdate?: (data: {
    event_id: string;
    showMode?: 'rehearsal' | 'in-show';
    trackWasDurations?: boolean;
  }) => void;
  onPresenceUpdated?: (viewers: {
    userId: string;
    userName: string;
    userEmail: string;
    userRole: string;
  }[]) => void;
  onForceDisconnect?: () => void;
  onServerTime?: (data: any) => void;
  onScheduleUpdated?: (data: any) => void;
  onRowLocked?: (data: { eventId: string; rowId: number; userId: string; userName: string }) => void;
  onRowUnlocked?: (data: { eventId: string; rowId: number }) => void;
  onRowLocksSnapshot?: (data: { eventId: string; locks: { rowId: number; userId: string; userName: string }[] }) => void;
}

type Subscriber = { eventId: string; callbacks: SocketCallbacks };

class SocketClient {
  private socket: Socket | null = null;
  private eventId: string | null = null;
  private subscribers = new Map<number, Subscriber>();
  private nextSubscriberId = 1;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private disconnectedByAdmin = false;

  /** Register for socket updates. Returns unsubscribe — prefer this over disconnect(). */
  connect(eventId: string, callbacks: SocketCallbacks): () => void {
    const id = this.nextSubscriberId++;
    this.subscribers.set(id, { eventId, callbacks });

    this.ensureSocket(eventId);

    return () => {
      this.subscribers.delete(id);
      if (this.subscribers.size === 0) {
        this.teardownSocket();
      }
    };
  }

  /** @deprecated Prefer the unsubscribe function returned by connect(). */
  disconnect(eventId?: string) {
    for (const [id, sub] of this.subscribers) {
      if (!eventId || sub.eventId === eventId) {
        this.subscribers.delete(id);
      }
    }
    if (this.subscribers.size === 0) {
      this.teardownSocket();
    }
  }

  private subscribersForEvent(eventId: string): Subscriber[] {
    return [...this.subscribers.values()].filter((s) => s.eventId === eventId);
  }

  private invoke<K extends keyof SocketCallbacks>(
    eventId: string,
    key: K,
    ...args: Parameters<NonNullable<SocketCallbacks[K]>>
  ) {
    for (const sub of this.subscribersForEvent(eventId)) {
      const fn = sub.callbacks[key] as ((...a: typeof args) => void) | undefined;
      fn?.(...args);
    }
  }

  private ensureSocket(eventId: string) {
    if (this.socket && this.eventId === eventId) {
      if (!this.socket.connected) {
        console.log('Socket.IO: reconnecting existing socket for event:', eventId);
        this.socket.connect();
      } else {
        this.socket.emit('joinEvent', eventId);
      }
      return;
    }

    this.teardownSocket(false);

    this.eventId = eventId;
    const apiBaseUrl = getApiBaseUrl();
    this.socket = io(apiBaseUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
    });

    this.disconnectedByAdmin = false;
    this.attachSocketHandlers(eventId);
  }

  private attachSocketHandlers(eventId: string) {
    if (!this.socket) return;

    this.socket.on('connect', () => {
      console.log(`✅ Socket.IO connected for event: ${eventId}`);
      this.reconnectAttempts = 0;
      this.socket?.emit('joinEvent', eventId);
      this.invoke(eventId, 'onConnectionChange', true);
      void this.performInitialSync(eventId);
    });

    this.socket.on('update', (message: any) => {
      if (isCloudReconnecting()) {
        console.log('⏭️ Ignoring Socket.IO update during cloud reconnect:', message?.type);
        return;
      }
      const activeEventId = this.eventId;
      if (!activeEventId) return;

      console.log('📡 Socket.IO update received:', message.type);

      switch (message.type) {
        case 'runOfShowDataUpdated':
          this.invoke(activeEventId, 'onRunOfShowDataUpdated', message.data);
          break;
        case 'scheduleUpdated':
          this.invoke(activeEventId, 'onScheduleUpdated', message.data);
          break;
        case 'completedCuesUpdated':
          this.invoke(activeEventId, 'onCompletedCuesUpdated', message.data);
          break;
        case 'timerUpdated':
          this.invoke(activeEventId, 'onTimerUpdated', message.data);
          break;
        case 'timerStopped':
          this.invoke(activeEventId, 'onTimerStopped', message.data);
          break;
        case 'timersStopped':
          this.invoke(activeEventId, 'onTimersStopped', message.data);
          break;
        case 'timerStarted':
          this.invoke(activeEventId, 'onTimerStarted', message.data);
          break;
        case 'subCueTimerStarted':
          this.invoke(activeEventId, 'onSubCueTimerStarted', message.data);
          break;
        case 'subCueTimerStopped':
          this.invoke(activeEventId, 'onSubCueTimerStopped', message.data);
          break;
        case 'activeTimersUpdated':
          this.invoke(activeEventId, 'onActiveTimersUpdated', message.data);
          break;
        case 'resetAllStates':
          this.invoke(activeEventId, 'onResetAllStates', message.data);
          break;
        case 'timerMessageUpdated':
          this.invoke(activeEventId, 'onTimerMessageUpdated', message.data);
          break;
        case 'overtimeUpdate':
          this.invoke(activeEventId, 'onOvertimeUpdate', message.data);
          break;
        case 'overtimeReset':
          this.invoke(activeEventId, 'onOvertimeReset', message.data);
          break;
        case 'showStartOvertimeUpdate':
          this.invoke(activeEventId, 'onShowStartOvertimeUpdate', message.data);
          break;
        case 'startCueSelectionUpdate':
          this.invoke(activeEventId, 'onStartCueSelectionUpdate', message.data);
          break;
        case 'showModeUpdate':
          this.invoke(activeEventId, 'onShowModeUpdate', message.data);
          break;
        case 'presenceUpdated':
          this.invoke(activeEventId, 'onPresenceUpdated', message.data || []);
          break;
        case 'rowLocked':
          this.invoke(activeEventId, 'onRowLocked', message.data);
          break;
        case 'rowUnlocked':
          this.invoke(activeEventId, 'onRowUnlocked', message.data);
          break;
        case 'rowLocksSnapshot':
          this.invoke(activeEventId, 'onRowLocksSnapshot', message.data);
          break;
        default:
          console.log('Unknown Socket.IO message type:', message.type, message);
      }
    });

    this.socket.on('serverTime', (data: any) => {
      const activeEventId = this.eventId;
      if (activeEventId) this.invoke(activeEventId, 'onServerTime', data);
    });

    this.socket.on('forceDisconnect', (data: { reason?: string }) => {
      console.log('🔌 Socket: Force disconnect by admin', data);
      this.disconnectedByAdmin = true;
      const activeEventId = this.eventId;
      if (activeEventId) this.invoke(activeEventId, 'onForceDisconnect');
      this.teardownSocket();
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`❌ Socket.IO disconnected: ${reason}`);
      const activeEventId = this.eventId;
      if (activeEventId) this.invoke(activeEventId, 'onConnectionChange', false);

      if (this.disconnectedByAdmin || this.subscribers.size === 0) return;

      if (reason !== 'io client disconnect' && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(
          `🔄 Attempting to reconnect Socket.IO (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );
        setTimeout(() => {
          if (this.eventId && this.subscribers.size > 0) {
            this.ensureSocket(this.eventId);
          }
        }, 2000 * this.reconnectAttempts);
      }
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket.IO connection error:', error);
      const activeEventId = this.eventId;
      if (activeEventId) this.invoke(activeEventId, 'onConnectionChange', false);
    });
  }

  private teardownSocket(notify = true) {
    if (!this.socket) return;

    const prevEventId = this.eventId;
    console.log(`🔌 Disconnecting Socket.IO for event: ${prevEventId}`);

    if (prevEventId) {
      this.socket.emit('leaveEvent', prevEventId);
    }

    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.eventId = null;

    if (notify && prevEventId) {
      this.invoke(prevEventId, 'onConnectionChange', false);
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getEventId(): string | null {
    return this.eventId;
  }

  emitResetAllStates() {
    if (this.socket && this.eventId) {
      this.socket.emit('resetAllStates', { eventId: this.eventId });
    }
  }

  emitSyncRequest() {
    if (this.socket && this.eventId) {
      this.socket.emit('requestSync', { eventId: this.eventId });
    }
  }

  emitForceClockSync(): boolean {
    if (!this.socket?.connected || !this.eventId) return false;
    this.socket.emit('forceClockSync', { eventId: this.eventId });
    return true;
  }

  emitContentReviewSelectionUpdate(itemId: number, userId: string, userName: string) {
    if (this.socket && this.eventId) {
      this.socket.emit('contentReviewSelectionUpdate', {
        eventId: this.eventId,
        itemId,
        userId,
        userName,
      });
    }
  }

  emitContentReviewRequestState() {
    if (this.socket && this.eventId) {
      this.socket.emit('contentReviewRequestState', { eventId: this.eventId });
    }
  }

  /** Claim (or refresh) a schedule row edit lock for collaborative editing. */
  emitRowEditStart(rowId: number, userId: string, userName: string) {
    if (this.socket && this.eventId && rowId != null && userId) {
      console.log(`🔒 emitRowEditStart row=${rowId} user=${userName} → ${this.eventId}`);
      this.socket.emit('rowEditStart', {
        eventId: this.eventId,
        rowId,
        userId,
        userName: userName || '',
      });
    } else {
      console.warn('🔒 emitRowEditStart skipped (socket not ready)', {
        hasSocket: !!this.socket,
        connected: this.socket?.connected,
        eventId: this.eventId,
        rowId,
        userId,
      });
    }
  }

  /** Release a schedule row edit lock. */
  emitRowEditEnd(rowId: number, userId: string) {
    if (this.socket && this.eventId && rowId != null) {
      console.log(`🔒 emitRowEditEnd row=${rowId}`);
      this.socket.emit('rowEditEnd', {
        eventId: this.eventId,
        rowId,
        userId,
      });
    }
  }

  /** Request current row locks for this event (after reconnect). */
  emitRowLocksRequest() {
    if (this.socket && this.eventId) {
      this.socket.emit('rowLocksRequest', { eventId: this.eventId });
    }
  }

  sendPresence(
    eventId: string,
    user: { userId: string; userName: string; userEmail: string; userRole: string }
  ) {
    if (this.socket && eventId) {
      this.socket.emit('presenceJoin', {
        eventId: String(eventId),
        userId: user.userId,
        userName: user.userName || '',
        userEmail: user.userEmail || '',
        userRole: user.userRole || 'VIEWER',
      });
    }
  }

  emitScriptScroll(scrollPosition: number, lineNumber: number, fontSize: number) {
    if (this.socket && this.eventId) {
      this.socket.emit('scriptScrollUpdate', {
        eventId: this.eventId,
        scrollPosition,
        lineNumber,
        fontSize,
      });
    }
  }

  emitScriptComment(action: 'add' | 'edit' | 'delete', comment?: any, commentId?: string) {
    if (this.socket && this.eventId) {
      this.socket.emit('scriptCommentUpdate', {
        eventId: this.eventId,
        action,
        comment,
        commentId,
      });
    }
  }

  getSocket() {
    return this.socket;
  }

  private async performInitialSync(eventId: string) {
    if (isCloudReconnecting()) return;

    const syncs = this.subscribersForEvent(eventId)
      .map((s) => s.callbacks.onInitialSync?.())
      .filter(Boolean);

    if (syncs.length === 0) return;

    try {
      await Promise.all(syncs);
    } catch (error) {
      console.error('❌ Initial sync failed:', error);
    }
  }
}

export const socketClient = new SocketClient();

let systemSocket: Socket | null = null;

function getSystemSocket(): Socket {
  if (!systemSocket) {
    systemSocket = io(getApiBaseUrl(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
    });
  }
  return systemSocket;
}

export type CloudModePayload = {
  mode: 'lan-only' | 'cloud-connected';
  lanOnly: boolean;
  cloudConnected: boolean;
  updatedAt: string | null;
  updatedBy?: string | null;
  sync?: { calendarEvents: number; runOfShow: number };
};

export function onCloudModeChange(handler: (payload: CloudModePayload) => void): () => void {
  const s = getSystemSocket();
  const listener = (payload: CloudModePayload) => handler(payload);
  s.on('cloudMode', listener);
  return () => {
    s.off('cloudMode', listener);
  };
}
