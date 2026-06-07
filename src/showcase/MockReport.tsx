import React from 'react';
import {
  DEMO_EVENT,
  DEMO_SHOWCASE_VISIBLE_CUES,
  SHOWCASE_FULL_CUE_COUNT,
  formatDuration,
  formatEventDate,
  type DemoScheduleRow,
} from './demoData';
import {
  formatSpeakerLocation,
  getSpeakerForSlot,
  parseSpeakers,
  truncateText,
  type ParsedSpeaker,
} from './photoShowcaseHelpers';
import { PROGRAM_TYPE_COLORS } from './showcaseConstants';

const REPORT_ROWS = DEMO_SHOWCASE_VISIBLE_CUES;
/** Same 7 slots as Photo View mock */
const SPEAKER_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

type ReportKind = 'showfile' | 'speakers' | 'condensed';

const REPORT_META: Record<
  ReportKind,
  { title: string; subtitle: string; color: string; footer: string }
> = {
  showfile: {
    title: 'ROS SHOW',
    subtitle: `Section layout · ${SHOWCASE_FULL_CUE_COUNT} cues`,
    color: '#2563eb',
    footer: 'ROS Show File',
  },
  speakers: {
    title: 'ROS SPEAKERS',
    subtitle: `Participants & slots · ${SHOWCASE_FULL_CUE_COUNT} cues`,
    color: '#ea580c',
    footer: 'ROS Speakers Report',
  },
  condensed: {
    title: 'ROS CONDENSED',
    subtitle: `Full table · ${SHOWCASE_FULL_CUE_COUNT} cues`,
    color: '#059669',
    footer: 'ROS Condensed Report',
  },
};

function pptQaLabel(row: DemoScheduleRow): string {
  if (row.hasPPT && row.hasQA) return 'PPT + Q&A';
  if (row.hasPPT) return 'PPT';
  if (row.hasQA) return 'Q&A';
  return 'None';
}

function programBadgeStyle(programType: string): React.CSSProperties {
  const bg = PROGRAM_TYPE_COLORS[programType] || '#366092';
  const light = programType === 'Sub Cue';
  return {
    backgroundColor: bg,
    color: light ? '#000' : '#fff',
    border: light ? '1px solid #000' : undefined,
  };
}

/** Speaker cell — same photos as Photo View, sized for print */
function ReportSpeakerCell({ speaker, xs }: { speaker: ParsedSpeaker; xs?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center py-0.5">
      <img
        src={speaker.photoLink || '/speaker-placeholder.svg'}
        alt={speaker.fullName}
        className={`rounded object-cover border border-slate-400 bg-slate-100 ${
          xs ? 'w-8 h-10' : 'w-10 h-[52px]'
        }`}
        style={{ objectFit: 'cover', objectPosition: 'center top' }}
        onError={(e) => {
          e.currentTarget.onerror = null;
          e.currentTarget.src = '/speaker-placeholder.svg';
        }}
      />
      <div className={`font-bold leading-tight mt-0.5 line-clamp-2 ${xs ? 'text-[7px]' : 'text-[8px]'}`}>
        {speaker.fullName}
      </div>
      {!xs && (
        <div className="text-[7px] text-slate-500 leading-none mt-0.5">
          {formatSpeakerLocation(speaker.location)}
        </div>
      )}
    </div>
  );
}

function rowHasSpeakers(row: DemoScheduleRow): boolean {
  return parseSpeakers(row.speakersText).length > 0;
}

function ShowFileSectionNoSpeakers({ row }: { row: DemoScheduleRow }) {
  const headerBg = PROGRAM_TYPE_COLORS[row.programType] || '#366092';

  return (
    <div className="border border-black text-[10px] leading-snug w-full">
      <div
        className="px-2 py-1 font-semibold border-b border-black flex items-center justify-between gap-2"
        style={{ backgroundColor: headerBg, color: row.programType === 'Sub Cue' ? '#000' : '#fff' }}
      >
        <span className="truncate">
          {row.cue} — {row.segmentName}
        </span>
        <span className="shrink-0 opacity-90">
          {row.startTime} · {formatDuration(row)}
        </span>
      </div>
      <div className="p-1.5 bg-white text-[10px] text-slate-700">
        {row.shotType} · {pptQaLabel(row)}
        {row.notes ? ` · ${truncateText(row.notes, 80)}` : ''}
      </div>
    </div>
  );
}

