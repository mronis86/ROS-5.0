import React, { useEffect, useState } from 'react';
import {
  EXTEND_EVENT_CONTROL_MODULES,
  EXTEND_MODULE_LABELS,
  ExtendEventControlModule,
  ExtendEventControlsConfig,
} from '../lib/extendEventControls';

type Props = {
  open: boolean;
  eventName: string;
  initial: ExtendEventControlsConfig;
  saving?: boolean;
  onClose: () => void;
  onSave: (config: ExtendEventControlsConfig) => void;
};

const ExtendEventControlsConfigModal: React.FC<Props> = ({
  open,
  eventName,
  initial,
  saving = false,
  onClose,
  onSave,
}) => {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [modules, setModules] = useState<ExtendEventControlModule[]>(
    initial.modules.length ? initial.modules : ['civicsBee']
  );

  useEffect(() => {
    if (!open) return;
    setEnabled(initial.enabled);
    setModules(initial.modules.length ? initial.modules : ['civicsBee']);
  }, [open, initial.enabled, initial.modules]);

  if (!open) return null;

  const toggleModule = (id: ExtendEventControlModule) => {
    setModules((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 shadow-xl">
        <div className="border-b border-slate-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-white">Extend Event Controls</h2>
          <p className="mt-1 text-sm text-slate-400">{eventName}</p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-3">
            <span className="text-sm text-slate-200">Enable for this event</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4"
            />
          </label>
          <div className={enabled ? '' : 'pointer-events-none opacity-50'}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Modules
            </p>
            <div className="space-y-2">
              {EXTEND_EVENT_CONTROL_MODULES.map((id) => (
                <label
                  key={id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <span>{EXTEND_MODULE_LABELS[id]}</span>
                  <input
                    type="checkbox"
                    checked={modules.includes(id)}
                    onChange={() => toggleModule(id)}
                    className="h-4 w-4"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-700 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || (enabled && modules.length === 0)}
            onClick={() => onSave({ enabled, modules: enabled ? modules : [] })}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExtendEventControlsConfigModal;
