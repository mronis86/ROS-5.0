import React from 'react';
import type { LedFontStyle, LedFontWeight } from '../../types/ledText';
import { LED_FONT_STYLE_OPTIONS, LED_FONT_WEIGHT_OPTIONS } from '../../lib/ledFonts';
import LedFontSelect from './LedFontSelect';

const fieldClass =
  'mt-0.5 w-full bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/60';

type LedFontRoleSettingsProps = {
  label: string;
  fontFamily: string;
  fontWeight: LedFontWeight;
  fontStyle: LedFontStyle;
  onFontFamilyChange: (value: string) => void;
  onFontWeightChange: (value: LedFontWeight) => void;
  onFontStyleChange: (value: LedFontStyle) => void;
};

const LedFontRoleSettings: React.FC<LedFontRoleSettingsProps> = ({
  label,
  fontFamily,
  fontWeight,
  fontStyle,
  onFontFamilyChange,
  onFontWeightChange,
  onFontStyleChange,
}) => (
  <div className="sm:col-span-2 rounded-md border border-slate-700/80 bg-slate-900/30 px-2.5 py-2">
    <p className="text-xs font-medium text-slate-300 mb-1.5">{label}</p>
    <LedFontSelect
      value={fontFamily}
      fontWeight={fontWeight}
      fontStyle={fontStyle}
      onChange={onFontFamilyChange}
    />
    <div className="grid grid-cols-2 gap-1.5 mt-1.5">
      <label className="block">
        <span className="text-[11px] text-slate-500">Weight</span>
        <select
          value={fontWeight}
          onChange={(e) => onFontWeightChange(parseInt(e.target.value, 10) as LedFontWeight)}
          className={fieldClass}
        >
          {LED_FONT_WEIGHT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-[11px] text-slate-500">Style</span>
        <select
          value={fontStyle}
          onChange={(e) => onFontStyleChange(e.target.value as LedFontStyle)}
          className={fieldClass}
        >
          {LED_FONT_STYLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  </div>
);

export default LedFontRoleSettings;