function ShowFileSectionWithSpeakers({ row }: { row: DemoScheduleRow }) {
  const headerBg = PROGRAM_TYPE_COLORS[row.programType] || '#366092';

  return (
    <div className="border border-black text-[10px] leading-snug w-full">
      <div
        className="px-2 py-1 font-semibold border-b border-black"
        style={{ backgroundColor: headerBg, color: row.programType === 'Sub Cue' ? '#000' : '#fff' }}
      >
        {row.cue} — {row.segmentName}
      </div>
      <table className="w-full border-collapse bg-white table-fixed">
        <tbody>
          <tr>
            <td className="border border-black bg-slate-200 p-1.5 w-[76px] align-top text-center">
              <div className="font-bold">{row.cue}</div>
              <div
                className="inline-block px-1 py-0.5 rounded text-[9px] mt-0.5"
                style={programBadgeStyle(row.programType)}
              >
                {row.programType.split('/')[0]}
              </div>
              <div className="mt-1 text-[9px]">
                <div>{row.startTime}</div>
                <div>{formatDuration(row)}</div>
              </div>
            </td>
            <td className="border border-black p-1.5 align-top w-[100px]">
              <div className="font-semibold text-[10px]">{truncateText(row.segmentName, 24)}</div>
              <div className="text-[9px] text-slate-600 mt-0.5">
                {row.shotType} · {pptQaLabel(row)}
              </div>
            </td>
            <td className="border border-black p-1.5 align-top bg-slate-100">
              <div className="text-[9px] text-slate-700 line-clamp-3">{row.notes || '—'}</div>
            </td>
            {SPEAKER_SLOTS.map((slot) => {
              const sp = getSpeakerForSlot(row.speakersText, slot);
              return (
                <td key={slot} className="border border-black p-0.5 align-top bg-slate-50 w-[58px]">
                  {sp ? <ReportSpeakerCell speaker={sp} xs /> : <span className="text-slate-300 text-[8px] block text-center pt-4">—</span>}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ShowFileReport() {
  return (
    <div className="flex flex-col gap-1 w-full">
      {REPORT_ROWS.map((row) =>
        rowHasSpeakers(row) ? (
          <ShowFileSectionWithSpeakers key={row.id} row={row} />
        ) : (
          <ShowFileSectionNoSpeakers key={row.id} row={row} />
        )
      )}
    </div>
  );
}

function SpeakersReport() {
  return (
    <div className="border-2 border-black text-[10px] w-full overflow-hidden">
      <table className="w-full border-collapse bg-white table-fixed">
        <thead>
          <tr className="bg-slate-300 text-[9px]">
            <th className="border border-black p-1 w-[52px]">CUE</th>
            <th className="border border-black p-1 w-[56px]">TIME</th>
            <th className="border border-black p-1 w-[88px]">SEGMENT</th>
            <th className="border border-black p-1">PARTICIPANTS</th>
            {SPEAKER_SLOTS.map((n) => (
              <th key={n} className="border border-black p-0.5 w-[52px] font-bold">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REPORT_ROWS.map((row) => {
            const speakers = parseSpeakers(row.speakersText);
            return (
              <tr key={row.id}>
                <td className="border border-black p-1 align-top font-bold bg-blue-50/40 text-[9px]">{row.cue}</td>
                <td className="border border-black p-1 align-top text-[9px] whitespace-nowrap">{row.startTime}</td>
                <td className="border border-black p-1 align-top font-medium text-[9px]">
                  {truncateText(row.segmentName, 18)}
                </td>
                <td className="border border-black p-1 align-top bg-slate-50 text-[8px] leading-snug">
                  {speakers.length === 0
                    ? '—'
                    : speakers.map((s) => (
                        <div key={s.slot} className="mb-0.5 last:mb-0 truncate">
                          <strong>
                            {(s.location === 'Seat' ? 'S' : s.location === 'Virtual' ? 'V' : s.location === 'Moderator' ? 'M' : 'P')}
                            {s.slot} {s.fullName}
                          </strong>
                        </div>
                      ))}
                </td>
                {SPEAKER_SLOTS.map((slot) => {
                  const sp = getSpeakerForSlot(row.speakersText, slot);
                  return (
                    <td key={slot} className="border border-black p-0.5 align-top text-center">
                      {sp ? <ReportSpeakerCell speaker={sp} xs /> : <span className="text-slate-300 text-[8px]">—</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CondensedReport() {
  return (
    <div className="border-2 border-black text-[10px] w-full overflow-hidden">
      <table className="w-full border-collapse bg-white">
        <thead>
          <tr className="bg-slate-800 text-white text-[10px]">
            <th className="border border-slate-600 p-1.5 text-left w-12">CUE</th>
            <th className="border border-slate-600 p-1.5 text-left w-14">START</th>
            <th className="border border-slate-600 p-1.5 text-left w-12">DUR</th>
            <th className="border border-slate-600 p-1.5 text-left">SEGMENT</th>
            <th className="border border-slate-600 p-1.5 text-left w-16">TYPE</th>
            <th className="border border-slate-600 p-1.5 text-left">SPEAKERS</th>
          </tr>
        </thead>
        <tbody>
          {REPORT_ROWS.map((row, i) => {
            const speakers = parseSpeakers(row.speakersText);
            return (
              <tr key={row.id} className={i % 2 === 0 ? 'bg-slate-50' : 'bg-white'}>
                <td className="border border-slate-400 p-1.5 font-bold align-top">{row.cue}</td>
                <td className="border border-slate-400 p-1.5 align-top whitespace-nowrap">{row.startTime}</td>
                <td className="border border-slate-400 p-1.5 align-top font-mono whitespace-nowrap text-[9px]">
                  {formatDuration(row)}
                </td>
                <td className="border border-slate-400 p-1.5 align-top">{truncateText(row.segmentName, 26)}</td>
                <td className="border border-slate-400 p-1.5 align-top">
                  <span
                    className="inline-block px-1 py-0.5 rounded text-[8px] text-white"
                    style={{ backgroundColor: PROGRAM_TYPE_COLORS[row.programType] || '#64748b' }}
                  >
                    {row.programType.split('/')[0]}
                  </span>
                </td>
                <td className="border border-slate-400 p-1.5 align-top">
                  {speakers.length === 0 ? (
                    '—'
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {speakers.map((s) => (
                        <div key={s.slot} className="flex items-center gap-1 max-w-[120px]">
                          <img
                            src={s.photoLink || '/speaker-placeholder.svg'}
                            alt={s.fullName}
                            className="w-7 h-9 object-cover rounded border border-slate-400 shrink-0"
                            style={{ objectFit: 'cover', objectPosition: 'center top' }}
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = '/speaker-placeholder.svg';
                            }}
                          />
                          <span className="text-[8px] leading-tight font-medium">{truncateText(s.fullName, 16)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PdfPage({
  kind,
  pageNum,
  children,
}: {
  kind: ReportKind;
  pageNum: number;
  children: React.ReactNode;
}) {
  const meta = REPORT_META[kind];

  return (
    <div
      className="w-full bg-white text-slate-900 overflow-hidden flex flex-col"
      style={{
        boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.15)',
      }}
    >
      <div className="px-6 py-2.5 text-white" style={{ backgroundColor: meta.color }}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xl font-bold tracking-wide leading-tight">{meta.title}</div>
            <div className="text-xs mt-0.5 opacity-90">{meta.subtitle}</div>
          </div>
          <div className="text-right shrink-0 opacity-90 text-xs">
            <div className="font-semibold uppercase tracking-wide">Landscape</div>
            <div className="font-bold mt-0.5">Page {pageNum} / 3</div>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 flex-1 flex flex-col">
        <div className="border-b border-slate-800 pb-2 mb-3 shrink-0">
          <div className="text-base font-bold">{DEMO_EVENT.name}</div>
          <div className="text-xs text-slate-600 mt-0.5">
            {DEMO_EVENT.location} · {formatEventDate(DEMO_EVENT.date)} · {REPORT_ROWS.length} cues · Master 9:00 AM
          </div>
        </div>

        <div className="flex-1">{children}</div>
      </div>

      <div className="px-6 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 flex justify-between shrink-0">
        <span>
          {meta.footer} · {REPORT_ROWS.length} cues
        </span>
        <span>{DEMO_EVENT.name}</span>
      </div>
    </div>
  );
}

export const ReportShowcaseContent: React.FC = () => (
  <div className="w-full min-h-full bg-[#64748b] py-6 px-4">
    <div className="flex flex-col gap-8 w-full max-w-[1240px] mx-auto">
      <PdfPage kind="showfile" pageNum={1}>
        <ShowFileReport />
      </PdfPage>

      <PdfPage kind="speakers" pageNum={2}>
        <SpeakersReport />
      </PdfPage>

      <PdfPage kind="condensed" pageNum={3}>
        <CondensedReport />
      </PdfPage>
    </div>
  </div>
);
