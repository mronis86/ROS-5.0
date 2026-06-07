/** Static demo data for marketing mockups — no API, no auth. */

export const DEMO_EVENT = {
  id: 'demo-summit-2026',
  name: 'Annual Leadership Summit',
  date: '2026-06-15',
  location: 'Great Hall',
  numberOfDays: 1,
  timezone: 'America/New_York',
  eventType: 'Staged Production',
  recordStreaming: 'Record',
};

export type DemoScheduleRow = {
  id: number;
  day: number;
  cue: string;
  segmentName: string;
  programType: string;
  shotType: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  startTime: string;
  endTime: string;
  notes: string;
  hasPPT: boolean;
  hasQA: boolean;
  speakersText?: string;
  timerDisplay?: string;
  isPublic?: boolean;
};

export type DemoSpeaker = {
  slot: number;
  fullName: string;
  title: string;
  org: string;
  location: string;
  photoLink?: string;
};

/** Local portrait assets (Unsplash) — bundled under public/showcase/speakers/ */
export const DEMO_SPEAKER_PHOTOS = {
  alexRivera: '/showcase/speakers/alex-rivera.jpg',
  morganLee: '/showcase/speakers/morgan-lee.jpg',
  jordanKim: '/showcase/speakers/jordan-kim.jpg',
  taylorBrooks: '/showcase/speakers/taylor-brooks.jpg',
  rileySantos: '/showcase/speakers/riley-santos.jpg',
  sarahChen: '/showcase/speakers/sarah-chen.jpg',
  jamesOkonkwo: '/showcase/speakers/james-okonkwo.jpg',
  elenaVasquez: '/showcase/speakers/elena-vasquez.jpg',
  marcusWebb: '/showcase/speakers/marcus-webb.jpg',
  priyaSharma: '/showcase/speakers/priya-sharma.jpg',
} as const;

/** Fallback initials avatar when no local photo is set */
export function photoAvatarUrl(fullName: string, seed?: string): string {
  const label = encodeURIComponent(fullName.replace(/\s+/g, '+'));
  const bg = seed ? encodeURIComponent(seed) : '475569';
  return `https://ui-avatars.com/api/?name=${label}&size=128&background=${bg}&color=f8fafc&bold=true&format=png`;
}

type SpeakerInput = Omit<DemoSpeaker, 'photoLink'> & { photo?: string };

export function speakersJson(speakers: SpeakerInput[]): string {
  return JSON.stringify(
    speakers.map((s) => {
      const { photo, ...rest } = s;
      return {
        ...rest,
        photoLink: photo ?? photoAvatarUrl(s.fullName, `spk-${s.slot}`),
      };
    })
  );
}

const speakerJson = (
  slot: number,
  fullName: string,
  title: string,
  org = 'Summit Corp',
  location = 'Podium',
  photo?: string
) =>
  speakersJson([{ slot, fullName, title, org, location, photo }]);

