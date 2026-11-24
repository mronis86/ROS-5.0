import React, { useEffect, useMemo, useState } from 'react';
import type { WebPollType } from '../lib/webPolls';
import {
  BAR_THICKNESS_OPTIONS,
  COLOR_PRESETS,
  STAGE_POSITION_OPTIONS,
  barStyleFromThickness,
  getColorPreset,
  STAGE_LAYOUT_OPTIONS,
  STAGE_SPLIT_SIDE_OPTIONS,
  STAGE_SPLIT_SIZE_OPTIONS,
  stageBandGapPct,
  stageBandHeightPct,
  stylesForPollType,
  verticalBarWidthPct,
  type BarThicknessId,
  type ResultLook,
  type ResultStyleId,
  type StageLayoutId,
  type StagePositionId,
  type StageSplitSideId,
  type StageSplitSizeId,
  type VerticalScaleId,
  type WebPollDisplayStyle,
} from '../lib/webPollDisplayStyle';

type PreviewOption = { id?: string; label: string; color?: string | null; votes?: number };
type PreviewSurface = 'results' | 'stage' | 'lower' | 'pip';

type Choice = { id: string; label: string; votes: number; color: string };

type Props = {
  pollType: WebPollType;
  value: WebPollDisplayStyle;
  onChange: (next: WebPollDisplayStyle) => void;
  previewOptions?: PreviewOption[];
  question?: string;
  dense?: boolean;
};

const SURFACE_MOTION_CSS = `
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
`;

const PIP_WIDTH: Record<string, number> = { s: 22, m: 28, l: 34, xl: 42 };

/** Same selectable motion for Stage / Lower / PiP: off · reveal (fade) · grow (+ chart grow). */
function surfaceAnim(
  motion: WebPollDisplayStyle['surfaces']['motion'],
  kind: 'reveal' | 'grow' | 'pie',
  name: string,
  opts?: { duration?: string; delayMs?: number; origin?: string }
): React.CSSProperties {
  if (motion === 'off') return {};
  if ((kind === 'grow' || kind === 'pie') && motion !== 'grow') return {};
  const ease =
    kind === 'reveal' ? 'cubic-bezier(0.33, 0.1, 0.25, 1)' : 'cubic-bezier(0.22, 1, 0.36, 1)';
  const fallback = kind === 'reveal' ? '1.05s' : kind === 'pie' ? '0.7s' : '0.75s';
  return {
    animation: `${name} ${opts?.duration || fallback} ${ease} both`,
    animationDelay: opts?.delayMs ? `${opts.delayMs}ms` : undefined,
    transformOrigin: opts?.origin,
  };
}

function metricLabel(c: Choice, total: number, look: ResultLook) {
  const parts: string[] = [];
  if (look.showPct) parts.push(`${Math.round((c.votes / total) * 100)}%`);
  if (look.showCounts) parts.push(String(c.votes));
  return parts.join(' · ');
}

