import React, { useEffect, useMemo, useState } from 'react';

type Choice = { id: string; label: string; votes: number; color: string };

type PollTypeId = 'single' | 'multi' | 'yesno' | 'rating' | 'ranked';

type TabId = 'vote' | 'results' | 'surfaces' | 'limits';

type ResultStyleId =
  | 'bars'
  | 'vertical'
  | 'donut'
  | 'pie'
  | 'winner'
  | 'leaderboard'
  | 'ab'
  | 'histogram';

type SurfaceId = 'stage' | 'lower' | 'pip';

/** Horizontal / leaderboard bar presentation */
type BarStyleId = 'fill' | 'track';

/** Vertical bar scale in Results preview */
type VerticalScaleId = 'tall' | 'compact';

/** When lower third has many options: pack them in, or page through */
type LowerOverflowId = 'squeeze' | 'rotate';

type PipPlacementId = 'br' | 'bl' | 'tr' | 'tl';

type PipScaleId = 's' | 'm' | 'l' | 'xl';

/** Surface motion: off, chrome reveal only, or reveal + bar/pie grow */
type SurfaceMotionId = 'off' | 'reveal' | 'grow';

const SURFACE_MOTION_CSS = `
@keyframes ros-lt-in {
  from { transform: translateY(112%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes ros-pip-in {
  from { transform: scale(0.88) translateY(6%); opacity: 0; }
  to { transform: scale(1) translateY(0); opacity: 1; }
}
@keyframes ros-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes ros-grow-x {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes ros-grow-y {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}
@keyframes ros-pie-in {
  from { transform: scale(0.72); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes ros-page-in {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}
`;

function surfaceAnim(
  motion: SurfaceMotionId,
  kind: 'reveal' | 'grow',
  name: string,
  opts?: { duration?: string; delayMs?: number; origin?: string }
): React.CSSProperties {
  if (motion === 'off') return {};
  if (kind === 'grow' && motion !== 'grow') return {};
  if (kind === 'reveal' && motion === 'off') return {};
  const ease =
    kind === 'reveal' ? 'cubic-bezier(0.33, 0.1, 0.25, 1)' : 'cubic-bezier(0.22, 1, 0.36, 1)';
  const fallback = kind === 'reveal' ? '1.15s' : '0.75s';
  return {
    animation: `${name} ${opts?.duration || fallback} ${ease} both`,
    animationDelay: opts?.delayMs ? `${opts.delayMs}ms` : undefined,
    transformOrigin: opts?.origin,
  };
}