export const DEMO_SCHEDULE: DemoScheduleRow[] = [
  {
    id: 1,
    day: 1,
    cue: 'CUE 1',
    segmentName: 'Welcome & Opening',
    programType: 'PreShow/End',
    shotType: 'Wide',
    durationHours: 0,
    durationMinutes: 5,
    durationSeconds: 0,
    startTime: '9:00 AM',
    endTime: '9:05 AM',
    notes: 'House lights at 50%. Walk-in music.',
    hasPPT: true,
    hasQA: false,
    isPublic: true,
    speakersText: speakerJson(1, 'Alex Rivera', 'Conference Chair', 'Summit Corp', 'Podium', DEMO_SPEAKER_PHOTOS.alexRivera),
  },
  {
    id: 2,
    day: 1,
    cue: 'CUE 2',
    segmentName: 'Keynote — Future of Work',
    programType: 'Podium Transition',
    shotType: 'Medium',
    durationHours: 0,
    durationMinutes: 25,
    durationSeconds: 0,
    startTime: '9:05 AM',
    endTime: '9:30 AM',
    notes: 'Lower third: name + title. Slides on V1.',
    hasPPT: true,
    hasQA: true,
    isPublic: true,
    speakersText: speakersJson([
      { slot: 1, fullName: 'Dr. Morgan Lee', title: 'Chief Innovation Officer', org: 'Summit Corp', location: 'Podium', photo: DEMO_SPEAKER_PHOTOS.morganLee },
      { slot: 2, fullName: 'Jordan Kim', title: 'Program Director', org: 'Summit Corp', location: 'Podium', photo: DEMO_SPEAKER_PHOTOS.jordanKim },
      { slot: 3, fullName: 'Taylor Brooks', title: 'Executive Producer', org: 'Summit Corp', location: 'Seat', photo: DEMO_SPEAKER_PHOTOS.taylorBrooks },
      { slot: 4, fullName: 'Riley Santos', title: 'ASL Interpreter', org: 'Access Services', location: 'Virtual', photo: DEMO_SPEAKER_PHOTOS.rileySantos },
    ]),
  },
  {
    id: 3,
    day: 1,
    cue: 'CUE 3',
    segmentName: 'Panel — Industry Trends',
    programType: 'Panel Transition',
    shotType: 'Two Shot',
    durationHours: 0,
    durationMinutes: 30,
    durationSeconds: 0,
    startTime: '9:30 AM',
    endTime: '10:00 AM',
    notes: '4 panelists + moderator. Lav mics.',
    hasPPT: false,
    hasQA: true,
    isPublic: true,
    speakersText: speakersJson([
      { slot: 1, fullName: 'Sarah Chen', title: 'Conference Moderator', org: 'Summit Corp', location: 'Moderator', photo: DEMO_SPEAKER_PHOTOS.sarahChen },
      { slot: 2, fullName: 'James Okonkwo', title: 'VP Strategy', org: 'TechForward', location: 'Podium', photo: DEMO_SPEAKER_PHOTOS.jamesOkonkwo },
      { slot: 3, fullName: 'Elena Vasquez', title: 'Director of Research', org: 'DataWorks', location: 'Seat', photo: DEMO_SPEAKER_PHOTOS.elenaVasquez },
      { slot: 4, fullName: 'Marcus Webb', title: 'CEO', org: 'InnovateLab', location: 'Podium', photo: DEMO_SPEAKER_PHOTOS.marcusWebb },
      { slot: 5, fullName: 'Priya Sharma', title: 'Industry Analyst', org: 'Global Insights', location: 'Seat', photo: DEMO_SPEAKER_PHOTOS.priyaSharma },
    ]),
  },
  {
    id: 4,
    day: 1,
    cue: 'CUE 4',
    segmentName: 'Break',
    programType: 'Break F&B/B2B',
    shotType: 'Wide',
    durationHours: 0,
    durationMinutes: 15,
    durationSeconds: 0,
    startTime: '10:00 AM',
    endTime: '10:15 AM',
    notes: '',
    hasPPT: false,
    hasQA: false,
    isPublic: true,
  },
  {
    id: 5,
    day: 1,
    cue: 'CUE 5',
    segmentName: 'Awards Presentation',
    programType: 'Full-Stage/Ted-Talk',
    shotType: 'Medium',
    durationHours: 0,
    durationMinutes: 20,
    durationSeconds: 0,
    startTime: '10:15 AM',
    endTime: '10:35 AM',
    notes: 'Pre-recorded open on V2.',
    hasPPT: true,
    hasQA: false,
    isPublic: true,
    speakersText: speakersJson([
      { slot: 1, fullName: 'Jordan Kim', title: 'Program Director', org: 'Summit Corp', location: 'Podium', photo: DEMO_SPEAKER_PHOTOS.jordanKim },
      { slot: 2, fullName: 'Taylor Brooks', title: 'Awards Host', org: 'Summit Corp', location: 'Podium', photo: DEMO_SPEAKER_PHOTOS.taylorBrooks },
    ]),
  },
  {
    id: 6,
    day: 1,
    cue: 'CUE 6',
    segmentName: 'Product Demo — Platform Walkthrough',
    programType: 'Podium Transition',
    shotType: 'Medium',
    durationHours: 0,
    durationMinutes: 30,
    durationSeconds: 0,
    startTime: '10:35 AM',
    endTime: '11:05 AM',
    notes: 'Live demo on confidence monitor.',
    hasPPT: true,
    hasQA: true,
    isPublic: true,
    speakersText: speakerJson(1, 'James Okonkwo', 'VP Strategy', 'TechForward', 'Podium', DEMO_SPEAKER_PHOTOS.jamesOkonkwo),
  },
  {
    id: 7,
    day: 1,
    cue: 'CUE 7',
    segmentName: 'Fireside Chat — Leadership',
    programType: 'Panel Transition',
    shotType: 'Two Shot',
    durationHours: 0,
    durationMinutes: 25,
    durationSeconds: 0,
    startTime: '11:05 AM',
    endTime: '11:30 AM',
    notes: 'Two armchairs, lav mics.',
    hasPPT: false,
    hasQA: true,
    isPublic: true,
    speakersText: speakersJson([
      { slot: 1, fullName: 'Sarah Chen', title: 'Moderator', org: 'Summit Corp', location: 'Moderator', photo: DEMO_SPEAKER_PHOTOS.sarahChen },
      { slot: 2, fullName: 'Marcus Webb', title: 'CEO', org: 'InnovateLab', location: 'Seat', photo: DEMO_SPEAKER_PHOTOS.marcusWebb },
    ]),
  },
  {
    id: 8,
    day: 1,
    cue: 'CUE 8',
    segmentName: 'Lunch Break',
    programType: 'Break F&B/B2B',
    shotType: 'Wide',
    durationHours: 0,
    durationMinutes: 45,
    durationSeconds: 0,
    startTime: '11:30 AM',
    endTime: '12:15 PM',
    notes: '',
    hasPPT: false,
    hasQA: false,
    isPublic: true,
  },
  {
    id: 9,
    day: 1,
    cue: 'CUE 9',
    segmentName: 'Closing Remarks',
    programType: 'PreShow/End',
    shotType: 'Wide',
    durationHours: 0,
    durationMinutes: 15,
    durationSeconds: 0,
    startTime: '12:15 PM',
    endTime: '12:30 PM',
    notes: 'Thank sponsors. House lights up.',
    hasPPT: true,
    hasQA: false,
    isPublic: true,
    speakersText: speakerJson(1, 'Alex Rivera', 'Conference Chair', 'Summit Corp', 'Podium', DEMO_SPEAKER_PHOTOS.alexRivera),
  },
  {
    id: 10,
    day: 1,
    cue: 'CUE 10',
    segmentName: 'Photo Op & End',
    programType: 'PreShow/End',
    shotType: 'Wide',
    durationHours: 0,
    durationMinutes: 10,
    durationSeconds: 0,
    startTime: '12:30 PM',
    endTime: '12:40 PM',
    notes: 'Walk-out music. B-roll capture.',
    hasPPT: false,
    hasQA: false,
    isPublic: true,
  },
];