function pipPositionStyle(placement: WebPollDisplayStyle['surfaces']['pipPlacement']): React.CSSProperties {
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

/** Sample vote curves so empty polls still show a readable design. */
const FAKE_VOTE_CURVES = [
  [142, 98, 61, 37, 54, 29, 22, 15],
  [88, 120, 45, 72, 33, 51, 19, 40],
  [56, 64, 110, 48, 91, 27, 35, 18],
  [210, 44, 88, 66, 31, 52, 17, 25],
];

function fakeVotesForIndex(i: number, count: number, curveIndex: number): number {
  const curve = FAKE_VOTE_CURVES[curveIndex % FAKE_VOTE_CURVES.length];
  // Spread a strong leader + mid pack so % and ranking read clearly.
  if (count <= 1) return 128;
  return curve[i % curve.length] ?? Math.max(8, 60 - i * 7);
}

function buildChoices(
  options: PreviewOption[] | undefined,
  palette: string[],
  opts?: { fakeResults?: boolean; fakeSeed?: number }
): Choice[] {
  const useFake = opts?.fakeResults !== false;
  const seed = opts?.fakeSeed ?? 0;
  const base =
    options && options.length
      ? options
      : [
          { label: 'Option A' },
          { label: 'Option B' },
          { label: 'Option C' },
          { label: 'Option D' },
        ];
  return base.map((o, i) => {
    const live = Number(o.votes);
    const votes = useFake
      ? fakeVotesForIndex(i, base.length, seed)
      : Number.isFinite(live) && live >= 0
        ? live
        : 0;
    return {
      id: o.id || `opt-${i}`,
      label: o.label,
      votes,
      color: o.color || palette[i % palette.length],
    };
  });
}

function LookToggles({
  look,
  onChange,
}: {
  look: ResultLook;
  onChange: (next: ResultLook) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {(
        [
          { key: 'showPct', label: '% values' },
          { key: 'showCounts', label: 'Counts' },
          { key: 'showLabels', label: 'Labels' },
          { key: 'accentBars', label: 'Color accents' },
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
  compact,
}: {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2.5'}>
      {(['various', 'monotone'] as const).map((group) => (
        <div key={group}>
          <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
            {group === 'various' ? 'Various' : 'Monotone'}
          </p>
          <div className="flex flex-wrap gap-1">
            {COLOR_PRESETS.filter((p) => p.group === group).map((p) => {
              const selected = value === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange(p.id)}
                  title={p.label}
                  className={`flex items-center gap-1.5 rounded border transition-colors ${
                    compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
                  } ${
                    selected
                      ? 'border-sky-400/50 bg-sky-500/10 text-sky-50'
                      : 'border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span className="flex h-3 overflow-hidden rounded-sm ring-1 ring-black/40">
                    {p.colors.slice(0, compact ? 4 : 5).map((c) => (
                      <span key={c} className="w-2 h-full" style={{ background: c }} />
                    ))}
                  </span>
                  {!compact ? (
                    <span className="text-[11px] font-medium leading-none">{p.label}</span>
                  ) : (
                    <span className="text-[10px] font-medium leading-none">{p.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
        active
          ? 'border-sky-400/50 bg-sky-500/15 text-sky-50'
          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function ResultsChart({
  pollType,
  style,
  choices,
  question,
  motionKey,
}: {
  pollType: WebPollType;
  style: WebPollDisplayStyle;
  choices: Choice[];
  question: string;
  motionKey: number;
}) {
  const total = choices.reduce((n, c) => n + c.votes, 0) || 1;
  const { look, resultStyle, verticalScale, surfaces } = style;
  const motion = surfaces.motion;
  const max = Math.max(...choices.map((c) => c.votes), 1);
  const accent = getColorPreset(style.colorPresetId).colors[3] || '#38bdf8';

  if (pollType === 'rating' || resultStyle === 'histogram') {
    const avg = choices.reduce((n, c, i) => n + (Number(c.label) || i + 1) * c.votes, 0) / total;
    return (
      <div className="space-y-3" key={motionKey}>
        <div className="flex items-end justify-between gap-3">
          <p className="text-sm font-medium text-white">{question}</p>
          <p className="text-2xl font-semibold tabular-nums" style={{ color: accent }}>
            {avg.toFixed(1)}
          </p>
        </div>
        <div
          className={`grid items-end ${verticalScale === 'compact' ? 'h-16' : 'h-24'}`}
          style={{
            ...surfaceAnim(motion, 'reveal', 'ros-fade-in'),
            gridTemplateColumns: `repeat(${Math.min(5, choices.length)}, minmax(0, 1fr))`,
            gap: 6,
          }}
        >
          {choices.slice(0, 5).map((c, i) => {
            const barPct = Math.max(8, (c.votes / max) * 100);
            return (
              <div key={c.id} className="min-w-0 h-full flex flex-col items-center gap-1">
                <div className="relative flex-1 w-full min-h-0">
                  <div
                    className="absolute bottom-0 left-[12%] right-[12%] rounded-t"
                    style={{
                      height: `${barPct}%`,
                      background: look.accentBars ? c.color : '#94a3b8',
                      transformOrigin: 'bottom center',
                      ...surfaceAnim(motion, 'grow', 'ros-grow-y', {
                        delayMs: i * 60,
                        origin: 'bottom center',
                      }),
                    }}
                  />
                </div>
                {look.showLabels ? (
                  <span className="text-[10px] text-slate-400">{c.label}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (resultStyle === 'winner' || resultStyle === 'ab') {
    const top = [...choices].sort((a, b) => b.votes - a.votes).slice(0, resultStyle === 'ab' ? 2 : 3);
    return (
      <div className="space-y-3" key={motionKey} style={surfaceAnim(motion, 'reveal', 'ros-fade-in')}>
        <p className="text-sm font-medium text-white">{question}</p>
        <div className={`grid gap-2 ${resultStyle === 'ab' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {top.map((c, i) => (
            <div
              key={c.id}
              className="rounded-lg border border-slate-700 px-3 py-2.5"
              style={{
                borderColor: look.accentBars ? `${c.color}66` : undefined,
                background: look.accentBars ? `${c.color}14` : undefined,
              }}
            >
              {i === 0 && resultStyle === 'winner' ? (
                <p className="text-[10px] uppercase tracking-wide text-amber-300 mb-1">Leader</p>
              ) : null}
              <p className="text-sm font-semibold text-white truncate">
                {look.showLabels ? c.label : '—'}
              </p>
              <p className="text-xs text-slate-400 tabular-nums mt-0.5">
                {look.showPct ? `${Math.round((c.votes / total) * 100)}%` : ''}
                {look.showPct && look.showCounts ? ' · ' : ''}
                {look.showCounts ? c.votes : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (resultStyle === 'vertical') {
    return (
      <div className="space-y-3" key={motionKey}>
        <p className="text-sm font-medium text-white">{question}</p>
        <div
          className={`grid ${verticalScale === 'compact' ? 'h-20' : 'h-32'}`}
          style={{
            ...surfaceAnim(motion, 'reveal', 'ros-fade-in'),
            gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))`,
            gap: 8,
          }}
        >
          {choices.map((c, i) => {
            const barPct = Math.max(8, (c.votes / max) * 100);
            return (
              <div key={c.id} className="min-w-0 h-full flex flex-col items-center gap-1">
                <div className="relative flex-1 w-full min-h-0">
                  <div
                    className="absolute bottom-0 left-[10%] right-[10%] rounded-t"
                    style={{
                      height: `${barPct}%`,
                      background: look.accentBars ? c.color : '#94a3b8',
                      transformOrigin: 'bottom center',
                      ...surfaceAnim(motion, 'grow', 'ros-grow-y', {
                        delayMs: i * 70,
                        origin: 'bottom center',
                      }),
                    }}
                  />
                </div>
                {look.showLabels ? (
                  <span className="text-[10px] text-slate-400 truncate w-full text-center">
                    {c.label}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (resultStyle === 'pie' || resultStyle === 'donut') {
    let cursor = 0;
    const stops = choices.map((c) => {
      const start = cursor;
      const slice = (c.votes / total) * 100;
      cursor += slice;
      return `${look.accentBars ? c.color : '#94a3b8'} ${start}% ${cursor}%`;
    });
    const hole =
      resultStyle === 'donut' ? 'radial-gradient(circle, #0f172a 46%, transparent 47%)' : '';
    return (
      <div
        className="space-y-3"
        key={motionKey}
        style={surfaceAnim(motion, 'reveal', 'ros-fade-in')}
      >
        <p className="text-sm font-medium text-white">{question}</p>
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 items-center">
          <div
            className="w-28 h-28 rounded-full shrink-0"
            style={{
              background: hole
                ? `${hole}, conic-gradient(${stops.join(', ')})`
                : `conic-gradient(${stops.join(', ')})`,
            }}
          />
          <ul className="space-y-2 min-w-0">
            {choices.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center text-sm text-slate-200"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: look.accentBars ? c.color : '#94a3b8' }}
                />
                <span className="min-w-0 leading-snug line-clamp-2">
                  {look.showLabels ? c.label : '—'}
                </span>
                <span className="tabular-nums text-slate-400 shrink-0 text-right font-medium">
                  {look.showPct ? `${Math.round((c.votes / total) * 100)}%` : ''}
                  {look.showPct && look.showCounts ? ' · ' : ''}
                  {look.showCounts ? c.votes : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const ranked = resultStyle === 'leaderboard';
  const sorted = ranked ? [...choices].sort((a, b) => b.votes - a.votes) : choices;
  // Results preview is always a normal operator chart — bar thickness is surfaces-only.
  return (
    <div className="h-full min-h-0 flex flex-col gap-2" key={motionKey}>
      {question ? (
        <div className="flex items-end justify-between gap-2 shrink-0">
          <p className="text-sm font-medium text-white truncate">{question}</p>
          <p className="text-[11px] text-slate-500 tabular-nums shrink-0">{total} votes</p>
        </div>
      ) : null}
      <ul className="flex-1 min-h-0 space-y-2 overflow-auto">
        {sorted.map((c, i) => {
          const pct = Math.round((c.votes / total) * 100);
          const barPct = Math.round((c.votes / max) * 100);
          const fill = look.accentBars ? c.color : '#94a3b8';
          const metric = [
            look.showPct ? `${pct}%` : null,
            look.showCounts ? String(c.votes) : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={c.id} className="space-y-1">
              <div className="flex justify-between text-xs gap-2">
                <span className="text-slate-200 truncate">
                  {ranked ? `${i + 1}. ` : ''}
                  {look.showLabels ? c.label : ''}
                </span>
                <span className="tabular-nums text-slate-400 shrink-0">{metric}</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${barPct}%`, background: fill }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProgramFrame({ children }: { children: React.ReactNode }) {
  // Fixed 16∶9 with a clear program “background” so entrance motion is easy to judge.
  return (
    <div
      className="relative w-full rounded-lg overflow-hidden border border-slate-700 bg-zinc-950 shrink-0"
      style={{ aspectRatio: '16 / 9', contain: 'layout paint' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, #1e3a5f 0%, #0f172a 40%, #312e81 100%), radial-gradient(ellipse at 25% 35%, rgba(56,189,248,0.35) 0%, transparent 50%), radial-gradient(ellipse at 75% 70%, rgba(167,139,250,0.3) 0%, transparent 45%)',
        }}
      />
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.12]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 11px, rgba(255,255,255,0.06) 11px, rgba(255,255,255,0.06) 12px)',
        }}
      />
      <div className="absolute inset-[6%] rounded border border-white/10 pointer-events-none" />
      <p className="absolute left-3 top-2 text-[9px] uppercase tracking-wider text-white/35 pointer-events-none z-[1]">
        Program feed
      </p>
      <div className="absolute inset-0 overflow-hidden">{children}</div>
    </div>
  );
}

function stageJustify(position: StagePositionId): React.CSSProperties['justifyContent'] {
  if (position === 'upper') return 'flex-start';
  if (position === 'lower') return 'flex-end';
  return 'center';
}

type SurfaceScale = 'stage' | 'lower' | 'pip';

function SurfaceHorizontalBars({
  choices,
  style,
  ranked,
  motionKey,
  scale,
}: {
  choices: Choice[];
  style: WebPollDisplayStyle;
  ranked?: boolean;
  motionKey: number;
  scale: SurfaceScale;
}) {
  const { look, barThickness, surfaces } = style;
  const motion = surfaces.motion;
  const total = choices.reduce((n, c) => n + c.votes, 0) || 1;
  const max = Math.max(...choices.map((c) => c.votes), 1);
  const sorted = ranked ? [...choices].sort((a, b) => b.votes - a.votes) : choices;
  const gap = scale === 'stage' ? `${stageBandGapPct(barThickness)}%` : scale === 'pip' ? 3 : 4;
  const skinny = barThickness === 'skinny';
  const dense = scale !== 'stage';

  if (skinny) {
    return (
      <div
        key={motionKey}
        className="h-full min-h-0 flex flex-col justify-center"
        style={{ gap }}
      >
        {sorted.map((c, i) => (
          <div
            key={c.id}
            style={surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 70 })}
          >
            <div className="flex justify-between gap-1 mb-0.5">
              <span
                className="text-white/90 truncate font-semibold"
                style={{ fontSize: dense ? 10 : 'clamp(12px, 2.1cqi, 18px)' }}
              >
                {ranked ? `${i + 1}. ` : ''}
                {look.showLabels ? c.label : ''}
              </span>
              <span
                className="text-white/55 tabular-nums shrink-0"
                style={{ fontSize: dense ? 10 : 'clamp(11px, 1.8cqi, 15px)' }}
              >
                {metricLabel(c, total, look)}
              </span>
            </div>
            <div
              className="rounded-full bg-white/15 overflow-hidden"
              style={{ height: dense ? 4 : 'clamp(8px, 1.8cqh, 14px)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(c.votes / max) * 100}%`,
                  background: look.accentBars ? c.color : '#94a3b8',
                  ...surfaceAnim(motion, 'grow', 'ros-grow-x', {
                    delayMs: 70 + i * 50,
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

  const radius =
    barThickness === 'xxl' ? 12 : barThickness === 'xl' ? 10 : barThickness === 'large' ? 9 : 8;

  return (
    <div
      key={motionKey}
      className="h-full min-h-0"
      style={{
        display: 'grid',
        gridTemplateRows: `repeat(${sorted.length}, minmax(0, 1fr))`,
        gap,
      }}
    >
      {sorted.map((c, i) => (
        <div
          key={c.id}
          className="relative min-h-0 overflow-hidden"
          style={{
            borderRadius: dense ? 6 : radius,
            background: 'rgba(255,255,255,0.1)',
            ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 75 }),
          }}
        >
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${(c.votes / max) * 100}%`,
              background: look.accentBars ? c.color : '#94a3b8',
              opacity: 0.92,
              ...surfaceAnim(motion, 'grow', 'ros-grow-x', {
                delayMs: 140 + i * 75,
                origin: 'left center',
              }),
            }}
          />
          <div className="relative z-[1] h-full flex items-center justify-between gap-2 px-2">
            <span
              className="text-white font-semibold truncate"
              style={{
                fontSize: dense ? 10 : 'clamp(13px, 2.4cqi, 26px)',
                textShadow: '0 1px 3px rgba(0,0,0,0.55)',
              }}
            >
              {ranked ? `${i + 1}. ` : ''}
              {look.showLabels ? c.label : ''}
            </span>
            <span
              className="text-white font-bold tabular-nums shrink-0"
              style={{
                fontSize: dense ? 10 : 'clamp(14px, 2.8cqi, 30px)',
                textShadow: '0 1px 3px rgba(0,0,0,0.55)',
              }}
            >
              {metricLabel(c, total, look)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SurfaceVerticalBars({
  choices,
  style,
  motionKey,
  scale,
}: {
  choices: Choice[];
  style: WebPollDisplayStyle;
  motionKey: number;
  scale: SurfaceScale;
}) {
  const { look, barThickness, verticalScale, surfaces } = style;
  const motion = surfaces.motion;
  const total = choices.reduce((n, c) => n + c.votes, 0) || 1;
  const max = Math.max(...choices.map((c) => c.votes), 1);
  const gap = scale === 'stage' ? `${stageBandGapPct(barThickness)}%` : scale === 'pip' ? 3 : 4;
  const dense = scale !== 'stage';
  const skinny = barThickness === 'skinny';
  const compact = verticalScale === 'compact';
  const widthPct = verticalBarWidthPct(barThickness);
  const sideInset = `${Math.max(0, (100 - widthPct) / 2)}%`;
  const radius =
    barThickness === 'xxl' ? 12 : barThickness === 'xl' ? 10 : barThickness === 'large' ? 9 : 8;
  // Tall fills the chart body; compact uses a shorter plot so the scale is obvious.
  const plotH =
    compact
      ? scale === 'stage'
        ? '54%'
        : scale === 'lower'
          ? '68%'
          : '58%'
      : '100%';

  const grid = (
    <div
      className="h-full min-h-0 w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))`,
        gap,
      }}
    >
      {choices.map((c, i) => {
        const barPct = Math.max(4, (c.votes / max) * 100);
        return (
          <div
            key={c.id}
            className="min-w-0 h-full min-h-0 flex flex-col"
            style={{
              gap: dense ? 2 : 'clamp(2px, 1.2cqh, 8px)',
              ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 75 }),
            }}
          >
            {(look.showPct || look.showCounts) && (
              <span
                className="tabular-nums text-white/75 text-center shrink-0 truncate"
                style={{
                  fontSize: dense ? 9 : 'clamp(11px, 2cqi, 18px)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.45)',
                }}
              >
                {metricLabel(c, total, look)}
              </span>
            )}

            <div className="relative flex-1 w-full min-h-0 overflow-hidden">
              {skinny ? (
                <div
                  className="absolute inset-y-0 rounded-full bg-white/15 overflow-hidden"
                  style={{ left: sideInset, right: sideInset }}
                >
                  <div
                    className="absolute bottom-0 inset-x-0 rounded-full"
                    style={{
                      height: `${barPct}%`,
                      background: look.accentBars ? c.color : '#94a3b8',
                      transformOrigin: 'bottom center',
                      ...surfaceAnim(motion, 'grow', 'ros-grow-y', {
                        delayMs: 140 + i * 75,
                        origin: 'bottom center',
                      }),
                    }}
                  />
                </div>
              ) : (
                <>
                  <div
                    className="absolute inset-y-0 bg-white/10"
                    style={{
                      left: sideInset,
                      right: sideInset,
                      borderRadius: dense ? 6 : radius,
                    }}
                  />
                  <div
                    className="absolute bottom-0"
                    style={{
                      left: sideInset,
                      right: sideInset,
                      height: `${barPct}%`,
                      borderRadius: dense ? '6px 6px 4px 4px' : `${radius}px ${radius}px 6px 6px`,
                      background: look.accentBars ? c.color : '#94a3b8',
                      opacity: 0.92,
                      transformOrigin: 'bottom center',
                      ...surfaceAnim(motion, 'grow', 'ros-grow-y', {
                        delayMs: 140 + i * 75,
                        origin: 'bottom center',
                      }),
                    }}
                  />
                </>
              )}
            </div>

            {look.showLabels ? (
              <span
                className="truncate w-full text-center text-white/80 font-semibold shrink-0"
                style={{
                  fontSize: dense ? 9 : 'clamp(11px, 2.1cqi, 18px)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.45)',
                }}
              >
                {c.label}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      key={motionKey}
      className="h-full min-h-0 flex flex-col"
      style={{ justifyContent: compact ? 'flex-end' : 'stretch' }}
    >
      <div className="min-h-0 w-full" style={{ height: plotH }}>
        {grid}
      </div>
    </div>
  );
}

function SurfacePie({
  choices,
  style,
  motionKey,
  scale,
  donut,
}: {
  choices: Choice[];
  style: WebPollDisplayStyle;
  motionKey: number;
  scale: SurfaceScale;
  donut?: boolean;
}) {
  const { look, surfaces } = style;
  const motion = surfaces.motion;
  const total = choices.reduce((n, c) => n + c.votes, 0) || 1;
  let cursor = 0;
  const stops = choices.map((c) => {
    const start = cursor;
    const slice = (c.votes / total) * 100;
    cursor += slice;
    return `${look.accentBars ? c.color : '#94a3b8'} ${start}% ${cursor}%`;
  });
  const hole = donut
    ? 'radial-gradient(circle, rgba(7,11,20,0.95) 46%, transparent 47%)'
    : '';
  const chartBg = hole
    ? `${hole}, conic-gradient(${stops.join(', ')})`
    : `conic-gradient(${stops.join(', ')})`;

  const labelSize =
    scale === 'stage'
      ? 'clamp(13px, 2.1cqi, 20px)'
      : scale === 'lower'
        ? 'clamp(11px, 2.4cqh, 15px)'
        : 10;
  const metricSize =
    scale === 'stage'
      ? 'clamp(13px, 2cqi, 18px)'
      : scale === 'lower'
        ? 'clamp(11px, 2.2cqh, 14px)'
        : 10;
  const swatch = scale === 'stage' ? 11 : scale === 'lower' ? 9 : 7;
  const rowGap = scale === 'stage' ? 'clamp(6px, 1.4cqh, 12px)' : scale === 'lower' ? 3 : 2;

  const legend = (
    <ul
      className="min-w-0 overflow-y-auto overflow-x-hidden"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: rowGap,
        // Stage: hug the chart. Lower/PiP: fill the legend column.
        flex: scale === 'stage' ? '0 1 auto' : '1 1 0',
        maxWidth: scale === 'stage' ? 'min(36cqi, 18rem)' : undefined,
        height: scale === 'lower' ? '100%' : undefined,
      }}
    >
      {choices.map((c, i) => (
        <li
          key={c.id}
          className="min-w-0"
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto',
            alignItems: 'center',
            columnGap: scale === 'pip' ? 5 : scale === 'stage' ? 10 : 6,
            ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: 120 + i * 50 }),
          }}
        >
          <span
            className="rounded-full shrink-0"
            style={{
              width: swatch,
              height: swatch,
              background: look.accentBars ? c.color : '#94a3b8',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.22)',
            }}
          />
          <span
            className="text-white font-semibold min-w-0"
            style={{
              fontSize: labelSize,
              lineHeight: 1.2,
              display: '-webkit-box',
              WebkitLineClamp: scale === 'pip' ? 1 : 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textShadow: '0 1px 2px rgba(0,0,0,0.45)',
            }}
          >
            {look.showLabels ? c.label : '—'}
          </span>
          <span
            className="tabular-nums text-white/85 font-bold shrink-0 text-right"
            style={{
              fontSize: metricSize,
              letterSpacing: '-0.02em',
              textShadow: '0 1px 2px rgba(0,0,0,0.45)',
            }}
          >
            {metricLabel(c, total, look)}
          </span>
        </li>
      ))}
    </ul>
  );

  // Stage: full = chart + legend side-by-side; split panel = stacked (narrow column).
  if (scale === 'stage') {
    const splitPanel = surfaces.stageLayout === 'split';
    if (splitPanel) {
      return (
        <div
          key={motionKey}
          className="h-full w-full min-h-0 flex flex-col items-stretch"
          style={{ gap: 8, ...surfaceAnim(motion, 'reveal', 'ros-fade-in') }}
        >
          <div
            className="flex justify-center items-center min-h-0"
            style={{ flex: '1.6 1 0' }}
          >
            <div
              className="rounded-full"
              style={{
                height: '100%',
                aspectRatio: '1',
                maxWidth: '100%',
                background: chartBg,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.14)',
                ...surfaceAnim(motion, 'pie', 'ros-pie-in', { delayMs: 80 }),
              }}
            />
          </div>
          <div className="min-h-0" style={{ flex: '1 1 0' }}>
            {legend}
          </div>
        </div>
      );
    }
    return (
      <div
        key={motionKey}
        className="h-full w-full min-h-0 flex items-center justify-center"
        style={surfaceAnim(motion, 'reveal', 'ros-fade-in')}
      >
        <div
          className="h-full max-h-full min-h-0 flex items-center"
          style={{ gap: 'clamp(14px, 2.8cqi, 28px)', maxWidth: '100%' }}
        >
          <div
            className="rounded-full shrink-0"
            style={{
              height: '100%',
              width: 'auto',
              aspectRatio: '1',
              maxWidth: 'min(56cqi, 100%)',
              background: chartBg,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.14)',
              ...surfaceAnim(motion, 'pie', 'ros-pie-in', { delayMs: 80 }),
            }}
          />
          {legend}
        </div>
      </div>
    );
  }

  if (scale === 'pip') {
    return (
      <div
        key={motionKey}
        className="h-full min-h-0 flex flex-col items-stretch"
        style={{ gap: 3, ...surfaceAnim(motion, 'reveal', 'ros-fade-in') }}
      >
        <div
          className="flex justify-center items-center min-h-0"
          style={{ flex: '2.2 1 0', minHeight: 0 }}
        >
          <div
            className="rounded-full"
            style={{
              height: '100%',
              aspectRatio: '1',
              maxWidth: '100%',
              background: chartBg,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.12)',
              ...surfaceAnim(motion, 'pie', 'ros-pie-in', { delayMs: 80 }),
            }}
          />
        </div>
        <div className="min-h-0" style={{ flex: '0.7 0 0', maxHeight: '38%' }}>
          {legend}
        </div>
      </div>
    );
  }

  // Lower: legend fills the left; donut sits on the right (full band height).
  return (
    <div
      key={motionKey}
      className="h-full w-full min-h-0 grid items-center"
      style={{
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 10,
        ...surfaceAnim(motion, 'reveal', 'ros-fade-in'),
      }}
    >
      {legend}
      <div
        className="rounded-full shrink-0"
        style={{
          height: '100%',
          aspectRatio: '1',
          maxWidth: '42%',
          background: chartBg,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.12)',
          ...surfaceAnim(motion, 'pie', 'ros-pie-in', { delayMs: 80 }),
        }}
      />
    </div>
  );
}

function SurfaceWinner({
  choices,
  style,
  motionKey,
  scale,
  ab,
}: {
  choices: Choice[];
  style: WebPollDisplayStyle;
  motionKey: number;
  scale: SurfaceScale;
  ab?: boolean;
}) {
  const { look, surfaces } = style;
  const motion = surfaces.motion;
  const total = choices.reduce((n, c) => n + c.votes, 0) || 1;
  const sorted = [...choices].sort((a, b) => b.votes - a.votes);
  const lead = sorted[0];
  const rest = ab ? sorted.slice(0, 2) : sorted.slice(0, Math.min(3, sorted.length));
  const dense = scale !== 'stage';

  if (!lead) return null;

  if (ab) {
    return (
      <div
        key={motionKey}
        className="h-full min-h-0 grid gap-2"
        style={{ gridTemplateColumns: '1fr 1fr' }}
      >
        {rest.map((c, i) => (
          <div
            key={c.id}
            className="min-h-0 rounded-lg flex flex-col items-center justify-center text-center px-2"
            style={{
              border: `1px solid ${look.accentBars ? `${c.color}66` : 'rgba(255,255,255,0.15)'}`,
              background: look.accentBars ? `${c.color}22` : 'rgba(255,255,255,0.06)',
              ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: i * 90 }),
            }}
          >
            <p
              className="font-bold tabular-nums m-0"
              style={{
                fontSize: dense ? 22 : 'clamp(28px, 7cqi, 64px)',
                color: look.accentBars ? c.color : '#fff',
                lineHeight: 1,
              }}
            >
              {look.showPct ? `${Math.round((c.votes / total) * 100)}%` : c.votes}
            </p>
            {look.showLabels ? (
              <p
                className="m-0 mt-1 text-white font-semibold truncate w-full"
                style={{ fontSize: dense ? 11 : 'clamp(12px, 2.2cqi, 20px)' }}
              >
                {c.label}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div key={motionKey} className="h-full min-h-0 flex flex-col gap-2">
      <div
        className="rounded-lg flex-1 min-h-0 flex flex-col items-center justify-center text-center px-3"
        style={{
          border: `1px solid ${look.accentBars ? `${lead.color}77` : 'rgba(255,255,255,0.2)'}`,
          background: look.accentBars ? `${lead.color}28` : 'rgba(255,255,255,0.08)',
          ...(motion === 'grow'
            ? surfaceAnim(motion, 'pie', 'ros-pie-in', { delayMs: 40 })
            : surfaceAnim(motion, 'reveal', 'ros-fade-in')),
        }}
      >
        <p
          className="m-0 uppercase tracking-[0.2em] text-white/55"
          style={{ fontSize: dense ? 9 : 'clamp(10px, 1.4cqi, 12px)' }}
        >
          Leading
        </p>
        <p
          className="m-0 font-bold tabular-nums"
          style={{
            fontSize: dense ? 28 : 'clamp(36px, 9cqi, 72px)',
            color: look.accentBars ? lead.color : '#fff',
            lineHeight: 1.05,
          }}
        >
          {look.showPct ? `${Math.round((lead.votes / total) * 100)}%` : lead.votes}
        </p>
        {look.showLabels ? (
          <p
            className="m-0 mt-1 text-white font-semibold"
            style={{ fontSize: dense ? 12 : 'clamp(14px, 2.5cqi, 24px)' }}
          >
            {lead.label}
          </p>
        ) : null}
      </div>
      {sorted.length > 1 ? (
        <ul className="shrink-0 space-y-1">
          {sorted.slice(1, dense ? 3 : 4).map((c, i) => (
            <li
              key={c.id}
              className="flex justify-between gap-2 text-white/75"
              style={{
                fontSize: dense ? 10 : 'clamp(11px, 1.8cqi, 15px)',
                ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: 120 + i * 60 }),
              }}
            >
              <span className="truncate">
                #{i + 2} {look.showLabels ? c.label : ''}
              </span>
              <span className="tabular-nums shrink-0">{metricLabel(c, total, look)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SurfaceLeaderboard({
  choices,
  style,
  motionKey,
  scale,
}: {
  choices: Choice[];
  style: WebPollDisplayStyle;
  motionKey: number;
  scale: SurfaceScale;
}) {
  // Ranked race: place badges + fill bars (distinct from plain horizontal).
  const sorted = [...choices].sort((a, b) => b.votes - a.votes);
  return (
    <SurfaceHorizontalBars
      choices={sorted}
      style={style}
      ranked
      motionKey={motionKey}
      scale={scale}
    />
  );
}

function SurfaceChart({
  choices,
  style,
  pollType,
  motionKey,
  scale,
}: {
  choices: Choice[];
  style: WebPollDisplayStyle;
  pollType: WebPollType;
  motionKey: number;
  scale: SurfaceScale;
}) {
  const resultStyle = style.resultStyle;
  if (pollType === 'rating' || resultStyle === 'histogram') {
    return (
      <SurfaceVerticalBars
        choices={choices}
        style={style}
        motionKey={motionKey}
        scale={scale}
      />
    );
  }
  if (resultStyle === 'vertical') {
    return (
      <SurfaceVerticalBars
        choices={choices}
        style={style}
        motionKey={motionKey}
        scale={scale}
      />
    );
  }
  if (resultStyle === 'pie' || resultStyle === 'donut') {
    return (
      <SurfacePie
        choices={choices}
        style={style}
        motionKey={motionKey}
        scale={scale}
        donut={resultStyle === 'donut'}
      />
    );
  }
  if (resultStyle === 'winner' || resultStyle === 'ab') {
    return (
      <SurfaceWinner
        choices={choices}
        style={style}
        motionKey={motionKey}
        scale={scale}
        ab={resultStyle === 'ab'}
      />
    );
  }
  if (resultStyle === 'leaderboard') {
    return (
      <SurfaceLeaderboard
        choices={choices}
        style={style}
        motionKey={motionKey}
        scale={scale}
      />
    );
  }
  return (
    <SurfaceHorizontalBars
      choices={choices}
      style={style}
      motionKey={motionKey}
      scale={scale}
    />
  );
}

function stagePlateFrameStyle(surfaces: WebPollDisplayStyle['surfaces']): React.CSSProperties {
  const split = surfaces.stageLayout === 'split';
  const widthPct = surfaces.stageSplitSize === 'third' ? 33.333 : 50;
  const side = surfaces.stageSplitSide === 'left' ? 'left' : 'right';
  if (!split) {
    return { inset: '4%' };
  }
  return {
    top: '4%',
    bottom: '4%',
    width: `calc(${widthPct}% - 2%)`,
    left: side === 'left' ? '2%' : 'auto',
    right: side === 'right' ? '2%' : 'auto',
  };
}

function StagePlate({
  question,
  choices,
  pollType,
  style,
  motionKey,
}: {
  question: string;
  choices: Choice[];
  pollType: WebPollType;
  style: WebPollDisplayStyle;
  motionKey: number;
}) {
  const total = choices.reduce((n, c) => n + c.votes, 0) || 1;
  const bandPct = stageBandHeightPct(style.barThickness);
  const { surfaces } = style;
  const position = surfaces.stagePosition || 'mid';
  const motion = surfaces.motion;
  const showTitle = surfaces.showTitle !== false;
  const isSplit = surfaces.stageLayout === 'split';
  // Band height is for bar stacks only — pie/donut/winner need the full body.
  const useBand =
    !isSplit &&
    (style.resultStyle === 'bars' ||
      style.resultStyle === 'vertical' ||
      style.resultStyle === 'leaderboard' ||
      style.resultStyle === 'histogram');

  return (
    <div
      key={motionKey}
      className="absolute rounded-lg overflow-hidden"
      style={{
        ...stagePlateFrameStyle(surfaces),
        display: 'grid',
        gridTemplateRows: showTitle ? 'auto 1fr' : '1fr',
        gap: showTitle ? '3%' : 0,
        padding: isSplit ? '4% 5%' : '3.5% 4% 4%',
        boxSizing: 'border-box',
        background: surfaces.showBackground === false ? 'transparent' : 'rgba(7, 11, 20, 0.82)',
        border:
          surfaces.showBorder === false
            ? '1px solid transparent'
            : '1px solid rgba(255,255,255,0.12)',
        color: '#fff',
        containerType: 'size',
        backdropFilter: surfaces.showBackground === false ? undefined : 'blur(2px)',
        ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '0.9s' }),
      }}
    >
      {showTitle ? (
        <div
          className="min-h-0 overflow-hidden flex items-end justify-between gap-3"
          style={surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1.05s', delayMs: 40 })}
        >
          <p
            className="m-0 font-semibold min-w-0 flex-1"
            style={{
              fontSize: 'clamp(16px, 3.2cqi, 36px)',
              lineHeight: 1.15,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {question}
          </p>
          <p
            className="m-0 shrink-0 tabular-nums text-white/45 pb-1"
            style={{ fontSize: 'clamp(11px, 1.7cqi, 15px)' }}
          >
            {total} votes
          </p>
        </div>
      ) : null}

      <div className="min-h-0 flex flex-col" style={{ justifyContent: stageJustify(position) }}>
        <div
          className="min-h-0 w-full"
          style={{
            height: useBand && bandPct < 99 ? `${bandPct}%` : '100%',
            maxHeight: '100%',
          }}
        >
          <SurfaceChart
            choices={choices}
            style={style}
            pollType={pollType}
            motionKey={motionKey}
            scale="stage"
          />
        </div>
      </div>
    </div>
  );
}

function StagePreview({
  question,
  choices,
  pollType,
  style,
  motionKey,
}: {
  question: string;
  choices: Choice[];
  pollType: WebPollType;
  style: WebPollDisplayStyle;
  motionKey: number;
}) {
  return (
    <ProgramFrame>
      <StagePlate
        question={question}
        choices={choices}
        pollType={pollType}
        style={style}
        motionKey={motionKey}
      />
    </ProgramFrame>
  );
}

function LowerPlate({
  question,
  choices,
  style,
  pollType,
  motionKey,
}: {
  question: string;
  choices: Choice[];
  style: WebPollDisplayStyle;
  pollType: WebPollType;
  motionKey: number;
}) {
  const accent = getColorPreset(style.colorPresetId).colors[3] || '#38bdf8';
  const { surfaces } = style;
  const motion = surfaces.motion;
  const overflow = surfaces.lowerOverflow;
  const showTitle = surfaces.showTitle !== false;
  const sorted =
    style.resultStyle === 'leaderboard' || style.resultStyle === 'winner'
      ? [...choices].sort((a, b) => b.votes - a.votes)
      : choices;
  const pageSize = 4;
  const visible =
    overflow === 'squeeze' ||
    style.resultStyle === 'pie' ||
    style.resultStyle === 'donut' ||
    style.resultStyle === 'vertical' ||
    style.resultStyle === 'winner' ||
    style.resultStyle === 'ab'
      ? sorted
      : sorted.slice(0, Math.min(pageSize, sorted.length));

  return (
    <div
      key={motionKey}
      className="absolute inset-x-[4%] bottom-[7%] h-[30%] rounded-md overflow-hidden flex shadow-2xl"
      style={{
        background:
          surfaces.showBackground === false ? 'transparent' : 'rgba(2, 6, 23, 0.88)',
        border:
          surfaces.showBorder === false
            ? '1px solid transparent'
            : '1px solid rgba(255,255,255,0.15)',
        backdropFilter: surfaces.showBackground === false ? undefined : 'blur(6px)',
        ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1s' }),
      }}
    >
      {surfaces.showBorder !== false || surfaces.showBackground !== false ? (
        <div className="w-1.5 shrink-0" style={{ background: accent }} />
      ) : null}
      <div className="flex-1 min-w-0 px-2.5 py-1.5 flex flex-col gap-1 min-h-0">
        {showTitle ? (
          <p
            className="text-white font-medium truncate text-xs shrink-0"
            style={surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: 50 })}
          >
            {question}
          </p>
        ) : null}
        <div className="flex-1 min-h-0">
          <SurfaceChart
            choices={visible}
            style={style}
            pollType={pollType}
            motionKey={motionKey}
            scale="lower"
          />
        </div>
      </div>
    </div>
  );
}

function LowerPreview({
  question,
  choices,
  style,
  pollType,
  motionKey,
}: {
  question: string;
  choices: Choice[];
  style: WebPollDisplayStyle;
  pollType: WebPollType;
  motionKey: number;
}) {
  return (
    <ProgramFrame>
      <LowerPlate
        question={question}
        choices={choices}
        style={style}
        pollType={pollType}
        motionKey={motionKey}
      />
    </ProgramFrame>
  );
}

function PipPlate({
  question,
  choices,
  style,
  pollType,
  motionKey,
}: {
  question: string;
  choices: Choice[];
  style: WebPollDisplayStyle;
  pollType: WebPollType;
  motionKey: number;
}) {
  const { surfaces } = style;
  const motion = surfaces.motion;
  const widthPct = PIP_WIDTH[surfaces.pipScale] || 24;
  const showTitle = surfaces.showTitle !== false;
  const sorted =
    style.resultStyle === 'leaderboard' || style.resultStyle === 'winner'
      ? [...choices].sort((a, b) => b.votes - a.votes)
      : choices;

  return (
    <div
      key={motionKey}
      className="absolute aspect-[4/3] rounded-md overflow-hidden shadow-2xl flex flex-col"
      style={{
        ...pipPositionStyle(surfaces.pipPlacement),
        width: `${widthPct}%`,
        background:
          surfaces.showBackground === false ? 'transparent' : 'rgba(2, 6, 23, 0.9)',
        border:
          surfaces.showBorder === false
            ? '1px solid transparent'
            : '1px solid rgba(255,255,255,0.2)',
        ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { duration: '1s' }),
      }}
    >
      {showTitle ? (
        <div
          className="px-2 pt-1.5 pb-1 shrink-0"
          style={{
            borderBottom:
              surfaces.showBorder === false
                ? undefined
                : '1px solid rgba(255,255,255,0.1)',
            ...surfaceAnim(motion, 'reveal', 'ros-fade-in', { delayMs: 40 }),
          }}
        >
          <p className="text-[10px] text-white font-medium leading-snug line-clamp-2">
            {question}
          </p>
        </div>
      ) : null}
      <div className="flex-1 px-2 py-1.5 min-h-0">
        <SurfaceChart
          choices={sorted}
          style={style}
          pollType={pollType}
          motionKey={motionKey}
          scale="pip"
        />
      </div>
    </div>
  );
}

function PipPreview({
  question,
  choices,
  style,
  pollType,
  motionKey,
}: {
  question: string;
  choices: Choice[];
  style: WebPollDisplayStyle;
  pollType: WebPollType;
  motionKey: number;
}) {
  return (
    <ProgramFrame>
      <PipPlate
        question={question}
        choices={choices}
        style={style}
        pollType={pollType}
        motionKey={motionKey}
      />
    </ProgramFrame>
  );
}

export type BroadcastSurfaceKind = 'stage' | 'lower' | 'pip';

/** Full-viewport transparent overlay for OBS / vMix browser sources. */
export function WebPollBroadcastSurface({
  surface,
  question,
  choices,
  pollType,
  style,
  motionKey,
}: {
  surface: BroadcastSurfaceKind;
  question: string;
  choices: Choice[];
  pollType: WebPollType;
  style: WebPollDisplayStyle;
  motionKey: number;
}) {
  const plate =
    surface === 'lower' ? (
      <LowerPlate
        question={question}
        choices={choices}
        style={style}
        pollType={pollType}
        motionKey={motionKey}
      />
    ) : surface === 'pip' ? (
      <PipPlate
        question={question}
        choices={choices}
        style={style}
        pollType={pollType}
        motionKey={motionKey}
      />
    ) : (
      <StagePlate
        question={question}
        choices={choices}
        pollType={pollType}
        style={style}
        motionKey={motionKey}
      />
    );

  return (
    <div className="fixed inset-0 overflow-hidden bg-transparent" style={{ containerType: 'size' }}>
      <style>{SURFACE_MOTION_CSS}</style>
      {plate}
    </div>
  );
}

export default function WebPollDesignEditor({
  pollType,
  value,
  onChange,
  previewOptions,
  question = 'Poll question',
  dense,
}: Props) {
  const styles = useMemo(() => stylesForPollType(pollType), [pollType]);
  const showBarThickness =
    value.resultStyle === 'bars' ||
    value.resultStyle === 'vertical' ||
    value.resultStyle === 'leaderboard' ||
    value.resultStyle === 'histogram';
  const showVerticalScale = value.resultStyle === 'vertical';
  // Thickness belongs with surfaces (stage / lower / PiP), not Results or live rollup.
  const [preview, setPreview] = useState<PreviewSurface>('stage');
  const [motionKey, setMotionKey] = useState(0);
  const [fakeResults, setFakeResults] = useState(true);
  const [fakeSeed, setFakeSeed] = useState(0);
  const [openColors, setOpenColors] = useState(false);
  const [openSurfaces, setOpenSurfaces] = useState(true);

  const palette = getColorPreset(value.colorPresetId).colors;
  const choices = useMemo(
    () => buildChoices(previewOptions, palette, { fakeResults, fakeSeed }),
    [previewOptions, palette, fakeResults, fakeSeed]
  );
  const fakeTotal = choices.reduce((n, c) => n + c.votes, 0);

  // Only re-trigger entrance motion when the preview surface or motion mode changes —
  // not on every thickness/color tweak (that made the 16∶9 frame feel like it jumped).
  useEffect(() => {
    setMotionKey((k) => k + 1);
  }, [preview, value.surfaces.motion]);

  const patch = (partial: Partial<WebPollDisplayStyle>) => {
    const next = { ...value, ...partial };
    if (partial.barThickness) {
      next.barStyle = barStyleFromThickness(partial.barThickness);
    }
    onChange(next);
  };

  const setThickness = (barThickness: BarThicknessId) => {
    patch({ barThickness, barStyle: barStyleFromThickness(barThickness) });
  };

  const selectCls =
    'rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-white focus:outline-none focus:border-sky-500/50';

  const previewPane = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5 min-h-[28px]">
        <div className="flex flex-wrap gap-1">
          {(
            [
              { id: 'results', label: 'Results' },
              { id: 'stage', label: 'Stage' },
              { id: 'lower', label: 'Lower' },
              { id: 'pip', label: 'PiP' },
            ] as const
          ).map((tab) => (
            <Chip key={tab.id} active={preview === tab.id} onClick={() => setPreview(tab.id)}>
              {tab.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Chip
            active={fakeResults}
            onClick={() => setFakeResults((v) => !v)}
            title={fakeResults ? 'Sample vote totals' : 'Live counted votes'}
          >
            {fakeResults ? 'Fake' : 'Live'}
          </Chip>
          {fakeResults ? (
            <Chip
              onClick={() => setFakeSeed((s) => s + 1)}
              title="Shuffle sample totals"
            >
              Shuffle
            </Chip>
          ) : null}
          <Chip onClick={() => setMotionKey((k) => k + 1)} title="Replay motion">
            Replay
          </Chip>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 leading-snug h-4 truncate">
        {fakeResults
          ? `Sample totals (${fakeTotal} fake) — not real ballots.`
          : 'Live counted votes (may be empty before voting).'}
      </p>
      {/* Always the same 16∶9 slot — tabs only swap absolute content inside. */}
      {preview === 'results' ? (
        <ProgramFrame>
          <div className="absolute inset-0 bg-slate-950 p-[3.5%] overflow-hidden">
            <ResultsChart
              pollType={pollType}
              style={value}
              choices={choices}
              question={question}
              motionKey={motionKey}
            />
          </div>
        </ProgramFrame>
      ) : null}
      {preview === 'stage' ? (
        <StagePreview
          question={question}
          choices={choices}
          pollType={pollType}
          style={value}
          motionKey={motionKey}
        />
      ) : null}
      {preview === 'lower' ? (
        <LowerPreview
          question={question}
          choices={choices}
          style={value}
          pollType={pollType}
          motionKey={motionKey}
        />
      ) : null}
      {preview === 'pip' ? (
        <PipPreview
          question={question}
          choices={choices}
          style={value}
          pollType={pollType}
          motionKey={motionKey}
        />
      ) : null}
    </div>
  );

  return (
    <div className={dense ? 'space-y-3' : 'space-y-3'}>
      <style>{SURFACE_MOTION_CSS}</style>

      {/* Preview first on mobile; sticky beside controls on lg+ */}
      <div className="lg:grid lg:grid-cols-[minmax(0,18.5rem)_minmax(0,1fr)] lg:gap-4 lg:items-start">
        <div
          className="order-2 lg:order-1 space-y-2.5 lg:max-h-[min(70vh,40rem)] lg:overflow-y-auto lg:pr-1"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-2.5 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">
                  Layout
                </span>
                {styles.length > 1 ? (
                  <select
                    value={value.resultStyle}
                    onChange={(e) => patch({ resultStyle: e.target.value as ResultStyleId })}
                    className={`${selectCls} flex-1 min-w-0`}
                  >
                    {styles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] text-slate-300 truncate">
                    {styles[0]?.label || value.resultStyle}
                  </span>
                )}
              </label>
              {showVerticalScale ? (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {(
                      [
                        { id: 'tall' as VerticalScaleId, label: 'Tall' },
                        { id: 'compact' as VerticalScaleId, label: 'Compact' },
                      ] as const
                    ).map((opt) => (
                      <Chip
                        key={opt.id}
                        active={value.verticalScale === opt.id}
                        onClick={() => patch({ verticalScale: opt.id })}
                      >
                        {opt.label}
                      </Chip>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-500">
                    Tall fills the chart; compact shortens the plot on Results and surfaces.
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Look</p>
              <LookToggles look={value.look} onChange={(look) => patch({ look })} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenColors((v) => !v)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-slate-900/50"
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                Colors
              </span>
              <span className="text-[11px] text-slate-500">
                {getColorPreset(value.colorPresetId).label} · {openColors ? 'Hide' : 'Show'}
              </span>
            </button>
            {openColors ? (
              <div className="px-2.5 pb-2.5 border-t border-slate-800 pt-2">
                <ColorPresetPicker
                  compact
                  value={value.colorPresetId}
                  onChange={(colorPresetId) => patch({ colorPresetId })}
                />
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenSurfaces((v) => !v)}
              className="w-full flex items-center justify-between px-2.5 py-2 text-left hover:bg-slate-900/50"
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                Surfaces
              </span>
              <span className="text-[11px] text-slate-500">
                {showBarThickness ? value.barThickness : value.surfaces.motion} ·{' '}
                {openSurfaces ? 'Hide' : 'Show'}
              </span>
            </button>
            {openSurfaces ? (
              <div className="px-2.5 pb-2.5 border-t border-slate-800 pt-2 space-y-2.5">
                {showBarThickness ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                      Bar thickness
                    </p>
                    <p className="text-[10px] text-slate-500 mb-1.5">
                      Horizontal: row weight. Vertical: column width. Surfaces only — not Results
                      or live rollup.
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {BAR_THICKNESS_OPTIONS.map((opt) => (
                        <Chip
                          key={opt.id}
                          active={value.barThickness === opt.id}
                          title={opt.hint}
                          onClick={() => setThickness(opt.id)}
                        >
                          {opt.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                    Stage layout
                  </p>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {STAGE_LAYOUT_OPTIONS.map((opt) => (
                      <Chip
                        key={opt.id}
                        active={(value.surfaces.stageLayout || 'full') === opt.id}
                        onClick={() =>
                          patch({
                            surfaces: {
                              ...value.surfaces,
                              stageLayout: opt.id as StageLayoutId,
                            },
                          })
                        }
                      >
                        {opt.label}
                      </Chip>
                    ))}
                  </div>
                  {(value.surfaces.stageLayout || 'full') === 'split' ? (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {STAGE_SPLIT_SIZE_OPTIONS.map((opt) => (
                        <Chip
                          key={opt.id}
                          active={(value.surfaces.stageSplitSize || 'half') === opt.id}
                          onClick={() =>
                            patch({
                              surfaces: {
                                ...value.surfaces,
                                stageSplitSize: opt.id as StageSplitSizeId,
                              },
                            })
                          }
                        >
                          {opt.label}
                        </Chip>
                      ))}
                      {STAGE_SPLIT_SIDE_OPTIONS.map((opt) => (
                        <Chip
                          key={opt.id}
                          active={(value.surfaces.stageSplitSide || 'right') === opt.id}
                          onClick={() =>
                            patch({
                              surfaces: {
                                ...value.surfaces,
                                stageSplitSide: opt.id as StageSplitSideId,
                              },
                            })
                          }
                        >
                          {opt.label}
                        </Chip>
                      ))}
                    </div>
                  ) : (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                        Stage position
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {STAGE_POSITION_OPTIONS.map((opt) => (
                          <Chip
                            key={opt.id}
                            active={(value.surfaces.stagePosition || 'mid') === opt.id}
                            onClick={() =>
                              patch({
                                surfaces: {
                                  ...value.surfaces,
                                  stagePosition: opt.id as StagePositionId,
                                },
                              })
                            }
                          >
                            {opt.label}
                          </Chip>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">
                    Plate chrome
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { key: 'showBackground' as const, label: 'Background' },
                        { key: 'showBorder' as const, label: 'Border' },
                        { key: 'showTitle' as const, label: 'Title' },
                      ] as const
                    ).map((opt) => (
                      <Chip
                        key={opt.key}
                        active={value.surfaces[opt.key] !== false}
                        onClick={() =>
                          patch({
                            surfaces: {
                              ...value.surfaces,
                              [opt.key]: value.surfaces[opt.key] === false,
                            },
                          })
                        }
                      >
                        {opt.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-0.5 col-span-2">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      Motion (Stage · Lower · PiP)
                    </span>
                    <select
                      value={value.surfaces.motion}
                      onChange={(e) =>
                        patch({
                          surfaces: {
                            ...value.surfaces,
                            motion: e.target.value as WebPollDisplayStyle['surfaces']['motion'],
                          },
                        })
                      }
                      className={selectCls}
                    >
                      <option value="off">Off</option>
                      <option value="reveal">Fade — same on all surfaces</option>
                      <option value="grow">Fade + grow — same on all surfaces</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      Lower overflow
                    </span>
                    <select
                      value={value.surfaces.lowerOverflow}
                      onChange={(e) =>
                        patch({
                          surfaces: {
                            ...value.surfaces,
                            lowerOverflow: e.target
                              .value as WebPollDisplayStyle['surfaces']['lowerOverflow'],
                          },
                        })
                      }
                      className={selectCls}
                      disabled={
                        value.resultStyle !== 'bars' && value.resultStyle !== 'leaderboard'
                      }
                      title={
                        value.resultStyle === 'bars' || value.resultStyle === 'leaderboard'
                          ? 'How Lower handles many options'
                          : 'Only applies to horizontal bars / leaderboard on Lower'
                      }
                    >
                      <option value="squeeze">Squeeze all</option>
                      <option value="rotate">Cap at 4</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      PiP place
                    </span>
                    <select
                      value={value.surfaces.pipPlacement}
                      onChange={(e) =>
                        patch({
                          surfaces: {
                            ...value.surfaces,
                            pipPlacement: e.target
                              .value as WebPollDisplayStyle['surfaces']['pipPlacement'],
                          },
                        })
                      }
                      className={selectCls}
                    >
                      <option value="br">Bottom right</option>
                      <option value="bl">Bottom left</option>
                      <option value="tr">Top right</option>
                      <option value="tl">Top left</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      PiP size
                    </span>
                    <select
                      value={value.surfaces.pipScale}
                      onChange={(e) =>
                        patch({
                          surfaces: {
                            ...value.surfaces,
                            pipScale: e.target
                              .value as WebPollDisplayStyle['surfaces']['pipScale'],
                          },
                        })
                      }
                      className={selectCls}
                    >
                      <option value="s">S · 22%</option>
                      <option value="m">M · 28%</option>
                      <option value="l">L · 34%</option>
                      <option value="xl">XL · 42%</option>
                    </select>
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="order-1 lg:order-2 mb-3 lg:mb-0 lg:sticky lg:top-3 rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-2.5">
          {previewPane}
        </div>
      </div>
    </div>
  );
}
