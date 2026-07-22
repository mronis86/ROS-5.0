import React from 'react';
import type { CloudReconnectPreview } from '../services/cloud-reconnect-preview';

type Props = {
  preview: CloudReconnectPreview | null;
  loading?: boolean;
};

const FLAG_LABEL: Record<string, string> = {
  running: 'RUNNING',
  loaded: 'LOADED',
  completed: 'DONE',
  indented: 'INDENT',
};

const CloudReconnectPreviewPanel: React.FC<Props> = ({ preview, loading }) => {
  if (loading && !preview) {
    return (
      <div className="cloud-push-preview cloud-push-preview--loading">
        Reading current schedule and cue state…
      </div>
    );
  }

  if (!preview) return null;

  if (!preview.ok) {
    return (
      <div className="cloud-push-preview cloud-push-preview--error">
        {preview.error || 'Could not build upload preview.'}
      </div>
    );
  }

  const notable = preview.rows.filter((r) => r.flags.length > 0);
  const showAll = preview.rows.length <= 40;
  const showRows = showAll ? preview.rows : notable.length > 0 ? notable : preview.rows.slice(0, 20);
  const showingPartial = !showAll && showRows.length < preview.rows.length;

  return (
    <div className="cloud-push-preview" aria-live="polite">
      <div className="cloud-push-preview__summary">
        <strong>{preview.eventName}</strong>
        <span>
          {preview.scheduleCount} schedule row{preview.scheduleCount === 1 ? '' : 's'}
          {preview.showMode ? ` · ${preview.showMode}` : ''}
          {preview.indentedCount > 0 ? ` · ${preview.indentedCount} indented` : ''}
        </span>
      </div>

      <div className="cloud-push-preview__section">
        <div className="cloud-push-preview__section-title">Live cue handoff</div>
        {preview.liveCue ? (
          <div
            className={`cloud-push-preview__live cloud-push-preview__live--${preview.liveCue.timerState}`}
          >
            <div className="cloud-push-preview__live-main">
              <span className="cloud-push-preview__badge">
                {String(preview.liveCue.timerState).toUpperCase()}
              </span>
              <span className="cloud-push-preview__cue">{preview.liveCue.cue}</span>
              <span className="cloud-push-preview__seg">
                {preview.liveCue.segmentName || preview.liveCue.programType || `Row ${preview.liveCue.itemId}`}
              </span>
            </div>
            <div className="cloud-push-preview__live-time">
              {preview.liveCue.timerState === 'running' && preview.liveCue.remainingLabel != null ? (
                <>
                  Remaining <strong>{preview.liveCue.remainingLabel}</strong>
                  <span className="cloud-push-preview__muted">
                    {' '}
                    / {preview.liveCue.durationLabel}
                  </span>
                </>
              ) : (
                <>
                  Duration <strong>{preview.liveCue.durationLabel}</strong>
                  <span className="cloud-push-preview__muted"> (loaded, not started)</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="cloud-push-preview__empty">No loaded or running cue — timer state will not be pushed.</p>
        )}
      </div>

      {preview.subCue ? (
        <div className="cloud-push-preview__section">
          <div className="cloud-push-preview__section-title">Sub-cue timer</div>
          <div className="cloud-push-preview__row cloud-push-preview__row--sub">
            <span className="cloud-push-preview__badge">{preview.subCue.timerState.toUpperCase()}</span>
            <span className="cloud-push-preview__cue">{preview.subCue.cue}</span>
            <span className="cloud-push-preview__dur">{preview.subCue.durationLabel}</span>
          </div>
        </div>
      ) : null}

      <div className="cloud-push-preview__section">
        <div className="cloud-push-preview__section-title">
          Schedule rows to upload ({preview.scheduleCount})
          {!showAll && notable.length > 0 ? ` · highlighting ${notable.length} flagged` : ''}
        </div>
        <div className="cloud-push-preview__table" role="list">
          {showRows.map((row) => (
            <div
              key={row.id}
              role="listitem"
              className={`cloud-push-preview__row ${
                row.flags.includes('running')
                  ? 'cloud-push-preview__row--running'
                  : row.flags.includes('loaded')
                    ? 'cloud-push-preview__row--loaded'
                    : row.flags.includes('completed')
                      ? 'cloud-push-preview__row--completed'
                      : ''
              }`}
            >
              <span className="cloud-push-preview__cue">{row.cue}</span>
              <span className="cloud-push-preview__seg" title={row.segmentName}>
                {row.segmentName || '—'}
              </span>
              <span className="cloud-push-preview__type">{row.programType || '—'}</span>
              <span className="cloud-push-preview__dur">{row.durationLabel}</span>
              <span className="cloud-push-preview__flags">
                {row.flags.map((f) => (
                  <span key={f} className={`cloud-push-preview__flag cloud-push-preview__flag--${f}`}>
                    {FLAG_LABEL[f] || f}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
        {showingPartial ? (
          <p className="cloud-push-preview__footnote">
            Showing {showRows.length} of {preview.scheduleCount} rows — full schedule still uploads.
          </p>
        ) : null}
      </div>
    </div>
  );
};

export default CloudReconnectPreviewPanel;
