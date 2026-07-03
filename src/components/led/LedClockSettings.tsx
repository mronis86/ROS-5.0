import React from 'react';
import { DEFAULT_LED_OUTPUT_CLOCK } from '../../lib/ledClock';
import type { LedOutputClock, LedClockVisibility } from '../../types/ledClock';
import LedFontSelect from './LedFontSelect';
import LedCanvas from './LedCanvas';
import LedClockOverlay from './LedClockOverlay';

const fieldClass =
  'mt-1 w-full bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-xs text-slate-100';

const VISIBILITY_OPTIONS: { value: LedClockVisibility; label: string }[] = [
  { value: 'break-only', label: 'Break only (when graphics are cleared)' },
  { value: 'always', label: 'Always (overlay on graphics too)' },
];

type LedClockSettingsProps = {
  value: LedOutputClock;
  onChange: (value: LedOutputClock) => void;
};

const LedClockSettings: React.FC<LedClockSettingsProps> = ({ value, onChange }) => {
  const patch = (partial: Partial<LedOutputClock>) => onChange({ ...value, ...partial });

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <h3 className="font-semibold mb-1 text-sm">Break countdown</h3>
      <p className="text-xs text-slate-500 mb-3">
        Show the Run of Show timer countdown on output — keeps the audience on time during breaks.
      </p>

      <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
        />
        <span className="text-slate-300">Enable countdown on output</span>
      </label>

      {value.enabled ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-400">When to show</span>
            <select
              value={value.visibility}
              onChange={(e) => patch({ visibility: e.target.value as LedClockVisibility })}
              className={fieldClass}
            >
              {VISIBILITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.showLabel}
              onChange={(e) => patch({ showLabel: e.target.checked })}
              className="rounded border-slate-600 bg-slate-900 text-cyan-500"
            />
            <span className="text-slate-300">Show label above countdown</span>
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-400">Label text</span>
            <input
              type="text"
              value={value.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder="Break ends in"
              className={fieldClass}
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-400">Font</span>
            <LedFontSelect
              value={value.fontFamily}
              onChange={(fontFamily) => patch({ fontFamily })}
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Timer size ({value.fontSize}px)</span>
            <input
              type="range"
              min={48}
              max={320}
              step={4}
              value={value.fontSize}
              onChange={(e) => patch({ fontSize: parseInt(e.target.value, 10) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Scale ({value.scale.toFixed(2)}×)</span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={value.scale}
              onChange={(e) => patch({ scale: parseFloat(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">X ({value.x.toFixed(0)}%)</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={value.x}
              onChange={(e) => patch({ x: parseFloat(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Y ({value.y.toFixed(0)}%)</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={value.y}
              onChange={(e) => patch({ y: parseFloat(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Align</span>
            <select
              value={value.align}
              onChange={(e) =>
                patch({ align: e.target.value as LedOutputClock['align'] })
              }
              className={fieldClass}
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Text color</span>
            <input
              type="color"
              value={value.color}
              onChange={(e) => patch({ color: e.target.value })}
              className="mt-1 h-9 w-full rounded cursor-pointer bg-slate-900 border border-slate-600"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Label color</span>
            <input
              type="color"
              value={value.labelColor}
              onChange={(e) => patch({ labelColor: e.target.value })}
              className="mt-1 h-9 w-full rounded cursor-pointer bg-slate-900 border border-slate-600"
            />
          </label>

          <label className="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.showBackground}
              onChange={(e) => patch({ showBackground: e.target.checked })}
              className="rounded border-slate-600 bg-slate-900 text-cyan-500"
            />
            <span className="text-slate-300">Background pill behind countdown</span>
          </label>

          {value.showBackground ? (
            <>
              <label className="block text-sm">
                <span className="text-slate-400">Background</span>
                <input
                  type="color"
                  value={value.backgroundColor}
                  onChange={(e) => patch({ backgroundColor: e.target.value })}
                  className="mt-1 h-9 w-full rounded cursor-pointer bg-slate-900 border border-slate-600"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-400">Background opacity</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={value.backgroundOpacity}
                  onChange={(e) => patch({ backgroundOpacity: parseFloat(e.target.value) })}
                  className="mt-1 w-full"
                />
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {value.enabled ? (
        <div className="mt-3 pt-3 border-t border-slate-700">
          <span className="text-xs text-slate-400 block mb-2">Preview</span>
          <LedCanvas fitParent className="bg-slate-950/80">
            <LedClockOverlay clock={value} timer={null} preview />
          </LedCanvas>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_LED_OUTPUT_CLOCK })}
        className="mt-3 text-xs text-slate-400 hover:text-slate-200"
      >
        Reset countdown to defaults
      </button>
    </div>
  );
};

export default LedClockSettings;
