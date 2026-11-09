import React, { useEffect } from 'react';

export type OfflineDialogProps = {
  open: boolean;
  title: string;
  message: string;
  /** Confirm / primary action. Omit for notice-only (single dismiss). */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'info' | 'warn' | 'error';
  busy?: boolean;
  onConfirm?: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
};

/**
 * Non-blocking modal — does not use window.alert/confirm, so countdown
 * timers keep ticking while the operator reads and clicks.
 */
const OfflineDialog: React.FC<OfflineDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'info',
  busy = false,
  onConfirm,
  onCancel,
  children,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const isConfirm = typeof onConfirm === 'function' && confirmLabel;

  return (
    <div
      className={`offline-dialog-backdrop offline-dialog-backdrop--${tone}`}
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="offline-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-dialog-title"
        aria-describedby="offline-dialog-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="offline-dialog-title" className="offline-dialog__title">
          {title}
        </h2>
        <p id="offline-dialog-body" className="offline-dialog__message">
          {message}
        </p>
        {children}
        <p className="offline-dialog__timer-hint">Timers keep running while this is open.</p>
        <div className="offline-dialog__actions">
          {isConfirm ? (
            <>
              <button
                type="button"
                className="offline-dialog__btn offline-dialog__btn--ghost"
                disabled={busy}
                onClick={onCancel}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className={`offline-dialog__btn offline-dialog__btn--primary offline-dialog__btn--${tone}`}
                disabled={busy}
                onClick={onConfirm}
              >
                {busy ? 'Working…' : confirmLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="offline-dialog__btn offline-dialog__btn--primary"
              disabled={busy}
              onClick={onCancel}
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OfflineDialog;
