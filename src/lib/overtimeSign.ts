import { useEffect, useState } from 'react';

export type OvertimeSignId = 'minus' | 'plus';

export const OVERTIME_SIGN_STORAGE_KEY = 'ros.overtimeSign';
export const OVERTIME_SIGN_CHANGE_EVENT = 'ros:overtime-sign-change';

export const OVERTIME_SIGN_OPTIONS: {
  id: OvertimeSignId;
  label: string;
  description: string;
  preview: string;
}[] = [
  {
    id: 'minus',
    label: 'Minus (−)',
    description: 'Overtime counts down through zero: −01:23',
    preview: '−01:23',
  },
  {
    id: 'plus',
    label: 'Plus (+)',
    description: 'Overtime counts up from zero: +01:23',
    preview: '+01:23',
  },
];

let cachedOvertimeSignId: OvertimeSignId | null = null;

function readOvertimeSignFromStorage(): OvertimeSignId | null {
  try {
    const raw = localStorage.getItem(OVERTIME_SIGN_STORAGE_KEY);
    if (raw === 'minus' || raw === 'plus') return raw;
  } catch {
    // ignore
  }
  return null;
}

export function parseOvertimeSignId(value: unknown): OvertimeSignId | null {
  return value === 'minus' || value === 'plus' ? value : null;
}

export function getOvertimeSignId(): OvertimeSignId {
  if (cachedOvertimeSignId) return cachedOvertimeSignId;
  return readOvertimeSignFromStorage() ?? 'minus';
}

export function applyOvertimeSignId(id: OvertimeSignId): void {
  cachedOvertimeSignId = id;
  try {
    localStorage.setItem(OVERTIME_SIGN_STORAGE_KEY, id);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(OVERTIME_SIGN_CHANGE_EVENT, { detail: { overtimeSignId: id } }));
}

/** Prefix for overtime (negative remaining). Empty when still on the clock. */
export function overtimeSignPrefix(
  seconds: number,
  sign: OvertimeSignId = getOvertimeSignId()
): string {
  if (!(seconds < 0)) return '';
  return sign === 'plus' ? '+' : '−';
}

/** Subscribe so open clocks update when Admin changes the overtime sign. */
export function useOvertimeSign(): OvertimeSignId {
  const [sign, setSign] = useState<OvertimeSignId>(() => getOvertimeSignId());
  useEffect(() => {
    const onChange = () => setSign(getOvertimeSignId());
    window.addEventListener(OVERTIME_SIGN_CHANGE_EVENT, onChange);
    window.addEventListener('ros:branding-change', onChange);
    return () => {
      window.removeEventListener(OVERTIME_SIGN_CHANGE_EVENT, onChange);
      window.removeEventListener('ros:branding-change', onChange);
    };
  }, []);
  return sign;
}
