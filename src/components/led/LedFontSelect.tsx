import React, { useEffect, useState } from 'react';
import type { LedFontStyle, LedFontWeight } from '../../types/ledText';
import type { LedHostedFontGroup } from '../../lib/ledFonts';
import {
  findFontGroup,
  fontOptionLabel,
  getFontsForPickerGroup,
  LED_HOSTED_FONT_GROUPS,
} from '../../lib/ledFonts';

type FontPickerGroup = LedHostedFontGroup | 'System' | 'Other';

const GROUP_OPTIONS: { value: FontPickerGroup; label: string }[] = [
  ...LED_HOSTED_FONT_GROUPS.map((g) => ({ value: g as FontPickerGroup, label: g })),
  { value: 'System', label: 'System' },
  { value: 'Other', label: 'Other' },
];

const fieldClass =
  'bg-slate-900 border border-slate-600 rounded-md px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500/60';

type LedFontSelectProps = {
  value: string;
  onChange: (value: string) => void;
  fontWeight?: LedFontWeight;
  fontStyle?: LedFontStyle;
  allowInherit?: boolean;
  inheritHint?: string;
  className?: string;
};

const LedFontSelect: React.FC<LedFontSelectProps> = ({
  value,
  onChange,
  fontWeight = 400,
  fontStyle = 'normal',
  allowInherit = false,
  inheritHint,
}) => {
  const initialGroup = allowInherit && !value ? 'System' : findFontGroup(value);
  const [group, setGroup] = useState<FontPickerGroup>(initialGroup);
  const [customMode, setCustomMode] = useState(initialGroup === 'Other');

  useEffect(() => {
    if (!value) return;
    const detected = findFontGroup(value);
    setGroup(detected);
    setCustomMode(detected === 'Other');
  }, [value]);

  const fontsInGroup = getFontsForPickerGroup(group);

  const handleGroupChange = (next: FontPickerGroup) => {
    setGroup(next);
    if (next === 'Other') {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    const options = getFontsForPickerGroup(next);
    if (options.length > 0) onChange(options[0].value);
  };

  const previewStyle: React.CSSProperties = {
    fontFamily: value || inheritHint || 'inherit',
    fontWeight,
    fontStyle,
  };

  if (allowInherit && !value && !customMode) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => onChange('')}
          className={`${fieldClass} w-full text-left text-slate-400`}
        >
          {inheritHint || 'Use global default'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1.5 min-w-0">
        <select
          value={group}
          onChange={(e) => handleGroupChange(e.target.value as FontPickerGroup)}
          className={`${fieldClass} w-[6.8rem] shrink-0`}
          title="Font family"
        >
          {GROUP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {customMode || group === 'Other' ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Font name"
            className={`${fieldClass} flex-1 min-w-0`}
          />
        ) : (
          <select
            value={fontsInGroup.some((f) => f.value === value) ? value : fontsInGroup[0]?.value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={`${fieldClass} flex-1 min-w-0 truncate`}
            title={fontOptionLabel(value)}
          >
            {fontsInGroup.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {value ? (
        <p
          className="text-[11px] text-slate-500 truncate leading-tight px-0.5"
          style={previewStyle}
          title={fontOptionLabel(value)}
        >
          {fontOptionLabel(value)}
        </p>
      ) : null}
    </div>
  );
};

export default LedFontSelect;
