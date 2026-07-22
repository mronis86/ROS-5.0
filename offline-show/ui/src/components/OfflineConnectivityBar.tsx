import React, { useCallback, useEffect, useState } from 'react';
import {
  clearRailwayApiToken,
  fetchConnectivityStatus,
  saveRailwayApiToken,
  setCloudMode,
  type CloudModeState,
  type ConnectivityPill,
  type ConnectivitySnapshot,
  type RailwayApiTokenStatus,
} from '../services/connectivity-status';
import { getOfflineDisplayName } from '../services/offline-user';
import { onCloudModeChange } from '../services/socket-client';
import { performCloudReconnect } from '../services/offline-sync-bridge';
import {
  loadCloudReconnectPreview,
  type CloudReconnectPreview,
} from '../services/cloud-reconnect-preview';
import OfflineDialog from './OfflineDialog';
import CloudReconnectPreviewPanel from './CloudReconnectPreviewPanel';

const POLL_MS = 12_000;
const PREVIEW_REFRESH_MS = 2000;

type PillKey = 'internet' | 'railway' | 'neon' | 'localLan';

const PILL_ORDER: { key: PillKey; short: string }[] = [
  { key: 'internet', short: 'Internet' },
  { key: 'railway', short: 'Railway' },
  { key: 'neon', short: 'Neon' },
  { key: 'localLan', short: 'Local LAN' },
];

type DialogState =
  | { kind: 'toggle-mode'; next: 'lan-only' | 'cloud-connected'; message: string }
  | { kind: 'reconnect-failed'; error: string }
  | { kind: 'clear-token' }
  | { kind: 'notice'; title: string; message: string; tone?: 'info' | 'warn' | 'error' };

