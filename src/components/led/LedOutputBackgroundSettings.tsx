import React from 'react';
import type { LedOutputBackground } from '../../types/ledOutput';
import { DEFAULT_LED_OUTPUT_BACKGROUND } from '../../types/ledOutput';

const fieldClass =
  'mt-1 w-full bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-xs text-slate-100';

type LedOutputBackgroundSettingsProps = {
  value: LedOutputBackground;
  onChange: (value: LedOutputBackground) => void;
};

const LedOutputBackgroundSettings: React.FC<LedOutputBackgroundSettingsProps> = ({
  value,
  onChange,
}) => {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <h3 className="font-semibold mb-1 text-sm">Output background</h3>
      <p className="text-xs text-slate-500 mb-3">
        Event-wide setting for the LED output page (OBS / media server). Transparent uses true
        alpha for keying; solid color fills the output frame.
      </p>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="text-slate-400">Background</span>
          <select
            value={value.mode}
            onChange={(e) =>
              onChange({
                ...value,
                mode: e.target.value === 'color' ? 'color' : 'transparent',
              })
            }
            className={fieldClass}
          >
            <option value="transparent">Transparent</option>
            <option value="color">Solid color</option>
          </select>
        </label>
        {value.mode === 'color' ? (
          <label className="block text-sm">
            <span className="text-slate-400">Color</span>
            <input
              type="color"
              value={value.color}
              onChange={(e) => onChange({ ...value, color: e.target.value })}
              className="mt-1 w-full h-10 bg-slate-900 border border-slate-600 rounded-lg cursor-pointer"
            />
          </label>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_LED_OUTPUT_BACKGROUND })}
        className="mt-3 text-xs text-slate-400 hover:text-slate-200"
      >
        Reset to transparent
      </button>
    </div>
  );
};

export default LedOutputBackgroundSettings;
