/** Feature Updates changelog — drafts stay private until Admin approves each item. */

import { getApiBaseUrl } from '../services/api-client';
import { apiAuthFetch, apiJsonHeaders } from './sessionAuth';

export const FEATURE_UPDATE_CATEGORIES = [
  'Feature',
  'System Update',
  'Fix',
  'Ops',
] as const;

export type FeatureUpdateCategory = (typeof FEATURE_UPDATE_CATEGORIES)[number];

export type FeatureUpdateItem = {
  id: string;
  /** Short name of what shipped */
  title: string;
  /** One or two sentences: what changed, how you use it, why it matters */
  detail?: string;
  category?: FeatureUpdateCategory;
  /** Public readers only see approved items */
  approved?: boolean;
  forWho?: string;
  /** Optional still — shown as a small thumb; click expands */
  imageUrl?: string;
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

function item(
  id: string,
  title: string,
  detail: string,
  category: FeatureUpdateCategory,
  forWho?: string,
  imageUrl?: string
): FeatureUpdateItem {
  return {
    id,
    title,
    detail,
    category,
    approved: false,
    ...(forWho ? { forWho } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export function newFeatureItem(title = '', detail = ''): FeatureUpdateItem {
  return {
    id: nid('item'),
    title,
    category: 'Feature',
    approved: false,
    ...(detail ? { detail } : {}),
  };
}

export function newFeatureWeek(label = 'Week', rangeLabel = ''): FeatureUpdateWeek {
  return { id: nid('week'), label, rangeLabel, items: [newFeatureItem('')] };
}

export function newFeatureMonth(label = 'New month'): FeatureUpdateMonth {
  return { id: nid('month'), label, weeks: [newFeatureWeek('Week 1', '')] };
}

/**
 * Built-in draft from git history. Every item starts unapproved —
 * nothing is public until Admin checks Approve and Saves.
 */
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
          item(
            's1',
            'Creative ROS tools',
            'Creatives can filter the run of show, copy segment details, export only filtered rows, and upload Content Review PDFs from their own login.',
            'Feature',
            'Creative',
            '/feature-updates/s1-content-review-pdf.png'
          ),
          item(
            's2',
            'Speakers: copy, search, import/export',
            'Speaker cards get copy actions. Speakers modal search and Import/Export are cleaner for day-of edits.',
            'Feature'
          ),
          item(
            's3',
            'Producer + Speaker Database',
            'Producer role manages a shared Speaker Database across events instead of rebuilding lists per show.',
            'Feature',
            'Producer'
          ),
          item(
            's4',
            'Event Board workspace',
            'For General Meeting and Hollow Square, choose Event Board instead of a timed Run of Show. It is a shared workspace for agenda, PowerPoint decks, display files, and note tabs (conference setup, food & beverage, AV)—not a minute-by-minute cue timer. Multi-day events keep board content lined up with each day.',
            'Feature',
            'Event ops'
          ),
        ],
      },
      {
        id: '2026-09-w2',
        label: 'Week 2',
        rangeLabel: 'Sept 8–14',
        items: [
          item(
            's5',
            'Event Board day-of workflow',
            'On the Event Board: switch note tabs (agenda / setup / food / AV), use a simpler agenda layout, and drag-and-drop upload decks or display files without leaving the page.',
            'Feature',
            'Event ops'
          ),
          item(
            's6',
            'Comms role + HyperDeck Record Bridge',
            'New Comms user role marks cues for post/social export (Record badge on the ROS) without changing the master full-program record. The HyperDeck Ingest bridge follows those marks: when a Record-marked cue is loaded or running it starts the deck, stops when the cue ends or you jump, then copies/indexes each clip into an editor folder with a dated event–segment name. In-Show vs Rehearsal gate keeps rehearsal takes out of the show index; marks refresh while following.',
            'Feature',
            'Comms'
          ),
          item(
            's7',
            'Other Room & Head Table',
            'Mark a cue as Other Room when it plays elsewhere. Head Table program type for General Meeting / Hollow Square.',
            'Feature'
          ),
          item(
            's8',
            'Streaming setup & public request',
            'RTMP, key, and playback on the event. Public Stream Request form includes YouTube title/description.',
            'Feature',
            'Streaming'
          ),
          item(
            's9',
            'Content Review live sync',
            'Live sync with ROS, row locks, program-type align, cue start times, and VO/BGM in Notes.',
            'Feature',
            'Creative'
          ),
          item(
            's10',
            'Offline ROS parity',
            'Laptop failover carries Other Room and VO/BGM the same way as online.',
            'System Update'
          ),
          item(
            's11',
            'Quick Mode & Large displays',
            'Quick Mode, Large Photo slots, countdown color, VO toast timing/sticky catch-up, Operator Large improvements.',
            'Feature',
            'Operators'
          ),
        ],
      },
      {
        id: '2026-09-w3',
        label: 'Week 3',
        rangeLabel: 'Sept 15–21',
        items: [
          item(
            's12',
            'Public Quick Mode links',
            'Operators open Quick Mode without sign-in; admins still control displays. Stream Guide is public.',
            'Feature'
          ),
          item(
            's13',
            'Teleprompter voice-follow',
            'Voice scroll, highlight, skip-ahead, SettleCue notes. Clock overlay matches Viewer; Send to Clock for Cue Cards and Teleprompter (offline too).',
            'Feature',
            'Prompter'
          ),
          item(
            's14',
            'Cue Cards (web)',
            'Web slides with scroller/viewer, groups, comments, editing polish, size dropdown, Operator Actions beside the panel.',
            'Feature',
            'Cue Cards'
          ),
          item(
            's15',
            'PreShow & Green Room timing',
            'PreShow countdown branding and rainbow sync across browsers. Show-day arming. Green Room delay from Delay Blocks above START.',
            'Feature'
          ),
          item(
            's16',
            'Clock / Fullscreen & VO toasts',
            'ALT labels, layout, open modes. VO/BGM toasts fire at the same UTC moment with sticky catch-up.',
            'System Update'
          ),
          item(
            's17',
            'Stage Direction & show control',
            'Stage Direction notes, optional auto shot type, STT diagnostics. Electron OSC API tokens and show-control backup hardening.',
            'Feature'
          ),
        ],
      },
      {
        id: '2026-09-w4',
        label: 'Week 4',
        rangeLabel: 'Sept 22–28',
        items: [
          item(
            's18',
            'Enter In-Show nudge',
            'About a minute after PreShow, Admin/Crew get a centered In-Show overlay so the room flips clocks together.',
            'Feature'
          ),
          item(
            's19',
            'Role & presence UX',
            'Viewer / Editor / Operator stick after refresh. Presence reminder moves to a bottom lightbox.',
            'System Update'
          ),
          item(
            's20',
            'Display pickers, version, Large Photo',
            'Dated app versioning (V26.9.23…). Large Photo countdown enlarge. Display pickers sort by date; Ontime/Late toast on refresh.',
            'System Update'
          ),
          item(
            's21',
            'Display-sync safety',
            'Kill switch for display sync; quarantine unauthorized API spam. Cloudflare Pages treated as first-party for those alerts.',
            'Ops'
          ),
          item(
            's22',
            'Extend Event Controls',
            'Per-event specialty modules you turn on from the Event List when a show needs more than the standard ROS. Admin/EM flip Extend on for that event, pick which modules apply, then open them from the ROS menu. Civics Bee Students is the first module—graphics, selection, and companion tools for that show—without forcing Civics UI onto every other event.',
            'Feature'
          ),
        ],
      },
      {
        id: '2026-09-w5',
        label: 'Week 5',
        rangeLabel: 'Sept 29–30',
        items: [
          item(
            's23',
            'START offsets follow the show day',
            'On multi-day events, overtime and show-start math use the day that owns the START cue—not a single master clock for every day. Enter In-Show copy shows that day’s start time so the room arms the right morning.',
            'Fix'
          ),
          item(
            's23b',
            'Split multi-day events on Event List',
            'Admin, Event Manager, and Crew can split a multi-day event into per-day rows on the Event List (day split lives in Edit Event). Easier to open or assign just Day 1 or Day 2.',
            'Feature'
          ),
          item(
            's23c',
            'Guest column controls',
            'Guest-facing views get clearer control over which columns show, so public/guest sheets stay lean while the full ROS stays complete.',
            'Feature'
          ),
          item(
            's24',
            'Sticky Start beside CUE',
            'Start stays pinned next to the CUE column while you scroll sideways, and columns can reorder as you scroll so timing stays visible without hunting.',
            'Feature'
          ),
          item(
            's24b',
            'Grouped timed markers',
            'On the ROS, click the cue number on the left to open Row actions, then choose Add Timed Marker. The marker nests under that cue (like an indented timer) with a start time but no duration—set a fixed clock time, or an offset from the parent so it moves with overtime. Click the marker’s Start cell to edit later.',
            'Feature'
          ),
          item(
            's24c',
            'Ted-Talk location + segment names',
            '“Walking” speaker location is renamed Ted-Talk. Segment names left-align for faster scanning on the sheet.',
            'System Update'
          ),
          item(
            's25',
            'PreShow and EndShow are separate',
            'End-of-show is no longer a shared “PreShow/End” blob. PreShow and EndShow are distinct rows; EndShow uses the same purple diagonal treatment so displays read clearly.',
            'Feature'
          ),
          item(
            's25b',
            'Green Room timer and layout toggles',
            'Green Room can show its own timer and title, with toggles for which columns appear—tuned for backstage screens, not the full ROS.',
            'Feature'
          ),
          item(
            's25c',
            'Op Timer on Clock / Fullscreen',
            'Operator countdown is a purple ALT (like indented timers) on Clock and Fullscreen—open as a modal or a small pop-out—without clearing when cues clear.',
            'Feature',
            'Operators'
          ),
          item(
            's26',
            'Civics Bee graphics CSV',
            'Graphics can pull a Civics Bee CSV feed for lower-thirds and boards instead of hand-building the student list each show.',
            'Feature',
            'Civics'
          ),
          item(
            's27',
            'Director View',
            'New Director View: scale and resize panels, preview ROS filters, and run the show from a director-focused layout.',
            'Feature',
            'Director'
          ),
          item(
            's27b',
            'Custom print + clear master time',
            'Custom print report for paper rundowns. Admin/Crew can clear master start when the show needs a clean slate. Offline timer behavior matches online.',
            'Feature'
          ),
          item(
            's27c',
            'Larger REC hover tip',
            'Hovering REC shows a bigger tip explaining post/social export marks so operators do not confuse them with master program record.',
            'System Update',
            'Comms'
          ),
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
        label: 'Week 1',
        rangeLabel: 'Oct 1–5',
        items: [
          item(
            'o1',
            'Director View Script mode',
            'Script mode on Director View with live script sync, speaker highlight, and teleprompter/guide follow. Custom strip can hide.',
            'Feature',
            'Director'
          ),
          item(
            'o2',
            'Civics Bee awards + CSVs',
            'Awards flow with CSVs using full first/last names; Top 5 award links collapse into an accordion.',
            'Feature',
            'Civics'
          ),
          item(
            'o3',
            'Named backups & filter prefs',
            'Named ROS backups, account filter preferences, Socket.IO presence alert, and Filter View checkbox to sync layout to the account or keep it browser-local.',
            'System Update'
          ),
          item(
            'o4',
            'Scripts Follow voice ignore',
            'Click lines (Ctrl/Shift multi-select) to ignore for voice matching; grey ignored lines; resync on manual scroll; ignore [notes]/NOTE: lines.',
            'Feature',
            'Prompter'
          ),
          item(
            'o5',
            'Live badge & Mitti labels',
            'Live sync badge moves to the top bar (admin toggle). Mitti vs Resolume sync labels; Mitti Companion cue-load and crash-loop fixes.',
            'System Update'
          ),
          item(
            'o6',
            'AV-Playout / Caspar sync',
            'AV-Playout Companion module with Railway timer align, SINOR sync label, stop on clear/stop timer, and direct Play/Pause/Stop Arm/Send Time.',
            'Feature',
            'AV'
          ),
          item(
            'o7',
            'Notes contrast & cue assets',
            'Stronger notes text/highlight contrast (color separate from highlight). Cue assets allow any file type up to 200 MB. Time Toast defaults off.',
            'Feature'
          ),
          item(
            'o8',
            'Admin change-log restore',
            'Admin can restore from the change log; offline AV-Playout updates stay in sync.',
            'Ops'
          ),
        ],
      },
      {
        id: '2026-10-w2',
        label: 'Week 2',
        rangeLabel: 'Oct 6–12',
        items: [
          item(
            'o9',
            'Civics vMix + StreamDeck pages',
            'Civics vMix bridge and StreamDeck Top 25/10/5 graphics select pages.',
            'Feature',
            'Civics'
          ),
          item(
            'o10',
            'Mitti / AV next-cue columns',
            'Mitti and AV next-cue columns sync when playback starts. Disarm/Reset clear loaded cue and countdown. Companion tokens can set the checks. Watch next play checks the column for every browser.',
            'Feature',
            'AV'
          ),
          item(
            'o11',
            'Per-row editor saves',
            'Save only the cue row an editor finished; keep each editor’s changed rows when a sync snapshot returns.',
            'System Update'
          ),
          item(
            'o12',
            'Civics Bridge V2 → Companion',
            'Companion button push from Civics Bridge V2: preview → generate → confirmed import, row banks, press colors, bridge log, Top 10 from vMix row. Old vMix bridge blocked from redrawing buttons.',
            'Feature',
            'Civics'
          ),
          item(
            'o13',
            'Producer Go (then removed)',
            'Producer Go page (clock, Now/Next, Go/space) shipped mid-week, then was removed from the rundown menu after a quieter Director Show-control popup took its place.',
            'Feature',
            'Producer'
          ),
        ],
      },
      {
        id: '2026-10-w3',
        label: 'Week 3',
        rangeLabel: 'Oct 13–19',
        items: [
          item(
            'o14',
            'Director Show control popup',
            'Director view gets a Show control popup to roll the next cue; late stop keeps control on the current cue.',
            'Feature',
            'Director'
          ),
          item(
            'o15',
            'Civics export name styles',
            'Civics exports can use full last names; Companion picture styles stack full state over first name + last initial.',
            'Feature',
            'Civics'
          ),
          item(
            'o16',
            'Green Room timer subscribe',
            'Green Room timer stays subscribed when the schedule listener connects.',
            'Fix'
          ),
        ],
      },
      {
        id: '2026-10-w4',
        label: 'Week 4',
        rangeLabel: 'Oct 20–26',
        items: [
          item(
            'o17',
            'Auto Roll',
            'Run of Show can load and start cues at their Start times. Auto Roll stays armed across refresh (local + schedule save).',
            'Feature'
          ),
          item(
            'o18',
            'Est / ran Start times',
            'Start shows est until a cue runs, then ran in the same spot on ROS and operator displays. Completed cues grey on Load/Start/Stop; Killed rows strike without shifting later Starts.',
            'Feature'
          ),
          item(
            'o19',
            'Follow, Delay, clocks',
            'Follow stays on the running cue (Delay cannot jump the list). Delay Blocks show as DELAY. Running clocks use hh:mm:ss; remaining under an hour stays mm:ss.',
            'System Update'
          ),
          item(
            'o20',
            'PowerPoint stills → ROS',
            'Live PowerPoint slides can load and start ROS cues. Slide can stop the clock. Stills clear/expire; list or grid. Teleprompter and Scripts Follow follow loaded cues.',
            'Feature'
          ),
          item(
            'o21',
            'ROS PPT Launcher',
            'Launcher page follows the live cue, syncs decks to a folder, opens the matching file, retries COM failures, shows current/next previews, and can quit PowerPoint to end.',
            'Feature'
          ),
          item(
            'o22',
            'Overtime sign (Admin)',
            'Admin chooses minus or plus for overtime so every clock uses the same sign.',
            'System Update'
          ),
          item(
            'o23',
            'Helper zips on Railway',
            'PowerPoint Bridge, vMix DataSource, and HyperDeck Ingest zips stream from Railway so corp browsers are not stuck on storageapi/Netlify/Cloudflare limits.',
            'Ops'
          ),
          item(
            'o24',
            'Cue file versions & ReCue#',
            'Same-name cue uploads become Name_V2 files operators can pick. ReCue# labels; typed VO/Settle notes convert without moving live rows. Filter Pin Start defaults on.',
            'Feature'
          ),
        ],
      },
      {
        id: '2026-10-w5',
        label: 'Week 5',
        rangeLabel: 'Oct 27–31',
        items: [
          item(
            'o25',
            'Photo View & For Photos',
            'For Photos checkboxes and matching program colors. Photo View stays on the last loaded cue between timers. Show completed next to Track was durations.',
            'Feature'
          ),
          item(
            'o26',
            'Editor hold & Start estimates',
            'First editor on a cue is held. Live Start estimates only while a cue runs and actually shifts times; clear after Clear/Reset.',
            'System Update'
          ),
          item(
            'o27',
            'PPT / Q&A / REC / Public persist',
            'Checks save to Neon immediately and stay dirty until confirm so refresh or pause-end cannot drop them (including Mitti/AV stamps).',
            'Fix'
          ),
          item(
            'o28',
            'Show Break section',
            'Insert a Show Break so evening cues get their own start, offsets, and PreShow.',
            'Feature'
          ),
          item(
            'o29',
            'Access: see all, request event',
            'Selected-event users see every event and can request access for managers to approve.',
            'Feature'
          ),
          item(
            'o30',
            'Creative spelling & copy icons',
            'Creative reviews segment spelling and pushes a check to ROS. Per-field copy icons replace bulk speaker copy. Guest/embed names wrap.',
            'Feature',
            'Creative'
          ),
          item(
            'o31',
            'Make PowerPoint + live deck helper',
            'PDF→PPT on Railway (canvas/pdf.js). Helper identifies the live deck, Manual open, stills on switch, follow vs manual, Clock auto-push, show-day picker.',
            'Feature'
          ),
          item(
            'o32',
            'Admin key gate & sign-out',
            'Real admin key required before the color puzzle. Admin can sign accounts out. Admin version auto-bumps on master push.',
            'Ops'
          ),
          item(
            'o33',
            'VDO.Ninja Live Capture',
            'Bridge Live Capture into PPT Launcher; pick a screen without VDO elevate; swap decks without desktop flash; push upcoming PPT from Launcher or ROS.',
            'Feature'
          ),
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
          item(
            'n1',
            'PowerPoint Bridge V2',
            'Stops Open/Loaded thrash from shared titles; locks one helper per event. Matches ROS cue labels; Show completed for the whole event; always Confirm show day on multi-day.',
            'Fix'
          ),
          item(
            'n2',
            'Bridge focus & Protected View',
            'Focus targets the slide show (Presenter View when presenting). Focus picker, Force Enable Editing, auto Enable Editing for Protected View. Live hosted zip download.',
            'Feature'
          ),
          item(
            'n3',
            'VOG (ElevenLabs)',
            'Notes-adjacent VOG: preview, WAV/MP3, tabbed scripts, bulk MP3, Neon save. Text-to-Dialogue v4 for emotion/context. Admin connection check.',
            'Feature'
          ),
          item(
            'n4',
            'ROS scroll jello fix',
            'Horizontal scroll no longer jellos the sheet while you pan.',
            'Fix'
          ),
          item(
            'n5',
            'DSM Clock + Companion',
            'DSM schedule column with Ross Talk Companion bridge. Presets/variables for 16:9 vs full; page/row/column on cue load. Participants hidden on Show All.',
            'Feature'
          ),
          item(
            'n6',
            'Feature Updates page',
            'Event List → Feature Updates. Month/week accordions. Admin drafts, categories, and per-item Approve before anything is public.',
            'Feature'
          ),
        ],
      },
    ],
  },
];

