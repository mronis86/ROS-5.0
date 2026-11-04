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
    weeks: [],
    emptyMessage: 'October draft next — send notes after September is locked.',
  },
  {
    id: '2026-11',
    label: 'November 2026',
    weeks: [],
    emptyMessage: 'November draft after October.',
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
