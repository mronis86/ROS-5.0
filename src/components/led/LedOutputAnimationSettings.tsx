import React from 'react';
import {
  DEFAULT_LED_OUTPUT_ANIMATION,
  LED_ANIMATION_EASING_OPTIONS,
  LED_ANIMATION_STYLE_OPTIONS,
  isMotionLedAnimation,
  isSlideLedAnimation,
} from '../../lib/ledOutputAnimation';
import type { LedOutputAnimation } from '../../types/ledOutput';
import LedOutputAnimationPreview, {
  type LedAnimationPreviewContent,
} from './LedOutputAnimationPreview';

const fieldClass =
  'mt-1 w-full bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-xs text-slate-100';

type LedOutputAnimationSettingsProps = {
  value: LedOutputAnimation;
  onChange: (value: LedOutputAnimation) => void;
  preview?: LedAnimationPreviewContent | null;
};

const LedOutputAnimationSettings: React.FC<LedOutputAnimationSettingsProps> = ({
  value,
  onChange,
  preview = null,
}) => {
  const patch = (partial: Partial<LedOutputAnimation>) => onChange({ ...value, ...partial });

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <h3 className="font-semibold mb-1 text-sm">Output animation</h3>
      <p className="text-xs text-slate-500 mb-3">
        Clears between cues. Use delays to sync with your media server.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm sm:col-span-2">
          <span className="text-slate-400">Style</span>
          <select
            value={value.style}
            onChange={(e) => patch({ style: e.target.value as LedOutputAnimation['style'] })}
            className={fieldClass}
          >
            {LED_ANIMATION_STYLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Easing</span>
          <select
            value={value.easing}
            onChange={(e) => patch({ easing: e.target.value as LedOutputAnimation['easing'] })}
            className={fieldClass}
          >
            {LED_ANIMATION_EASING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">In duration (ms)</span>
          <input
            type="number"
            min={0}
            max={10000}
            step={50}
            value={value.inDurationMs}
            onChange={(e) => patch({ inDurationMs: parseInt(e.target.value, 10) || 0 })}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Out duration (ms)</span>
          <input
            type="number"
            min={0}
            max={10000}
            step={50}
            value={value.outDurationMs}
            onChange={(e) => patch({ outDurationMs: parseInt(e.target.value, 10) || 0 })}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">In delay (ms)</span>
          <input
            type="number"
            min={0}
            max={10000}
            step={50}
            value={value.inDelayMs}
            onChange={(e) => patch({ inDelayMs: parseInt(e.target.value, 10) || 0 })}
            className={fieldClass}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-400">Out delay (ms)</span>
          <input
            type="number"
            min={0}
            max={10000}
            step={50}
            value={value.outDelayMs}
            onChange={(e) => patch({ outDelayMs: parseInt(e.target.value, 10) || 0 })}
            className={fieldClass}
          />
        </label>
        {isMotionLedAnimation(value.style) ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.fadeWithMotion}
              onChange={(e) => patch({ fadeWithMotion: e.target.checked })}
              className="rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-slate-300">Fade opacity with motion</span>
          </label>
        ) : null}
        {isSlideLedAnimation(value.style) ? (
          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-400">
              Slide distance ({value.slideDistancePx}px on 4K canvas)
            </span>
            <input
              type="range"
              min={0}
              max={2000}
              step={8}
              value={value.slideDistancePx}
              onChange={(e) => patch({ slideDistancePx: parseInt(e.target.value, 10) || 0 })}
              className="mt-1 w-full"
            />
            <div className="mt-1 flex flex-wrap gap-1.5">
              {[
                { label: 'Short', px: 48 },
                { label: 'Medium', px: 192 },
                { label: 'Long', px: 480 },
                { label: 'Off-screen', px: 960 },
              ].map((preset) => (
                <button
                  key={preset.px}
                  type="button"
                  onClick={() => patch({ slideDistancePx: preset.px })}
                  className={`px-2 py-0.5 rounded text-[11px] ${
                    value.slideDistancePx === preset.px
                      ? 'bg-cyan-700 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              How far off-position the graphic starts before sliding in. Use with left/right/up/down
              styles — try 400–1200 for a long travel on 4K.
            </p>
          </label>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_LED_OUTPUT_ANIMATION })}
        className="mt-3 text-xs text-slate-400 hover:text-slate-200"
      >
        Reset to defaults
      </button>

      <LedOutputAnimationPreview animation={value} content={preview} />
    </div>
  );
};

export default LedOutputAnimationSettings;
