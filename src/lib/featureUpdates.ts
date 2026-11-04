/** Feature Updates changelog — defaults seed the page until Admin saves Neon copy. */

import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch, apiJsonHeaders } from './sessionAuth';

export type FeatureUpdateItem = {
  id: string;
  /** Short name of what shipped */
  title: string;
  /** One or two sentences: what changed, how you use it, why it matters */
  detail?: string;
  forWho?: string;
};

export type FeatureUpdateWeek = {
  id: string;
  label: string;
  rangeLabel: string;
  items: FeatureUpdateItem[];
};

export type FeatureUpdateMonth = {
  id: string;
  label: string;
  weeks: FeatureUpdateWeek[];
  emptyMessage?: string;
};

export type FeatureUpdatesDocument = {
  months: FeatureUpdateMonth[];
  updatedAt?: string | null;
  updatedByName?: string | null;
  empty?: boolean;
};

function nid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newFeatureItem(title = '', detail = ''): FeatureUpdateItem {
  return { id: nid('item'), title, ...(detail ? { detail } : {}) };
}

export function newFeatureWeek(label = 'Week', rangeLabel = ''): FeatureUpdateWeek {
  return { id: nid('week'), label, rangeLabel, items: [newFeatureItem('')] };
}

export function newFeatureMonth(label = 'New month'): FeatureUpdateMonth {
  return { id: nid('month'), label, weeks: [newFeatureWeek('Week 1', '')] };
}

