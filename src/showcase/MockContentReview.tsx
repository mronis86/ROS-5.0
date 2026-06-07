import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_EVENT, DEMO_SCHEDULE, formatDuration, type DemoScheduleRow } from './demoData';
import { getSpeakerForSlot, truncateText } from './photoShowcaseHelpers';
import { PROGRAM_TYPE_COLORS } from './showcaseConstants';
import {
  ShowcaseFakeCursor,
  showcaseTargetPoint,
  waitForElement,
  waitForLayout,
  waitMs,
} from './ShowcaseFakeCursor';
import {
  applyShowcaseCueApproval,
  applyShowcaseCueNeedsReview,
  CONTENT_REVIEW_CUE_DETAILS,
  CONTENT_REVIEW_TOUR_CYCLE_SEC,
  CONTENT_REVIEW_TOUR_STEPS,
  FOLLOW_NEEDS_REVIEW_NOTES,
  getShowcaseContentReviewStepAction,
  getShowcaseCueReviews,
  INITIAL_SHOWCASE_CUE_REVIEWS,
  parseShowcaseAssetRows,
  resetShowcaseContentReviewTour,
  type ContentReviewReviewStatus,
  type ShowcaseCueReviewState,
  useShowcaseContentReviewSync,
} from './showcaseContentReviewSync';

export type ContentReviewShowcaseMode = 'drive' | 'follow';

const RAIL_CUES = DEMO_SCHEDULE.slice(0, 8);

function reviewStatusMeta(status: ContentReviewReviewStatus) {
  switch (status) {
    case 'approved':
      return {
        label: 'Approved',
        railClass: 'bg-emerald-500/90 text-emerald-950 border-emerald-300 shadow-sm shadow-emerald-900/50',
        cueRailIdleClass:
          'border-emerald-400/90 bg-emerald-950/90 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)] hover:bg-emerald-900/95',
        cueRailActiveClass:
          'border-cyan-300 bg-emerald-900 ring-2 ring-emerald-300/70 shadow-[0_0_12px_rgba(52,211,153,0.35)]',
        cueLabelClass: 'text-emerald-50',
      };
    case 'needs_update':
      return {
        label: 'Needs update',
        railClass: 'bg-amber-500/90 text-amber-950 border-amber-200 shadow-sm shadow-amber-900/50',
        cueRailIdleClass:
          'border-amber-400/90 bg-amber-950/90 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)] hover:bg-amber-900/95',
        cueRailActiveClass:
          'border-cyan-300 bg-amber-950 ring-2 ring-amber-300/70 shadow-[0_0_12px_rgba(251,191,36,0.35)]',
        cueLabelClass: 'text-amber-50',
      };
    default:
      return {
        label: 'Pending',
        railClass: 'bg-slate-700/80 text-slate-300 border-slate-500/70',
        cueRailIdleClass: 'border-transparent bg-transparent hover:bg-slate-900',
        cueRailActiveClass: 'border-cyan-500/80 bg-slate-800 ring-1 ring-cyan-500/40',
        cueLabelClass: 'text-white',
      };
  }
}

function cueRailMeta(review: ShowcaseCueReviewState) {
  if (review.creative === 'approved' && review.ros === 'approved') {
    return reviewStatusMeta('approved');
  }
  return reviewStatusMeta(review.ros);
}

function cueLabel(row: DemoScheduleRow): string {
  const raw = row.cue.replace(/^CUE\s*/i, '').trim();
  return raw ? `CUE ${raw}` : row.cue;
}

function formatDurationShort(row: DemoScheduleRow): string {
  const parts: string[] = [];
  if (row.durationHours) parts.push(`${row.durationHours}h`);
  if (row.durationMinutes) parts.push(`${row.durationMinutes}m`);
  if (row.durationSeconds) parts.push(`${row.durationSeconds}s`);
  return parts.join(' ') || '0s';
}

function pptQaString(row: DemoScheduleRow): string {
  const parts: string[] = [];
  if (row.hasPPT) parts.push('PPT');
  if (row.hasQA) parts.push('Q&A');
  return parts.length ? parts.join(' / ') : 'None';
}

