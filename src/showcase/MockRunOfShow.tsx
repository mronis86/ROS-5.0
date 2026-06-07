import React, { useEffect, useState } from 'react';
import {
  clockProgressColor,
  clockRemainingPercent,
  formatClockTime,
} from './clockShowcaseHelpers';
import {
  DEMO_EVENT,
  DEMO_SCHEDULE,
  formatDuration,
  type DemoScheduleRow,
} from './demoData';
import { parseSpeakers, truncateText } from './photoShowcaseHelpers';
import { PROGRAM_TYPE_COLORS } from './showcaseConstants';
import {
  getShowcaseRowTimerState,
  getShowcaseScheduleTrt,
  SHOWCASE_FULL_CUE_COUNT,
  useShowcaseFollow,
} from './showcaseFollowMode';

const COL = {
  start: 108,
  programType: 188,
  duration: 188,
  segmentName: 252,
  shotType: 128,
  pptQA: 108,
  notes: 200,
  speakers: 168,
  timerCol: 108,
} as const;

const ROW_H = '5.75rem';
const COMPLETED_ROW_CLASS =
  'bg-purple-950/90 ring-2 ring-inset ring-purple-400/45';

function formatSpeakersCell(speakersText?: string): string {
  const speakers = parseSpeakers(speakersText);
  if (speakers.length === 0) return '—';
  if (speakers.length === 1) return truncateText(speakers[0].fullName, 22);
  return `${truncateText(speakers[0].fullName, 16)} +${speakers.length - 1}`;
}

function getMainRowClass(row: DemoScheduleRow, index: number, timerState: ReturnType<typeof getShowcaseRowTimerState>) {
  if (timerState === 'running') return 'bg-green-950';
  if (timerState === 'completed') return COMPLETED_ROW_CLASS;
  return index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
}

function getMainRowStyle(row: DemoScheduleRow, timerState: ReturnType<typeof getShowcaseRowTimerState>): React.CSSProperties {
  if (timerState === 'completed') {
    return { opacity: 0.68, filter: 'brightness(0.59) saturate(0.33)' };
  }
  if (row.programType === 'KILLED') return { opacity: 0.7 };
  return { opacity: 1 };
}

