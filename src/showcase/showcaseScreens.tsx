import React from 'react';
import { ContentReviewDriveShowcaseContent, ContentReviewFollowShowcaseContent } from './MockContentReview';
import { PinNotesShowcaseContent } from './MockPinNotes';
import { AddItemShowcaseContent } from './MockAddItem';
import { AgendaShowcaseContent } from './MockAgendaModal';
import { ClockShowcaseContent } from './MockClock';
import { EventListShowcaseContent } from './MockEventList';
import { GreenRoomShowcaseContent } from './MockGreenRoom';
import { PhotoViewShowcaseContent } from './MockPhotoView';
import { ReportShowcaseContent } from './MockReport';
import { RunOfShowShowcaseContent } from './MockRunOfShow';
import type { ShowcaseScreenMeta } from './showcaseTypes';

export const SHOWCASE_SCREENS: ShowcaseScreenMeta[] = [
  {
    id: 'event-list',
    title: 'Event List',
    subtitle: 'Auto-demo: cursor fills form, Refresh resets loop',
    designWidth: 1280,
    designHeight: 680,
    compactMaxHeight: 240,
    render: () => <EventListShowcaseContent />,
  },
  {
    id: 'agenda',
    title: 'Agenda Import',
    subtitle: 'Upload → document viewer → label → lines → review (10 cues)',
    designWidth: 1280,
    designHeight: 720,
    compactMaxHeight: 260,
    render: () => <AgendaShowcaseContent />,
  },
  {
    id: 'add-item',
    title: 'Add Schedule Item',
    subtitle: 'Auto-demo: add cue + three speakers, then save row',
    designWidth: 1280,
    designHeight: 720,
    compactMaxHeight: 260,
    render: () => <AddItemShowcaseContent />,
  },
  {
    id: 'run-of-show',
    title: 'Run of Show',
    subtitle: 'Follow mode, live timer, full schedule grid (10 cues)',
    designWidth: 1360,
    designHeight: 800,
    compactMaxHeight: 260,
    render: () => <RunOfShowShowcaseContent />,
  },
  {
    id: 'clock',
    title: 'Clock',
    subtitle: 'Follow mode: CUE 1 → CUE 2, rotates layouts on keynote',
    designWidth: 1280,
    designHeight: 720,
    compactMaxHeight: 200,
    render: () => <ClockShowcaseContent />,
  },
  {
    id: 'photo-view',
    title: 'Photo View',
    subtitle: 'Follow mode — active cue + next 2 rows, synced timer',
    designWidth: 1280,
    designHeight: 880,
    compactMaxHeight: 240,
    render: () => <PhotoViewShowcaseContent />,
  },
  {
    id: 'green-room',
    title: 'Green Room',
    subtitle: '9×16 portrait — synced timer, remaining cues in follow list',
    designWidth: 405,
    designHeight: 720,
    compactMaxHeight: 380,
    render: () => <GreenRoomShowcaseContent />,
  },
  {
    id: 'report',
    title: 'Reports / Printouts',
    subtitle: 'Show · Speakers · Condensed — 3 landscape PDF pages',
    designWidth: 1280,
    designHeight: 2280,
    compactMaxHeight: 580,
    render: () => <ReportShowcaseContent />,
  },
  {
    id: 'pin-notes',
    title: 'Notes Popout',
    subtitle: 'Scalable popout — full follow list with private my-notes column',
    designWidth: 1280,
    designHeight: 1400,
    compactMaxHeight: 580,
    render: () => <PinNotesShowcaseContent />,
  },
  {
    id: 'content-review-drive',
    title: 'Content Review — Drive',
    subtitle: 'Drive tour + Edit On demo on CUE 4 (segment save)',
    designWidth: 1280,
    designHeight: 960,
    compactMaxHeight: 300,
    galleryGroup: 'content-review',
    render: () => <ContentReviewDriveShowcaseContent />,
  },
  {
    id: 'content-review-follow',
    title: 'Content Review — Follow',
    subtitle: 'Approve without notes; type notes only on Needs Review cues (3 & 7)',
    designWidth: 1280,
    designHeight: 960,
    compactMaxHeight: 300,
    galleryGroup: 'content-review',
    render: () => <ContentReviewFollowShowcaseContent />,
  },
];

export function getShowcaseScreen(id: string): ShowcaseScreenMeta | undefined {
  return SHOWCASE_SCREENS.find((s) => s.id === id);
}
