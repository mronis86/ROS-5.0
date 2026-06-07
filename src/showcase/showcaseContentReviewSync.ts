import { useSyncExternalStore } from 'react';
import { getShowcaseElapsedSec, subscribeShowcaseTick } from './useFakeCountdown';

export type ContentReviewReviewStatus = 'pending' | 'needs_update' | 'approved';

export type ShowcaseCueReviewState = {
  creative: ContentReviewReviewStatus;
  ros: ContentReviewReviewStatus;
  rosNote: string;
};

/** Drive tour — shared clock so Drive + Follow mocks stay in sync in the gallery. */
export type ContentReviewTourAction = 'approve' | 'needs_review';

export type ContentReviewTourStep = {
  cueId: number;
  action: ContentReviewTourAction;
};

/** Pending cues approved first, then two flagged needs review. */
export const CONTENT_REVIEW_TOUR_STEPS: ContentReviewTourStep[] = [
  { cueId: 2, action: 'approve' },
  { cueId: 4, action: 'approve' },
  { cueId: 8, action: 'approve' },
  { cueId: 3, action: 'needs_review' },
  { cueId: 7, action: 'needs_review' },
];

export const CONTENT_REVIEW_TOUR = CONTENT_REVIEW_TOUR_STEPS.map((s) => s.cueId);
export const CONTENT_REVIEW_CUE_DWELL_SEC = 15;
export const CONTENT_REVIEW_TOUR_CYCLE_SEC = CONTENT_REVIEW_TOUR_STEPS.length * CONTENT_REVIEW_CUE_DWELL_SEC;

export const INITIAL_SHOWCASE_CUE_REVIEWS: Record<number, ShowcaseCueReviewState> = {
  1: { creative: 'approved', ros: 'approved', rosNote: 'Walk-in and house lights cue verified with show caller.' },
  2: { creative: 'approved', ros: 'pending', rosNote: '' },
  3: { creative: 'approved', ros: 'pending', rosNote: '' },
  4: { creative: 'approved', ros: 'pending', rosNote: '' },
  5: { creative: 'approved', ros: 'approved', rosNote: 'Pre-record on V2 checked — awards open looks good.' },
  6: { creative: 'approved', ros: 'approved', rosNote: 'Remote panel feed checked with broadcast.' },
  7: { creative: 'approved', ros: 'pending', rosNote: '' },
  8: { creative: 'approved', ros: 'pending', rosNote: '' },
};

export type ShowcaseAssetRow = { name: string; link: string; linkEnabled: boolean };

export const CONTENT_REVIEW_CUE_DETAILS: Record<
  number,
  { notesHtml: string; assetsRaw: string }
> = {
  1: {
    notesHtml: `<p><strong>House preset:</strong> Lights at 50%, walk-in music at −12 LUFS.</p><p><span style="background-color:#fbbf24;color:#111">Confirm with show caller before doors open.</span></p><p>Roll opening bumper on <strong>V2</strong> at T−2:00. Stage manager clears at T−0:30.</p>`,
    assetsRaw:
      'Walk-in Music|https://drive.example.com/summit/walk-in-track||Opening Bumper|https://drive.example.com/summit/open-bumper-v2.mp4',
  },
  2: {
    notesHtml: `<p><strong>Keynote — Future of Work</strong></p><p>Lower third: name + title on <strong>CG1</strong>. Slides on <strong>V1</strong>; confidence monitor duplicate on <strong>V3</strong>.</p><p><span style="color:#60a5fa">Q&amp;A mic queue:</span> handoff to moderator at 22:00 elapsed. Teleprompter scroll speed 1.2×.</p>`,
    assetsRaw:
      'Keynote Deck v3|https://drive.example.com/summit/keynote-deck-v3.pptx||Lower Third GFX|https://figma.example/file/lt-keynote||Speaker Intro Sting|https://drive.example.com/summit/intro-sting.wav',
  },
  3: {
    notesHtml: `<p><strong>Panel — Industry Trends</strong></p><p>4 panelists + moderator. <span style="background-color:#fbbf24;color:#111">Lav mics on all four — verify RF before rehearsal.</span></p><p>Shot sequence: moderator 1-shot → panel 2-shot → audience reaction wide. No PPT — graphics on V2 only.</p><p>Moderator reads audience questions from iPad; backup printed cards in green room.</p>`,
    assetsRaw:
      'Panel Lower Thirds|https://drive.example.com/summit/panel-lts.zip||Audience Poll Slides|https://drive.example.com/summit/panel-poll.pptx',
  },
  4: {
    notesHtml: `<p>Break — house lights to 100%, hold music in lobby only. <strong>Do not</strong> roll content on main screens; hold sponsor loop on side screens if requested.</p>`,
    assetsRaw: 'Lobby Hold Music|https://drive.example.com/summit/lobby-break.mp3',
  },
  5: {
    notesHtml: `<p><strong>Awards Presentation</strong></p><p>Pre-record on <strong>V2</strong> — awards open animation. Winner names on teleprompter; verify spelling with production assistant.</p><p><span style="color:#4ade80">ROS approved:</span> camera 3 push on each winner walk-up.</p>`,
    assetsRaw:
      'Awards Open Animation|https://drive.example.com/summit/awards-open-v2.mp4||Winner Lower Thirds|https://drive.example.com/summit/winner-lts.pptx||Walk-up Music|https://drive.example.com/summit/walk-up.wav',
  },
  6: {
    notesHtml: `<p>Remote panel feed — test complete. Backup dial-in on <strong>Ch 4</strong> if primary drops. Delay line +7 frames to match in-room.</p>`,
    assetsRaw: 'Remote IFB Test Sheet|https://drive.example.com/summit/remote-ifb.pdf',
  },
  7: {
    notesHtml: `<p><strong>Fireside Chat</strong></p><p><span style="background-color:#fbbf24;color:#111">Two-chair layout — mark tape on stage.</span> Soft key light; no podium. Handheld mics for both speakers.</p>`,
    assetsRaw: 'Fireside B-Roll|https://drive.example.com/summit/fireside-broll.mp4',
  },
  8: {
    notesHtml: `<p>Closing remarks — wide shot hold, then fade to end card on V1. Thank-you slide auto-advance at 45s.</p>`,
    assetsRaw: 'End Card|https://drive.example.com/summit/end-card.png||Closing Music|https://drive.example.com/summit/closing.wav',
  },
};

