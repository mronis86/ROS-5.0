import React, { useEffect, useState } from 'react';
import {
  clockProgressColor,
  clockRemainingPercent,
  formatClockTime,
} from './clockShowcaseHelpers';
import { DEMO_EVENT, formatDuration, type DemoScheduleRow } from './demoData';
import {
  formatNameForTwoLines,
  formatSpeakerLocation,
  getSpeakerForSlot,
  truncateText,
} from './photoShowcaseHelpers';
import { useShowcaseFollow } from './showcaseFollowMode';
import { PROGRAM_TYPE_COLORS } from './showcaseConstants';

function rowHighlight(row: DemoScheduleRow, activeCueId: number): { border: string; bg: string } {
  if (row.id === activeCueId) {
    return { border: 'border-4 border-green-400', bg: 'bg-green-950' };
  }
  return { border: 'border border-slate-600', bg: 'bg-slate-900' };
}

function PhotoRow({
  row,
  showNotes,
  activeCueId,
  isNew,
}: {
  row: DemoScheduleRow;
  showNotes: boolean;
  activeCueId: number;
  isNew?: boolean;
}) {
  const highlight = rowHighlight(row, activeCueId);
  const ptColor = PROGRAM_TYPE_COLORS[row.programType] || '#6B7280';
  const pptQA = [row.hasPPT && 'PPT', row.hasQA && 'Q&A'].filter(Boolean).join('/') || 'None';
  const isActive = row.id === activeCueId;
  const cleanNotes = row.notes?.replace(/<[^>]*>/g, '').trim() ?? '';
  const hasNotes = showNotes && cleanNotes.length > 0;

  return (
    <div
      className={`${highlight.border} transition-all duration-500 ${isNew ? 'animate-[photoRowReveal_500ms_ease-out]' : ''}`}
    >
      <div className={`grid grid-cols-11 gap-0 ${highlight.bg}`} style={{ minHeight: 200 }}>
        <div className="col-span-1 border-r border-slate-600 p-3 flex flex-col justify-center">
          <div className="text-center">
            <div className="text-lg font-bold mb-3 text-white">{row.cue}</div>
            <div
              className="inline-block px-2 py-1 rounded text-xs font-medium text-white border shadow-lg"
              style={{ backgroundColor: ptColor }}
            >
              {row.programType}
            </div>
          </div>
        </div>

        <div className="col-span-1 border-r border-slate-600 p-3 flex flex-col justify-center">
          <div className="text-center">
            <div className="mb-4">
              <div className="text-gray-400 text-xs mb-1">START TIME</div>
              <div className="text-lg font-bold text-white">{row.startTime}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">DURATION</div>
              <div className="text-base font-bold text-white">{formatDuration(row)}</div>
            </div>
          </div>
        </div>

        <div className="col-span-2 border-r border-slate-600 p-3 flex flex-col justify-center">
          <div className="space-y-3">
            <div>
              <div className="text-gray-400 text-xs mb-1">SEGMENT NAME</div>
              <div className="text-lg font-bold text-white">{row.segmentName}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">SHOT TYPE</div>
              <div className="text-sm font-bold text-white">{row.shotType}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">PPT/Q&A</div>
              <div className="text-sm font-bold text-white">{pptQA}</div>
            </div>
          </div>
        </div>

        {[1, 2, 3, 4, 5, 6, 7].map((slot) => {
          const speaker = getSpeakerForSlot(row.speakersText, slot);
          return (
            <div
              key={slot}
              className={`col-span-1 ${slot < 7 ? 'border-r border-slate-600' : ''} p-3 flex flex-col justify-center`}
            >
              {speaker ? (
                <div className="text-center h-full flex flex-col justify-center">
                  <div className="mb-3 flex justify-center">
                    <img
                      src={speaker.photoLink || '/speaker-placeholder.svg'}
                      alt={speaker.fullName}
                      className="w-24 h-32 rounded-lg object-cover border-2 border-slate-400 shadow-lg"
                      style={{ objectFit: 'cover', objectPosition: 'center top' }}
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = '/speaker-placeholder.svg';
                      }}
                    />
                  </div>
                  {(() => {
                    const nameResult = formatNameForTwoLines(speaker.fullName);
                    return (
                      <div
                        className={`font-bold text-white mb-2 leading-tight ${
                          nameResult.needsSmallText ? 'text-sm' : 'text-base'
                        }`}
                        dangerouslySetInnerHTML={{ __html: nameResult.html }}
                      />
                    );
                  })()}
                  {(speaker.title || speaker.org) && (
                    <div className="text-xs text-gray-300 mb-1 leading-tight">
                      {truncateText(
                        speaker.title && speaker.org
                          ? `${speaker.title}, ${speaker.org}`
                          : speaker.title || speaker.org || '',
                        20
                      )}
                    </div>
                  )}
                  <div className="text-xs text-gray-300 font-medium bg-slate-700 px-2 py-1 rounded inline-block mx-auto">
                    {formatSpeakerLocation(speaker.location)}
                  </div>
                </div>
              ) : (
                <div className="text-center text-xs text-gray-500 h-full flex items-center justify-center">
                  <div className="text-gray-600">Empty</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasNotes && (
        <div className={`border-t border-slate-600 p-4 ${isActive ? 'bg-green-950' : 'bg-slate-800'}`}>
          <div className="text-gray-400 text-sm mb-2 font-bold">NOTES:</div>
          <div className="text-sm text-white break-words leading-relaxed" style={{ whiteSpace: 'pre-line' }}>
            {cleanNotes}
          </div>
        </div>
      )}
    </div>
  );
}

export const PhotoViewShowcaseContent: React.FC = () => {
  const { activeCueId, activeRow, mainRemaining, activeDurationSec, photoPreviewRows, showSubCueHeader, subCueRemaining, subCueLabel } =
    useShowcaseFollow();
  const [now, setNow] = useState(new Date());
  const [syncCountdown, setSyncCountdown] = useState(18);
  const [prevRowIds, setPrevRowIds] = useState<number[]>(() => photoPreviewRows.map((r) => r.id));

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSyncCountdown((s) => (s <= 1 ? 20 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const currentIds = photoPreviewRows.map((r) => r.id);
    const t = window.setTimeout(() => setPrevRowIds(currentIds), 600);
    return () => window.clearTimeout(t);
  }, [photoPreviewRows]);

  const timerColor = clockProgressColor(mainRemaining);
  const progressPct = clockRemainingPercent(mainRemaining, activeDurationSec);
  const newRowIds = new Set(photoPreviewRows.map((r) => r.id).filter((id) => !prevRowIds.includes(id)));

  return (
    <div className="min-h-full bg-slate-900 text-white p-4">
      <style>{`
        @keyframes photoRowReveal {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="mb-4">
        <div className="flex justify-between items-start mb-4 gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{DEMO_EVENT.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-1.5">
              <span className="text-sm text-gray-300">
                {now.toLocaleTimeString('en-US', { hour12: true })}
              </span>
              <span className="text-xs text-slate-400">Sync in: {syncCountdown}s</span>
              <span className="px-2 py-1 text-xs rounded border bg-emerald-700 border-emerald-500 text-white">
                🎯 Follow
              </span>
              <span className="px-2 py-1 text-xs rounded border bg-blue-600 border-blue-500 text-white">
                Hide Notes
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-6 flex-shrink-0">
            <div className="text-center">
              <div className="flex flex-col items-center gap-0.5">
                <div className="text-lg font-bold text-green-400 whitespace-nowrap">
                  RUNNING - {activeRow.cue}
                </div>
                {showSubCueHeader && subCueRemaining !== null && (
                  <div className="flex flex-col items-center mt-0.5 gap-0.5">
                    <div className="text-lg font-bold text-orange-400 whitespace-nowrap">
                      {subCueLabel} -
                    </div>
                    <div className="text-lg font-bold text-orange-400 tabular-nums">
                      {formatClockTime(subCueRemaining)}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div
              className="text-3xl font-mono bg-slate-800 px-6 py-3 rounded-lg border border-slate-600 whitespace-nowrap"
              style={{ color: timerColor }}
            >
              {formatClockTime(mainRemaining)}
            </div>
          </div>
        </div>

        <div className="w-full bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative h-2">
          <div
            className="h-full transition-all duration-1000 absolute top-0 right-0"
            style={{ width: `${progressPct}%`, background: timerColor }}
          />
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        <div className="bg-slate-700 border border-slate-600">
          <div className="grid grid-cols-11 gap-0">
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-2 text-center font-bold text-xs">
              CUE
            </div>
            <div className="col-span-1 bg-slate-600 border-r border-slate-600 p-2 text-center font-bold text-xs">
              TIME
            </div>
            <div className="col-span-2 bg-slate-600 border-r border-slate-600 p-2 text-center font-bold text-xs">
              SEGMENT INFO
            </div>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <div
                key={n}
                className={`col-span-1 bg-slate-600 p-2 text-center font-bold text-xs ${
                  n < 7 ? 'border-r border-slate-600' : ''
                }`}
              >
                SLOT {n}
              </div>
            ))}
          </div>
        </div>

        {photoPreviewRows.map((row, index) => (
          <React.Fragment key={row.id}>
            <PhotoRow
              row={row}
              showNotes
              activeCueId={activeCueId}
              isNew={newRowIds.has(row.id)}
            />
            {index < photoPreviewRows.length - 1 && <div className="border-t-2 border-slate-500" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