/** Built-in September draft — used when Neon has no saved document yet. */
export const FEATURE_UPDATES_DEFAULT: FeatureUpdateMonth[] = [
  {
    id: '2026-09',
    label: 'September 2026',
    weeks: [
      {
        id: '2026-09-w1',
        label: 'Week 1',
        rangeLabel: 'Sept 1–7',
        items: [
          {
            id: 's1',
            title: 'Creative ROS tools',
            detail:
              'Creatives can filter the run of show, copy segment details, and export only the filtered rows. They can also upload Content Review PDFs from their own login so review files live with the show.',
          },
          {
            id: 's2',
            title: 'Speakers modal & copy',
            detail:
              'Search and Import/Export in the Speakers modal are cleaner. Speaker cards have copy actions so you can grab names/titles without retyping.',
          },
          {
            id: 's3',
            title: 'Producer + Speaker Database',
            detail:
              'A Producer role can manage a shared Speaker Database across events, instead of rebuilding speaker lists show by show.',
          },
          {
            id: 's4',
            title: 'Event Board',
            detail:
              'New workspace for day-of notes and files next to the show. Multi-day ROS fixes keep the board lined up with each day’s cues.',
          },
        ],
      },
      {
        id: '2026-09-w2',
        label: 'Week 2',
        rangeLabel: 'Sept 8–14',
        items: [
          {
            id: 's5',
            title: 'Event Board day-of workflow',
            detail:
              'Note tabs, a simpler agenda view, and drag-and-drop uploads so ops can park files and notes without leaving the board.',
          },
          {
            id: 's6',
            title: 'HyperDeck / Record',
            detail:
              'In-Show vs Rehearsal is gated so rehearsal marks do not mix into show. Follow mode refreshes marks live; REC choices stick after refresh. Comms gets a Record badge when recording is active.',
          },
          {
            id: 's7',
            title: 'Other Room & Head Table',
            detail:
              'Mark a cue as Other Room when it plays elsewhere. Head Table is a program type for General Meeting / Hollow Square seating layouts.',
          },
          {
            id: 's8',
            title: 'Streaming setup & requests',
            detail:
              'RTMP URL, stream key, and playback details sit on the event. Outside teams use the public Stream Request form (including YouTube title/description) without needing a ROS login.',
          },
          {
            id: 's9',
            title: 'Content Review live sync',
            detail:
              'Review stays in sync with the ROS, locks rows while someone edits, aligns program types, and shows cue start times plus VO/BGM in Notes.',
          },
          {
            id: 's10',
            title: 'Offline ROS parity',
            detail:
              'Laptop failover now carries Other Room and VO/BGM the same way as the live show, so a disconnect does not drop those cues.',
          },
          {
            id: 's11',
            title: 'Quick Mode & Large displays',
            detail:
              'Quick Mode, Large Photo slots, countdown color, and VO toast timing are tuned for operator screens. Operator Large view is easier to read in the room.',
          },
        ],
      },
      {
        id: '2026-09-w3',
        label: 'Week 3',
        rangeLabel: 'Sept 15–21',
        items: [
          {
            id: 's12',
            title: 'Public Quick Mode links',
            detail:
              'Operators can open Quick Mode from a link with no sign-in. Admins still control which displays are allowed. Stream Guide is public too.',
          },
          {
            id: 's13',
            title: 'Teleprompter voice-follow',
            detail:
              'Prompter scrolls and highlights from voice, with skip-ahead when talent jumps. Clock can show the same teleprompter layout as Viewer; Cue Cards and Teleprompter can Send to Clock, including offline.',
          },
          {
            id: 's14',
            title: 'Cue Cards (web)',
            detail:
              'Web slides with scroller/viewer, groups, and comments. Editing is cleaner, size is a dropdown, and Operator Actions sit beside the panel for show control.',
          },
          {
            id: 's15',
            title: 'PreShow & Green Room timing',
            detail:
              'PreShow countdown branding and rainbow sync match across browsers. Show-day arming is clearer. Green Room delay comes from Delay Blocks above START so hold time is automatic.',
          },
          {
            id: 's16',
            title: 'Clock / Fullscreen & cue notes',
            detail:
              'ALT labels, layout, and open modes on Clock/Fullscreen. SettleCue notes plus VO/BGM toasts use UTC with sticky catch-up if you join late.',
          },
          {
            id: 's17',
            title: 'Stage Direction & show control',
            detail:
              'Stage Direction notes and optional auto shot type from speakers. STT diagnostics for voice follow. Electron OSC tokens and show-control backups are hardened for booth machines.',
          },
        ],
      },
      {
        id: '2026-09-w4',
        label: 'Week 4',
        rangeLabel: 'Sept 22–28',
        items: [
          {
            id: 's18',
            title: 'Enter In-Show nudge',
            detail:
              'About a minute after PreShow, Admin/Crew see a short overlay reminding the room to move into In-Show so clocks and displays flip together.',
          },
          {
            id: 's19',
            title: 'Role & presence UX',
            detail:
              'Viewer / Editor / Operator sticks after refresh so you do not re-pick every time. Presence reminder is a bottom lightbox instead of blocking the sheet.',
          },
          {
            id: 's20',
            title: 'Display pickers & status',
            detail:
              'Event pickers on displays sort by date. Ontime/Late toast updates on refresh. Large Photo countdown can enlarge. Calendar builds show a dated app version (V26.9.23…).',
          },
          {
            id: 's21',
            title: 'Display-sync safety',
            detail:
              'Admins can kill display sync per event if a feed misbehaves. Unauthorized API spam is quarantined so one bad client does not hammer the server.',
          },
          {
            id: 's22',
            title: 'Civics Bee Students control',
            detail:
              'Extend Event Controls includes Civics Bee Students so student graphics/selection can be managed with the rest of the event tools.',
          },
        ],
      },
      {
        id: '2026-09-w5',
        label: 'Week 5',
        rangeLabel: 'Sept 29–30',
        items: [
          {
            id: 's23',
            title: 'Multi-day show start',
            detail:
              'Show-start offsets follow the START cue’s day. Enter In-Show copy matches that day. PreShow and EndShow are split. Event List can split multi-day events for Admin / EM / Crew. Guest columns are controllable.',
          },
          {
            id: 's24',
            title: 'ROS layout & markers',
            detail:
              'Start stays sticky beside CUE; columns reorder when you scroll. Timed markers group with absolute or offset starts and follow their parent row. “Walking” is Ted-Talk; segment names left-align. Row height/timers paint faster.',
          },
          {
            id: 's25',
            title: 'Green Room, Op Timer, REC tip',
            detail:
              'Green Room has timer, title, and column toggles. Op Timer is a purple ALT on Clock/Fullscreen (modal or pop-out). REC hover tip is larger for post/social export.',
          },
          {
            id: 's26',
            title: 'Civics Bee graphics CSV',
            detail:
              'Graphics can pull a Civics Bee CSV feed for lower-thirds / boards without hand-building the list each show.',
          },
          {
            id: 's27',
            title: 'Director View & print / master time',
            detail:
              'Director View scales/resizes panels and previews ROS filters. Custom print report, Admin/Crew clear master time, import popout notes, and offline timer parity round out show ops.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-10',
    label: 'October 2026',
    weeks: [
      {
        id: '2026-10-w1',
        label: 'Week of Oct 23',
        rangeLabel: 'Oct 23–25',
        items: [
          {
            id: 'o1',
            title: 'ROS PPT Launcher',
            detail:
              'Launcher sits on its own page, follows the live ROS cue, and syncs decks into a chosen folder so only the matching cue file opens. Opening a loaded cue retries through PowerPoint COM failures instead of dying on E_FAIL.',
          },
          {
            id: 'o2',
            title: 'Launcher slide previews',
            detail:
              'Current and next slides show large in the Launcher with a slide count. Previews stay centered; leftover stills expire after about a month so the machine does not fill with old thumbs.',
          },
          {
            id: 'o3',
            title: 'Overtime sign (Admin)',
            detail:
              'Admin picks minus or plus for overtime so every clock and display uses the same sign. Signs sit beside the digits without lifting the numbers.',
          },
          {
            id: 'o4',
            title: 'End show / open any deck',
            detail:
              'Launcher can end by quitting PowerPoint. You can open any synced deck without waiting for a cue load when you need a manual deck.',
          },
          {
            id: 'o22',
            title: 'VDO.Ninja Live Capture',
            detail:
              'PowerPoint Bridge can send Live Capture into PPT Launcher. Pick a screen without VDO elevate; swap cue decks without a desktop flash. Operators can push a new upcoming PPT to the helper from Launcher or ROS.',
          },
        ],
      },
      {
        id: '2026-10-w2',
        label: 'Week of Oct 26',
        rangeLabel: 'Oct 26–27',
        items: [
          {
            id: 'o5',
            title: 'Cue file versions',
            detail:
              'Same-name cue uploads become versions (Name_V2 in the filename). Operators pick the current file so downloads do not collide or overwrite the wrong deck.',
          },
          {
            id: 'o6',
            title: 'ReCue# & typed notes',
            detail:
              'ReCue# labels sit with Move. Typed VO/Settle notes convert in place without shuffling live rows. Same tools ship in offline ROS.',
          },
          {
            id: 'o7',
            title: 'Filter Pin Start default',
            detail:
              'New ROS and guest views default Filter Pin Start next to CUE on, so Start stays visible without re-toggling every show.',
          },
          {
            id: 'o8',
            title: 'Photo View & For Photos',
            detail:
              'For Photos row checkboxes and Photo/Large Ops program colors match. Photo View stays on the last loaded cue between timers instead of jumping back to PreShow. Session roles were renamed for clarity.',
          },
          {
            id: 'o9',
            title: 'Show completed & change-log notes',
            detail:
              'Show completed sits next to Track was durations (For Photos checkbox removed from that spot). Change-log notes restore onto the cue instead of writing an empty previous value. Next Photo View speaker photo can show beside program type.',
          },
          {
            id: 'o10',
            title: 'Editor hold & Start estimates',
            detail:
              'The first editor on a cue is held so a later save cannot wipe their work. Live Start estimates show only while a cue is running (and only when it actually shifts times), then clear after Clear/Reset until the next load/start.',
          },
          {
            id: 'o11',
            title: 'Column layout & VO chips',
            detail:
              'Delay Start, Program Type, and Duration stay under their headers. VO callouts stay linked to Notes chips so leftover hidden VOs cannot fire popups.',
          },
          {
            id: 'o12',
            title: 'HyperDeck multi-day',
            detail:
              'Show day picker lets HyperDeck ingest follow multi-day events through the last day. You can copy a selected stored clip, not only the last one.',
          },
        ],
      },
      {
        id: '2026-10-w3',
        label: 'Week of Oct 28',
        rangeLabel: 'Oct 28–30',
        items: [
          {
            id: 'o13',
            title: 'PPT / Q&A / REC / Public persist',
            detail:
              'Those checks save to Neon right away and stay dirty until confirm, so a refresh or pause-end save cannot drop them. Stale rundown saves no longer overwrite newer checkbox stamps (including Mitti and AV).',
          },
          {
            id: 'o14',
            title: 'Admin version auto-bump',
            detail:
              'Admin version bumps on master push (and on Cloudflare pack if needed) so the on-screen label cannot freeze on an old build.',
          },
          {
            id: 'o15',
            title: 'Session overlay & guest Start',
            detail:
              'Session overlay and an Admin-gated refresh notice help after deploy. Guest and Director Start columns show Ran, EST, and overtime from live ROS timing. PDF-to-PPTX cue assets land for Make PowerPoint.',
          },
          {
            id: 'o16',
            title: 'Show Break section',
            detail:
              'Insert a Show Break so evening cues get their own start, offsets, and PreShow instead of sharing the morning START clock.',
          },
          {
            id: 'o17',
            title: 'Access: see all, request event',
            detail:
              'Selected-event users can see every event on the list and request access; managers approve. Access-request list fixes shipped with PowerPoint live preview to Clock.',
          },
          {
            id: 'o18',
            title: 'Creative spelling check',
            detail:
              'Creative can review segment spelling, push a check to ROS, and see wrapped names on guest and embed views. Per-field copy icons replace bulk speaker copy buttons.',
          },
          {
            id: 'o19',
            title: 'Make PowerPoint on Railway',
            detail:
              'PDF→PPT uses Railway’s canvas/pdf.js path (including Node DOMMatrix) so Make PowerPoint renders slides in production.',
          },
          {
            id: 'o20',
            title: 'PowerPoint helper: live deck',
            detail:
              'Helper identifies the live deck, keeps Manual open, refreshes stills on switch, shares Clock auto-push, and supports follow vs manual open. Hosted rebuild stays off Electron dist uploads during Railway deploys.',
          },
          {
            id: 'o21',
            title: 'Admin key gate & sign-out',
            detail:
              'Real admin key is required before the color puzzle. Admin can sign accounts out. PowerPoint show-day picker covers multi-day events on the bridge.',
          },
        ],
      },
    ],
  },
  {
    id: '2026-11',
    label: 'November 2026',
    weeks: [
      {
        id: '2026-11-w1',
        label: 'Week 1',
        rangeLabel: 'Nov 1–3',
        items: [
          {
            id: 'n1',
            title: 'PowerPoint Bridge V2 (thrash fixes)',
            detail:
              'Open/Loaded thrash from shared deck titles is stopped; keep/run no longer overwrites live identity. Cue matching uses ROS cue labels; Show completed syncs for the whole event. Confirm show day always shows for multi-day (e.g. Business Solves Day 1/2).',
          },
          {
            id: 'n2',
            title: 'Bridge focus & Protected View',
            detail:
              'Focus targets the slide show window (Presenter View when in presenter mode). Focus picker, Force Enable Editing, and auto Enable Editing for Protected View ship in Bridge V2 0.2.4+. Download uses the live hosted zip route.',
          },
          {
            id: 'n3',
            title: 'VOG (ElevenLabs)',
            detail:
              'Notes-adjacent VOG column: preview and WAV/MP3 download, tabbed scripts, bulk MP3. Scripts save to Neon. Admin connection check. Text-to-Dialogue (v4) for emotion and context.',
          },
          {
            id: 'n4',
            title: 'ROS scroll jello fix',
            detail:
              'Horizontal scroll jello on the ROS sheet is fixed so columns stay put while you pan.',
          },
          {
            id: 'n5',
            title: 'DSM Clock + Companion',
            detail:
              'DSM schedule column with Ross Talk Companion bridge. Companion presets/variables control 16:9 vs full DSM layout; page/row/column buttons can fire on cue load. Participants stay hidden on Show All. Sticky header column drift fixed; full zip rebuilt for Cloudflare download.',
          },
          {
            id: 'n6',
            title: 'Feature Updates page',
            detail:
              'Event List → Feature Updates: month and week accordions with short titles plus how/why copy. Admins can Edit copy and Save to Neon once the API is live.',
          },
        ],
      },
    ],
  },
];

export function withDefaultsIfEmpty(doc: FeatureUpdatesDocument | null | undefined): FeatureUpdateMonth[] {
  if (doc?.months?.length) return doc.months;
  return FEATURE_UPDATES_DEFAULT;
}

export async function fetchFeatureUpdates(): Promise<FeatureUpdatesDocument> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const res = await fetch(`${base}/api/feature-updates?t=${Date.now()}`, {
    headers: { Accept: 'application/json' },
  });
  const data = (await res.json().catch(() => ({}))) as FeatureUpdatesDocument & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Failed to load feature updates (${res.status})`);
  }
  return {
    months: Array.isArray(data.months) ? data.months : [],
    updatedAt: data.updatedAt ?? null,
    updatedByName: data.updatedByName ?? null,
    empty: data.empty === true || !data.months?.length,
  };
}

export async function saveFeatureUpdates(
  months: FeatureUpdateMonth[]
): Promise<FeatureUpdatesDocument> {
  const res = await apiAuthFetch(`${getApiBaseUrl().replace(/\/$/, '')}/api/admin/feature-updates`, {
    method: 'PUT',
    headers: apiJsonHeaders(),
    body: JSON.stringify({ months }),
  });
  if (!res) {
    throw new Error('Not signed in');
  }
  const data = (await res.json().catch(() => ({}))) as FeatureUpdatesDocument & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Failed to save (${res.status})`);
  }
  return {
    months: Array.isArray(data.months) ? data.months : months,
    updatedAt: data.updatedAt ?? null,
    updatedByName: data.updatedByName ?? null,
    empty: false,
  };
}