export const FOLLOW_NEEDS_REVIEW_NOTES: Record<number, string> = {
  3: 'Lav mics on all four panelists still need RF scan on site. Hold ROS approval until rehearsal walk-through.',
  7: 'Two-chair layout needs spike tape on stage. Camera 2 framing too wide — revisit before marking approved.',
};

let cueReviews: Record<number, ShowcaseCueReviewState> = { ...INITIAL_SHOWCASE_CUE_REVIEWS };
const reviewListeners = new Set<() => void>();

function notifyReviews() {
  reviewListeners.forEach((l) => l());
}

export function subscribeShowcaseCueReviews(cb: () => void): () => void {
  reviewListeners.add(cb);
  return () => reviewListeners.delete(cb);
}

export function getShowcaseCueReviews(): Record<number, ShowcaseCueReviewState> {
  return cueReviews;
}

export function applyShowcaseCueApproval(cueId: number, note: string) {
  cueReviews = {
    ...cueReviews,
    [cueId]: {
      ...(cueReviews[cueId] ?? { creative: 'approved', ros: 'pending', rosNote: '' }),
      ros: 'approved',
      rosNote: note,
    },
  };
  notifyReviews();
}

export function applyShowcaseCueNeedsReview(cueId: number, note: string) {
  cueReviews = {
    ...cueReviews,
    [cueId]: {
      ...(cueReviews[cueId] ?? { creative: 'approved', ros: 'pending', rosNote: '' }),
      ros: 'needs_update',
      rosNote: note,
    },
  };
  notifyReviews();
}

const TOUR_RESET_PENDING_IDS = [2, 3, 4, 7, 8] as const;

export function resetShowcaseContentReviewTour() {
  cueReviews = { ...INITIAL_SHOWCASE_CUE_REVIEWS };
  for (const id of TOUR_RESET_PENDING_IDS) {
    cueReviews[id] = { creative: 'approved', ros: 'pending', rosNote: '' };
  }
  notifyReviews();
}

export function getShowcaseContentReviewTourStep(cueIndex: number): ContentReviewTourStep | undefined {
  return CONTENT_REVIEW_TOUR_STEPS[cueIndex];
}

export function getShowcaseContentReviewStepAction(cueId: number): ContentReviewTourAction | undefined {
  return CONTENT_REVIEW_TOUR_STEPS.find((s) => s.cueId === cueId)?.action;
}

export function getShowcaseContentReviewSelectedCueId(): number {
  const elapsed = getShowcaseElapsedSec();
  const idx = Math.floor(elapsed / CONTENT_REVIEW_CUE_DWELL_SEC) % CONTENT_REVIEW_TOUR_STEPS.length;
  return CONTENT_REVIEW_TOUR_STEPS[idx]?.cueId ?? 1;
}

export function getShowcaseContentReviewCueIndex(): number {
  const elapsed = getShowcaseElapsedSec();
  return Math.floor(elapsed / CONTENT_REVIEW_CUE_DWELL_SEC) % CONTENT_REVIEW_TOUR_STEPS.length;
}

export function getShowcaseContentReviewPhaseSec(): number {
  return getShowcaseElapsedSec() % CONTENT_REVIEW_CUE_DWELL_SEC;
}

export function parseShowcaseAssetRows(raw: string): ShowcaseAssetRow[] {
  if (!raw.trim()) return [];
  return raw
    .split('||')
    .map((piece) => {
      const trimmed = piece.trim();
      if (!trimmed) return null;
      const [namePart, ...rest] = trimmed.split('|');
      const name = (namePart || '').trim();
      const link = rest.join('|').trim();
      if (!name) return null;
      return { name, link, linkEnabled: link.length > 0 };
    })
    .filter((r): r is ShowcaseAssetRow => r !== null);
}

export function useShowcaseContentReviewSync() {
  const tick = useSyncExternalStore(subscribeShowcaseTick, getShowcaseElapsedSec, () => 0);
  void tick;
  const reviews = useSyncExternalStore(
    subscribeShowcaseCueReviews,
    getShowcaseCueReviews,
    () => INITIAL_SHOWCASE_CUE_REVIEWS
  );
  void reviews;

  return {
    selectedCueId: getShowcaseContentReviewSelectedCueId(),
    cueIndex: getShowcaseContentReviewCueIndex(),
    phaseSec: getShowcaseContentReviewPhaseSec(),
    cueReviews: getShowcaseCueReviews(),
  };
}