export const DEMO_EVENTS_LIST = [
  DEMO_EVENT,
  {
    id: 'demo-studio-hit',
    name: 'Studio Hit — Product Launch',
    date: '2026-07-02',
    location: 'Studio A',
    numberOfDays: 1,
    timezone: 'America/New_York',
    eventType: 'Studio Hit',
    recordStreaming: 'Streaming',
  },
  {
    id: 'demo-town-hall',
    name: 'Q3 Town Hall',
    date: '2026-05-20',
    location: 'Virtual',
    numberOfDays: 1,
    timezone: 'America/New_York',
    eventType: 'General Meeting',
    recordStreaming: 'None',
  },
];

/** Full demo schedule length — use for ROS, reports, agenda, TRT, etc. */
export const SHOWCASE_FULL_CUE_COUNT = DEMO_SCHEDULE.length;

/** Public cues used across showcase mocks (full schedule). */
export const SHOWCASE_GREEN_ROOM_MAX_CUES = SHOWCASE_FULL_CUE_COUNT;

export const DEMO_SHOWCASE_VISIBLE_CUES = DEMO_SCHEDULE.filter((r) => r.isPublic !== false).slice(
  0,
  SHOWCASE_GREEN_ROOM_MAX_CUES
);

export const DEMO_ACTIVE_CUE = DEMO_SCHEDULE[1];
export const DEMO_PHOTO_ACTIVE_ID = DEMO_ACTIVE_CUE.id;
/** Rows shown in Photo View showcase (welcome, active keynote, panel). */
export const DEMO_PHOTO_ROWS = DEMO_SCHEDULE.slice(0, 3);
export const DEMO_ACTIVE_DURATION_SEC = DEMO_ACTIVE_CUE.durationMinutes * 60;
export const DEMO_COUNTDOWN_START_SEC = Math.floor(DEMO_ACTIVE_DURATION_SEC * 0.58);

/** Sub-cue + stage message demo (Clock page combined layout). */
export const DEMO_SUB_CUE = {
  cue: 'CUE 2A',
  segmentName: 'Video Roll — Sizzle Reel',
  durationSec: 135,
  startRemainingSec: 98,
};

export const DEMO_STAGE_MESSAGE = 'Please take your seats\nWe begin in two minutes';

export const DEMO_AGENDA_SAMPLES = [
  { id: '1', label: 'time' as const, text: '9:05 AM' },
  { id: '2', label: 'segment' as const, text: 'Keynote — Future of Work' },
  { id: '3', label: 'person' as const, text: 'Dr. Morgan Lee' },
];