export function withDefaultsIfEmpty(doc: FeatureUpdatesDocument | null | undefined): FeatureUpdateMonth[] {
  if (doc?.months?.length) return doc.months;
  return FEATURE_UPDATES_DEFAULT;
}

/** Fill missing imageUrl from built-in defaults (same item id). */
export function mergeDefaultImageUrls(months: FeatureUpdateMonth[]): FeatureUpdateMonth[] {
  const images = new Map<string, string>();
  for (const month of FEATURE_UPDATES_DEFAULT) {
    for (const week of month.weeks) {
      for (const entry of week.items) {
        if (entry.imageUrl) images.set(entry.id, entry.imageUrl);
      }
    }
  }
  if (!images.size) return months;
  return months.map((month) => ({
    ...month,
    weeks: month.weeks.map((week) => ({
      ...week,
      items: week.items.map((entry) =>
        entry.imageUrl || !images.has(entry.id)
          ? entry
          : { ...entry, imageUrl: images.get(entry.id) }
      ),
    })),
  }));
}

/** Drop unapproved items; drop empty weeks/months. */
export function filterApprovedOnly(months: FeatureUpdateMonth[]): FeatureUpdateMonth[] {
  return months
    .map((month) => ({
      ...month,
      weeks: month.weeks
        .map((week) => ({
          ...week,
          items: week.items.filter((it) => it.approved === true),
        }))
        .filter((week) => week.items.length > 0),
    }))
    .filter((month) => month.weeks.length > 0);
}

export async function fetchFeatureUpdates(opts?: {
  admin?: boolean;
}): Promise<FeatureUpdatesDocument> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  if (opts?.admin) {
    const res = await apiAuthFetch(`${base}/api/admin/feature-updates?t=${Date.now()}`, {
      headers: apiJsonHeaders({ Accept: 'application/json' }),
    });
    if (!res) throw new Error('Not signed in');
    const data = (await res.json().catch(() => ({}))) as FeatureUpdatesDocument & { error?: string };
    if (!res.ok) throw new Error(data.error || `Failed to load (${res.status})`);
    return {
      months: Array.isArray(data.months) ? data.months : [],
      updatedAt: data.updatedAt ?? null,
      updatedByName: data.updatedByName ?? null,
      empty: data.empty === true || !data.months?.length,
    };
  }

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