function ScheduleRow({
  row,
  index,
  rowNumber,
  mainRemaining,
  isNew,
}: {
  row: DemoScheduleRow;
  index: number;
  rowNumber: number;
  mainRemaining: number;
  isNew?: boolean;
}) {
  const timerState = getShowcaseRowTimerState(row.id);
  const isRunning = timerState === 'running';
  const isCompleted = timerState === 'completed';
  const mainClass = getMainRowClass(row, index, timerState);
  const mainStyle = getMainRowStyle(row, timerState);
  const sideClass = isCompleted ? COMPLETED_ROW_CLASS : index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
  const ptColor = PROGRAM_TYPE_COLORS[row.programType] || '#6B7280';
  const pptQA = [row.hasPPT && 'PPT', row.hasQA && 'Q&A'].filter(Boolean).join('/') || 'None';
  const cleanNotes = row.notes?.replace(/<[^>]*>/g, '').trim() ?? '';
  const isStartCue = row.id === 1;

  return (
    <div
      className={`flex border-b-2 border-slate-600 ${isNew ? 'animate-[rosRowReveal_450ms_ease-out]' : ''}`}
      data-item-id={row.id}
      style={{ minHeight: ROW_H, ...mainStyle }}
    >
      {/* Row # */}
      <div
        className={`w-12 flex-shrink-0 border-r-2 border-slate-600 flex flex-col items-center justify-center gap-1 ${sideClass}`}
        style={{ minHeight: ROW_H }}
      >
        <span className="text-white font-bold text-lg">{rowNumber}</span>
        <span className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center text-white text-xs font-bold">
          +
        </span>
      </div>

      {/* CUE column */}
      <div
        className={`w-40 flex-shrink-0 flex flex-col items-center justify-center gap-1 px-1 ${sideClass}`}
        style={{ borderRight: '6px solid #475569', minHeight: ROW_H }}
      >
        <div className="flex items-center gap-1">
          <span className={`text-lg ${isStartCue ? 'text-yellow-400' : 'text-slate-600'}`} title="START cue">
            {isStartCue ? '★' : '☆'}
          </span>
          <div className="flex">
            <span className="px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded-l text-white text-sm font-bold">
              CUE
            </span>
            <span className="w-12 px-1 py-0.5 bg-slate-700 border border-l-0 border-slate-600 rounded-r text-center text-white text-sm font-bold">
              {row.cue.replace(/^CUE\s*/i, '')}
            </span>
          </div>
        </div>
        <div className="flex gap-0.5">
          {['↘', '↑', '↓', '×'].map((icon) => (
            <span
              key={icon}
              className="w-7 h-7 bg-slate-600 text-white flex items-center justify-center text-sm rounded font-bold"
            >
              {icon}
            </span>
          ))}
        </div>
      </div>

      {/* Main scroll columns */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className={`flex min-w-max h-full ${mainClass}`}>
          {[
            [row.startTime, COL.start],
            [null, COL.programType],
            [formatDuration(row), COL.duration],
            [row.segmentName, COL.segmentName],
            [row.shotType, COL.shotType],
            [pptQA, COL.pptQA],
            [truncateText(cleanNotes || '—', 36), COL.notes],
            [formatSpeakersCell(row.speakersText), COL.speakers],
            [isRunning ? formatClockTime(mainRemaining) : '—', COL.timerCol],
          ].map(([val, w], ci) => (
            <div
              key={ci}
              className="px-3 py-2 border-r border-slate-600 flex items-center text-sm text-slate-200 flex-shrink-0"
              style={{ width: w as number }}
            >
              {ci === 1 ? (
                <span
                  className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white truncate max-w-full"
                  style={{
                    backgroundColor: ptColor,
                    color: row.programType === 'Sub Cue' ? '#000' : '#fff',
                  }}
                >
                  {row.programType}
                </span>
              ) : (
                <span className={ci === 3 ? 'font-medium text-white truncate' : 'truncate'}>{val as string}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timer controls */}
      <div
        className={`w-32 flex-shrink-0 flex flex-col items-center justify-center gap-1 p-2 ${sideClass}`}
        style={{ borderLeft: '6px solid #475569', minHeight: ROW_H }}
      >
        <div className="text-sm font-mono text-slate-300">TIMER</div>
        <div className="flex flex-col gap-1">
          <span
            className={`px-3 py-1 rounded text-sm font-bold text-center ${
              isRunning
                ? 'bg-blue-600 text-white'
                : isCompleted
                  ? 'bg-gray-500 text-gray-300'
                  : 'bg-slate-600 text-white'
            }`}
          >
            {isRunning ? 'LOADED' : isCompleted ? 'LOADED' : 'LOAD'}
          </span>
          <span
            className={`px-3 py-1 rounded text-sm font-bold text-center ${
              isRunning
                ? 'bg-red-600 text-white'
                : isCompleted
                  ? 'bg-slate-600 text-slate-400'
                  : 'bg-slate-600 text-slate-400'
            }`}
          >
            {isRunning ? 'STOP' : 'START'}
          </span>
        </div>
      </div>
    </div>
  );
}

export const RunOfShowShowcaseContent: React.FC = () => {
  const {
    activeRow,
    mainRemaining,
    activeDurationSec,
    runOfShowRows,
    showSubCueHeader,
    subCueRemaining,
    subCueLabel,
    phase,
  } = useShowcaseFollow();
  const [now, setNow] = useState(new Date());
  const [syncCountdown, setSyncCountdown] = useState(18);
  const [prevRowIds, setPrevRowIds] = useState<number[]>(() => runOfShowRows.map((r) => r.id));

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setSyncCountdown((s) => (s <= 1 ? 20 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const currentIds = runOfShowRows.map((r) => r.id);
    const t = window.setTimeout(() => setPrevRowIds(currentIds), 500);
    return () => window.clearTimeout(t);
  }, [runOfShowRows]);

  const trt = getShowcaseScheduleTrt();
  const timerColor = clockProgressColor(mainRemaining);
  const progressPct = clockRemainingPercent(mainRemaining, activeDurationSec);
  const newRowIds = new Set(runOfShowRows.map((r) => r.id).filter((id) => !prevRowIds.includes(id)));
  const startRowNumber = DEMO_SCHEDULE.findIndex((r) => r.id === runOfShowRows[0]?.id) + 1;

  return (
    <div className="w-full h-full flex flex-col bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden">
      <style>{`
        @keyframes rosRowReveal {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Top timer header — mirrors production ROS + Photo follow header */}
      <div className="shrink-0 px-6 pt-4 pb-2 border-b border-slate-700/80">
        <div className="flex justify-between items-start gap-4 mb-2">
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{DEMO_EVENT.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <span className="text-sm text-slate-300">
                Master start: <strong className="text-white">9:00 AM</strong>
              </span>
              <span className="text-sm text-slate-400">
                {now.toLocaleTimeString('en-US', { hour12: true })}
              </span>
              <span className="text-xs text-slate-400">Next sync in {syncCountdown}s</span>
            </div>
          </div>

          <div className="flex items-center gap-5 flex-shrink-0">
            <div className="text-center">
              <div className="flex flex-col items-center gap-0.5">
                <div className="text-lg font-bold text-green-400 whitespace-nowrap">
                  RUNNING - {activeRow.cue}
                </div>
                {showSubCueHeader && subCueRemaining !== null && phase === 'cue2' && (
                  <div className="flex flex-col items-center mt-0.5 gap-0.5">
                    <div className="text-lg font-bold text-orange-400 whitespace-nowrap">{subCueLabel} -</div>
                    <div className="text-lg font-bold text-orange-400 tabular-nums">
                      {formatClockTime(subCueRemaining)}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div
              className="text-3xl font-mono bg-slate-800 px-5 py-2.5 rounded-lg border border-slate-600 whitespace-nowrap tabular-nums"
              style={{ color: timerColor }}
            >
              {formatClockTime(mainRemaining)}
            </div>
          </div>
        </div>

        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative">
          <div
            className="h-full transition-all duration-1000 absolute top-0 right-0"
            style={{ width: `${progressPct}%`, background: timerColor }}
          />
        </div>
      </div>

      {/* Operator controls */}
      <div className="shrink-0 px-6 py-2 flex items-center justify-between gap-3 border-b border-slate-700/60 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-300">
            Role: <strong className="text-white">OPERATOR</strong>
          </span>
          <span className="px-3 py-1 bg-blue-600 rounded text-blue-100 text-xs font-medium">
            Next sync in {syncCountdown}s
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1 bg-blue-600 text-white text-xs rounded">Filter View</span>
          <span className="px-3 py-1 bg-green-600 text-white text-xs rounded">⏰ Time Toast</span>
          <span className="px-3 py-1 bg-purple-600 text-white text-xs font-medium rounded ring-4 ring-inset ring-green-400">
            🎯 Follow
          </span>
          <span className="text-slate-300 text-xs">Duration:</span>
          {['-5', '-1', '+1', '+5'].map((n) => (
            <span
              key={n}
              className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold text-white ${
                n.startsWith('-') ? 'bg-red-600' : 'bg-blue-600'
              }`}
            >
              {n}
            </span>
          ))}
          <span className="px-3 py-1 bg-purple-600 text-white text-xs rounded">Messages</span>
        </div>
      </div>

      {/* Schedule grid */}
      <div className="flex-1 min-h-0 px-6 py-3 flex flex-col">
        <div className="bg-slate-800 rounded-xl p-3 shadow-2xl flex flex-col flex-1 min-h-0">
          <div className="flex items-center gap-3 mb-3 flex-wrap shrink-0">
            <h2 className="text-xl font-bold">
              Schedule - TRT {trt.hours}h {trt.minutes}m {trt.seconds}s
              <span className="text-slate-400 text-base font-normal ml-2">· {SHOWCASE_FULL_CUE_COUNT} cues</span>
            </h2>
            <div className="flex rounded-lg overflow-hidden border border-slate-600">
              <span className="px-3 py-1.5 text-sm font-medium bg-slate-700 text-slate-400">Rehearsal</span>
              <span className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white">In-Show</span>
            </div>
            <span className="text-xs bg-purple-600 text-white px-2 py-1 rounded font-medium">📝 Change Log (12)</span>
          </div>

          <div className="flex flex-col flex-1 min-h-0 border-2 border-slate-600 rounded-lg overflow-hidden bg-slate-900">
            {/* Header row */}
            <div className="flex shrink-0">
              <div className="w-12 flex-shrink-0 bg-slate-900 border-r-2 border-slate-600">
                <div className="h-24 bg-slate-700 border-b-2 border-slate-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">#</span>
                </div>
              </div>
              <div
                className="w-40 flex-shrink-0 bg-slate-900"
                style={{ borderRight: '6px solid #475569' }}
              >
                <div className="h-24 bg-slate-700 border-b-2 border-slate-600 flex items-center justify-center">
                  <span className="text-white font-bold text-lg">CUE</span>
                </div>
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="h-24 bg-slate-700 border-b-2 border-slate-600 flex min-w-max">
                  {[
                    ['Start', COL.start],
                    ['Program Type', COL.programType],
                    ['Duration', COL.duration, 'HH MM SS'],
                    ['Segment Name', COL.segmentName],
                    ['Shot Type', COL.shotType],
                    ['PPT/Q&A', COL.pptQA],
                    ['Notes', COL.notes],
                    ['Speakers', COL.speakers],
                    ['Timer', COL.timerCol],
                  ].map(([label, w, sub]) => (
                    <div
                      key={label as string}
                      className="px-3 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                      style={{ width: w as number }}
                    >
                      <div className="text-center">
                        <span className="text-white font-bold text-sm block">{label as string}</span>
                        {sub && <span className="text-xs text-slate-400">{sub as string}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div
                className="w-32 flex-shrink-0 bg-slate-900"
                style={{ borderLeft: '6px solid #475569' }}
              >
                <div className="h-24 bg-slate-700 border-b-2 border-slate-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">Timer 🔒</span>
                </div>
              </div>
            </div>

            {/* Data rows — follow scroll */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {runOfShowRows.map((row, i) => (
                <ScheduleRow
                  key={row.id}
                  row={row}
                  index={i}
                  rowNumber={startRowNumber + i}
                  mainRemaining={mainRemaining}
                  isNew={newRowIds.has(row.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
