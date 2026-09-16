import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, getApiBaseUrl } from '../services/api-client';
import { apiJsonHeaders, getApiAccessToken } from '../lib/sessionAuth';
import { socketClient } from '../services/socket-client';
import { resolveQuickModeEventId } from '../lib/quickModeEvent';
import {
  fetchQmOperatorLinkStatus,
  fetchQmOperatorSession,
  formatQmExpiry,
  qmLinkIsActive,
  updateQmOperatorLink,
  type QmOperatorLinkStatus,
} from '../lib/quickModeOperatorLink';

type QuickTimer = {
  id: number;
  title: string;
  cue: string;
  durationMs: number;
  remainingMs: number;
  isRunning: boolean;
  startedAtMs: number | null;
};

const STORAGE_KEY_PREFIX = 'ros.quickMode.timers.';

const clampDurationMs = (value: number) => Math.max(1000, Math.min(value, 24 * 60 * 60 * 1000));

const formatTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const nowRemainingMs = (timer: QuickTimer, nowMs: number) => {
  if (!timer.isRunning || !timer.startedAtMs) return timer.remainingMs;
  return Math.max(0, timer.remainingMs - (nowMs - timer.startedAtMs));
};

const createQuickCalendarEvent = async (): Promise<string> => {
  const data = await apiClient.createCalendarEvent({
    name: `Quick Mode ${new Date().toLocaleDateString()}`,
    date: new Date().toISOString().slice(0, 10),
    schedule_data: { quickMode: true, source: 'quick-mode' }
  });
  if (!data?.id) throw new Error('Calendar event created without an ID');
  return String(data.id);
};

const toScheduleItem = (timer: QuickTimer) => {
  const totalSeconds = Math.max(1, Math.floor(timer.durationMs / 1000));
  return {
    id: timer.id,
    day: 1,
    programType: 'No Transition',
    shotType: '',
    segmentName: timer.title,
    durationHours: Math.floor(totalSeconds / 3600),
    durationMinutes: Math.floor((totalSeconds % 3600) / 60),
    durationSeconds: totalSeconds % 60,
    notes: '',
    assets: '',
    speakersText: '',
    hasPPT: false,
    hasQA: false,
    customFields: { cue: timer.cue }
  };
};

type TimerUiState = 'READY' | 'LOADED' | 'RUNNING' | 'DONE';
const timerState = (timer: QuickTimer, nowMs: number, loadedTimerId: number | null): TimerUiState => {
  if (timer.isRunning) return 'RUNNING';
  if (nowRemainingMs(timer, nowMs) <= 0) return 'DONE';
  if (loadedTimerId === timer.id) return 'LOADED';
  return 'READY';
};

const QuickModePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [eventId, setEventId] = useState('');
  const [eventIdError, setEventIdError] = useState('');
  const [timers, setTimers] = useState<QuickTimer[]>([]);
  const [selectedTimerId, setSelectedTimerId] = useState<number | null>(null);
  const [loadedTimerId, setLoadedTimerId] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [minutesDraft, setMinutesDraft] = useState('5');
  const [secondsDraft, setSecondsDraft] = useState('0');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [isCompanionSyncing, setIsCompanionSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [operatorToken, setOperatorToken] = useState<string | null>(null);
  const [publicLinkExpired, setPublicLinkExpired] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState('');
  const [publicExpiresAt, setPublicExpiresAt] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<QmOperatorLinkStatus | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMessage, setLinkMessage] = useState('');
  const [showLinkPanel, setShowLinkPanel] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const clockWindowRef = useRef<Window | null>(null);
  const resolvedForUrlRef = useRef<string | null>(null);
  const publicBootstrappedRef = useRef<string | null>(null);
  /** Ignore remote timer echoes briefly after local START/STOP/RESET (stop-all races). */
  const localControlUntilRef = useRef(0);
  /** After reset, refuse server rows that would re-apply running/partial remaining. */
  const resetGuardUntilRef = useRef(0);

  const markLocalControl = (ms = 2000) => {
    localControlUntilRef.current = Date.now() + ms;
  };

  const ignoreRemoteTimerSync = () => Date.now() < localControlUntilRef.current;

  const markResetGuard = (ms = 5000) => {
    resetGuardUntilRef.current = Date.now() + ms;
    markLocalControl(ms);
  };

  const inResetGuard = () => Date.now() < resetGuardUntilRef.current;

  const eventIdParam = searchParams.get('eventId') ?? '';
  const forceNewSession = searchParams.get('new') === '1';
  const opParam = searchParams.get('op') ?? '';
  const isPublicOperator = Boolean(operatorToken);
  const isSignedIn = Boolean(getApiAccessToken());

  const storageKey = useMemo(() => (eventId ? `${STORAGE_KEY_PREFIX}${eventId}` : ''), [eventId]);

  const qmJsonHeaders = useCallback((): Record<string, string> => {
    if (operatorToken) {
      return { 'Content-Type': 'application/json', Authorization: `Bearer ${operatorToken}` };
    }
    return apiJsonHeaders();
  }, [operatorToken]);

  useEffect(() => {
    if (!opParam) {
      setOperatorToken(null);
      setPublicLinkExpired(false);
      setPublicLinkError('');
      setPublicExpiresAt(null);
      publicBootstrappedRef.current = null;
      return;
    }

    if (publicBootstrappedRef.current === opParam && operatorToken === opParam) return;

    let cancelled = false;
    (async () => {
      try {
        const { status, data } = await fetchQmOperatorSession(opParam);
        if (cancelled) return;
        if (status === 410 || data.expired) {
          setPublicLinkExpired(true);
          setPublicLinkError(data.error || 'This public operator link has expired.');
          setPublicExpiresAt(data.expiresAt || null);
          setOperatorToken(null);
          if (data.eventId) setEventId(String(data.eventId));
          publicBootstrappedRef.current = opParam;
          return;
        }
        if (!data.ok || !data.eventId) {
          setPublicLinkExpired(false);
          setPublicLinkError(data.error || 'Invalid public operator link.');
          setOperatorToken(null);
          publicBootstrappedRef.current = opParam;
          return;
        }
        setPublicLinkExpired(false);
        setPublicLinkError('');
        setPublicExpiresAt(data.expiresAt || null);
        setOperatorToken(data.token || opParam);
        resolvedForUrlRef.current = data.eventId;
        publicBootstrappedRef.current = opParam;
        setEventId(data.eventId);
        setEventIdError('');
        setSearchParams((prev) => {
          const p = new URLSearchParams(prev);
          p.set('eventId', data.eventId);
          p.set('op', opParam);
          p.delete('new');
          return p;
        }, { replace: true });
        if (Array.isArray(data.timers) && data.timers.length > 0) {
          const key = `${STORAGE_KEY_PREFIX}${data.eventId}`;
          const hasLocal = (() => {
            try {
              const raw = localStorage.getItem(key);
              if (!raw) return false;
              const parsed = JSON.parse(raw);
              return Array.isArray(parsed) && parsed.length > 0;
            } catch {
              return false;
            }
          })();
          if (!hasLocal) {
            setTimers(
              data.timers.map((t) => ({
                id: Number(t.id),
                title: t.title || `Timer ${t.id}`,
                cue: t.cue || `CUE ${t.id}`,
                durationMs: clampDurationMs(Number(t.durationMs) || 60_000),
                remainingMs: Math.max(0, Number(t.remainingMs) || Number(t.durationMs) || 60_000),
                isRunning: false,
                startedAtMs: null,
              }))
            );
          }
        }
      } catch (err) {
        if (cancelled) return;
        setPublicLinkError(err instanceof Error ? err.message : 'Failed to open public operator link');
        setOperatorToken(null);
        publicBootstrappedRef.current = opParam;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opParam, operatorToken, setSearchParams]);

  useEffect(() => {
    if (opParam) return;

    // Skip re-resolve when this mount just updated the URL with the new event id
    if (!forceNewSession && eventIdParam && resolvedForUrlRef.current === eventIdParam) {
      setEventId((prev) => (prev === eventIdParam ? prev : eventIdParam));
      setEventIdError('');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const id = await resolveQuickModeEventId(eventIdParam, createQuickCalendarEvent, {
          forceNew: forceNewSession,
          verifyEventId: async (candidateId) => {
            try {
              await apiClient.getCalendarEvent(candidateId);
              return true;
            } catch {
              return false;
            }
          }
        });
        if (cancelled) return;
        resolvedForUrlRef.current = id;
        setSearchParams((prev) => {
          const p = new URLSearchParams(prev);
          if (p.get('eventId') === id && !p.has('new')) return prev;
          p.set('eventId', id);
          p.delete('new');
          return p;
        }, { replace: true });
        setEventId((prev) => (prev === id ? prev : id));
        setEventIdError('');
      } catch (err) {
        if (cancelled) return;
        setEventIdError(err instanceof Error ? err.message : 'Failed to create Quick Mode session');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [eventIdParam, forceNewSession, opParam, setSearchParams]);

  const refreshLinkStatus = useCallback(async () => {
    if (!eventId || !isSignedIn || isPublicOperator) {
      setLinkStatus(null);
      return;
    }
    const status = await fetchQmOperatorLinkStatus(eventId);
    setLinkStatus(status);
  }, [eventId, isSignedIn, isPublicOperator]);

  useEffect(() => {
    void refreshLinkStatus();
  }, [refreshLinkStatus]);

  useEffect(() => {
    if (!publicExpiresAt || !operatorToken) return;
    const tick = () => {
      if (Date.parse(publicExpiresAt) <= Date.now()) {
        setPublicLinkExpired(true);
        setPublicLinkError('This public operator link has expired.');
        setOperatorToken(null);
      }
    };
    tick();
    const id = window.setInterval(tick, 10_000);
    return () => window.clearInterval(id);
  }, [publicExpiresAt, operatorToken]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as QuickTimer[];
      if (!Array.isArray(parsed)) return;
      const hydrated = parsed
        .filter((t) => t && Number.isFinite(Number(t.id)))
        .map((t) => ({
          id: Number(t.id),
          title: typeof t.title === 'string' && t.title.trim() ? t.title : 'Quick Timer',
          cue: typeof t.cue === 'string' && t.cue.trim() ? t.cue : `CUE ${Number(t.id)}`,
          durationMs: clampDurationMs(Number(t.durationMs) || 5 * 60 * 1000),
          remainingMs: Math.max(0, Number(t.remainingMs) || 5 * 60 * 1000),
          isRunning: false,
          startedAtMs: null
        }));
      setTimers(hydrated);
      setSelectedTimerId((prev) => (prev != null && hydrated.some((t) => t.id === prev) ? prev : hydrated[0]?.id ?? null));
    } catch {
      // ignore invalid localStorage data
    }
  }, [storageKey]);

  useEffect(() => {
    setSelectedTimerId((prev) => (prev != null && timers.some((t) => t.id === prev) ? prev : timers[0]?.id ?? null));
  }, [timers]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const snapshot = timers.map((t) => ({
        ...t,
        remainingMs: nowRemainingMs(t, Date.now()),
        isRunning: false,
        startedAtMs: null
      }));
      localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // ignore
    }
  }, [timers, storageKey]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    const syncSchedule = async () => {
      try {
        setIsCompanionSyncing(true);
        const payload = {
          event_id: eventId,
          event_name: `Quick Mode ${eventId}`,
          event_date: new Date().toISOString().slice(0, 10),
          schedule_items: timers.map(toScheduleItem),
          custom_columns: [],
          settings: { quickMode: true, source: 'quick-mode' },
          last_modified_by: 'quick-mode',
          last_modified_by_name: 'Quick Mode',
          last_modified_by_role: 'OPERATOR'
        };
        const res = await fetch(`${getApiBaseUrl()}/api/run-of-show-data`, {
          method: 'POST',
          headers: qmJsonHeaders(),
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) setSyncMessage('Synced to Railway (clock + Companion)');
      } catch {
        if (!cancelled) setSyncMessage('Local only (API unavailable)');
      } finally {
        if (!cancelled) setIsCompanionSyncing(false);
      }
    };
    const id = window.setTimeout(syncSchedule, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [eventId, timers, qmJsonHeaders]);

  const applyServerTimerRow = (data: Record<string, unknown>) => {
    if (ignoreRemoteTimerSync() || inResetGuard()) return;
    const itemId = Number(data.item_id);
    if (!Number.isFinite(itemId)) return;
    const serverDurationMs = Math.max(1000, Number(data.duration_seconds || 60) * 1000);
    const running = data.is_running === true;
    const loaded = data.timer_state === 'loaded' || (data.is_active === true && !running);
    const startedAtMs = running && data.started_at ? new Date(String(data.started_at)).getTime() : null;
    const now = Date.now();
    setTimers((prev) => {
      const exists = prev.some((t) => t.id === itemId);
      if (!exists) {
        const nextRemaining = running
          ? Math.max(0, serverDurationMs - (now - (startedAtMs || now)))
          : serverDurationMs;
        return [
          ...prev,
          {
            id: itemId,
            title: String(data.cue_is || `Timer ${itemId}`).replace(/^CUE\s*/i, 'Timer '),
            cue: String(data.cue_is || `CUE ${itemId}`),
            durationMs: serverDurationMs,
            remainingMs: nextRemaining,
            isRunning: running,
            startedAtMs
          }
        ];
      }
      return prev.map((t) => {
        if (t.id !== itemId) return running ? { ...t, isRunning: false, startedAtMs: null } : t;
        // Keep programmed durationMs — server duration_seconds is often "remaining from started_at"
        // after live nudges, and must not overwrite the cue length used by Reset.
        const nextRemaining = running
          ? Math.max(0, serverDurationMs - (now - (startedAtMs || now)))
          : loaded
            ? t.durationMs
            : t.remainingMs;
        return {
          ...t,
          remainingMs: nextRemaining,
          isRunning: running,
          startedAtMs: running ? startedAtMs : null
        };
      });
    });
    if (running || loaded) setLoadedTimerId(itemId);
    if (data.timer_state === 'stopped' || data.is_active === false) {
      setLoadedTimerId((prev) => (prev === itemId ? null : prev));
    }
  };

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    const hydrateFromApi = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/api/active-timers/${eventId}`, {
          headers: qmJsonHeaders(),
        });
        if (!res.ok || cancelled) return;
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (row && row.is_active !== false && row.timer_state !== 'stopped') {
          applyServerTimerRow(row);
        }
      } catch {
        // local timers still work
      }
    };

    hydrateFromApi();

    const callbacks = {
      onTimerUpdated: (data: Record<string, unknown>) => applyServerTimerRow(data),
      onActiveTimersUpdated: (data: unknown) => {
        if (ignoreRemoteTimerSync() || inResetGuard()) return;
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) {
          setLoadedTimerId(null);
          return;
        }
        const r = row as Record<string, unknown>;
        if (r.timer_state === 'stopped' || r.is_active === false) {
          const itemId = Number(r.item_id);
          const stopAt = Date.now();
          setTimers((prev) =>
            prev.map((t) =>
              t.id === itemId
                ? { ...t, remainingMs: nowRemainingMs(t, stopAt), isRunning: false, startedAtMs: null }
                : t
            )
          );
          setLoadedTimerId((prev) => (prev === itemId ? null : prev));
          return;
        }
        applyServerTimerRow(r);
      },
      onTimerStopped: (data: Record<string, unknown>) => {
        if (ignoreRemoteTimerSync() || inResetGuard()) return;
        const itemId = Number(data.item_id);
        const stopAt = Date.now();
        if (Number.isFinite(itemId)) {
          setTimers((prev) =>
            prev.map((t) =>
              t.id === itemId
                ? { ...t, remainingMs: nowRemainingMs(t, stopAt), isRunning: false, startedAtMs: null }
                : t
            )
          );
          setLoadedTimerId((prev) => (prev === itemId ? null : prev));
        }
      },
      onTimersStopped: (data: Record<string, unknown>) => {
        if (ignoreRemoteTimerSync() || inResetGuard()) return;
        const itemId = Number(data.item_id);
        const stopAt = Date.now();
        if (Number.isFinite(itemId)) {
          setTimers((prev) =>
            prev.map((t) =>
              t.id === itemId
                ? { ...t, remainingMs: nowRemainingMs(t, stopAt), isRunning: false, startedAtMs: null }
                : t
            )
          );
          setLoadedTimerId((prev) => (prev === itemId ? null : prev));
        } else {
          setTimers((prev) =>
            prev.map((t) => ({
              ...t,
              remainingMs: nowRemainingMs(t, stopAt),
              isRunning: false,
              startedAtMs: null
            }))
          );
          setLoadedTimerId(null);
        }
      },
      onResetAllStates: () => {
        if (ignoreRemoteTimerSync() || inResetGuard()) {
          // Local reset already restored remaining → duration; still ensure unload.
          setLoadedTimerId(null);
          return;
        }
        setTimers((prev) => prev.map((t) => ({ ...t, remainingMs: t.durationMs, isRunning: false, startedAtMs: null })));
        setLoadedTimerId(null);
      }
    };

    socketClient.connect(eventId, callbacks);
    return () => {
      cancelled = true;
      socketClient.disconnect(eventId);
    };
  }, [eventId, qmJsonHeaders]);

  const openClock = () => {
    if (!eventId) return;
    if (clockWindowRef.current && !clockWindowRef.current.closed) {
      clockWindowRef.current.focus();
      return;
    }
    const clockUrl = `/clock?eventId=${encodeURIComponent(eventId)}`;
    const win = window.open(
      clockUrl,
      'clock',
      'width=1920,height=1080,fullscreen=yes,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes'
    );
    if (win) clockWindowRef.current = win;
  };

  const totals = useMemo(() => {
    const active = timers.filter((t) => t.isRunning).length;
    const done = timers.filter((t) => nowRemainingMs(t, nowMs) <= 0).length;
    return { active, done };
  }, [timers, nowMs]);

  const runningTimers = useMemo(() => timers.filter((t) => t.isRunning), [timers]);
  const selectedTimer = timers.find((t) => t.id === selectedTimerId) || null;
  const selectedState = selectedTimer ? timerState(selectedTimer, nowMs, loadedTimerId) : 'READY';
  const selectedRemaining = selectedTimer ? nowRemainingMs(selectedTimer, nowMs) : 0;

  const callApi = async (path: string, method: 'POST' | 'PUT', body: Record<string, any>) => {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers: qmJsonHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('Quick Mode API error:', path, res.status, detail);
      throw new Error(`HTTP ${res.status}`);
    }
  };

  const runLinkAction = async (body: { hours?: number; expireNow?: boolean; rotate?: boolean }) => {
    if (!eventId) return;
    setLinkBusy(true);
    setLinkMessage('');
    setCopyOk(false);
    try {
      const result = await updateQmOperatorLink(eventId, body);
      if (!result.ok) {
        setLinkMessage(result.error || 'Failed to update public link');
        return;
      }
      setLinkStatus(result);
      if (body.expireNow) setLinkMessage('Public link expired — QR/bookmark kept, access off.');
      else if (body.rotate) setLinkMessage('Token regenerated — update QR/bookmarks.');
      else setLinkMessage(`Public link active until ${formatQmExpiry(result.expiresAt)}.`);
    } catch (err) {
      setLinkMessage(err instanceof Error ? err.message : 'Failed to update public link');
    } finally {
      setLinkBusy(false);
    }
  };

  const copyPublicUrl = async () => {
    const url = linkStatus?.operatorUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyOk(true);
      window.setTimeout(() => setCopyOk(false), 2000);
    } catch {
      setLinkMessage('Could not copy — select the URL manually.');
    }
  };

  const addTimer = () => {
    const minutes = Math.max(0, Number.parseInt(minutesDraft || '0', 10) || 0);
    const seconds = Math.max(0, Number.parseInt(secondsDraft || '0', 10) || 0);
    const durationMs = clampDurationMs((minutes * 60 + seconds) * 1000 || 60 * 1000);
    const nextId = timers.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const next: QuickTimer = {
      id: nextId,
      title: titleDraft.trim() || `Timer ${timers.length + 1}`,
      cue: `CUE ${nextId}`,
      durationMs,
      remainingMs: durationMs,
      isRunning: false,
      startedAtMs: null
    };
    setTimers((prev) => [...prev, next]);
    setSelectedTimerId(next.id);
    setTitleDraft('');
  };

  const updateTitle = (id: number, title: string) => setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));

  const syncActiveDuration = async (id: number, durationSeconds: number, running: boolean, cue: string) => {
    if (!eventId) return;
    const secs = Math.max(1, Math.floor(durationSeconds));
    try {
      if (running) {
        await callApi('/api/active-timers', 'POST', {
          event_id: eventId,
          item_id: id,
          user_id: 'quick-mode',
          timer_state: 'running',
          is_active: true,
          is_running: true,
          started_at: new Date().toISOString(),
          last_loaded_cue_id: id,
          cue_is: cue,
          duration_seconds: secs
        });
      } else if (loadedTimerId === id) {
        await callApi(`/api/active-timers/${encodeURIComponent(eventId)}/${id}/duration`, 'PUT', {
          duration_seconds: secs
        });
      }
    } catch {
      // local still works
    }
  };

  /** Set absolute duration for idle / upcoming timers (not while running). */
  const setTimerDurationMs = (id: number, nextDurationMs: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer || timer.isRunning) return;
    const durationMs = clampDurationMs(nextDurationMs);
    setTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, durationMs, remainingMs: durationMs, startedAtMs: null } : t))
    );
    void syncActiveDuration(id, durationMs / 1000, false, timer.cue);
  };

  /** Add/subtract time. Running timers nudge remaining; idle timers change duration. */
  const nudgeTimerSeconds = (id: number, deltaSeconds: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer || !deltaSeconds) return;
    const now = Date.now();
    const deltaMs = deltaSeconds * 1000;

    if (timer.isRunning) {
      const current = nowRemainingMs(timer, now);
      const nextRemaining = Math.max(1000, current + deltaMs);
      // Keep programmed duration as the larger of current program length and new remaining.
      // Do not shrink durationMs down to leftover time (that broke Reset).
      const nextDuration = clampDurationMs(Math.max(timer.durationMs, nextRemaining));
      setTimers((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                durationMs: nextDuration,
                remainingMs: nextRemaining,
                isRunning: true,
                startedAtMs: now
              }
            : t
        )
      );
      // Clock API treats duration_seconds as countdown length from started_at (= remaining).
      void syncActiveDuration(id, nextRemaining / 1000, true, timer.cue);
      return;
    }

    setTimerDurationMs(id, timer.durationMs + deltaMs);
  };

  const loadTimer = async (id: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer) return;
    markLocalControl(2500);
    const now = Date.now();
    setTimers((prev) => prev.map((t) => ({ ...t, remainingMs: nowRemainingMs(t, now), isRunning: false, startedAtMs: null })));
    setLoadedTimerId(id);
    setSelectedTimerId(id);
    if (!eventId) return;
    const durationSeconds = Math.max(1, Math.floor(timer.durationMs / 1000));
    try {
      await callApi('/api/active-timers/stop-all', 'PUT', {
        event_id: eventId,
        user_id: 'quick-mode',
        user_name: 'Quick Mode',
        user_role: 'OPERATOR'
      });
    } catch {
      // ignore
    }
    try {
      await callApi('/api/sub-cue-timers/stop', 'PUT', { event_id: eventId, item_id: null });
    } catch {
      // ignore
    }
    try {
      await callApi('/api/active-timers', 'POST', {
        event_id: eventId,
        item_id: id,
        user_id: 'quick-mode',
        timer_state: 'loaded',
        is_active: true,
        is_running: false,
        started_at: null,
        last_loaded_cue_id: id,
        cue_is: timer.cue,
        duration_seconds: durationSeconds
      });
    } catch {
      // local still works
    }
  };

  const startStopTimer = async (id: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer) return;
    if (timer.isRunning) {
      markLocalControl(2500);
      const stopAt = Date.now();
      setTimers((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, remainingMs: nowRemainingMs(t, stopAt), isRunning: false, startedAtMs: null } : t
        )
      );
      if (eventId) {
        callApi('/api/active-timers/stop', 'PUT', {
          event_id: eventId,
          item_id: id,
          user_id: 'quick-mode',
          user_name: 'Quick Mode',
          user_role: 'OPERATOR'
        }).catch(() => undefined);
      }
      return;
    }
    markLocalControl(3000);
    if (loadedTimerId !== id) {
      await loadTimer(id);
      markLocalControl(3000);
    }
    const startAt = Date.now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return { ...t, remainingMs: nowRemainingMs(t, startAt), isRunning: false, startedAtMs: null };
        const remaining = nowRemainingMs(t, startAt);
        return { ...t, remainingMs: remaining <= 0 ? t.durationMs : remaining, isRunning: true, startedAtMs: startAt };
      })
    );
    setLoadedTimerId(id);
    if (!eventId) return;
    const durationSeconds = Math.max(1, Math.floor(timer.durationMs / 1000));
    try {
      await callApi('/api/active-timers', 'POST', {
        event_id: eventId,
        item_id: id,
        user_id: 'quick-mode',
        timer_state: 'running',
        is_active: true,
        is_running: true,
        started_at: new Date(startAt).toISOString(),
        last_loaded_cue_id: id,
        cue_is: timer.cue,
        duration_seconds: durationSeconds
      });
    } catch {
      // local still works
    }
  };

  const resetTimer = async (id: number) => {
    const timer = timers.find((t) => t.id === id);
    if (!timer) return;
    markResetGuard(5000);

    // Restore programmed duration on all cues and unload (matches event-wide /api/timers/reset).
    setTimers((prev) => {
      const next = prev.map((t) => ({
        ...t,
        remainingMs: t.durationMs,
        isRunning: false,
        startedAtMs: null
      }));
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
    setLoadedTimerId(null);

    if (!eventId) return;
    try {
      await callApi('/api/active-timers/stop-all', 'PUT', {
        event_id: eventId,
        user_id: 'quick-mode',
        user_name: 'Quick Mode',
        user_role: 'OPERATOR'
      });
    } catch {
      // ignore
    }
    try {
      await callApi('/api/active-timers/stop', 'PUT', {
        event_id: eventId,
        item_id: id,
        user_id: 'quick-mode',
        user_name: 'Quick Mode',
        user_role: 'OPERATOR'
      });
    } catch {
      // ignore
    }
    try {
      await callApi('/api/timers/reset', 'POST', { event_id: eventId, item_id: id });
    } catch {
      // local reset already applied
    }
  };

  const removeTimer = (id: number) => {
    setTimers((prev) => prev.filter((t) => t.id !== id));
    if (loadedTimerId === id) setLoadedTimerId(null);
    if (selectedTimerId === id) setSelectedTimerId(null);
  };

  if (publicLinkExpired || (opParam && publicLinkError && !operatorToken)) {
    return (
      <div className="fixed inset-0 z-0 flex flex-col items-center justify-center bg-slate-900 px-6 text-white">
        <div className="max-w-md rounded-xl border border-slate-700 bg-slate-800/90 p-6 text-center shadow-xl">
          <h1 className="text-xl font-bold text-white">Quick Mode link unavailable</h1>
          <p className="mt-3 text-sm text-slate-300">
            {publicLinkError || 'This public operator link has expired.'}
          </p>
          {publicExpiresAt && (
            <p className="mt-2 text-xs text-slate-500">Expired: {formatQmExpiry(publicExpiresAt)}</p>
          )}
          <p className="mt-4 text-xs text-slate-400">
            Ask a signed-in operator to re-enable the same QR/bookmark link (token stays the same).
          </p>
        </div>
      </div>
    );
  }

  const linkActive = qmLinkIsActive(linkStatus?.expiresAt);
  const publicUrl = linkStatus?.operatorUrl || '';

  return (
    <div className="fixed inset-0 z-0 flex flex-col bg-slate-900 text-white">
      <header className="shrink-0 border-b border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-3 py-2 md:px-4">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            {!isPublicOperator && (
              <button
                type="button"
                onClick={() => navigate('/', { state: { tab: 'quickMode' } })}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                aria-label="Back to event list"
                title="Back to event list"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <div className="hidden h-7 w-px shrink-0 bg-slate-600/80 sm:block" aria-hidden />
            <div className="min-w-0">
              <h1 className="text-base font-bold md:text-lg">Quick Mode</h1>
              <p className="text-[11px] text-slate-400">
                {isPublicOperator
                  ? `Public operator${publicExpiresAt ? ` · until ${formatQmExpiry(publicExpiresAt)}` : ''}`
                  : 'Ad-hoc timers — uses a real event ID for clock sync'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isPublicOperator && (
              <span className="rounded border border-amber-500/60 bg-amber-950/50 px-2 py-1 text-[10px] font-semibold text-amber-200">
                Public operator
              </span>
            )}
            <div className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[11px] text-slate-200">
              Event ID:{' '}
              <span className={`font-mono ${eventIdError ? 'text-red-300' : 'text-purple-300'}`}>
                {eventIdError || eventId || 'loading...'}
              </span>
            </div>
            {isSignedIn && !isPublicOperator && (
              <button
                type="button"
                onClick={() => setShowLinkPanel((v) => !v)}
                className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                  linkActive
                    ? 'border-amber-500/70 text-amber-200 hover:bg-amber-900/30'
                    : 'border-slate-500 text-slate-200 hover:bg-slate-800'
                }`}
              >
                {showLinkPanel ? 'Hide public link' : linkActive ? 'Public link on' : 'Public link'}
              </button>
            )}
            <button
              type="button"
              onClick={openClock}
              className="rounded border border-emerald-500/70 px-2 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/30"
            >
              Open Clock
            </button>
            <span className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
              {isCompanionSyncing ? 'Syncing to API...' : syncMessage || 'Waiting for first timer...'}
            </span>
            <span className="rounded bg-slate-700 px-2 py-1 text-[10px]">Total: {timers.length}</span>
            <span className="rounded bg-emerald-900/70 px-2 py-1 text-[10px] text-emerald-200">Running: {totals.active}</span>
            <span className="rounded bg-amber-900/70 px-2 py-1 text-[10px] text-amber-200">Done: {totals.done}</span>
          </div>
        </div>
        {showLinkPanel && isSignedIn && !isPublicOperator && (
          <div className="mx-auto mt-2 max-w-[1800px] rounded-lg border border-slate-600 bg-slate-950/80 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-white">Public operator link</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Click <span className="text-amber-200 font-semibold">Enable</span> to create a stable{' '}
                  <span className="font-mono text-slate-300">op=ros_qmop_…</span> token in the URL.
                  Share / QR that link — no sign-in. Re-enable or expire without changing the token.
                </p>
                {publicUrl ? (
                  <div className="mt-2 break-all rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-[10px] text-slate-300">
                    {publicUrl}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">No link yet — enable below to create one.</p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  Status:{' '}
                  <span className={linkActive ? 'text-emerald-300' : 'text-slate-400'}>
                    {linkActive ? 'Active' : linkStatus?.exists ? 'Expired / off' : 'Not created'}
                  </span>
                  {linkStatus?.expiresAt ? ` · ${formatQmExpiry(linkStatus.expiresAt)}` : ''}
                </p>
                {linkMessage && <p className="mt-1 text-[11px] text-cyan-300">{linkMessage}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[4, 8, 12, 24].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    disabled={linkBusy || !eventId}
                    onClick={() => void runLinkAction({ hours })}
                    className="rounded border border-amber-600/70 bg-amber-950/40 px-2 py-1 text-[10px] font-semibold text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
                  >
                    Enable {hours}h
                  </button>
                ))}
                <button
                  type="button"
                  disabled={linkBusy || !publicUrl}
                  onClick={() => void copyPublicUrl()}
                  className="rounded border border-slate-500 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {copyOk ? 'Copied' : 'Copy URL'}
                </button>
                <button
                  type="button"
                  disabled={linkBusy || !linkStatus?.exists}
                  onClick={() => void runLinkAction({ expireNow: true })}
                  className="rounded border border-slate-600 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Expire now
                </button>
                <button
                  type="button"
                  disabled={linkBusy || !linkStatus?.exists}
                  onClick={() => {
                    if (window.confirm('Regenerate token? Existing QR codes and bookmarks will stop working.')) {
                      void runLinkAction({ hours: 8, rotate: true });
                    }
                  }}
                  className="rounded border border-red-700/60 px-2 py-1 text-[10px] font-semibold text-red-200 hover:bg-red-950/40 disabled:opacity-50"
                  title="Emergency only — breaks printed QR / bookmarks"
                >
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 overflow-hidden">
        <aside className="hidden w-56 shrink-0 border-r border-slate-700 bg-slate-950 lg:block">
          <div className="border-b border-slate-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Quick Cues
          </div>
          <div className="min-h-0 max-h-full overflow-y-auto p-2">
            {timers.map((t) => {
              const state = timerState(t, nowMs, loadedTimerId);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedTimerId(t.id)}
                  className={`mb-1.5 w-full rounded border px-2 py-1.5 text-left ${
                    selectedTimerId === t.id ? 'border-cyan-500 bg-cyan-950/30' : 'border-slate-700 bg-slate-900/70 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-300">{t.cue}</div>
                  <div className="truncate text-xs font-semibold text-white">{t.title}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-slate-400">{state}</span>
                    <span className="font-mono tabular-nums text-slate-200">{formatTime(nowRemainingMs(t, nowMs))}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-slate-900 p-2.5 md:p-3">
          <section className="mb-2 rounded-lg border border-slate-600 bg-slate-800 p-2.5 shadow-lg">
            <div className="grid gap-3 md:grid-cols-[1.4fr_auto_auto_auto]">
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder="Timer name (optional)"
                className="rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
              <input
                type="number"
                min={0}
                value={minutesDraft}
                onChange={(e) => setMinutesDraft(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 md:w-24"
                aria-label="Minutes"
              />
              <input
                type="number"
                min={0}
                value={secondsDraft}
                onChange={(e) => setSecondsDraft(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500 md:w-24"
                aria-label="Seconds"
              />
              <button type="button" onClick={addTimer} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500">
                + Add timer
              </button>
            </div>
          </section>

          {selectedTimer ? (
            <section className="mb-3 rounded-lg border border-slate-600 bg-slate-800 p-3 shadow-lg md:p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-700 px-2.5 py-1 text-xs font-bold">{selectedTimer.cue}</span>
                <span
                  className={`rounded px-2.5 py-1 text-xs font-bold ${
                    selectedState === 'RUNNING'
                      ? 'bg-emerald-900/50 text-emerald-200'
                      : selectedState === 'DONE'
                        ? 'bg-amber-900/50 text-amber-200'
                        : selectedState === 'LOADED'
                          ? 'bg-blue-900/60 text-blue-200'
                          : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {selectedState}
                </span>
                <input
                  type="text"
                  value={selectedTimer.title}
                  onChange={(e) => updateTitle(selectedTimer.id, e.target.value)}
                  className="min-w-[12rem] flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white outline-none focus:border-blue-500"
                  aria-label="Timer name"
                />
              </div>

              <div
                className={`mb-4 rounded-xl border px-4 py-6 text-center md:py-8 ${
                  selectedState === 'RUNNING'
                    ? 'border-emerald-500/40 bg-emerald-950/30'
                    : selectedState === 'DONE'
                      ? 'border-amber-500/40 bg-amber-950/25'
                      : selectedState === 'LOADED'
                        ? 'border-blue-500/40 bg-blue-950/30'
                        : 'border-slate-600 bg-slate-950/60'
                }`}
              >
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  {selectedState === 'DONE' ? 'Time complete' : 'Time remaining'}
                </div>
                <div
                  className={`font-mono text-6xl font-bold tabular-nums tracking-tight md:text-7xl lg:text-8xl ${
                    selectedState === 'RUNNING'
                      ? 'text-emerald-300'
                      : selectedState === 'DONE'
                        ? 'text-amber-300'
                        : selectedState === 'LOADED'
                          ? 'text-blue-200'
                          : 'text-white'
                  }`}
                  aria-live="polite"
                >
                  {formatTime(selectedRemaining)}
                </div>
                <div className="mt-2 text-sm text-slate-400">
                  Duration {formatTime(selectedTimer.durationMs)}
                </div>

                {selectedTimer.isRunning ? (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Adjust live
                    </span>
                    {[
                      { label: '−5m', sec: -300 },
                      { label: '−1m', sec: -60 },
                      { label: '−10s', sec: -10 },
                      { label: '+10s', sec: 10 },
                      { label: '+1m', sec: 60 },
                      { label: '+5m', sec: 300 }
                    ].map((btn) => (
                      <button
                        key={btn.label}
                        type="button"
                        onClick={() => nudgeTimerSeconds(selectedTimer.id, btn.sec)}
                        className="min-h-[40px] min-w-[3.25rem] rounded-lg border border-emerald-500/50 bg-emerald-950/40 px-3 text-sm font-bold text-emerald-100 hover:bg-emerald-900/60"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Set duration
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={Math.floor(selectedTimer.durationMs / 60000)}
                      onChange={(e) => {
                        const minutes = Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0);
                        const seconds = Math.floor((selectedTimer.durationMs / 1000) % 60);
                        setTimerDurationMs(selectedTimer.id, (minutes * 60 + seconds) * 1000 || 1000);
                      }}
                      className="w-16 rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-center font-mono text-sm text-white outline-none focus:border-blue-500"
                      aria-label="Duration minutes"
                    />
                    <span className="text-slate-500">m</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={Math.floor((selectedTimer.durationMs / 1000) % 60)}
                      onChange={(e) => {
                        const seconds = Math.max(0, Math.min(59, Number.parseInt(e.target.value || '0', 10) || 0));
                        const minutes = Math.floor(selectedTimer.durationMs / 60000);
                        setTimerDurationMs(selectedTimer.id, (minutes * 60 + seconds) * 1000 || 1000);
                      }}
                      className="w-16 rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-center font-mono text-sm text-white outline-none focus:border-blue-500"
                      aria-label="Duration seconds"
                    />
                    <span className="text-slate-500">s</span>
                    {[
                      { label: '−5m', sec: -300 },
                      { label: '−1m', sec: -60 },
                      { label: '+1m', sec: 60 },
                      { label: '+5m', sec: 300 }
                    ].map((btn) => (
                      <button
                        key={btn.label}
                        type="button"
                        onClick={() => nudgeTimerSeconds(selectedTimer.id, btn.sec)}
                        className="min-h-[40px] min-w-[3.25rem] rounded-lg border border-slate-500 bg-slate-900 px-3 text-sm font-bold text-slate-100 hover:bg-slate-700"
                      >
                        {btn.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadTimer(selectedTimer.id)}
                  disabled={loadedTimerId === selectedTimer.id && !selectedTimer.isRunning}
                  className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-bold ${
                    loadedTimerId === selectedTimer.id && !selectedTimer.isRunning
                      ? 'cursor-default bg-blue-600 text-white'
                      : 'border border-blue-400/80 bg-blue-700/80 text-blue-50 hover:bg-blue-600'
                  }`}
                >
                  {loadedTimerId === selectedTimer.id && !selectedTimer.isRunning ? 'LOADED' : 'LOAD'}
                </button>
                {!selectedTimer.isRunning ? (
                  <button
                    type="button"
                    onClick={() => startStopTimer(selectedTimer.id)}
                    disabled={runningTimers.length > 0}
                    className={`min-h-[44px] min-w-[7rem] rounded-lg px-5 py-2 text-sm font-bold ${
                      runningTimers.length > 0
                        ? 'cursor-not-allowed bg-slate-600 text-slate-400'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500'
                    }`}
                  >
                    START
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startStopTimer(selectedTimer.id)}
                    className="min-h-[44px] min-w-[7rem] rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-500"
                  >
                    STOP
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => resetTimer(selectedTimer.id)}
                  className="min-h-[44px] rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => removeTimer(selectedTimer.id)}
                  className="min-h-[44px] rounded-lg border border-red-500/70 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-900/30"
                >
                  Remove
                </button>
              </div>
            </section>
          ) : null}

          {timers.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-lg">
              <div className="border-b border-slate-600 bg-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-200">
                Quick Rundown
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead className="bg-slate-700/80">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-300">Cue</th>
                      <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-300">Segment</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">Duration</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">Remaining</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">State</th>
                      <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-300">Controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timers.map((timer) => {
                      const state = timerState(timer, nowMs, loadedTimerId);
                      const remaining = nowRemainingMs(timer, nowMs);
                      return (
                        <tr
                          key={timer.id}
                          onClick={() => setSelectedTimerId(timer.id)}
                          className={`cursor-pointer border-t border-slate-700 ${
                            state === 'LOADED' ? 'bg-blue-900/55 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.55)] hover:bg-blue-900/65' :
                            selectedTimerId === timer.id ? 'bg-cyan-950/25' : 'hover:bg-slate-700/40'
                          }`}
                        >
                          <td className="px-2 py-1.5 font-mono text-[11px] text-slate-200">{timer.cue}</td>
                          <td className="px-2 py-1.5 text-xs text-white">{timer.title || 'Untitled timer'}</td>
                          <td className="px-2 py-1.5 text-center font-mono text-[11px] text-slate-300">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span>{formatTime(timer.durationMs)}</span>
                              {!timer.isRunning ? (
                                <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => nudgeTimerSeconds(timer.id, -60)}
                                    className="rounded bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold text-slate-200 hover:bg-slate-600"
                                    title="−1 minute"
                                  >
                                    −1m
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => nudgeTimerSeconds(timer.id, 60)}
                                    className="rounded bg-slate-700 px-1.5 py-0.5 text-[9px] font-bold text-slate-200 hover:bg-slate-600"
                                    title="+1 minute"
                                  >
                                    +1m
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center font-mono text-xs text-white">
                            <div className="inline-flex flex-col items-center gap-1">
                              <span>{formatTime(remaining)}</span>
                              {timer.isRunning ? (
                                <div className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => nudgeTimerSeconds(timer.id, -60)}
                                    className="rounded bg-emerald-900/70 px-1.5 py-0.5 text-[9px] font-bold text-emerald-100 hover:bg-emerald-800"
                                    title="−1 minute"
                                  >
                                    −1m
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => nudgeTimerSeconds(timer.id, 60)}
                                    className="rounded bg-emerald-900/70 px-1.5 py-0.5 text-[9px] font-bold text-emerald-100 hover:bg-emerald-800"
                                    title="+1 minute"
                                  >
                                    +1m
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`rounded px-2 py-1 text-[10px] font-bold ${
                              state === 'RUNNING' ? 'bg-emerald-900/50 text-emerald-200' :
                              state === 'DONE' ? 'bg-amber-900/50 text-amber-200' :
                              state === 'LOADED' ? 'bg-blue-900/60 text-blue-200' : 'bg-slate-700 text-slate-300'
                            }`}>{state}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex justify-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  loadTimer(timer.id);
                                }}
                                disabled={loadedTimerId === timer.id && !timer.isRunning}
                                className={`rounded px-2 py-1 text-[10px] font-semibold ${
                                  loadedTimerId === timer.id && !timer.isRunning
                                    ? 'bg-blue-600 text-white cursor-default'
                                    : 'border border-blue-400/80 bg-blue-700/80 text-blue-50 hover:bg-blue-600'
                                }`}
                              >
                                {loadedTimerId === timer.id && !timer.isRunning ? 'LOADED' : 'LOAD'}
                              </button>
                              {!timer.isRunning ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startStopTimer(timer.id);
                                  }}
                                  disabled={runningTimers.length > 0}
                                  className={`rounded px-2 py-1 text-[10px] font-semibold ${
                                    runningTimers.length > 0
                                      ? 'bg-slate-600 text-slate-400 cursor-not-allowed'
                                      : 'bg-emerald-600 text-white hover:bg-emerald-500'
                                  }`}
                                >
                                  START
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startStopTimer(timer.id);
                                  }}
                                  className="rounded bg-red-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-500"
                                >
                                  STOP
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-600 bg-slate-800/50 p-6 text-center text-slate-400">
              No quick timers yet. Add one above to get started.
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default QuickModePage;
