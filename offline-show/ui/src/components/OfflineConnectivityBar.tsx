import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchConnectivityStatus,
  setCloudMode,
  type CloudModeState,
  type ConnectivityPill,
  type ConnectivitySnapshot,
} from '../services/connectivity-status';
import { getOfflineDisplayName } from '../services/offline-user';
import { onCloudModeChange } from '../services/socket-client';
import { performCloudReconnect } from '../services/offline-sync-bridge';

const POLL_MS = 12_000;

type PillKey = 'internet' | 'railway' | 'neon' | 'localLan';

const PILL_ORDER: { key: PillKey; short: string }[] = [
  { key: 'internet', short: 'Internet' },
  { key: 'railway', short: 'Railway' },
  { key: 'neon', short: 'Neon' },
  { key: 'localLan', short: 'Local LAN' },
];

const OfflineConnectivityBar: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ConnectivitySnapshot | null>(null);
  const [cloudMode, setCloudModeState] = useState<CloudModeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchConnectivityStatus();
      setSnapshot(data);
      setCloudModeState({
        mode: data.cloudMode,
        lanOnly: data.lanOnly,
        cloudConnected: data.cloudConnected,
        updatedAt: data.cloudModeUpdatedAt ?? null,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Status unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    return onCloudModeChange((payload) => {
      setCloudModeState(payload);
      void refresh();
    });
  }, [refresh]);

  const handleToggleCloud = async () => {
    if (toggling) return;
    const next = cloudMode?.lanOnly ? 'cloud-connected' : 'lan-only';
    const confirmMsg =
      next === 'lan-only'
        ? 'Switch to LAN only? Event list and schedules use the local SQLite copy on this show laptop. No Railway/Neon reads or writes. All devices on :3004 will follow.'
        : 'Turn Cloud on? Run of Show will PAUSE, upload your current schedule and show state to the hosted app, then reconnect. Your screen will NOT reload from cloud.';
    if (!window.confirm(confirmMsg)) return;

    setToggling(true);
    try {
      if (next === 'cloud-connected') {
        const result = await performCloudReconnect(getOfflineDisplayName());
        if (!result.ok) {
          const proceed = window.confirm(
            `${result.error || 'Could not upload offline show data.'}\n\nConnect anyway without uploading? (Hosted app may show older data.)`
          );
          if (!proceed) return;
          await setCloudMode('cloud-connected', getOfflineDisplayName());
        } else {
          const items = result.stats?.scheduleItems;
          const timerItem = result.stats?.activeTimerItemId;
          const timerState = result.stats?.activeTimerState;
          const timerNote =
            result.stats?.activeTimer === true && timerItem != null
              ? `\n\nActive cue synced: item ${timerItem}${timerState ? ` (${timerState})` : ''}.`
              : result.stats?.activeTimerSource === 'no-live-timer'
                ? '\n\nNo loaded/running cue was detected — hosted app may not show the current cue.'
                : '\n\nActive cue was not synced — check server log for reconnect timer push.';
          alert(
            `Cloud connected. Uploaded ${items ?? 'your'} schedule item(s) to the hosted app. Your Run of Show screen was kept as-is.${timerNote}`
          );
        }
      } else {
        await setCloudMode(next, getOfflineDisplayName());
      }
      await refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not change cloud mode');
    } finally {
      setToggling(false);
    }
  };

  const host =
    typeof window !== 'undefined' ? `${window.location.hostname}:${window.location.port}` : '';

  const lanOnly = cloudMode?.lanOnly ?? snapshot?.lanOnly ?? true;

  return (
    <footer className="offline-connectivity-bar" role="status" aria-live="polite">
      <div className="offline-connectivity-bar__inner">
        <div className="offline-connectivity-bar__brand">
          <span className="offline-connectivity-bar__badge">Offline Show</span>
          <span className="offline-connectivity-bar__host" title="LAN show server">
            {host}
          </span>
        </div>

        <button
          type="button"
          className={`offline-cloud-toggle ${lanOnly ? 'offline-cloud-toggle--lan' : 'offline-cloud-toggle--cloud'}`}
          onClick={() => void handleToggleCloud()}
          disabled={toggling}
          title={
            lanOnly
              ? 'LAN only — pause, upload local show, then reconnect to cloud.'
              : 'Cloud on — bridged to Railway. Click for LAN-only SQLite.'
          }
        >
          {toggling ? 'Syncing…' : lanOnly ? 'LAN only' : 'Cloud on'}
        </button>

        <div className="offline-connectivity-bar__pills">
          {PILL_ORDER.map(({ key, short }) => {
            const pill: ConnectivityPill | undefined = snapshot?.[key];
            return (
              <StatusPill
                key={key}
                label={short}
                pill={pill}
                loading={loading && !pill}
                lanOnly={lanOnly && key !== 'localLan'}
              />
            );
          })}
        </div>

        <div className="offline-connectivity-bar__meta">
          {error ? (
            <span className="offline-connectivity-bar__error" title={error}>
              Probe error
            </span>
          ) : snapshot?.cached ? (
            <span className="offline-connectivity-bar__hint">cached</span>
          ) : null}
          <button
            type="button"
            className="offline-connectivity-bar__refresh"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
            title="Refresh connectivity"
          >
            ↻
          </button>
        </div>
      </div>
    </footer>
  );
};

function StatusPill({
  label,
  pill,
  loading,
  lanOnly,
}: {
  label: string;
  pill?: ConnectivityPill;
  loading: boolean;
  lanOnly: boolean;
}) {
  const skipped = pill?.skipped === true || lanOnly;
  const state = loading ? 'checking' : skipped ? 'off' : pill?.ok ? 'ok' : 'down';
  const title = skipped
    ? pill?.reason || 'Disabled — LAN only mode'
    : pill?.error
      ? `${label}: ${pill.error}`
      : pill?.latencyMs != null
        ? `${label}: ${pill.latencyMs}ms`
        : pill?.dbName
          ? `${label}: ${pill.dbName}`
          : label;

  return (
    <span className={`offline-pill offline-pill--${state}`} title={title}>
      <span className="offline-pill__dot" aria-hidden />
      {label}
    </span>
  );
}

export default OfflineConnectivityBar;