function ReviewStageSwitcher({ activeRos }: { activeRos: boolean }) {
  return (
    <div
      className="flex rounded-lg border border-slate-600 bg-slate-800/50 p-0.5"
      role="group"
      aria-label="Review stage"
    >
      <span
        className={`rounded-md px-2 py-1 text-[10px] font-semibold leading-tight md:text-xs ${
          activeRos ? 'text-slate-400' : 'bg-violet-600 text-white shadow-sm'
        }`}
      >
        Creative Content
      </span>
      <span
        className={`rounded-md px-2 py-1 text-[10px] font-semibold leading-tight md:text-xs ${
          activeRos ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-400'
        }`}
      >
        ROS Show
      </span>
    </div>
  );
}

function SpeakerSlotsRow({ speakersText }: { speakersText?: string }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[36rem] grid-cols-7 divide-x divide-slate-600">
        {[1, 2, 3, 4, 5, 6, 7].map((slot) => {
          const sp = getSpeakerForSlot(speakersText, slot);
          return (
            <div key={slot} className="flex min-w-0 flex-col p-2 text-center">
              <div className="text-[9px] font-bold uppercase text-slate-500">Slot {slot}</div>
              {sp ? (
                <>
                  <div className="mt-1 flex justify-center">
                    <img
                      src={sp.photoLink || '/speaker-placeholder.svg'}
                      alt=""
                      className="h-10 w-8 rounded border border-slate-500 object-cover object-top"
                    />
                  </div>
                  <div className="mt-1 text-[9px] font-semibold leading-tight text-white line-clamp-2">
                    {truncateText(sp.fullName, 20)}
                  </div>
                </>
              ) : (
                <div className="mt-3 text-[9px] text-slate-600">—</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AssetsBlock({ cueId }: { cueId: number }) {
  const details = CONTENT_REVIEW_CUE_DETAILS[cueId];
  const rows = parseShowcaseAssetRows(details?.assetsRaw ?? '');

  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-slate-600 bg-slate-800">
      <div className="border-b border-slate-600 bg-slate-700 px-3 py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-200">Assets</span>
      </div>
      <div className="p-2.5">
        {rows.length ? (
          <ul className="space-y-1.5">
            {rows.map((a) => (
              <li key={`${a.name}-${a.link}`} className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[10px] font-semibold text-slate-200">{a.name}</span>
                {a.linkEnabled ? (
                  <span className="truncate font-mono text-[9px] text-cyan-300">{a.link}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[10px] text-slate-500">None</span>
        )}
      </div>
    </div>
  );
}

function RosCueDetail({
  row,
  editMode,
  segmentDraft,
  segmentSaved,
  segmentInputRef,
  segmentSaveRef,
}: {
  row: DemoScheduleRow;
  editMode?: boolean;
  segmentDraft?: string;
  segmentSaved?: boolean;
  segmentInputRef?: React.RefObject<HTMLInputElement | null>;
  segmentSaveRef?: React.RefObject<HTMLSpanElement | null>;
}) {
  const details = CONTENT_REVIEW_CUE_DETAILS[row.id];
  const notesHtml = details?.notesHtml ?? row.notes;
  const segmentDisplay = segmentDraft ?? row.segmentName;

  return (
    <div className="flex flex-col gap-2 overflow-hidden">
      <div
        className="shrink-0 overflow-hidden rounded-lg border border-slate-600 bg-slate-800 shadow-lg"
        style={{ opacity: row.programType === 'KILLED' ? 0.85 : 1 }}
      >
        <div className="grid grid-cols-12 border-b border-slate-600 bg-slate-800/90">
          <div className="col-span-2 border-r border-slate-600 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cue</span>
            <div className="mt-0.5 truncate text-sm font-bold text-white">{cueLabel(row)}</div>
            <span
              className="mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: PROGRAM_TYPE_COLORS[row.programType] || '#475569' }}
            >
              {row.programType}
            </span>
          </div>
          <div className="col-span-2 border-r border-slate-600 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
            <div className="mt-0.5 text-sm font-bold text-white">Day {row.day}</div>
            {row.id === 1 ? <div className="mt-1 text-[10px] font-bold text-amber-400">START</div> : null}
          </div>
          <div className="col-span-2 border-r border-slate-600 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Duration</span>
            <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-white">{formatDuration(row)}</div>
            <div className="mt-1 text-[10px] text-slate-400">{formatDurationShort(row)}</div>
          </div>
          <div className="col-span-6 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Segment</span>
            {editMode ? (
              <div className="mt-1 space-y-1">
                <input
                  ref={segmentInputRef}
                  type="text"
                  readOnly
                  value={segmentDisplay}
                  className="w-full rounded border border-violet-400 bg-slate-900 px-2 py-1 text-sm font-semibold text-white ring-2 ring-violet-400/40 outline-none"
                />
                <div className="flex flex-wrap items-center gap-1">
                  <span
                    ref={segmentSaveRef}
                    className="rounded bg-violet-600 px-2 py-0.5 text-[9px] font-semibold text-white"
                  >
                    Save
                  </span>
                  <span className="rounded border border-slate-500 px-2 py-0.5 text-[9px] font-semibold text-slate-200">
                    Cancel
                  </span>
                  {segmentSaved ? <span className="text-[9px] font-semibold text-emerald-300">Saved</span> : null}
                </div>
              </div>
            ) : (
              <div className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-white">{segmentDisplay}</div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2">
          <div className="border-r border-slate-600 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Shot</span>
            <div className="mt-1 text-xs font-bold text-white">{row.shotType || '—'}</div>
          </div>
          <div className="px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">PPT / Q&A</span>
            <div className="mt-1 text-xs font-bold text-white">{pptQaString(row)}</div>
          </div>
        </div>
      </div>

      <div className="shrink-0 overflow-hidden rounded-lg border border-slate-600 bg-slate-800">
        <div className="flex items-center justify-between gap-2 border-b border-slate-600 bg-slate-700 px-3 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-200">Speakers (slots 1–7)</span>
          <span className="shrink-0 rounded border border-slate-500 bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold text-slate-200">
            Show title, org & photo
          </span>
        </div>
        <SpeakerSlotsRow speakersText={row.speakersText} />
      </div>

      <div className="shrink-0 overflow-hidden rounded-lg border border-slate-600 bg-slate-800">
        <div className="border-b border-slate-600 bg-slate-700 px-3 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-200">Notes</span>
        </div>
        <div
          className="max-h-[5.5rem] overflow-hidden p-2.5 text-[10px] leading-relaxed text-slate-100 [&_p]:mb-1 [&_p:last-child]:mb-0"
          dangerouslySetInnerHTML={{
            __html: notesHtml?.trim() ? notesHtml : '<span class="text-slate-500">No notes</span>',
          }}
        />
      </div>

      <AssetsBlock cueId={row.id} />
    </div>
  );
}

type Props = { mode: ContentReviewShowcaseMode };

export const ContentReviewShowcaseContent: React.FC<Props> = ({ mode }) => {
  const { selectedCueId, cueIndex, cueReviews } = useShowcaseContentReviewSync();
  const rootRef = useRef<HTMLDivElement>(null);
  const reviewBtnRef = useRef<HTMLSpanElement>(null);
  const reviewNoteRef = useRef<HTMLTextAreaElement>(null);
  const approveBtnRef = useRef<HTMLSpanElement>(null);
  const needsReviewBtnRef = useRef<HTMLSpanElement>(null);
  const editBtnRef = useRef<HTMLSpanElement>(null);
  const segmentInputRef = useRef<HTMLInputElement>(null);
  const segmentSaveRef = useRef<HTMLSpanElement>(null);
  const cueRailRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [reviewNoteDraft, setReviewNoteDraft] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<ContentReviewReviewStatus>('pending');
  const [saveFlash, setSaveFlash] = useState(false);
  const [editModeEnabled, setEditModeEnabled] = useState(false);
  const [segmentDraft, setSegmentDraft] = useState<string | null>(null);
  const [segmentSaved, setSegmentSaved] = useState(false);
  const [cursor, setCursor] = useState({ x: 640, y: 360, visible: false, clicking: false });

  const followDemoRef = useRef(false);
  const lastFollowStepRef = useRef<string | null>(null);
  const prevCueIndexRef = useRef(cueIndex);
  const reviewPanelOpenRef = useRef(reviewPanelOpen);
  reviewPanelOpenRef.current = reviewPanelOpen;

  const displayItem = DEMO_SCHEDULE.find((r) => r.id === selectedCueId) ?? DEMO_SCHEDULE[0];
  const currentReview = cueReviews[displayItem.id] ?? INITIAL_SHOWCASE_CUE_REVIEWS[displayItem.id];
  const showReviewPanel = mode === 'follow' && reviewPanelOpen;

  useEffect(() => {
    const stored = cueReviews[displayItem.id]?.rosNote ?? '';
    setReviewNoteDraft(stored);
    setSelectedStatus(cueReviews[displayItem.id]?.ros ?? 'pending');
  }, [displayItem.id, cueReviews]);

  useEffect(() => {
    if (cueIndex === 0 && prevCueIndexRef.current === CONTENT_REVIEW_TOUR_STEPS.length - 1) {
      resetShowcaseContentReviewTour();
      lastFollowStepRef.current = null;
      if (mode === 'follow') setReviewPanelOpen(false);
    }
    prevCueIndexRef.current = cueIndex;
  }, [cueIndex, mode]);

  const moveTo = useCallback(async (el: HTMLElement | null, click = false) => {
    if (!el) return;
    const pt = showcaseTargetPoint(el, rootRef.current, { anchor: click ? 'center' : 'tap' });
    setCursor((c) => ({ ...c, x: pt.x, y: pt.y, visible: true, clicking: false }));
    await waitMs(480);
    if (click) {
      setCursor((c) => ({ ...c, clicking: true }));
      await waitMs(180);
      setCursor((c) => ({ ...c, clicking: false }));
    }
  }, []);

  const typeIntoReviewNote = useCallback(async (text: string, cancelled: () => boolean) => {
    setReviewNoteDraft('');
    for (let i = 1; i <= text.length; i++) {
      if (cancelled()) return;
      setReviewNoteDraft(text.slice(0, i));
      await waitMs(26);
    }
  }, []);

  /** Drive — click cue on tour; on CUE 4 demo Edit → segment save. */
  useEffect(() => {
    if (mode !== 'drive') return;

    let cancelled = false;

    const run = async () => {
      setEditModeEnabled(false);
      setSegmentDraft(null);
      setSegmentSaved(false);

      await waitMs(cueIndex === 0 ? 1200 : 400);
      if (cancelled) return;

      setCursor((c) => ({ ...c, visible: true }));
      const el = cueRailRefs.current.get(selectedCueId);
      await moveTo(el, true);
      if (cancelled) return;

      if (selectedCueId !== 4) return;

      await waitMs(900);
      if (cancelled) return;

      await moveTo(editBtnRef.current, true);
      if (cancelled) return;
      setEditModeEnabled(true);
      await waitForLayout();
      await waitMs(400);

      const baseSegment = displayItem.segmentName;
      setSegmentDraft(baseSegment);
      const input = await waitForElement(() => segmentInputRef.current, 1500);
      if (cancelled || !input) return;

      await moveTo(input);
      const suffix = ' (F&B hold confirmed)';
      for (let i = 1; i <= suffix.length; i++) {
        if (cancelled) return;
        setSegmentDraft(baseSegment + suffix.slice(0, i));
        await waitMs(32);
      }

      await waitMs(500);
      const saveEl = await waitForElement(() => segmentSaveRef.current, 1000);
      if (saveEl) await moveTo(saveEl, true);
      if (cancelled) return;
      setSegmentSaved(true);
      await waitMs(1800);
      setEditModeEnabled(false);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedCueId, cueIndex, moveTo, displayItem.segmentName]);

  /** Follow — open Review, type notes, approve (synced to same cue tour as Drive). */
  useEffect(() => {
    if (mode !== 'follow') return;

    const stepKey = `${cueIndex}:${selectedCueId}`;
    if (lastFollowStepRef.current === stepKey) return;

    let cancelled = false;

    const openReviewPanel = async () => {
      if (reviewPanelOpenRef.current) return;
      await moveTo(reviewBtnRef.current, true);
      if (cancelled) return;
      setReviewPanelOpen(true);
      reviewPanelOpenRef.current = true;
      await waitForLayout();
      await waitMs(400);
    };

    const runFollowStep = async () => {
      if (followDemoRef.current) return;
      followDemoRef.current = true;
      lastFollowStepRef.current = stepKey;

      const review = getShowcaseCueReviews()[selectedCueId] ?? INITIAL_SHOWCASE_CUE_REVIEWS[selectedCueId];
      const stepAction = getShowcaseContentReviewStepAction(selectedCueId);

      setReviewPanelOpen(false);
      reviewPanelOpenRef.current = false;
      setReviewNoteDraft('');
      await waitMs(700);
      if (cancelled) {
        followDemoRef.current = false;
        return;
      }

      setCursor((c) => ({ ...c, visible: true }));
      await openReviewPanel();
      if (cancelled) {
        followDemoRef.current = false;
        return;
      }

      const textarea = await waitForElement(() => reviewNoteRef.current, 2500);
      if (cancelled || !textarea) {
        followDemoRef.current = false;
        return;
      }

      if (!stepAction || review.ros === 'approved') {
        setReviewNoteDraft(review.rosNote);
        setSelectedStatus(review.ros);
        await waitMs(1200);
        followDemoRef.current = false;
        return;
      }

      if (stepAction === 'approve') {
        setSelectedStatus('pending');
        setReviewNoteDraft('');
        await waitMs(400);
        const approveEl = await waitForElement(() => approveBtnRef.current, 1500);
        if (approveEl) await moveTo(approveEl, true);
        if (cancelled) return;

        applyShowcaseCueApproval(selectedCueId, '');
        setSelectedStatus('approved');
        setSaveFlash(true);
        window.setTimeout(() => setSaveFlash(false), 1400);
        await waitMs(2400);
        followDemoRef.current = false;
        return;
      }

      if (stepAction === 'needs_review') {
        const noteText =
          FOLLOW_NEEDS_REVIEW_NOTES[selectedCueId] ??
          'Flag for producer — ROS fields need another pass before approval.';
        setSelectedStatus('pending');
        await moveTo(textarea);
        await waitMs(300);
        await typeIntoReviewNote(noteText, () => cancelled);
        if (cancelled) return;

        await waitMs(600);
        const needsBtn = await waitForElement(() => needsReviewBtnRef.current, 1500);
        if (needsBtn) await moveTo(needsBtn, true);
        if (cancelled) return;

        applyShowcaseCueNeedsReview(selectedCueId, noteText);
        setSelectedStatus('needs_update');
        setSaveFlash(true);
        window.setTimeout(() => setSaveFlash(false), 1400);
        await waitMs(2000);
        followDemoRef.current = false;
        return;
      }

      followDemoRef.current = false;
    };

    runFollowStep();
    return () => {
      cancelled = true;
      followDemoRef.current = false;
    };
  }, [mode, selectedCueId, cueIndex, moveTo, typeIntoReviewNote]);

  useEffect(() => {
    if (mode !== 'follow') return;
    const id = window.setInterval(() => {
      lastFollowStepRef.current = null;
      setReviewPanelOpen(false);
      reviewPanelOpenRef.current = false;
    }, CONTENT_REVIEW_TOUR_CYCLE_SEC * 1000);
    return () => window.clearInterval(id);
  }, [mode]);

  return (
    <div ref={rootRef} className="relative flex h-full flex-col overflow-hidden bg-slate-900 text-white">
      <ShowcaseFakeCursor
        x={cursor.x}
        y={cursor.y}
        visible={cursor.visible}
        clicking={cursor.clicking}
        moveMs={480}
      />

      <header className="shrink-0 border-b border-slate-700 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-3 py-2 md:px-4">
        <div className="flex flex-wrap items-center gap-2 md:gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-300">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </div>
          <div className="hidden h-7 w-px shrink-0 bg-slate-600/80 sm:block" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Content review</div>
            <h1 className="truncate text-base font-bold leading-tight text-white">{DEMO_EVENT.name}</h1>
            {mode === 'drive' ? (
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-400/90">
                Driving — others can use Follow
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 rounded-lg border border-slate-600 bg-slate-800/50 p-0.5">
            {(['Solo', 'Drive', 'Follow'] as const).map((label) => {
              const active =
                (label === 'Drive' && mode === 'drive') || (label === 'Follow' && mode === 'follow');
              return (
                <span
                  key={label}
                  className={`rounded-md px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                    active ? 'bg-slate-600 text-white shadow-sm' : 'text-slate-400'
                  }`}
                >
                  {label}
                </span>
              );
            })}
          </div>
          <ReviewStageSwitcher activeRos />
          <span
            ref={mode === 'drive' ? editBtnRef : undefined}
            className={`hidden shrink-0 items-center gap-1 rounded-lg border-2 px-2 py-1.5 text-[10px] font-semibold sm:inline-flex ${
              editModeEnabled
                ? 'border-violet-300 bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-lg'
                : 'border-violet-500/60 bg-violet-950/40 text-violet-200'
            }`}
          >
            {editModeEnabled ? 'Edit On' : 'Edit'}
          </span>
          <span
            ref={mode === 'follow' ? reviewBtnRef : undefined}
            className={`shrink-0 rounded-lg border-2 px-2 py-1.5 text-[10px] font-semibold ${
              showReviewPanel
                ? 'border-orange-300 bg-gradient-to-b from-orange-500 to-orange-600 text-white shadow-lg'
                : 'border-orange-500/60 bg-orange-950/40 text-orange-200'
            }`}
          >
            Review
          </span>
          <span className="hidden shrink-0 rounded-lg border-2 border-emerald-500/60 bg-emerald-950/40 px-2 py-1.5 text-[10px] font-semibold text-emerald-200 sm:inline">
            Stream
          </span>
          <span className="shrink-0 rounded-lg border-2 border-sky-300 bg-gradient-to-r from-blue-500 to-blue-600 px-2 py-1.5 text-[10px] font-semibold text-white shadow-md">
            Refresh
          </span>
        </div>
      </header>

      {mode === 'follow' ? (
        <div className="shrink-0 border-b border-emerald-900/40 bg-emerald-950/35 px-3 py-1.5 text-center text-[11px] text-emerald-100">
          Following live cue selection from <span className="font-semibold text-white">Alex — Producer</span>. Switch to{' '}
          <span className="font-medium">Solo</span> to use the cue list locally.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[10.5rem] shrink-0 flex-col border-r border-slate-700 bg-slate-950 md:w-[11.5rem]">
          <div className="shrink-0 border-b border-slate-800 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Cues
          </div>
          <nav className="min-h-0 flex-1 overflow-hidden py-1 pl-1 pr-0.5">
            {RAIL_CUES.map((row) => {
              const active = row.id === selectedCueId;
              const review = cueReviews[row.id] ?? INITIAL_SHOWCASE_CUE_REVIEWS[row.id];
              const reviewMeta = cueRailMeta(review);
              const rosMeta = reviewStatusMeta(review.ros);
              const bar = PROGRAM_TYPE_COLORS[row.programType] || '#6B7280';
              const bothOk = review.creative === 'approved' && review.ros === 'approved';
              const isFollow = mode === 'follow';
              const railBorder = isFollow
                ? 'border-transparent'
                : active
                  ? reviewMeta.cueRailActiveClass
                  : reviewMeta.cueRailIdleClass;
              return (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) cueRailRefs.current.set(row.id, el);
                    else cueRailRefs.current.delete(row.id);
                  }}
                  className={`mb-0.5 flex w-full rounded-md border text-left transition-all duration-500 disabled:cursor-not-allowed ${railBorder}`}
                  style={{ opacity: isFollow ? 0.55 : 1 }}
                >
                  <div className="w-1 shrink-0 self-stretch rounded-l-md" style={{ backgroundColor: bar }} />
                  <div className="min-w-0 flex-1 py-1.5 pl-1 pr-0.5">
                    <div className={`truncate text-[11px] font-bold leading-tight md:text-xs ${reviewMeta.cueLabelClass}`}>
                      {cueLabel(row)}
                    </div>
                    <div className="truncate text-[10px] text-slate-400 md:text-[11px]">{row.segmentName}</div>
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {bothOk ? (
                        <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${reviewMeta.railClass}`}>
                          Both OK
                        </span>
                      ) : (
                        <>
                          <span
                            className={`inline-flex rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide border-slate-600/80 bg-slate-800/80 text-slate-400`}
                            title="Creative Content"
                          >
                            CC:{review.creative === 'approved' ? 'OK' : review.creative === 'needs_update' ? '!' : '…'}
                          </span>
                          <span
                            className={`inline-flex rounded border px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${rosMeta.railClass}`}
                            title="ROS Show"
                          >
                            ROS:{review.ros === 'approved' ? 'OK' : review.ros === 'needs_update' ? '!' : '…'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-slate-900 p-2 md:p-3">
            <RosCueDetail
              row={displayItem}
              editMode={mode === 'drive' && editModeEnabled}
              segmentDraft={segmentDraft ?? undefined}
              segmentSaved={segmentSaved}
              segmentInputRef={segmentInputRef}
              segmentSaveRef={segmentSaveRef}
            />
          </main>

          {showReviewPanel ? (
            <section className="flex w-[11rem] shrink-0 flex-col border-l-4 border-orange-500 bg-slate-950 md:w-[12.5rem]">
              <div className="shrink-0 border-b border-orange-600/45 px-2 py-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-orange-100">
                    Cue review
                  </span>
                  <div className="flex items-center gap-1">
                    {saveFlash ? <span className="text-[9px] font-semibold text-emerald-400">Saved</span> : null}
                    <span className="rounded border border-orange-400/60 px-1.5 py-0.5 text-[9px] font-medium text-orange-50">
                      Hide
                    </span>
                  </div>
                </div>
                <div className="mt-1.5">
                  <ReviewStageSwitcher activeRos />
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
                <div className="shrink-0 rounded border border-slate-600/80 bg-slate-900/50 px-2 py-1.5 text-[10px] text-slate-300">
                  <div className="font-semibold text-slate-200">ROS Show</div>
                  {currentReview.creative === 'approved' && currentReview.ros === 'approved' ? (
                    <div className="mt-0.5 text-emerald-300">Fully approved (Creative + ROS)</div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className={`rounded border px-1.5 py-0.5 ${reviewStatusMeta(currentReview.creative).railClass}`}>
                        Creative: {reviewStatusMeta(currentReview.creative).label}
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 ${reviewStatusMeta(currentReview.ros).railClass}`}>
                        ROS: {reviewStatusMeta(currentReview.ros).label}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {(
                    [
                      {
                        id: 'pending' as const,
                        label: 'Review',
                        active: 'border-sky-100 bg-sky-500 text-white shadow-lg',
                        idle: 'border-sky-600 bg-sky-800 text-sky-50',
                      },
                      {
                        id: 'needs_update' as const,
                        label: 'Needs Review',
                        active: 'border-amber-50 bg-amber-500 text-white shadow-lg',
                        idle: 'border-amber-600 bg-amber-800 text-amber-50',
                      },
                      {
                        id: 'approved' as const,
                        label: 'Approved',
                        active: 'border-emerald-50 bg-emerald-500 text-white shadow-lg',
                        idle: 'border-emerald-600 bg-emerald-800 text-emerald-50',
                      },
                    ] as const
                  ).map((s) => (
                    <span
                      key={s.id}
                      ref={
                        s.id === 'approved'
                          ? approveBtnRef
                          : s.id === 'needs_update'
                            ? needsReviewBtnRef
                            : undefined
                      }
                      className={`rounded border px-2 py-1 text-[10px] font-semibold ${
                        selectedStatus === s.id ? s.active : s.idle
                      }`}
                    >
                      {s.label}
                    </span>
                  ))}
                </div>
                <textarea
                  ref={reviewNoteRef}
                  readOnly
                  value={reviewNoteDraft}
                  rows={6}
                  placeholder="ROS Show notes…"
                  className="min-h-[7rem] w-full flex-1 resize-none rounded border-2 border-slate-300 bg-white px-2 py-2 text-[10px] leading-snug text-slate-900 shadow-inner outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/40"
                />
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export const ContentReviewDriveShowcaseContent: React.FC = () => (
  <ContentReviewShowcaseContent mode="drive" />
);

export const ContentReviewFollowShowcaseContent: React.FC = () => (
  <ContentReviewShowcaseContent mode="follow" />
);
