import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_EVENT, type DemoScheduleRow } from './demoData';
import { ShowcaseFakeCursor, showcaseTargetPoint, waitMs } from './ShowcaseFakeCursor';
import { useShowcaseViewport } from './ShowcaseViewportContext';
import { getShowcaseFollowState, useShowcaseFollow } from './showcaseFollowMode';

const OPERATOR_NAME = 'Sarah — Graphics';

const PERSONAL_NOTE_BY_CUE: Record<number, string> = {
  1: 'Confirm house lights at 50% before Alex walks on',
  2: 'Slide deck on V1 — watch lower third timing on intro',
};

function cueNumber(row: DemoScheduleRow): string {
  return row.cue.replace(/^CUE\s*/i, '') || '—';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function PinNotesCell({
  row,
  rowIndex,
  isMyNotes,
  personalValue,
  textareaRef,
  enlarged,
}: {
  row: DemoScheduleRow;
  rowIndex: number;
  isMyNotes: boolean;
  personalValue: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  enlarged: boolean;
}) {
  const isCurrent = rowIndex === 0;
  const label = isCurrent ? 'Current' : `Next ${rowIndex}`;

  return (
    <div
      className={`flex flex-col min-w-0 border-b border-r border-slate-600 ${
        enlarged ? 'p-3 min-h-[7.5rem]' : 'h-full min-h-0 p-2 overflow-hidden'
      } ${isCurrent ? 'bg-slate-800/90 ring-inset ring-2 ring-amber-500' : 'bg-slate-800/50'}`}
    >
      <div className={`flex flex-row items-stretch gap-0 flex-shrink-0 ${enlarged ? 'mb-3' : 'mb-1.5'}`}>
        <span
          className={`font-bold uppercase rounded-l flex-shrink-0 flex items-center ${
            enlarged ? 'text-xs px-2 py-1.5' : 'text-[10px] px-1.5 py-1'
          } ${isCurrent ? 'bg-amber-600 text-white' : 'bg-slate-600 text-slate-300'}`}
        >
          {label}
        </span>
        <h3
          className={`flex-1 min-w-0 font-semibold text-white leading-tight truncate rounded-r flex items-center ${
            enlarged ? 'text-base pl-3 py-1.5' : 'text-xs pl-2 py-1'
          } ${
            isCurrent
              ? 'border-l-2 border-amber-500 bg-amber-950/40'
              : 'border-l-2 border-slate-500 bg-slate-700/50'
          }`}
          title={row.segmentName}
        >
          {row.segmentName}
        </h3>
      </div>
      {isMyNotes ? (
        <textarea
          ref={textareaRef}
          readOnly
          value={personalValue}
          placeholder="Your private notes for this cue…"
          className={`w-full resize-none bg-slate-900/80 border border-emerald-700/50 rounded-md text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 ${
            enlarged
              ? 'flex-1 min-h-[5rem] p-2 text-sm leading-relaxed'
              : 'flex-1 min-h-0 p-1.5 text-[11px] leading-snug'
          }`}
        />
      ) : (
        <div
          className={`text-left text-slate-200 flex-1 min-h-0 ${
            enlarged
              ? 'text-sm leading-relaxed whitespace-pre-wrap break-words overflow-auto'
              : 'text-[11px] leading-snug overflow-hidden line-clamp-3'
          }`}
        >
          {row.notes ? stripHtml(row.notes) : <span className="text-slate-500">—</span>}
        </div>
      )}
    </div>
  );
}

export const PinNotesShowcaseContent: React.FC = () => {
  const viewportMode = useShowcaseViewport();
  const enlarged = viewportMode === 'enlarge';
  const { greenRoomRows } = useShowcaseFollow();
  const rootRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [personalNotes, setPersonalNotes] = useState<Record<number, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [cursor, setCursor] = useState({ x: 640, y: 320, visible: false, clicking: false });
  const demoRunningRef = useRef(false);

  const moveTo = useCallback(async (el: HTMLElement | null, click = false) => {
    if (!el) return;
    const pt = showcaseTargetPoint(el, rootRef.current, { anchor: click ? 'center' : 'tap' });
    setCursor((c) => ({ ...c, x: pt.x, y: pt.y, visible: true, clicking: false }));
    await waitMs(380);
    if (click) {
      setCursor((c) => ({ ...c, clicking: true }));
      await waitMs(160);
      setCursor((c) => ({ ...c, clicking: false }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const reset = () => {
      setPersonalNotes({});
      setSaveStatus('idle');
      setCursor((c) => ({ ...c, visible: false }));
    };

    const typeNote = async (cueId: number) => {
      const text = PERSONAL_NOTE_BY_CUE[cueId] ?? 'Private cue note for the operator';
      setSaveStatus('idle');
      await moveTo(noteRef.current);
      await waitMs(250);
      for (let i = 1; i <= text.length; i++) {
        if (cancelled) return;
        setPersonalNotes({ [cueId]: text.slice(0, i) });
        await waitMs(28);
      }
      setSaveStatus('saving');
      await waitMs(700);
      if (cancelled) return;
      setSaveStatus('saved');
    };

    const run = async () => {
      if (demoRunningRef.current) return;
      demoRunningRef.current = true;
      reset();
      await waitMs(1000);
      if (cancelled) return;

      setCursor((c) => ({ ...c, visible: true }));
      const { activeCueId } = getShowcaseFollowState();
      await typeNote(activeCueId);
      await waitMs(4500);
      if (cancelled) return;

      reset();
      demoRunningRef.current = false;
      await waitMs(900);
      if (!cancelled) run();
    };

    run();
    return () => {
      cancelled = true;
      demoRunningRef.current = false;
    };
  }, [moveTo]);

  const currentRow = greenRoomRows[0];
  const currentPersonal = currentRow ? personalNotes[currentRow.id] ?? '' : '';

  return (
    <div
      ref={rootRef}
      className={`relative w-full bg-slate-900 text-slate-100 ${enlarged ? 'min-h-full' : 'h-full overflow-hidden'}`}
    >
      <ShowcaseFakeCursor
        x={cursor.x}
        y={cursor.y}
        visible={cursor.visible}
        clicking={cursor.clicking}
        moveMs={380}
      />

      <div
        className={`w-full flex flex-col box-border min-h-0 ${enlarged ? 'p-5 min-h-full' : 'h-full p-3'}`}
      >
        <header
          className={`flex flex-wrap items-center justify-between gap-2 border-b border-slate-600 shrink-0 ${
            enlarged ? 'mb-4 pb-3' : 'mb-2 pb-2'
          }`}
        >
          <div className="min-w-0">
            <h1 className={`font-bold text-white leading-tight ${enlarged ? 'text-2xl' : 'text-lg'}`}>
              Notes popout
            </h1>
            <p className={`text-emerald-300 mt-0.5 ${enlarged ? 'text-sm' : 'text-[10px]'}`}>
              My notes as <span className="font-medium">{OPERATOR_NAME}</span> — saved to the cloud for this event
            </p>
            <p className={`text-slate-500 mt-0.5 truncate ${enlarged ? 'text-xs' : 'text-[10px]'}`}>
              {DEMO_EVENT.name}
            </p>
          </div>
          <div className={`flex items-center flex-wrap ${enlarged ? 'gap-2 text-sm' : 'gap-1.5 text-[10px]'}`}>
            {saveStatus === 'saving' && <span className="text-amber-300">Saving…</span>}
            {saveStatus === 'saved' && <span className="text-emerald-400">Saved</span>}
            <span className={`bg-slate-700 text-slate-200 rounded ${enlarged ? 'px-3 py-1.5' : 'px-1.5 py-0.5'}`}>
              Hide my notes
            </span>
            <span className={`bg-slate-600 text-white rounded ${enlarged ? 'px-3 py-1.5' : 'px-1.5 py-0.5'}`}>
              Change columns
            </span>
            <span className="text-slate-400">Zoom: 100%</span>
          </div>
        </header>

        <div
          className={`rounded-xl border-2 border-slate-600 bg-slate-800 flex flex-col ${
            enlarged ? 'flex-1 min-h-0 overflow-auto' : 'flex-1 min-h-0 overflow-hidden'
          }`}
        >
          <div
            className={`grid w-full ${enlarged ? 'min-h-0' : 'min-h-0 flex-1 h-full'}`}
            style={{
              gridTemplateColumns: enlarged ? 'minmax(5rem, max-content) 1fr 1fr' : 'minmax(3.5rem, max-content) 1fr 1fr',
              gridTemplateRows: enlarged
                ? `auto repeat(${greenRoomRows.length}, minmax(7.5rem, auto))`
                : `auto repeat(${greenRoomRows.length}, minmax(0, 1fr))`,
            }}
          >
            {[
              { name: 'Cue', badge: null },
              { name: 'Notes', badge: 'Shared' },
              { name: 'My notes', badge: 'Yours' },
            ].map((col) => (
              <div
                key={col.name}
                className={`bg-slate-700 border-b border-r border-slate-600 flex items-center min-w-0 sticky top-0 z-10 ${
                  enlarged ? 'px-3 py-2.5 gap-2' : 'px-2 py-1.5 gap-1.5'
                }`}
              >
                <h2 className={`font-bold text-white truncate ${enlarged ? 'text-base' : 'text-xs'}`}>
                  {col.name}
                </h2>
                {col.badge && (
                  <span
                    className={`uppercase tracking-wide rounded flex-shrink-0 ${
                      enlarged ? 'text-xs px-2 py-0.5' : 'text-[10px] px-1.5 py-0.5'
                    } ${
                      col.badge === 'Yours'
                        ? 'bg-emerald-800 text-emerald-200'
                        : 'bg-slate-600 text-slate-300'
                    }`}
                  >
                    {col.badge}
                  </span>
                )}
              </div>
            ))}

            {greenRoomRows.map((row, rowIndex) => (
              <React.Fragment key={row.id}>
                <div
                  className={`flex items-center border-b border-r border-slate-600 ${
                    enlarged ? 'px-3 py-3 min-h-[7.5rem]' : 'min-h-0 h-full px-2 py-1'
                  } ${
                    rowIndex === 0
                      ? 'bg-slate-800/90 ring-inset ring-2 ring-amber-500'
                      : 'bg-slate-800/50'
                  }`}
                >
                  <span
                    className={`font-semibold tabular-nums ${
                      enlarged ? 'text-base' : 'text-xs'
                    } ${rowIndex === 0 ? 'text-amber-200' : 'text-slate-300'}`}
                  >
                    CUE {cueNumber(row)}
                  </span>
                </div>
                <PinNotesCell
                  row={row}
                  rowIndex={rowIndex}
                  isMyNotes={false}
                  personalValue=""
                  enlarged={enlarged}
                />
                <PinNotesCell
                  row={row}
                  rowIndex={rowIndex}
                  isMyNotes
                  personalValue={rowIndex === 0 ? currentPersonal : personalNotes[row.id] ?? ''}
                  textareaRef={rowIndex === 0 ? noteRef : undefined}
                  enlarged={enlarged}
                />
              </React.Fragment>
            ))}
          </div>
        </div>

        <p
          className={`text-slate-500 shrink-0 leading-tight ${enlarged ? 'text-xs mt-3' : 'text-[9px] mt-1'}`}
        >
          {greenRoomRows.length} cues in follow list · same window as Green Room · synced to follow timeline
        </p>
      </div>
    </div>
  );
};