const OfflineConnectivityBar: React.FC = () => {
  const [snapshot, setSnapshot] = useState<ConnectivitySnapshot | null>(null);
  const [cloudMode, setCloudModeState] = useState<CloudModeState | null>(null);
  const [tokenStatus, setTokenStatus] = useState<RailwayApiTokenStatus | null>(null);
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pushPreview, setPushPreview] = useState<CloudReconnectPreview | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);

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
      if (data.railwayApiToken) {
        setTokenStatus(data.railwayApiToken);
      }
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

  const closeDialog = useCallback(() => {
    if (toggling || tokenSaving) return;
    setDialog(null);
    setPushPreview(null);
    setPushPreviewLoading(false);
  }, [toggling, tokenSaving]);

  const refreshPushPreview = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setPushPreviewLoading(true);
    try {
      const preview = await loadCloudReconnectPreview();
      setPushPreview(preview);
    } catch (e) {
      setPushPreview({
        ok: false,
        error: e instanceof Error ? e.message : 'Could not build upload preview.',
        eventName: '',
        eventId: '',
        showMode: null,
        scheduleCount: 0,
        rows: [],
        liveCue: null,
        completed: [],
        indentedCount: 0,
        subCue: null,
      });
    } finally {
      if (!opts?.silent) setPushPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    const showPreview =
      dialog?.kind === 'toggle-mode' && dialog.next === 'cloud-connected' && !toggling;
    if (!showPreview) return;

    void refreshPushPreview();
    const id = window.setInterval(() => void refreshPushPreview({ silent: true }), PREVIEW_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [dialog, toggling, refreshPushPreview]);

  const handleSaveToken = async () => {
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setTokenSaving(true);
    try {
      const saved = await saveRailwayApiToken(trimmed);
      setTokenStatus(saved);
      setTokenInput('');
      setTokenPanelOpen(false);
      await refresh();
    } catch (e) {
      setDialog({
        kind: 'notice',
        title: 'Could not save token',
        message: e instanceof Error ? e.message : 'Could not save token',
        tone: 'error',
      });
    } finally {
      setTokenSaving(false);
    }
  };

  const runClearToken = async () => {
    setTokenSaving(true);
    try {
      const cleared = await clearRailwayApiToken();
      setTokenStatus(cleared);
      setTokenInput('');
      setDialog(null);
      await refresh();
    } catch (e) {
      setDialog({
        kind: 'notice',
        title: 'Could not clear token',
        message: e instanceof Error ? e.message : 'Could not clear token',
        tone: 'error',
      });
    } finally {
      setTokenSaving(false);
    }
  };

  const runModeSwitch = async (next: 'lan-only' | 'cloud-connected') => {
    setToggling(true);
    try {
      if (next === 'cloud-connected') {
        const result = await performCloudReconnect(getOfflineDisplayName());
        if (!result.ok) {
          setDialog({
            kind: 'reconnect-failed',
            error: result.error || 'Could not upload offline show data.',
          });
          return;
        }
        console.log('☁️ Cloud connected', {
          scheduleItems: result.stats?.scheduleItems,
          activeTimerItemId: result.stats?.activeTimerItemId,
          activeTimerState: result.stats?.activeTimerState,
          remainingSeconds: result.stats?.activeTimerRemainingSeconds,
        });
        setDialog(null);
      } else {
        await setCloudMode(next, getOfflineDisplayName());
        setDialog(null);
      }
      await refresh();
    } catch (e) {
      setDialog({
        kind: 'notice',
        title: 'Could not change cloud mode',
        message: e instanceof Error ? e.message : 'Could not change cloud mode',
        tone: 'error',
      });
    } finally {
      setToggling(false);
    }
  };

  const runConnectWithoutUpload = async () => {
    setToggling(true);
    try {
      await setCloudMode('cloud-connected', getOfflineDisplayName());
      setDialog(null);
      await refresh();
    } catch (e) {
      setDialog({
        kind: 'notice',
        title: 'Could not change cloud mode',
        message: e instanceof Error ? e.message : 'Could not change cloud mode',
        tone: 'error',
      });
    } finally {
      setToggling(false);
    }
  };

  const handleToggleCloud = () => {
    if (toggling || dialog) return;
    const next = cloudMode?.lanOnly ? 'cloud-connected' : 'lan-only';
    const tokenReady = tokenStatus?.configured === true;
    const message =
      next === 'lan-only'
        ? 'Switch to LAN only? Event list and schedules use the local SQLite copy on this show laptop. No Railway/Neon reads or writes. All devices on :3004 will follow.'
        : `${
            tokenReady
              ? ''
              : 'Warning: no Railway API token saved yet. Upload may fail until you add one (API button → scopes read + control + write).\n\n'
          }Turn Cloud on? This will briefly pause, upload the snapshot below to the hosted app, then reconnect. Your screen will not reload from cloud.`;
    if (next === 'cloud-connected') {
      setPushPreview(null);
      setPushPreviewLoading(true);
    } else {
      setPushPreview(null);
      setPushPreviewLoading(false);
    }
    setDialog({ kind: 'toggle-mode', next, message });
  };

  const host =
    typeof window !== 'undefined' ? `${window.location.hostname}:${window.location.port}` : '';

  const lanOnly = cloudMode?.lanOnly ?? snapshot?.lanOnly ?? true;
  const tokenConfigured = tokenStatus?.configured === true;

  const dialogTitle =
    dialog?.kind === 'toggle-mode'
      ? dialog.next === 'cloud-connected'
        ? 'Turn Cloud on'
        : 'Switch to LAN only'
      : dialog?.kind === 'reconnect-failed'
        ? 'Cloud upload failed'
        : dialog?.kind === 'clear-token'
          ? 'Clear API token'
          : dialog?.kind === 'notice'
            ? dialog.title
            : '';

  const dialogMessage =
    dialog?.kind === 'toggle-mode'
      ? dialog.message
      : dialog?.kind === 'reconnect-failed'
        ? `${dialog.error}\n\nConnect anyway without uploading? (Hosted app may show older data.)`
        : dialog?.kind === 'clear-token'
          ? 'Remove the saved Railway API token from this show laptop?'
          : dialog?.kind === 'notice'
            ? dialog.message
            : '';

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
          onClick={handleToggleCloud}
          disabled={toggling}
          title={
            lanOnly
              ? 'LAN only — pause, upload local show, then reconnect to cloud.'
              : 'Cloud on — bridged to Railway. Click for LAN-only SQLite.'
          }
        >
          {toggling ? 'Syncing…' : lanOnly ? 'LAN only' : 'Cloud on'}
        </button>

        <button
          type="button"
          className={`offline-api-token-btn ${
            tokenConfigured && tokenStatus?.canWrite !== false
              ? 'offline-api-token-btn--ok'
              : 'offline-api-token-btn--missing'
          }`}
          onClick={() => setTokenPanelOpen((open) => !open)}
          title={
            tokenConfigured
              ? tokenStatus?.canWrite === false
                ? tokenStatus.writeError ||
                  'Token cannot write to Railway — needs scopes read + control + write'
                : `Railway API token configured (${tokenStatus?.prefix ?? 'saved'})`
              : 'Railway API token required for cloud sync — click to configure'
          }
        >
          API {tokenConfigured && tokenStatus?.canWrite !== false ? '✓' : '!'}
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

      {tokenPanelOpen ? (
        <div className="offline-api-token-panel">
          <div className="offline-api-token-panel__header">
            <strong>Railway API token</strong>
            <button
              type="button"
              className="offline-api-token-panel__close"
              onClick={() => setTokenPanelOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="offline-api-token-panel__hint">
            Create in the hosted app: <strong>Admin → Integration API tokens</strong> with scopes{' '}
            <strong>read</strong>, <strong>control</strong>, and <strong>write</strong>. Companion
            can use read+control; offline <em>Cloud on</em> reconnect also needs write (schedule +
            timer upload). Paste the token here once per show laptop.
          </p>
          {tokenStatus?.configured ? (
            <p className="offline-api-token-panel__status">
              Configured: <code>{tokenStatus.prefix}</code>
              {tokenStatus.source === 'env' ? ' (from server env)' : ''}
              {tokenStatus.canWrite === false ? (
                <span className="offline-api-token-panel__status--warn">
                  {' '}
                  — cannot write to cloud
                  {tokenStatus.writeError ? `: ${tokenStatus.writeError}` : ''}
                </span>
              ) : tokenStatus.canWrite === true ? (
                <span> — write OK</span>
              ) : null}
            </p>
          ) : (
            <p className="offline-api-token-panel__status offline-api-token-panel__status--warn">
              Not configured — cloud sync will fail when API auth is enabled on Railway.
            </p>
          )}
          {!tokenStatus?.locked ? (
            <>
              <input
                type="password"
                className="offline-api-token-panel__input"
                placeholder="Paste integration token…"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="offline-api-token-panel__actions">
                <button
                  type="button"
                  className="offline-api-token-panel__save"
                  disabled={tokenSaving || !tokenInput.trim()}
                  onClick={() => void handleSaveToken()}
                >
                  {tokenSaving ? 'Saving…' : 'Save & validate'}
                </button>
                {tokenStatus?.configured && tokenStatus.source === 'db' ? (
                  <button
                    type="button"
                    className="offline-api-token-panel__clear"
                    disabled={tokenSaving}
                    onClick={() =>
                      setDialog({
                        kind: 'clear-token',
                      })
                    }
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="offline-api-token-panel__hint">
              This laptop uses <code>OFFLINE_RAILWAY_API_TOKEN</code> on the server — edit that env
              var to change it.
            </p>
          )}
        </div>
      ) : null}

      <OfflineDialog
        open={dialog != null}
        title={dialogTitle}
        message={dialogMessage}
        tone={
          dialog?.kind === 'notice'
            ? dialog.tone || 'info'
            : dialog?.kind === 'reconnect-failed'
              ? 'warn'
              : dialog?.kind === 'clear-token'
                ? 'warn'
                : 'info'
        }
        busy={toggling || tokenSaving}
        confirmLabel={
          dialog?.kind === 'toggle-mode'
            ? dialog.next === 'cloud-connected'
              ? 'Turn Cloud on'
              : 'Switch to LAN'
            : dialog?.kind === 'reconnect-failed'
              ? 'Connect anyway'
              : dialog?.kind === 'clear-token'
                ? 'Clear token'
                : undefined
        }
        cancelLabel={dialog?.kind === 'reconnect-failed' ? 'Stay on LAN' : 'Cancel'}
        onCancel={closeDialog}
        onConfirm={
          dialog?.kind === 'toggle-mode'
            ? () => void runModeSwitch(dialog.next)
            : dialog?.kind === 'reconnect-failed'
              ? () => void runConnectWithoutUpload()
              : dialog?.kind === 'clear-token'
                ? () => void runClearToken()
                : undefined
        }
      >
        {dialog?.kind === 'toggle-mode' && dialog.next === 'cloud-connected' ? (
          <CloudReconnectPreviewPanel preview={pushPreview} loading={pushPreviewLoading} />
        ) : null}
      </OfflineDialog>
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