const PIP_PLACEMENTS: { id: PipPlacementId; label: string }[] = [
  { id: 'br', label: 'Bottom right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'tr', label: 'Top right' },
  { id: 'tl', label: 'Top left' },
];

const PIP_SCALES: { id: PipScaleId; label: string; widthPct: number }[] = [
  { id: 's', label: 'S · 18%', widthPct: 18 },
  { id: 'm', label: 'M · 24%', widthPct: 24 },
  { id: 'l', label: 'L · 30%', widthPct: 30 },
  { id: 'xl', label: 'XL · 38%', widthPct: 38 },
];

function pipPositionStyle(placement: PipPlacementId): React.CSSProperties {
  const inset = '4%';
  switch (placement) {
    case 'bl':
      return { left: inset, bottom: '8%', right: 'auto', top: 'auto' };
    case 'tr':
      return { right: inset, top: '6%', left: 'auto', bottom: 'auto' };
    case 'tl':
      return { left: inset, top: '6%', right: 'auto', bottom: 'auto' };
    case 'br':
    default:
      return { right: inset, bottom: '8%', left: 'auto', top: 'auto' };
  }
}

type ResultLook = {
  showPct: boolean;
  showCounts: boolean;
  showLabels: boolean;
  accentBars: boolean;
};

type ColorPresetGroup = 'various' | 'monotone';

type ColorPreset = {
  id: string;
  label: string;
  group: ColorPresetGroup;
  /** Up to 8 slice/bar colors */
  colors: string[];
};

const POLL_TYPES: { id: PollTypeId; label: string; question: string; blurb: string }[] = [
  {
    id: 'single',
    label: 'Single choice',
    question: 'Preferred event format for 2027?',
    blurb: 'Audience picks one option.',
  },
  {
    id: 'multi',
    label: 'Multi-select',
    question: 'Which formats interest you? (pick any)',
    blurb: 'Audience picks one or more options.',
  },
  {
    id: 'yesno',
    label: 'Yes / No / Skip',
    question: 'Should we keep the afternoon breakout?',
    blurb: 'Fast binary with an opt-out.',
  },
  {
    id: 'rating',
    label: 'Rating scale (1–5)',
    question: 'How useful was this session?',
    blurb: 'Satisfaction / quality score.',
  },
  {
    id: 'ranked',
    label: 'Ranked choice',
    question: 'Rank these formats by preference',
    blurb: 'Audience orders options.',
  },
];

const SAMPLE_POOL: Choice[] = [
  { id: 'a', label: 'Hybrid / hybrid-first', votes: 142, color: '#38bdf8' },
  { id: 'b', label: 'In-person only', votes: 98, color: '#a78bfa' },
  { id: 'c', label: 'Virtual only', votes: 61, color: '#34d399' },
  { id: 'd', label: 'Undecided', votes: 37, color: '#94a3b8' },
  { id: 'e', label: 'Regional hubs', votes: 54, color: '#f472b6' },
  { id: 'f', label: 'Pop-up events', votes: 29, color: '#fbbf24' },
  { id: 'g', label: 'Invite-only', votes: 22, color: '#fb923c' },
  { id: 'h', label: 'No preference', votes: 15, color: '#2dd4bf' },
];

const OPTION_COUNT_TYPES: PollTypeId[] = ['single', 'multi', 'ranked'];

const YES_NO: Choice[] = [
  { id: 'yes', label: 'Yes', votes: 218, color: '#34d399' },
  { id: 'no', label: 'No', votes: 94, color: '#f87171' },
  { id: 'skip', label: 'Skip', votes: 31, color: '#64748b' },
];

const RATING = [
  { score: 1, votes: 8 },
  { score: 2, votes: 14 },
  { score: 3, votes: 41 },
  { score: 4, votes: 96 },
  { score: 5, votes: 128 },
];

const TABS: { id: TabId; label: string; step: string }[] = [
  { id: 'vote', label: '1 · Vote UI', step: 'How the audience answers' },
  { id: 'results', label: '2 · Results', step: 'How totals look after voting' },
  { id: 'surfaces', label: '3 · Surfaces', step: 'Stage · lower third · PiP' },
  { id: 'limits', label: '4 · Limits', step: 'Ingest · drain · live totals' },
];

const RESULT_STYLES: {
  id: ResultStyleId;
  label: string;
  forTypes: PollTypeId[];
}[] = [
  { id: 'bars', label: 'Horizontal bars', forTypes: ['single', 'multi', 'yesno', 'ranked'] },
  { id: 'vertical', label: 'Vertical bars', forTypes: ['single', 'multi', 'yesno', 'ranked'] },
  { id: 'donut', label: 'Donut', forTypes: ['single', 'yesno'] },
  { id: 'pie', label: 'Pie', forTypes: ['single', 'yesno'] },
  { id: 'winner', label: 'Winner focus', forTypes: ['single', 'yesno', 'ranked'] },
  { id: 'leaderboard', label: 'Leaderboard race', forTypes: ['single', 'multi', 'ranked'] },
  { id: 'ab', label: 'A / B side-by-side', forTypes: ['yesno'] },
  { id: 'histogram', label: 'Rating histogram', forTypes: ['rating'] },
];

const DEFAULT_LOOK: ResultLook = {
  showPct: true,
  showCounts: true,
  showLabels: true,
  accentBars: true,
};

const COLOR_PRESETS: ColorPreset[] = [
  {
    id: 'spectrum',
    label: 'Spectrum',
    group: 'various',
    colors: ['#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#fb923c', '#2dd4bf', '#94a3b8'],
  },
  {
    id: 'cool',
    label: 'Cool',
    group: 'various',
    colors: ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#67e8f9', '#60a5fa', '#c4b5fd', '#5eead4'],
  },
  {
    id: 'warm',
    label: 'Warm',
    group: 'various',
    colors: ['#f87171', '#fb923c', '#fbbf24', '#f472b6', '#ef4444', '#f59e0b', '#e11d48', '#fdba74'],
  },
  {
    id: 'neon',
    label: 'Neon',
    group: 'various',
    colors: ['#22d3ee', '#a3e635', '#e879f9', '#facc15', '#fb7185', '#4ade80', '#38bdf8', '#f97316'],
  },
  {
    id: 'pastel',
    label: 'Pastel',
    group: 'various',
    colors: ['#7dd3fc', '#c4b5fd', '#86efac', '#fda4af', '#fde68a', '#fdba74', '#5eead4', '#cbd5e1'],
  },
  {
    id: 'mono-amber',
    label: 'Amber',
    group: 'monotone',
    colors: ['#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e'],
  },
  {
    id: 'mono-sky',
    label: 'Sky',
    group: 'monotone',
    colors: ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985'],
  },
  {
    id: 'mono-violet',
    label: 'Violet',
    group: 'monotone',
    colors: ['#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6'],
  },
  {
    id: 'mono-emerald',
    label: 'Emerald',
    group: 'monotone',
    colors: ['#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46'],
  },
  {
    id: 'mono-rose',
    label: 'Rose',
    group: 'monotone',
    colors: ['#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239'],
  },
  {
    id: 'mono-slate',
    label: 'Slate',
    group: 'monotone',
    colors: ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b'],
  },
];

const DEFAULT_COLOR_PRESET = 'spectrum';

const DARK = {
  panel: 'bg-slate-950/60 text-slate-200 border-slate-800',
  muted: 'text-slate-400',
  barTrack: 'bg-slate-800',
  card: 'bg-slate-900 border-slate-800',
  strong: 'text-white',
};

function totalVotes(choices: Choice[]) {
  return choices.reduce((n, c) => n + c.votes, 0) || 1;
}

function pct(votes: number, total: number) {
  return Math.round((votes / total) * 100);
}

function getColorPreset(id: string): ColorPreset {
  return COLOR_PRESETS.find((p) => p.id === id) || COLOR_PRESETS[0];
}

/** Mid-strength swatch for single-accent charts (rating, etc.). */
function presetAccent(preset: ColorPreset) {
  const colors = preset.colors;
  return colors[Math.min(3, colors.length - 1)];
}

function applyPalette(choices: Choice[], colors: string[]): Choice[] {
  return choices.map((c, i) => ({
    ...c,
    color: colors[i % colors.length],
  }));
}

function choicesForType(type: PollTypeId, optionCount: number): Choice[] {
  if (type === 'yesno') return YES_NO;
  return SAMPLE_POOL.slice(0, Math.min(Math.max(optionCount, 2), SAMPLE_POOL.length));
}

function shortChoiceLabel(label: string) {
  return label.split(/[/(]/)[0].trim();
}

/** Compact SVG pie/donut for surfaces (fills available box). */
function SurfacePieSvg({
  choices,
  variant,
  showPct,
  motion = 'off',
  motionKey = 0,
}: {
  choices: Choice[];
  variant: 'pie' | 'donut';
  showPct: boolean;
  motion?: SurfaceMotionId;
  motionKey?: number;
}) {
  const total = totalVotes(choices);
  const size = 100;
  const cx = 50;
  const cy = 50;
  const outerR = variant === 'donut' ? 46 : 47;
  const innerR = variant === 'donut' ? 26 : 0;
  const gapDeg = 2;
  let start = -90;
  const slices = choices.map((c) => {
    const sweep = (c.votes / total) * 360;
    const usable = Math.max(sweep - gapDeg, 0.01);
    const mid = start + usable / 2;
    const slice = { ...c, start, sweep: usable, mid, p: pct(c.votes, total) };
    start += sweep;
    return slice;
  });
  const polar = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const arcPath = (fromDeg: number, sweep: number, rOuter: number, rInner: number) => {
    const end = fromDeg + sweep;
    const large = sweep > 180 ? 1 : 0;
    const o0 = polar(fromDeg, rOuter);
    const o1 = polar(end, rOuter);
    if (rInner <= 0) {
      return `M ${cx} ${cy} L ${o0.x} ${o0.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y} Z`;
    }
    const i0 = polar(fromDeg, rInner);
    const i1 = polar(end, rInner);
    return `M ${o0.x} ${o0.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${rInner} ${rInner} 0 ${large} 0 ${i0.x} ${i0.y} Z`;
  };
  return (
    <svg
      key={motionKey}
      viewBox={`0 0 ${size} ${size}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      style={surfaceAnim(motion, 'grow', 'ros-pie-in', { duration: '0.7s', origin: '50% 50%' })}
    >
      {slices.map((s, i) => (
        <path
          key={s.id}
          d={arcPath(s.start, s.sweep, outerR, innerR)}
          fill={s.color}
          stroke="#070b14"
          strokeWidth={1.5}
          style={surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1.05s', delayMs: 80 + i * 70 })}
        />
      ))}
      {showPct
        ? slices
            .filter((s) => s.p >= 10)
            .map((s) => {
              const pos = polar(s.mid, variant === 'donut' ? (outerR + innerR) / 2 : outerR * 0.58);
              return (
                <text
                  key={`${s.id}-p`}
                  x={pos.x}
                  y={pos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  style={{
                    fontSize: 7,
                    fontWeight: 700,
                    ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1s', delayMs: 520 }),
                  }}
                >
                  {s.p}%
                </text>
              );
            })
        : null}
    </svg>
  );
}

function metricText(c: Choice, total: number, look: ResultLook) {
  const parts: string[] = [];
  if (look.showPct) parts.push(`${pct(c.votes, total)}%`);
  if (look.showCounts) parts.push(`${c.votes}`);
  return parts.join(' · ');
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/80 ${className}`}>{children}</div>
  );
}

function VoteButtons({
  choices,
  multi,
  selected,
  onToggle,
}: {
  choices: Choice[];
  multi?: boolean;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2 max-w-md">
      {choices.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
              on
                ? 'border-amber-400/50 bg-amber-500/10 text-white'
                : 'border-slate-700 bg-slate-950/50 text-slate-200 hover:border-slate-500'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <span
                className={`w-4 h-4 border flex items-center justify-center ${
                  multi ? 'rounded-sm' : 'rounded-full'
                } ${on ? 'border-amber-300 bg-amber-400/30' : 'border-slate-600'}`}
              >
                {on ? <span className="w-1.5 h-1.5 rounded-full bg-amber-200" /> : null}
              </span>
              {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function HorizontalBars({
  choices,
  look,
  barStyle,
  ranked,
}: {
  choices: Choice[];
  look: ResultLook;
  barStyle: BarStyleId;
  ranked?: boolean;
}) {
  const total = totalVotes(choices);
  const max = Math.max(...choices.map((c) => c.votes), 1);
  const sorted = ranked ? [...choices].sort((a, b) => b.votes - a.votes) : choices;

  if (barStyle === 'fill') {
    // Matches stage 16∶9 fill bars — label + value inside thick rows
    return (
      <div
        className={`rounded-lg border overflow-hidden max-w-2xl ${DARK.panel}`}
        style={{ containerType: 'inline-size' }}
      >
        <div
          className="bg-slate-950 p-[3.5%] grid gap-[2.5%]"
          style={{
            aspectRatio: '16 / 9',
            gridTemplateRows: `repeat(${sorted.length}, minmax(0, 1fr))`,
          }}
        >
          {sorted.map((c, i) => {
            const p = pct(c.votes, total);
            const barPct = (c.votes / max) * 100;
            const fill = look.accentBars ? c.color : '#94a3b8';
            return (
              <div
                key={c.id}
                className="relative min-h-0 rounded-xl overflow-hidden bg-white/10"
              >
                <div
                  className="absolute inset-y-0 left-0 transition-all duration-700"
                  style={{ width: `${barPct}%`, background: fill, opacity: 0.92 }}
                />
                <div className="relative z-[1] h-full flex items-center justify-between gap-3 px-[2.2%]">
                  <span
                    className="font-semibold text-white truncate"
                    style={{
                      fontSize: 'clamp(13px, 3.2cqi, 26px)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.55)',
                    }}
                  >
                    {ranked ? `${i + 1}. ` : ''}
                    {look.showLabels ? c.label : ''}
                  </span>
                  <span
                    className="font-bold tabular-nums text-white shrink-0"
                    style={{
                      fontSize: 'clamp(14px, 3.8cqi, 30px)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.55)',
                    }}
                  >
                    {look.showPct ? `${p}%` : look.showCounts ? c.votes : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Track: skinny bars with labels above (compact admin / phone look)
  return (
    <div className={`rounded-lg border p-4 space-y-3 max-w-lg ${DARK.panel}`}>
      {sorted.map((c, i) => (
        <div key={c.id}>
          <div className="flex justify-between text-xs mb-1 gap-2">
            <span className={look.showLabels ? DARK.strong : 'sr-only'}>
              {ranked ? `${i + 1}. ` : ''}
              {c.label}
            </span>
            <span className={`${DARK.muted} tabular-nums shrink-0`}>{metricText(c, total, look)}</span>
          </div>
          <div className={`h-2.5 rounded-full overflow-hidden ${DARK.barTrack}`}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${(c.votes / max) * 100}%`,
                background: look.accentBars ? c.color : '#94a3b8',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function VerticalBars({
  choices,
  look,
  scale,
}: {
  choices: Choice[];
  look: ResultLook;
  scale: VerticalScaleId;
}) {
  const total = totalVotes(choices);
  const max = Math.max(...choices.map((c) => c.votes), 1);
  const chartH = scale === 'tall' ? 260 : 140;
  const frameClass =
    scale === 'tall'
      ? `rounded-lg border overflow-hidden max-w-2xl ${DARK.panel}`
      : `rounded-lg border p-4 max-w-lg ${DARK.panel}`;

  const bars = (
    <div
      className={`flex items-end justify-between gap-3 ${scale === 'tall' ? 'h-full p-[4%]' : ''}`}
      style={scale === 'tall' ? { aspectRatio: '16 / 9' } : undefined}
    >
      {choices.map((c) => {
        const barH =
          scale === 'tall'
            ? undefined
            : Math.max(6, Math.round((c.votes / max) * chartH));
        const barPct = (c.votes / max) * 100;
        return (
          <div
            key={c.id}
            className="flex-1 flex flex-col items-center min-w-0 gap-1.5 h-full justify-end"
          >
            {look.showPct || look.showCounts ? (
              <span className={`text-[11px] tabular-nums ${DARK.muted}`}>
                {metricText(c, total, look)}
              </span>
            ) : null}
            <div
              className="w-full flex items-end justify-center flex-1 min-h-0"
              style={scale === 'compact' ? { height: chartH } : undefined}
            >
              <div
                className="w-[70%] max-w-[56px] rounded-t-md transition-all duration-700"
                style={{
                  height: scale === 'tall' ? `${Math.max(4, barPct)}%` : barH,
                  background: look.accentBars ? c.color : '#94a3b8',
                }}
              />
            </div>
            {look.showLabels ? (
              <span className={`text-[10px] truncate w-full text-center ${DARK.muted}`}>
                {shortChoiceLabel(c.label)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return scale === 'tall' ? (
    <div className={frameClass}>
      <div className="bg-slate-950">{bars}</div>
    </div>
  ) : (
    <div className={frameClass}>{bars}</div>
  );
}

/** Clean broadcast pie / thick donut — % on slices + ranked list, no callout lines. */
function PieChart({
  choices,
  look,
  variant,
}: {
  choices: Choice[];
  look: ResultLook;
  variant: 'pie' | 'donut';
}) {
  const total = totalVotes(choices);
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = variant === 'donut' ? 88 : 90;
  const innerR = variant === 'donut' ? 52 : 0;
  const gapDeg = 3;

  let start = -90;
  const slices = choices.map((c) => {
    const sweep = (c.votes / total) * 360;
    const usable = Math.max(sweep - gapDeg, 0.01);
    const mid = start + usable / 2;
    const slice = { ...c, start, sweep: usable, mid, p: pct(c.votes, total) };
    start += sweep;
    return slice;
  });

  const sorted = [...slices].sort((a, b) => b.votes - a.votes);

  const polar = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const arcPath = (fromDeg: number, sweep: number, rOuter: number, rInner: number) => {
    const end = fromDeg + sweep;
    const large = sweep > 180 ? 1 : 0;
    const o0 = polar(fromDeg, rOuter);
    const o1 = polar(end, rOuter);
    if (rInner <= 0) {
      return [
        `M ${cx} ${cy}`,
        `L ${o0.x} ${o0.y}`,
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y}`,
        'Z',
      ].join(' ');
    }
    const i0 = polar(fromDeg, rInner);
    const i1 = polar(end, rInner);
    return [
      `M ${o0.x} ${o0.y}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${o1.x} ${o1.y}`,
      `L ${i1.x} ${i1.y}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${i0.x} ${i0.y}`,
      'Z',
    ].join(' ');
  };

  const gapStroke = '#020617';

  return (
    <div className={`rounded-xl border p-4 max-w-xl ${DARK.panel}`}>
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {slices.map((s) => (
              <path
                key={s.id}
                d={arcPath(s.start, s.sweep, outerR, innerR)}
                fill={look.accentBars ? s.color : '#94a3b8'}
                stroke={gapStroke}
                strokeWidth={4}
                strokeLinejoin="round"
              />
            ))}
            {variant === 'pie'
              ? slices
                  .filter((s) => s.p >= 10 && look.showPct !== false)
                  .map((s) => {
                    const pos = polar(s.mid, outerR * 0.62);
                    return (
                      <text
                        key={`${s.id}-pct`}
                        x={pos.x}
                        y={pos.y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#fff"
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                          paintOrder: 'stroke',
                          stroke: 'rgba(0,0,0,0.45)',
                          strokeWidth: 3,
                        }}
                      >
                        {s.p}%
                      </text>
                    );
                  })
              : null}
          </svg>
        </div>

        <ul className="flex-1 w-full min-w-0 space-y-2">
          {sorted.map((c, i) => (
            <li
              key={c.id}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${
                i === 0 ? 'bg-white/5 border border-white/10' : ''
              }`}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0 ring-2 ring-black/20"
                style={{ background: look.accentBars ? c.color : '#94a3b8' }}
              />
              <div className="min-w-0 flex-1">
                {look.showLabels !== false ? (
                  <p className={`text-sm font-medium truncate ${DARK.strong}`}>{c.label}</p>
                ) : null}
                <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${DARK.barTrack}`}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${c.p}%`,
                      background: look.accentBars ? c.color : '#94a3b8',
                    }}
                  />
                </div>
              </div>
              <div className="text-right shrink-0">
                {look.showPct !== false ? (
                  <p className={`text-sm font-semibold tabular-nums ${DARK.strong}`}>{c.p}%</p>
                ) : null}
                {look.showCounts ? (
                  <p className={`text-[10px] tabular-nums ${DARK.muted}`}>{c.votes}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function WinnerFocus({ choices, look }: { choices: Choice[]; look: ResultLook }) {
  const total = totalVotes(choices);
  const sorted = [...choices].sort((a, b) => b.votes - a.votes);
  const [lead, ...rest] = sorted;
  return (
    <div className={`rounded-lg border p-4 space-y-3 max-w-md ${DARK.panel}`}>
      <div className={`rounded-lg border px-4 py-3 ${DARK.card}`}>
        <p className={`text-[10px] uppercase tracking-wide mb-1 ${DARK.muted}`}>Leading</p>
        <p className={`text-xl font-semibold ${DARK.strong}`}>{look.showLabels ? lead.label : '—'}</p>
        <p className={`text-sm mt-1 tabular-nums ${DARK.muted}`}>{metricText(lead, total, look)} votes</p>
      </div>
      <div className="space-y-1.5">
        {rest.map((c, i) => (
          <div key={c.id} className={`flex justify-between text-xs px-1 ${DARK.muted}`}>
            <span>
              #{i + 2} {look.showLabels ? c.label : ''}
            </span>
            <span className="tabular-nums">{metricText(c, total, look)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SideBySide({ choices, look }: { choices: Choice[]; look: ResultLook }) {
  const pair = choices.slice(0, 2);
  const total = totalVotes(pair);
  return (
    <div className={`grid grid-cols-2 gap-3 max-w-md rounded-lg border p-3 ${DARK.panel}`}>
      {pair.map((c) => (
        <div
          key={c.id}
          className="rounded-lg border p-4 text-center"
          style={{
            borderColor: look.accentBars ? `${c.color}66` : undefined,
            background: look.accentBars ? `${c.color}18` : undefined,
          }}
        >
          <p
            className="text-3xl font-semibold tabular-nums"
            style={{ color: look.accentBars ? c.color : undefined }}
          >
            {look.showPct ? `${pct(c.votes, total)}%` : look.showCounts ? c.votes : '—'}
          </p>
          {look.showLabels ? <p className={`text-xs mt-1 ${DARK.strong}`}>{c.label}</p> : null}
        </div>
      ))}
    </div>
  );
}

function RatingResults({ look, accentColor }: { look: ResultLook; accentColor: string }) {
  const total = RATING.reduce((n, r) => n + r.votes, 0) || 1;
  const avg = RATING.reduce((n, r) => n + r.score * r.votes, 0) / total;
  const max = Math.max(...RATING.map((r) => r.votes));
  return (
    <div className={`rounded-lg border p-4 space-y-3 max-w-md ${DARK.panel}`}>
      <div className="flex items-end gap-2">
        <span className={`text-3xl font-semibold tabular-nums ${DARK.strong}`}>{avg.toFixed(1)}</span>
        <span className={`text-xs mb-1.5 ${DARK.muted}`}>avg · {total} responses</span>
      </div>
      <div className="space-y-1.5">
        {[...RATING].reverse().map((r) => (
          <div key={r.score} className="flex items-center gap-2 text-xs">
            <span className={`w-3 tabular-nums ${DARK.muted}`}>{r.score}</span>
            <div className={`flex-1 h-2 rounded-full overflow-hidden ${DARK.barTrack}`}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(r.votes / max) * 100}%`,
                  background: look.accentBars ? accentColor : '#94a3b8',
                }}
              />
            </div>
            <span className={`w-8 text-right tabular-nums ${DARK.muted}`}>
              {look.showCounts ? r.votes : look.showPct ? `${pct(r.votes, total)}%` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 16:9 stage canvas — container queries size type/bars to the frame. */
function StageFrame({
  label,
  children,
  className = '',
  showProgramFeed = true,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  showProgramFeed?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-[10px] text-slate-600 tabular-nums">16∶9</p>
      </div>
      <div
        className={`relative w-full aspect-video rounded-lg overflow-hidden border border-slate-700 bg-zinc-950 ${className}`}
        style={{ containerType: 'size' }}
      >
        {showProgramFeed ? (
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background:
                'radial-gradient(ellipse at 30% 40%, #1e293b 0%, transparent 55%), radial-gradient(ellipse at 70% 60%, #312e81 0%, #09090b 70%)',
            }}
          />
        ) : null}
        {children}
      </div>
    </div>
  );
}

function StageFullGraphic({
  question,
  choices,
  pollType,
  resultStyle,
  look,
  accentColor,
  barStyle,
  motion = 'off',
  motionKey = 0,
}: {
  question: string;
  choices: Choice[];
  pollType: PollTypeId;
  resultStyle: ResultStyleId;
  look: ResultLook;
  accentColor: string;
  barStyle: BarStyleId;
  motion?: SurfaceMotionId;
  motionKey?: number;
}) {
  const total = totalVotes(choices);
  const sorted = [...choices].sort((a, b) => b.votes - a.votes);
  const max = Math.max(...sorted.map((c) => c.votes), 1);

  // Edge-to-edge fill of the 16:9 frame (header auto + body 1fr).
  const shell: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gap: '3%',
    padding: '3.5% 4% 4%',
    background: '#070b14',
    color: '#fff',
    ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1.1s' }),
  };

  const header = (
    <div
      key={`hdr-${motionKey}`}
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 16,
        ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1.2s' }),
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'clamp(20px, 3.6cqi, 42px)',
          fontWeight: 600,
          lineHeight: 1.15,
          minWidth: 0,
          flex: 1,
        }}
      >
        {question}
      </p>
      <p
        style={{
          margin: 0,
          fontSize: 'clamp(12px, 1.8cqi, 16px)',
          color: 'rgba(255,255,255,0.45)',
          fontVariantNumeric: 'tabular-nums',
          paddingBottom: 4,
          flexShrink: 0,
        }}
      >
        {total} votes
      </p>
    </div>
  );

  if (pollType === 'rating' || resultStyle === 'histogram') {
    const avg =
      RATING.reduce((n, r) => n + r.score * r.votes, 0) / RATING.reduce((n, r) => n + r.votes, 0);
    const ratingMax = Math.max(...RATING.map((r) => r.votes));
    return (
      <div style={shell}>
        {header}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '0.85fr 1.35fr',
            gap: '4%',
            minHeight: 0,
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 'clamp(48px, 14cqh, 120px)',
                fontWeight: 600,
                color: accentColor,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {avg.toFixed(1)}
            </p>
            <p style={{ margin: '0.5em 0 0', color: 'rgba(255,255,255,0.5)', fontSize: 'clamp(12px, 1.8cqi, 16px)' }}>
              average / 5
            </p>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateRows: `repeat(${RATING.length}, 1fr)`,
              gap: '2%',
              minHeight: 0,
            }}
          >
            {[...RATING].reverse().map((r) => (
              <div
                key={r.score}
                style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '2%', alignItems: 'center' }}
              >
                <span style={{ fontSize: 'clamp(12px, 2.2cqh, 18px)', color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>
                  {r.score}
                </span>
                <div style={{ height: '42%', minHeight: 8, maxHeight: 28, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${(r.votes / ratingMax) * 100}%`,
                      borderRadius: 999,
                      background: accentColor,
                    }}
                  />
                </div>
                <span style={{ fontSize: 'clamp(11px, 2cqh, 15px)', color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' }}>
                  {r.votes}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Pie / donut — mirrors Results chart layout on stage
  if (resultStyle === 'pie' || resultStyle === 'donut') {
    return (
      <div key={motionKey} style={shell}>
        {header}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)',
            gap: '4%',
            minHeight: 0,
            height: '100%',
            alignItems: 'center',
          }}
        >
          <div style={{ width: '100%', height: '100%', minHeight: 0, maxHeight: '100%' }}>
            <SurfacePieSvg
              choices={choices}
              variant={resultStyle === 'donut' ? 'donut' : 'pie'}
              showPct={look.showPct}
              motion={motion}
              motionKey={motionKey}
            />
          </div>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gridTemplateRows: `repeat(${sorted.length}, minmax(0, 1fr))`,
              gap: '2%',
              minHeight: 0,
              height: '90%',
            }}
          >
            {sorted.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3%',
                  minHeight: 0,
                  padding: '0 2%',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: c.color,
                    flexShrink: 0,
                  }}
                />
                {look.showLabels ? (
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: 'clamp(12px, 2cqi, 20px)',
                    }}
                  >
                    {c.label}
                  </span>
                ) : (
                  <span style={{ flex: 1 }} />
                )}
                <span
                  style={{
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: 'clamp(13px, 2.2cqi, 22px)',
                    flexShrink: 0,
                  }}
                >
                  {look.showPct ? `${pct(c.votes, total)}%` : null}
                  {look.showPct && look.showCounts ? ' · ' : null}
                  {look.showCounts ? c.votes : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // Vertical bars
  if (resultStyle === 'vertical') {
    return (
      <div key={motionKey} style={shell}>
        {header}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: '2%',
            minHeight: 0,
            height: '100%',
            paddingTop: '2%',
          }}
        >
          {sorted.map((c, i) => {
            const barPct = (c.votes / max) * 100;
            return (
              <div
                key={c.id}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '2%',
                  ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 90, duration: '1.1s' }),
                }}
              >
                {(look.showPct || look.showCounts) && (
                  <span
                    style={{
                      fontSize: 'clamp(11px, 1.8cqi, 16px)',
                      color: 'rgba(255,255,255,0.7)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {metricText(c, total, look)}
                  </span>
                )}
                <div
                  style={{
                    width: '70%',
                    maxWidth: 56,
                    height: `${Math.max(4, barPct)}%`,
                    borderRadius: '8px 8px 4px 4px',
                    background: c.color,
                    ...surfaceAnim(motion, 'grow', 'ros-grow-y', {
                      delayMs: 90 + i * 60,
                      duration: '0.75s',
                      origin: 'bottom center',
                    }),
                  }}
                />
                {look.showLabels ? (
                  <span
                    style={{
                      fontSize: 'clamp(10px, 1.5cqi, 14px)',
                      color: 'rgba(255,255,255,0.55)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      width: '100%',
                      textAlign: 'center',
                    }}
                  >
                    {shortChoiceLabel(c.label)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Winner / A-B / leaderboard / default horizontal text-in-bar
  if (resultStyle === 'winner' || resultStyle === 'ab') {
    const top = resultStyle === 'ab' ? sorted.slice(0, 2) : sorted;
    return (
      <div style={shell}>
        {header}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(top.length, 2)}, 1fr)`,
            gap: '3%',
            minHeight: 0,
            height: '100%',
            alignItems: 'stretch',
            paddingTop: '2%',
          }}
        >
          {top.slice(0, 2).map((c, i) => (
            <div
              key={c.id}
              style={{
                borderRadius: 14,
                border: `1px solid ${c.color}66`,
                background: `${c.color}22`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4%',
                textAlign: 'center',
              }}
            >
              {resultStyle === 'winner' && i === 0 ? (
                <span style={{ fontSize: 'clamp(10px, 1.4cqi, 13px)', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 8 }}>
                  Leading
                </span>
              ) : null}
              <p style={{ margin: 0, fontSize: 'clamp(36px, 8cqi, 72px)', fontWeight: 700, color: c.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {pct(c.votes, total)}%
              </p>
              {look.showLabels ? (
                <p style={{ margin: '10px 0 0', fontSize: 'clamp(14px, 2.4cqi, 24px)', fontWeight: 600 }}>
                  {c.label}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default: horizontal bars (fill = text-in-bar, track = label + thin bar)
  if (barStyle === 'track') {
    return (
      <div key={motionKey} style={shell}>
        {header}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '3.5%',
            minHeight: 0,
            height: '100%',
          }}
        >
          {sorted.map((c, i) => (
            <div
              key={c.id}
              style={{
                minWidth: 0,
                ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 85, duration: '1.1s' }),
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 6,
                  fontSize: 'clamp(13px, 2.2cqi, 20px)',
                }}
              >
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {resultStyle === 'leaderboard' ? `${i + 1}. ` : ''}
                  {look.showLabels ? c.label : ''}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {metricText(c, total, look)}
                </span>
              </div>
              <div
                style={{
                  height: 'clamp(10px, 2.2cqh, 16px)',
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.12)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(c.votes / max) * 100}%`,
                    borderRadius: 999,
                    background: c.color,
                    ...surfaceAnim(motion, 'grow', 'ros-grow-x', {
                      delayMs: 80 + i * 55,
                      duration: '0.75s',
                      origin: 'left center',
                    }),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div key={motionKey} style={shell}>
      {header}
      <div
        style={{
          display: 'grid',
          gridTemplateRows: `repeat(${sorted.length}, minmax(0, 1fr))`,
          gap: '2.5%',
          minHeight: 0,
          height: '100%',
        }}
      >
        {sorted.map((c, i) => {
          const p = pct(c.votes, total);
          const barPct = (c.votes / max) * 100;
          return (
            <div
              key={c.id}
              style={{
                position: 'relative',
                minHeight: 0,
                borderRadius: 12,
                background: 'rgba(255,255,255,0.08)',
                overflow: 'hidden',
                ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 90, duration: '1.15s' }),
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: `${barPct}%`,
                  background: c.color,
                  opacity: 0.92,
                  ...surfaceAnim(motion, 'grow', 'ros-grow-x', {
                    delayMs: 180 + i * 90,
                    duration: '1s',
                    origin: 'left center',
                  }),
                }}
              />
              <div
                style={{
                  position: 'relative',
                  zIndex: 1,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '0 2.2%',
                }}
              >
                <span
                  style={{
                    fontSize: 'clamp(15px, 2.6cqi, 28px)',
                    color: '#fff',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textShadow: '0 1px 3px rgba(0,0,0,0.55)',
                  }}
                >
                  {resultStyle === 'leaderboard' ? `${i + 1}. ` : ''}
                  {look.showLabels ? c.label : ''}
                </span>
                <span
                  style={{
                    fontSize: 'clamp(18px, 3.2cqi, 34px)',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: '#fff',
                    flexShrink: 0,
                    textShadow: '0 1px 3px rgba(0,0,0,0.55)',
                  }}
                >
                  {look.showPct ? `${p}%` : look.showCounts ? c.votes : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact bar rows for LT / PiP — respects fill vs track. */
function CompactSurfaceBars({
  choices,
  look,
  barStyle,
  ranked,
  dense,
  motion = 'off',
  motionKey = 0,
}: {
  choices: Choice[];
  look: ResultLook;
  barStyle: BarStyleId;
  ranked?: boolean;
  /** Tighter type for squeezed lower thirds / PiP */
  dense?: boolean;
  motion?: SurfaceMotionId;
  motionKey?: number;
}) {
  const total = totalVotes(choices);
  const max = Math.max(...choices.map((c) => c.votes), 1);
  const labelSize = dense ? 'clamp(8px, 1.1vw, 11px)' : 'clamp(9px, 1.25vw, 12px)';
  const valueSize = dense ? 'clamp(8px, 1.15vw, 11px)' : 'clamp(9px, 1.3vw, 12px)';

  if (barStyle === 'fill') {
    return (
      <div
        key={motionKey}
        className="min-h-0 flex-1 grid"
        style={{
          gridTemplateRows: `repeat(${choices.length}, minmax(0, 1fr))`,
          gap: dense ? 2 : 3,
        }}
      >
        {choices.map((c, i) => {
          const barPct = (c.votes / max) * 100;
          const fill = look.accentBars ? c.color : '#94a3b8';
          return (
            <div
              key={c.id}
              className="relative min-h-0 rounded-sm overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.1)',
                ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 85, duration: '1.1s' }),
              }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${barPct}%`,
                  background: fill,
                  opacity: 0.92,
                  ...surfaceAnim(motion, 'grow', 'ros-grow-x', {
                    delayMs: 160 + i * 85,
                    duration: '0.95s',
                    origin: 'left center',
                  }),
                }}
              />
              <div className="relative z-[1] h-full flex items-center justify-between gap-1.5 px-1.5">
                <span
                  className="text-white font-semibold truncate"
                  style={{ fontSize: labelSize, textShadow: '0 1px 2px rgba(0,0,0,0.55)' }}
                >
                  {ranked ? `${i + 1}. ` : ''}
                  {look.showLabels ? shortChoiceLabel(c.label) : ''}
                </span>
                <span
                  className="text-white font-bold tabular-nums shrink-0"
                  style={{ fontSize: valueSize, textShadow: '0 1px 2px rgba(0,0,0,0.55)' }}
                >
                  {look.showPct ? `${pct(c.votes, total)}%` : look.showCounts ? c.votes : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Track — stacked slim rows so 4–8 can share the strip
  return (
    <div
      key={motionKey}
      className="min-h-0 flex-1 flex flex-col justify-center"
      style={{ gap: dense ? 2 : 3 }}
    >
      {choices.map((c, i) => (
        <div
          key={c.id}
          className="min-w-0"
          style={surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 80, duration: '1.05s' })}
        >
          <div className="flex justify-between gap-1 mb-0.5">
            <span className="text-white/85 truncate font-medium" style={{ fontSize: labelSize }}>
              {ranked ? `${i + 1}. ` : ''}
              {look.showLabels ? shortChoiceLabel(c.label) : ''}
            </span>
            <span className="text-white/50 tabular-nums shrink-0" style={{ fontSize: valueSize }}>
              {metricText(c, total, look)}
            </span>
          </div>
          <div
            className="rounded-full bg-white/15 overflow-hidden"
            style={{ height: dense ? 3 : 4 }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${(c.votes / max) * 100}%`,
                background: look.accentBars ? c.color : '#94a3b8',
                ...surfaceAnim(motion, 'grow', 'ros-grow-x', {
                  delayMs: 70 + i * 50,
                  duration: '0.7s',
                  origin: 'left center',
                }),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function LowerThirdGraphic({
  question,
  choices,
  pollType,
  resultStyle,
  look,
  accentColor,
  barStyle,
  overflow,
  pageSize,
  pageIndex,
  motion = 'off',
  motionKey = 0,
}: {
  question: string;
  choices: Choice[];
  pollType: PollTypeId;
  resultStyle: ResultStyleId;
  look: ResultLook;
  accentColor: string;
  barStyle: BarStyleId;
  overflow: LowerOverflowId;
  pageSize: number;
  pageIndex: number;
  motion?: SurfaceMotionId;
  motionKey?: number;
}) {
  const sorted = [...choices].sort((a, b) => b.votes - a.votes);
  const pieStyle = resultStyle === 'pie' || resultStyle === 'donut';
  const ranked = resultStyle === 'leaderboard';
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = ((pageIndex % pageCount) + pageCount) % pageCount;
  const needsPaging = overflow === 'rotate' && sorted.length > pageSize;
  const visible =
    pollType === 'rating'
      ? []
      : overflow === 'squeeze'
        ? sorted
        : sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const dense = overflow === 'squeeze' && visible.length >= 4;

  return (
    <div
      key={motionKey}
      className="absolute inset-x-[4%] bottom-[7%] h-[24%] rounded-md overflow-hidden border border-white/15 bg-slate-950/90 backdrop-blur-sm shadow-2xl flex"
      style={surfaceAnim(motion, 'reveal', 'ros-lt-in', { duration: '1.15s' })}
    >
      <div className="w-1.5 shrink-0" style={{ background: accentColor }} />
      {pieStyle ? (
        <div className="w-[16%] shrink-0 p-1.5 self-stretch">
          <SurfacePieSvg
            choices={choices}
            variant={resultStyle === 'donut' ? 'donut' : 'pie'}
            showPct={look.showPct}
            motion={motion}
            motionKey={motionKey}
          />
        </div>
      ) : null}
      <div className="flex-1 min-w-0 px-2.5 py-1.5 flex flex-col gap-1 min-h-0">
        <div className="min-w-0 flex items-center justify-between gap-2 shrink-0">
          <span
            className="text-white font-medium truncate block min-w-0"
            style={{ fontSize: dense ? 'clamp(10px, 1.3vw, 13px)' : 'clamp(11px, 1.5vw, 14px)' }}
          >
            {question}
          </span>
          {needsPaging ? (
            <span className="flex items-center gap-1 shrink-0">
              {Array.from({ length: pageCount }).map((_, i) => (
                <span
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 5,
                    height: 5,
                    background: i === safePage ? accentColor : 'rgba(255,255,255,0.25)',
                  }}
                />
              ))}
            </span>
          ) : null}
        </div>
        {pollType === 'rating' ? (
          <p className="text-lg font-semibold tabular-nums" style={{ color: accentColor }}>
            {(
              RATING.reduce((n, r) => n + r.score * r.votes, 0) /
              RATING.reduce((n, r) => n + r.votes, 0)
            ).toFixed(1)}{' '}
            <span className="text-xs text-white/50 font-normal">avg</span>
          </p>
        ) : pieStyle ? (
          <div className="flex gap-2 overflow-hidden flex-1 items-center min-h-0" key={safePage}>
            {visible.slice(0, Math.min(visible.length, 4)).map((c) => (
              <div key={c.id} className="min-w-0 flex-1 flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-sm shrink-0"
                  style={{ background: c.color }}
                />
                <span className="text-[10px] text-white/80 truncate">
                  {look.showLabels ? shortChoiceLabel(c.label) : ''}
                </span>
                <span className="text-[10px] text-white/50 tabular-nums shrink-0">
                  {look.showPct ? `${pct(c.votes, totalVotes(choices))}%` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div
            key={overflow === 'rotate' ? `pg-${safePage}-${motionKey}` : `sq-${motionKey}`}
            className="min-h-0 flex-1 flex flex-col"
            style={
              overflow === 'rotate' && motion !== 'off'
                ? surfaceAnim(motion, 'reveal', 'ros-page-in', { duration: '0.85s' })
                : undefined
            }
          >
            <CompactSurfaceBars
              choices={visible}
              look={look}
              barStyle={barStyle}
              ranked={ranked}
              dense={dense}
              motion={motion}
              motionKey={motionKey}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PipGraphic({
  question,
  choices,
  pollType,
  resultStyle,
  look,
  accentColor,
  barStyle,
  placement,
  scale,
  motion = 'off',
  motionKey = 0,
}: {
  question: string;
  choices: Choice[];
  pollType: PollTypeId;
  resultStyle: ResultStyleId;
  look: ResultLook;
  accentColor: string;
  barStyle: BarStyleId;
  placement: PipPlacementId;
  scale: PipScaleId;
  motion?: SurfaceMotionId;
  motionKey?: number;
}) {
  const sorted = [...choices].sort((a, b) => b.votes - a.votes);
  const pieStyle = resultStyle === 'pie' || resultStyle === 'donut';
  const ranked = resultStyle === 'leaderboard';
  const widthPct = PIP_SCALES.find((s) => s.id === scale)?.widthPct ?? 28;
  const dense = sorted.length >= 4 || scale === 's';

  return (
    <div
      key={motionKey}
      className="absolute aspect-[4/3] rounded-md overflow-hidden border border-white/20 bg-slate-950/92 shadow-2xl flex flex-col"
      style={{
        ...pipPositionStyle(placement),
        width: `${widthPct}%`,
        ...surfaceAnim(motion, 'reveal', 'ros-pip-in', { duration: '1.05s' }),
      }}
    >
      <div className="px-2.5 pt-1.5 pb-1 border-b border-white/10 shrink-0">
        <p className="text-[clamp(9px,1.1vw,12px)] text-white font-medium leading-snug line-clamp-2">
          {question}
        </p>
      </div>
      <div className="flex-1 px-2 py-1.5 flex flex-col min-h-0">
        {pollType === 'rating' ? (
          <p className="text-center text-2xl font-semibold tabular-nums my-auto" style={{ color: accentColor }}>
            {(
              RATING.reduce((n, r) => n + r.score * r.votes, 0) /
              RATING.reduce((n, r) => n + r.votes, 0)
            ).toFixed(1)}
          </p>
        ) : pieStyle ? (
          <div className="h-full min-h-0 flex items-center justify-center">
            <div className="w-[70%] aspect-square">
              <SurfacePieSvg
                choices={choices}
                variant={resultStyle === 'donut' ? 'donut' : 'pie'}
                showPct={look.showPct}
                motion={motion}
                motionKey={motionKey}
              />
            </div>
          </div>
        ) : (
          <CompactSurfaceBars
            choices={sorted}
            look={look}
            barStyle={barStyle}
            ranked={ranked}
            dense={dense}
            motion={motion}
            motionKey={motionKey}
          />
        )}
      </div>
    </div>
  );
}

function LookToggles({
  look,
  onChange,
  showAccent,
}: {
  look: ResultLook;
  onChange: (next: ResultLook) => void;
  showAccent?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {(
        [
          { key: 'showPct', label: '% values' },
          { key: 'showCounts', label: 'Counts' },
          { key: 'showLabels', label: 'Labels' },
          ...(showAccent ? [{ key: 'accentBars' as const, label: 'Color accents' }] : []),
        ] as { key: keyof ResultLook; label: string }[]
      ).map((opt) => (
        <label key={opt.key} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(look[opt.key])}
            onChange={(e) => onChange({ ...look, [opt.key]: e.target.checked })}
            className="rounded border-slate-600"
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function ColorPresetPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const groups: { id: ColorPresetGroup; label: string }[] = [
    { id: 'various', label: 'Various' },
    { id: 'monotone', label: 'Monotone' },
  ];

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <div key={g.id}>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1.5">{g.label}</p>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.filter((p) => p.group === g.id).map((p) => {
              const selected = value === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange(p.id)}
                  title={p.label}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? 'border-amber-400/50 bg-amber-500/10 text-amber-50'
                      : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span className="flex h-3.5 overflow-hidden rounded-sm ring-1 ring-black/40">
                    {p.colors.slice(0, 5).map((c) => (
                      <span key={c} className="w-2.5 h-full" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-[11px] font-medium leading-none">{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CollapsibleColorPresets({
  value,
  onChange,
  open,
  onOpenChange,
}: {
  value: string;
  onChange: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const preset = getColorPreset(value);
  return (
    <div>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Color presets</span>
          <span className="flex h-3 overflow-hidden rounded-sm ring-1 ring-black/40 shrink-0">
            {preset.colors.slice(0, 5).map((c) => (
              <span key={c} className="w-2 h-full" style={{ background: c }} />
            ))}
          </span>
          <span className="text-[11px] text-slate-400 truncate">{preset.label}</span>
        </span>
        <span className="text-[10px] text-slate-500 shrink-0">{open ? 'Hide' : 'Edit'}</span>
      </button>
      {open ? (
        <div className="mt-2.5">
          <ColorPresetPicker value={value} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}

/** Build guide: ingest / drain / live totals — use when shipping polls. */
function LimitsGuidePanel() {
  return (
    <Panel className="p-5 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-white mb-1">Ingest &amp; server limits</h2>
        <p className="text-xs text-slate-400 max-w-2xl">
          Unlike Q&amp;A, poll results cannot be truncated for display. Cap intake and stagger
          commits so Railway / Neon stay healthy under large spikes (e.g. 100k votes) while
          stage graphics still show live progression.
        </p>
      </div>

      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Simple product rules
        </h3>
        <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
          <li>
            <span className="text-white font-medium">1 IP → 1 vote</span> per poll (reject or
            upsert duplicates).
          </li>
          <li>
            Polls are <span className="text-white font-medium">open</span> or{' '}
            <span className="text-white font-medium">closed</span> from control — closed stops
            new accepts.
          </li>
          <li>
            Closed ≠ final until the backlog is drained. Then mark results{' '}
            <span className="text-white font-medium">Final</span>.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Problem
        </h3>
        <p className="text-sm text-slate-300">
          Neon / Railway may only sustain roughly <span className="text-white">1k–10k</span>{' '}
          heavy writes in a short open window. A popular poll can still receive{' '}
          <span className="text-white">100k</span> inputs. Writing every vote straight into Neon
          counters on click will stall or crash; dropping votes to “fit” corrupts results.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Architecture we design for (always)
        </h3>
        <p className="text-sm text-slate-300">
          Shape the API as <span className="text-white font-medium">accept → inbox → drain →
          counters</span>. Vote requests never do full aggregation. Graphics always read{' '}
          <span className="text-white">committed counters</span>. Inbox storage can change later
          without redesigning Setup / Control / surfaces.
        </p>
        <ol className="text-sm text-slate-300 space-y-2 list-decimal pl-5">
          <li>
            <span className="text-white font-medium">Ingest</span> — poll open? → enqueue vote →
            return Accepted.
          </li>
          <li>
            <span className="text-white font-medium">Drain</span> — worker batches (e.g. 50–200)
            into Neon ballots + option counters at a Neon-safe rate.
          </li>
          <li>
            <span className="text-white font-medium">Live</span> — surfaces show Counted; control
            shows Received vs Counted while draining.
          </li>
        </ol>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
        <div className="grid grid-cols-[1fr_1.4fr] gap-0 text-xs border-b border-slate-800 px-3 py-2 text-slate-500 uppercase tracking-wide">
          <span>Metric</span>
          <span>Meaning</span>
        </div>
        {(
          [
            ['Received', 'Accepted into the inbox (spike-friendly).'],
            ['Counted', 'Applied to Neon counters — what broadcast surfaces use.'],
            ['Final', 'Intake closed + inbox empty — safe to lock graphics.'],
          ] as const
        ).map(([k, v]) => (
          <div
            key={k}
            className="grid grid-cols-[1fr_1.4fr] gap-0 px-3 py-2.5 border-b border-slate-800/80 last:border-0 text-sm"
          >
            <span className="text-white font-medium">{k}</span>
            <span className="text-slate-400">{v}</span>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Rollout: soft v1 → full B
        </h3>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 space-y-2">
          <p className="text-sm text-white font-medium">v1 — soft (Neon inbox)</p>
          <p className="text-sm text-slate-300">
            <span className="text-white">API → Neon inbox table → drain worker → Neon counters</span>
          </p>
          <ul className="text-sm text-slate-400 space-y-1 list-disc pl-5">
            <li>Same code shape as B; no Redis bill yet.</li>
            <li>
              Still <span className="text-slate-200">one Neon write per vote</span> on accept —
              softer than updating counters on the request, but a 100k spike can still pressure
              Neon. Treat as stepping-stone, not the big-show plan.
            </li>
          </ul>
        </div>
        <div className="rounded-lg border border-amber-500/25 bg-amber-950/20 px-3 py-3 space-y-2">
          <p className="text-sm text-white font-medium">Full B — Redis inbox (preferred: Railway Redis)</p>
          <p className="text-sm text-slate-300">
            <span className="text-white">API → Railway Redis inbox → drain worker → Neon</span>
          </p>
          <ul className="text-sm text-slate-400 space-y-1 list-disc pl-5">
            <li>Spike lands in Redis; Neon only sees a steady hose.</li>
            <li>
              Prefer <span className="text-slate-200">Railway Redis</span> (same project as the
              API) over Upstash — we barely use Upstash today and don’t want a second paid Redis
              unless needed.
            </li>
            <li>Swap inbox backend behind the same accept/drain interfaces; UI unchanged.</li>
          </ul>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Close sequence
        </h3>
        <ol className="text-sm text-slate-300 space-y-1.5 list-decimal pl-5">
          <li>Close intake (no new accepts)</li>
          <li>Drain inbox to empty</li>
          <li>Mark results Final → lock surfaces</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Control page (when we build it)
        </h3>
        <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
          <li>Open / pause / close intake</li>
          <li>
            Live <span className="text-white">Counted / Received</span> and drain status
          </li>
          <li>Push results on/off + motion to surfaces; links to stage / LT / PiP</li>
          <li>Mark Final only after drain completes; download reports</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] uppercase tracking-wide text-amber-300/80 font-semibold">
          Shipped backend (this branch)
        </h3>
        <ul className="text-sm text-slate-300 space-y-1.5 list-disc pl-5">
          <li>
            Migration <span className="text-white">088</span> + ensure in{' '}
            <span className="text-white">lib/web-polls.js</span>
          </li>
          <li>
            Tables: polls, options (+ vote_count), ballots (1 IP), votes_inbox,{' '}
            results_snapshot
          </li>
          <li>
            API: create/list, status, vote (202 → inbox), drain, rollup, inbox-backend toggle
          </li>
          <li>Default inbox = neon; redis toggle waits for Railway Redis</li>
        </ul>
      </section>

      <p className="text-[11px] text-slate-500 border-t border-slate-800 pt-3">
        Q&amp;A caps the visible list; polls cap intake and stagger commits. Soft v1 ≠ full B —
        Redis is what keeps the big event off Neon’s hot path.
      </p>
    </Panel>
  );
}

export default function PollSamplesPage() {
  const [pollType, setPollType] = useState<PollTypeId>('single');
  const [tab, setTab] = useState<TabId>('vote');
  const [resultStyle, setResultStyle] = useState<ResultStyleId>('bars');
  const [surface, setSurface] = useState<SurfaceId>('stage');
  const [look, setLook] = useState<ResultLook>(DEFAULT_LOOK);
  const [colorPresetId, setColorPresetId] = useState(DEFAULT_COLOR_PRESET);
  const [optionCount, setOptionCount] = useState(4);
  const [barStyle, setBarStyle] = useState<BarStyleId>('fill');
  const [verticalScale, setVerticalScale] = useState<VerticalScaleId>('tall');
  const [lowerOverflow, setLowerOverflow] = useState<LowerOverflowId>('squeeze');
  const [lowerPageSize, setLowerPageSize] = useState(4);
  const [lowerPage, setLowerPage] = useState(0);
  const [lowerAutoRotate, setLowerAutoRotate] = useState(true);
  const [pipPlacement, setPipPlacement] = useState<PipPlacementId>('br');
  const [pipScale, setPipScale] = useState<PipScaleId>('m');
  const [colorsOpen, setColorsOpen] = useState(false);
  const [surfaceMotion, setSurfaceMotion] = useState<SurfaceMotionId>('grow');
  const [motionKey, setMotionKey] = useState(0);

  const [singlePick, setSinglePick] = useState<string[]>(['a']);
  const [multiPick, setMultiPick] = useState<string[]>(['a', 'c']);
  const [yesNo, setYesNo] = useState<string[]>(['yes']);
  const [rating, setRating] = useState(4);
  const [rankOrder, setRankOrder] = useState(
    SAMPLE_POOL.slice(0, 4).map((c) => shortChoiceLabel(c.label))
  );

  const showOptionCount = OPTION_COUNT_TYPES.includes(pollType);
  const colorPreset = useMemo(() => getColorPreset(colorPresetId), [colorPresetId]);
  const accentColor = useMemo(() => presetAccent(colorPreset), [colorPreset]);
  const meta = useMemo(() => POLL_TYPES.find((p) => p.id === pollType)!, [pollType]);
  const choices = useMemo(
    () => applyPalette(choicesForType(pollType, optionCount), colorPreset.colors),
    [pollType, optionCount, colorPreset]
  );
  const stylesForType = useMemo(
    () => RESULT_STYLES.filter((s) => s.forTypes.includes(pollType)),
    [pollType]
  );

  const onPollTypeChange = (id: PollTypeId) => {
    setPollType(id);
    const first = RESULT_STYLES.find((s) => s.forTypes.includes(id));
    if (first) setResultStyle(first.id);
    setTab('vote');
  };

  const onOptionCountChange = (n: number) => {
    const count = Math.min(8, Math.max(2, n));
    setOptionCount(count);
    const next = SAMPLE_POOL.slice(0, count);
    setRankOrder(next.map((c) => shortChoiceLabel(c.label)));
    setSinglePick((prev) => {
      const ids = new Set(next.map((c) => c.id));
      return prev.filter((id) => ids.has(id)).length ? prev.filter((id) => ids.has(id)) : [next[0].id];
    });
    setMultiPick((prev) => {
      const ids = new Set(next.map((c) => c.id));
      const kept = prev.filter((id) => ids.has(id));
      return kept.length ? kept : [next[0].id];
    });
  };

  const moveRank = (index: number, dir: -1 | 1) => {
    setRankOrder((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const activeStyle = stylesForType.some((s) => s.id === resultStyle)
    ? resultStyle
    : stylesForType[0]?.id || 'bars';

  const showAccentToggle = true;
  const showBarStyle =
    activeStyle === 'bars' ||
    activeStyle === 'leaderboard' ||
    (tab === 'surfaces' &&
      (surface === 'lower' || surface === 'pip') &&
      pollType !== 'rating' &&
      activeStyle !== 'pie' &&
      activeStyle !== 'donut');
  const showVerticalScale = activeStyle === 'vertical' && tab === 'results';
  const lowerPageCount = Math.max(1, Math.ceil(choices.length / lowerPageSize));

  useEffect(() => {
    setLowerPage(0);
  }, [choices.length, lowerPageSize, lowerOverflow, pollType]);

  useEffect(() => {
    if (tab !== 'surfaces' || surface !== 'lower') return;
    if (lowerOverflow !== 'rotate' || !lowerAutoRotate) return;
    if (pollType === 'rating') return;
    if (choices.length <= lowerPageSize) return;
    const id = window.setInterval(() => {
      setLowerPage((p) => (p + 1) % Math.max(1, Math.ceil(choices.length / lowerPageSize)));
    }, 3200);
    return () => window.clearInterval(id);
  }, [
    tab,
    surface,
    lowerOverflow,
    lowerAutoRotate,
    lowerPageSize,
    choices.length,
    pollType,
  ]);

  const renderVoteUi = () => {
    switch (pollType) {
      case 'single':
        return (
          <VoteButtons
            choices={choices}
            selected={singlePick}
            onToggle={(id) => setSinglePick([id])}
          />
        );
      case 'multi':
        return (
          <VoteButtons
            choices={choices}
            multi
            selected={multiPick}
            onToggle={(id) =>
              setMultiPick((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
              )
            }
          />
        );
      case 'yesno':
        return (
          <VoteButtons choices={choices} selected={yesNo} onToggle={(id) => setYesNo([id])} />
        );
      case 'rating':
        return (
          <div>
            <div className="flex gap-2 justify-start py-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  className={`w-11 h-11 rounded-lg border text-sm font-semibold tabular-nums ${
                    rating >= n
                      ? 'border-amber-400/50 bg-amber-500/20 text-amber-100'
                      : 'border-slate-700 text-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">Selected: {rating} / 5</p>
          </div>
        );
      case 'ranked':
        return (
          <ul className="space-y-2 max-w-md">
            {rankOrder.map((label, i) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2"
              >
                <span className="text-xs text-slate-500 w-4 tabular-nums">{i + 1}</span>
                <span className="flex-1 text-sm text-slate-100">{label}</span>
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                  onClick={() => moveRank(i, -1)}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-slate-400 hover:text-white"
                  onClick={() => moveRank(i, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>
        );
      default:
        return null;
    }
  };

  const renderResults = () => {
    if (pollType === 'rating' || activeStyle === 'histogram') {
      return <RatingResults look={look} accentColor={accentColor} />;
    }
    switch (activeStyle) {
      case 'vertical':
        return <VerticalBars choices={choices} look={look} scale={verticalScale} />;
      case 'donut':
        return <PieChart choices={choices} look={look} variant="donut" />;
      case 'pie':
        return <PieChart choices={choices} look={look} variant="pie" />;
      case 'winner':
        return <WinnerFocus choices={choices} look={look} />;
      case 'leaderboard':
        return <HorizontalBars choices={choices} look={look} barStyle={barStyle} ranked />;
      case 'ab':
        return <SideBySide choices={choices.filter((c) => c.id !== 'skip')} look={look} />;
      case 'bars':
      default:
        return <HorizontalBars choices={choices} look={look} barStyle={barStyle} />;
    }
  };

  const chartOptionsUi = (
    <>
      {showBarStyle ? (
        <label className="flex flex-col gap-1 min-w-[10rem]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Bar style</span>
          <select
            value={barStyle}
            onChange={(e) => setBarStyle(e.target.value as BarStyleId)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
          >
            <option value="fill">Fill (stage)</option>
            <option value="track">Track (slim)</option>
          </select>
        </label>
      ) : null}
      {showVerticalScale ? (
        <label className="flex flex-col gap-1 min-w-[10rem]">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Scale</span>
          <select
            value={verticalScale}
            onChange={(e) => setVerticalScale(e.target.value as VerticalScaleId)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
          >
            <option value="tall">Tall (16∶9)</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      ) : null}
    </>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <style>{SURFACE_MOTION_CSS}</style>
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div
          className={`mx-auto px-4 py-3 space-y-3 ${
            tab === 'surfaces' || tab === 'limits' ? 'max-w-5xl' : 'max-w-3xl'
          }`}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300/80 font-semibold">
                Poll lab
              </p>
              <h1 className="text-sm font-semibold text-white">Sample explorer</h1>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 min-w-[12rem] sm:w-56">
                <span className="text-[10px] uppercase tracking-wide text-slate-500">Poll type</span>
                <select
                  value={pollType}
                  onChange={(e) => onPollTypeChange(e.target.value as PollTypeId)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                >
                  {POLL_TYPES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {showOptionCount ? (
                <label className="flex flex-col gap-1 w-[7.5rem]">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    Options
                  </span>
                  <select
                    value={optionCount}
                    onChange={(e) => onOptionCountChange(Number(e.target.value))}
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                  >
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} items
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 px-3 py-2 rounded-md text-xs font-medium border text-left transition-colors ${
                  tab === t.id
                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                <span className="block">{t.label}</span>
                <span className="block text-[10px] font-normal text-slate-500 mt-0.5">{t.step}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <main
        className={`mx-auto px-4 py-6 space-y-4 ${
          tab === 'surfaces' || tab === 'limits' ? 'max-w-5xl' : 'max-w-3xl'
        }`}
      >
        <Panel className="px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Sample question</p>
          <p className="text-base font-medium text-white">{meta.question}</p>
          <p className="text-xs text-slate-400 mt-1">{meta.blurb}</p>
        </Panel>

        {tab === 'vote' ? (
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-white mb-1">Audience vote UI</h2>
            <p className="text-xs text-slate-400 mb-4">
              What they see on phone / tablet while answering.
            </p>
            {renderVoteUi()}
          </Panel>
        ) : null}

        {tab === 'results' ? (
          <Panel className="p-5 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">Results view</h2>
                <p className="text-xs text-slate-400">
                  Layout + styling for this poll type · {totalVotes(choices)} sample votes
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                {stylesForType.length > 1 ? (
                  <label className="flex flex-col gap-1 min-w-[12rem]">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      Chart layout
                    </span>
                    <select
                      value={activeStyle}
                      onChange={(e) => setResultStyle(e.target.value as ResultStyleId)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                    >
                      {stylesForType.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {chartOptionsUi}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3 space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">Styling</p>
                <LookToggles look={look} onChange={setLook} showAccent={showAccentToggle} />
              </div>
              <div className="border-t border-slate-800 pt-3">
                <CollapsibleColorPresets
                  value={colorPresetId}
                  onChange={setColorPresetId}
                  open={colorsOpen}
                  onOpenChange={setColorsOpen}
                />
              </div>
            </div>

            {renderResults()}
          </Panel>
        ) : null}

        {tab === 'surfaces' ? (
          <Panel className="p-5 space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white mb-1">Broadcast surfaces</h2>
                <p className="text-xs text-slate-400">
                  Uses the Results chart layout ({stylesForType.find((s) => s.id === activeStyle)?.label || activeStyle}).
                </p>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(
                  [
                    { id: 'stage', label: 'Full stage' },
                    { id: 'lower', label: 'Lower third' },
                    { id: 'pip', label: 'PiP' },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSurface(s.id);
                      setMotionKey((k) => k + 1);
                    }}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium border ${
                      surface === s.id
                        ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                        : 'border-slate-700 text-slate-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-3 space-y-0 divide-y divide-slate-800">
              <div className="pb-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Motion</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 min-w-[9rem]">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      Entrance
                    </span>
                    <select
                      value={surfaceMotion}
                      onChange={(e) => {
                        setSurfaceMotion(e.target.value as SurfaceMotionId);
                        setMotionKey((k) => k + 1);
                      }}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                    >
                      <option value="off">Off</option>
                      <option value="reveal">Reveal</option>
                      <option value="grow">Reveal + grow</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={surfaceMotion === 'off'}
                    onClick={() => setMotionKey((k) => k + 1)}
                    className="px-3 py-2 rounded-md border border-slate-700 text-xs font-medium text-slate-300 hover:border-slate-500 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    Replay
                  </button>
                </div>
              </div>
              {(showBarStyle || showVerticalScale) && (
                <div className="py-3">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-2">
                    Chart options
                  </p>
                  <div className="flex flex-wrap items-end gap-2">{chartOptionsUi}</div>
                </div>
              )}
              {surface === 'lower' && pollType !== 'rating' ? (
                <div className="py-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
                    Lower third fit
                  </p>
                  <label className="flex flex-col gap-1 max-w-xs">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      Overflow
                    </span>
                    <select
                      value={lowerOverflow}
                      onChange={(e) => setLowerOverflow(e.target.value as LowerOverflowId)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                    >
                      <option value="squeeze">Squeeze to fit</option>
                      <option value="rotate">Rotate pages</option>
                    </select>
                  </label>
                  {lowerOverflow === 'rotate' ? (
                    <div className="flex flex-wrap items-end gap-2 pt-0.5">
                      <label className="flex flex-col gap-1 w-[7rem]">
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">
                          Per page
                        </span>
                        <select
                          value={lowerPageSize}
                          onChange={(e) => setLowerPageSize(Number(e.target.value))}
                          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50"
                        >
                          {[2, 3, 4, 5].map((n) => (
                            <option key={n} value={n}>
                              {n} items
                            </option>
                          ))}
                        </select>
                      </label>
                      {choices.length > lowerPageSize ? (
                        <>
                          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer pb-2">
                            <input
                              type="checkbox"
                              checked={lowerAutoRotate}
                              onChange={(e) => setLowerAutoRotate(e.target.checked)}
                              className="rounded border-slate-600"
                            />
                            Auto-rotate
                          </label>
                          <div className="flex items-center gap-1 pb-1">
                            <button
                              type="button"
                              className="px-2 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300"
                              onClick={() =>
                                setLowerPage((p) => (p - 1 + lowerPageCount) % lowerPageCount)
                              }
                            >
                              Prev
                            </button>
                            <span className="text-[11px] tabular-nums text-slate-500 px-1">
                              {((lowerPage % lowerPageCount) + lowerPageCount) % lowerPageCount + 1}/
                              {lowerPageCount}
                            </span>
                            <button
                              type="button"
                              className="px-2 py-1.5 rounded-md border border-slate-700 text-xs text-slate-300"
                              onClick={() => setLowerPage((p) => (p + 1) % lowerPageCount)}
                            >
                              Next
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      All {choices.length} options pack into the strip (tighter with 4+).
                    </p>
                  )}
                </div>
              ) : null}
              {surface === 'pip' ? (
                <div className="py-3 space-y-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">
                    PiP placement & scale
                  </p>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 block mb-1.5">
                      Corner
                    </span>
                    <div className="grid grid-cols-4 gap-1 max-w-sm">
                      {PIP_PLACEMENTS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          title={p.label}
                          onClick={() => setPipPlacement(p.id)}
                          className={`px-2 py-1.5 rounded-md border text-[10px] font-medium ${
                            pipPlacement === p.id
                              ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                              : 'border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {p.id === 'tl'
                            ? '↖ TL'
                            : p.id === 'tr'
                              ? '↗ TR'
                              : p.id === 'bl'
                                ? '↙ BL'
                                : '↘ BR'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 block mb-1.5">
                      Scale
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {PIP_SCALES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          title={s.label}
                          onClick={() => setPipScale(s.id)}
                          className={`px-2.5 py-1.5 rounded-md border text-xs font-medium ${
                            pipScale === s.id
                              ? 'border-amber-400/50 bg-amber-500/10 text-amber-100'
                              : 'border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {s.id.toUpperCase()}
                          <span className="text-slate-500 font-normal ml-1">{s.widthPct}%</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="pt-3">
                <CollapsibleColorPresets
                  value={colorPresetId}
                  onChange={setColorPresetId}
                  open={colorsOpen}
                  onOpenChange={setColorsOpen}
                />
              </div>
            </div>

            <StageFrame
              label={
                surface === 'stage'
                  ? 'Full-frame stage graphic'
                  : surface === 'lower'
                    ? 'Lower third over program'
                    : 'Picture-in-picture card'
              }
              showProgramFeed={surface !== 'stage'}
            >
              {surface === 'stage' ? (
                <StageFullGraphic
                  question={meta.question}
                  choices={choices}
                  pollType={pollType}
                  resultStyle={activeStyle}
                  look={look}
                  accentColor={accentColor}
                  barStyle={barStyle}
                  motion={surfaceMotion}
                  motionKey={motionKey}
                />
              ) : null}
              {surface === 'lower' ? (
                <LowerThirdGraphic
                  question={meta.question}
                  choices={choices}
                  pollType={pollType}
                  resultStyle={activeStyle}
                  look={look}
                  accentColor={accentColor}
                  barStyle={barStyle}
                  overflow={lowerOverflow}
                  pageSize={lowerPageSize}
                  pageIndex={lowerPage}
                  motion={surfaceMotion}
                  motionKey={motionKey}
                />
              ) : null}
              {surface === 'pip' ? (
                <PipGraphic
                  question={meta.question}
                  choices={choices}
                  pollType={pollType}
                  resultStyle={activeStyle}
                  look={look}
                  accentColor={accentColor}
                  barStyle={barStyle}
                  placement={pipPlacement}
                  scale={pipScale}
                  motion={surfaceMotion}
                  motionKey={motionKey}
                />
              ) : null}
            </StageFrame>
          </Panel>
        ) : null}

        {tab === 'limits' ? (
          <LimitsGuidePanel />
        ) : null}

        <p className="text-[11px] text-slate-600 pb-8">
          /poll-samples · type → vote → results → surfaces → limits
        </p>
      </main>
    </div>
  );
}
