import { io, Socket } from 'socket.io-client';
import { getApiBaseUrl } from './api-client';
import type { GuestActiveTimer, GuestEventPayload } from '../lib/eventGuestLinks';

export interface GuestSocketCallbacks {
  onInitialSync?: (payload: GuestEventPayload) => void;
  onJoinError?: (error: string, needsMigration?: boolean) => void;
  onTimerUpdated?: (timer: GuestActiveTimer | null) => void;
  onScheduleUpdated?: (data: {
    scheduleItems: GuestEventPayload['scheduleItems'];
    masterStartTime?: string;
    dayStartTimes?: Record<number | string, string>;
    numberOfDays?: number;
  }) => void;
  onIndentedCuesUpdated?: (data: {
    cleared?: boolean;
    removed?: boolean;
    itemId?: number | string;
    indented?: boolean;
    count?: number;
  }) => void;
  onResetAllStates?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

function timerFromSocket(data: unknown): GuestActiveTimer | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as Record<string, unknown>;
  const itemId = row.itemId ?? row.item_id;
  if (itemId == null) return null;
  const startedAt = row.startedAt ?? row.started_at;
  return {
    itemId: itemId as number | string,
    timerState: (row.timerState ?? row.timer_state) as string | undefined,
    isActive: !!(row.isActive ?? row.is_active),
    isRunning: !!(row.isRunning ?? row.is_running),
    durationSeconds: (row.durationSeconds ?? row.duration_seconds) as number | undefined,
    elapsedSeconds: Number(row.elapsedSeconds ?? row.elapsed_seconds) || 0,
    cueIs: String(row.cueIs ?? row.cue_is ?? ''),
    startedAt:
      startedAt instanceof Date
        ? startedAt.toISOString()
        : startedAt
          ? String(startedAt)
          : null,
  };
}

class GuestSocketClient {
  private socket: Socket | null = null;
  private token: string | null = null;
  private callbacks: GuestSocketCallbacks = {};

  connect(token: string, callbacks: GuestSocketCallbacks) {
    const trimmed = token.trim();
    if (!trimmed) return;

    if (this.socket && this.token === trimmed) {
      this.callbacks = { ...this.callbacks, ...callbacks };
      if (!this.socket.connected) {
        this.socket.connect();
      } else {
        this.socket.emit('joinGuestEvent', trimmed);
      }
      return;
    }

    this.disconnect();
    this.token = trimmed;
    this.callbacks = callbacks;

    const apiBaseUrl = getApiBaseUrl();
    this.socket = io(apiBaseUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.callbacks.onConnectionChange?.(true);
      this.socket?.emit('joinGuestEvent', trimmed);
    });

    this.socket.on('disconnect', () => {
      this.callbacks.onConnectionChange?.(false);
    });

    this.socket.on('guestInitialSync', (payload: GuestEventPayload) => {
      if (payload?.ok) {
        this.callbacks.onInitialSync?.(payload);
      }
    });

    this.socket.on('guestJoinError', (data: { error?: string; needsMigration?: boolean }) => {
      this.callbacks.onJoinError?.(data?.error || 'Invalid guest link.', data?.needsMigration);
    });

    this.socket.on('update', (message: { type?: string; data?: unknown }) => {
      switch (message.type) {
        case 'timerUpdated':
          this.callbacks.onTimerUpdated?.(timerFromSocket(message.data));
          break;
        case 'timerStopped':
          this.callbacks.onTimerUpdated?.(timerFromSocket(message.data));
          break;
        case 'timersStopped':
          this.callbacks.onTimerUpdated?.(null);
          break;
        case 'runOfShowDataUpdated':
          if (message.data && typeof message.data === 'object') {
            const d = message.data as Record<string, unknown>;
            this.callbacks.onScheduleUpdated?.({
              scheduleItems: (d.scheduleItems as GuestEventPayload['scheduleItems']) || [],
              masterStartTime: d.masterStartTime as string | undefined,
              dayStartTimes: d.dayStartTimes as Record<number | string, string> | undefined,
              numberOfDays: d.numberOfDays as number | undefined,
            });
          }
          break;
        case 'indentedCuesUpdated':
          if (message.data && typeof message.data === 'object') {
            this.callbacks.onIndentedCuesUpdated?.(
              message.data as {
                cleared?: boolean;
                removed?: boolean;
                itemId?: number | string;
                indented?: boolean;
                count?: number;
              }
            );
          }
          break;
        case 'resetAllStates':
          this.callbacks.onResetAllStates?.();
          this.callbacks.onTimerUpdated?.(null);
          break;
        default:
          break;
      }
    });
  }

  disconnect() {
    if (this.socket) {
      if (this.token) {
        this.socket.emit('leaveGuestEvent');
      }
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.token = null;
    this.callbacks = {};
  }

  isConnected(): boolean {
    return !!this.socket?.connected;
  }
}

export const guestSocketClient = new GuestSocketClient();