export const DEMO_AGENDA_FILE = {
  name: 'Summit_Agenda_Draft.docx',
  sizeKb: 84.2,
};

/** Extracted text lines (matches document viewer content) */
export const DEMO_AGENDA_DOC_LINES = [
  'Annual Leadership Summit — June 15, 2026',
  'Great Hall · Master start 9:00 AM',
  '',
  'Time\tSession\tPresenter',
  '9:00 AM\tWelcome & Opening\tAlex Rivera, Conference Chair',
  '9:05 AM\tKeynote — Future of Work\tDr. Morgan Lee, Chief Innovation Officer',
  '9:30 AM\tPanel — Industry Trends\tSarah Chen (mod.) + 4 panelists',
  '10:00 AM\tBreak\t—',
  '10:15 AM\tAwards Presentation\tJordan Kim & Taylor Brooks',
  '10:35 AM\tProduct Demo — Platform Walkthrough\tJames Okonkwo',
  '11:05 AM\tFireside Chat — Leadership\tSarah Chen (mod.) + Marcus Webb',
  '11:30 AM\tLunch Break\t—',
  '12:15 PM\tClosing Remarks\tAlex Rivera, Conference Chair',
  '12:30 PM\tPhoto Op & End\t—',
];

/** Table rows rendered inside the fake Word document viewer */
export const DEMO_AGENDA_TABLE_ROWS = [
  { time: '9:00 AM', session: 'Welcome & Opening', presenter: 'Alex Rivera, Conference Chair' },
  { time: '9:05 AM', session: 'Keynote — Future of Work', presenter: 'Dr. Morgan Lee, Chief Innovation Officer' },
  { time: '9:30 AM', session: 'Panel — Industry Trends', presenter: 'Sarah Chen (mod.) + 4 panelists' },
  { time: '10:00 AM', session: 'Break', presenter: '—' },
  { time: '10:15 AM', session: 'Awards Presentation', presenter: 'Jordan Kim & Taylor Brooks' },
  { time: '10:35 AM', session: 'Product Demo — Platform Walkthrough', presenter: 'James Okonkwo' },
  { time: '11:05 AM', session: 'Fireside Chat — Leadership', presenter: 'Sarah Chen (mod.) + Marcus Webb' },
  { time: '11:30 AM', session: 'Lunch Break', presenter: '—' },
  { time: '12:15 PM', session: 'Closing Remarks', presenter: 'Alex Rivera, Conference Chair' },
  { time: '12:30 PM', session: 'Photo Op & End', presenter: '—' },
];

/** 1-based line where parsing should start (first timed row) */
export const DEMO_AGENDA_PARSE_START_LINE = 5;

/** Highlights applied in sequence during the auto-demo */
export const DEMO_AGENDA_HIGHLIGHT_STEPS: {
  id: string;
  label: 'time' | 'segment' | 'person';
  text: string;
  rowIndex: number;
  field: 'time' | 'session' | 'presenter';
}[] = [
  { id: 'h1', label: 'time', text: '9:05 AM', rowIndex: 1, field: 'time' },
  { id: 'h2', label: 'segment', text: 'Keynote — Future of Work', rowIndex: 1, field: 'session' },
  { id: 'h3', label: 'person', text: 'Dr. Morgan Lee', rowIndex: 1, field: 'presenter' },
  { id: 'h4', label: 'time', text: '9:30 AM', rowIndex: 2, field: 'time' },
  { id: 'h5', label: 'segment', text: 'Panel — Industry Trends', rowIndex: 2, field: 'session' },
  { id: 'h6', label: 'person', text: 'Sarah Chen', rowIndex: 2, field: 'presenter' },
];

export function formatEventDate(dateString: string) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

export function formatDuration(row: DemoScheduleRow) {
  return `${String(row.durationHours).padStart(2, '0')}:${String(row.durationMinutes).padStart(2, '0')}:${String(row.durationSeconds).padStart(2, '0')}`;
}

/** Parsed rows preview — mirrors showcase-visible cues from demo schedule */
export const DEMO_AGENDA_PARSED_ROWS = DEMO_SHOWCASE_VISIBLE_CUES.map((row, i) => ({
  row: i + 1,
  startTime: row.startTime,
  segmentName: row.segmentName,
  duration: formatDuration(row),
  programType: row.programType,
  speakers: row.speakersText ?? '',
  speakerCount: row.speakersText
    ? (JSON.parse(row.speakersText) as unknown[]).length
    : 0,
}));
