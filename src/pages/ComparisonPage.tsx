import React, { useEffect, useState } from 'react';
import ShowcaseGallery from '../showcase/ShowcaseGallery';

type Support = 'yes' | 'partial' | 'no';

type FeatureRow = {
  group: string;
  feature: string;
  sheets: Support;
  ontime: Support;
  ros: Support;
};

const FEATURES: FeatureRow[] = [
  { group: 'Schedule', feature: 'Cue list / run of show', sheets: 'yes', ontime: 'no', ros: 'yes' },
  { group: 'Schedule', feature: 'Segment, duration, notes columns', sheets: 'yes', ontime: 'no', ros: 'yes' },
  { group: 'Schedule', feature: 'Auto start times from show start', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Schedule', feature: 'Multi-day events', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Schedule', feature: 'Breakouts / indented cues', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Schedule', feature: 'Custom columns', sheets: 'yes', ontime: 'no', ros: 'yes' },
  { group: 'Schedule', feature: 'Excel / agenda import', sheets: 'partial', ontime: 'no', ros: 'yes' },

  { group: 'Timers', feature: 'Countdown on confidence monitor', sheets: 'no', ontime: 'yes', ros: 'yes' },
  { group: 'Timers', feature: 'Load cue duration before start', sheets: 'no', ontime: 'yes', ros: 'yes' },
  { group: 'Timers', feature: 'Start / stop / reset', sheets: 'no', ontime: 'yes', ros: 'yes' },
  { group: 'Timers', feature: 'Timer linked to schedule row', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Timers', feature: 'Sub-cue / secondary timer', sheets: 'no', ontime: 'partial', ros: 'yes' },
  { group: 'Timers', feature: 'Stage messages on timer screen', sheets: 'no', ontime: 'partial', ros: 'yes' },
  { group: 'Timers', feature: 'Overtime tracking', sheets: 'no', ontime: 'partial', ros: 'yes' },
  { group: 'Timers', feature: 'Quick ad-hoc timers', sheets: 'no', ontime: 'yes', ros: 'yes' },

  { group: 'Sync', feature: 'Everyone sees same schedule live', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Sync', feature: 'Everyone sees same timer state live', sheets: 'no', ontime: 'partial', ros: 'yes' },
  { group: 'Sync', feature: 'Viewer / Editor / Operator roles', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Sync', feature: 'Change log / who edited what', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Sync', feature: 'Works over the internet (cloud)', sheets: 'yes', ontime: 'no', ros: 'yes' },
  { group: 'Sync', feature: 'Local network only (no cloud)', sheets: 'partial', ontime: 'yes', ros: 'partial' },

  { group: 'Graphics', feature: 'Lower thirds data feed', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Graphics', feature: 'vMix XML / CSV URLs', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Graphics', feature: 'Apps Script custom exports', sheets: 'yes', ontime: 'no', ros: 'partial' },
  { group: 'Graphics', feature: 'Push data to Google Sheet', sheets: 'yes', ontime: 'no', ros: 'yes' },

  { group: 'Production', feature: 'Green room (now / next)', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Production', feature: 'Photo / slide cue view', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Production', feature: 'Content review', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Production', feature: 'Companion / OSC timer control', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Production', feature: 'Reports / Printouts', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Production', feature: 'Teleprompter / scripts follow', sheets: 'no', ontime: 'no', ros: 'yes' },

  { group: 'Resolume', feature: 'Companion controls', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Resolume', feature: 'Media file time extraction', sheets: 'no', ontime: 'no', ros: 'yes' },

  { group: 'Mobile', feature: 'Phone-friendly event list', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Mobile', feature: 'Phone-friendly run of show', sheets: 'no', ontime: 'no', ros: 'yes' },
];

const GROUPS = [...new Set(FEATURES.map((f) => f.group))];

/** Headline improvements ROS 5.0 delivers vs Sheets + OnTime together. */
const TOP_ROS_IMPROVEMENTS: { title: string; detail: string }[] = [
  {
    title: 'Dedicated web platform & database',
    detail:
      'Each event’s run of show lives in a cloud database — not scattered spreadsheet tabs — so the whole team pulls from one synced source of truth.',
  },
  {
    title: 'Universal countdown timers',
    detail:
      'Web-based stage timers sync across every user, browser, and display (Clock, Green Room, Photo View) — not a separate LAN-only timer app.',
  },
  {
    title: 'Real-time schedule feedback',
    detail:
      'See overtime or minutes ahead of schedule as cues run — cumulative show delay and per-cue variance, not manual mental math.',
  },
  {
    title: 'Instant graphics data feeds',
    detail:
      'Live XML/CSV/Sheet URLs push updated lower-thirds and outboard graphics text the moment the ROS changes — no re-export or refresh scripts.',
  },
  {
    title: 'Content review & asset tracking',
    detail:
      'A purpose-built system to confirm design files and assets — with synchronized content review so producers, graphics, and show callers all see the same status on every cue.',
  },
  {
    title: 'Resolume TRT from media files',
    detail:
      'Extract total run time from Resolume clip/media files and sync duration back to the cue — built for show-floor Resolume workflows.',
  },
  {
    title: 'Headshot & image URL handling',
    detail:
      'Extract and use image URLs from your data more reliably than spreadsheet formulas and cell limits — built for headshots and photo views on confidence monitors, tablets, and backstage displays.',
  },
  {
    title: 'Agenda import, duplication & backups',
    detail:
      'AI agenda extraction, duplicate events for rehearsals, Neon backups, and change history — less manual rebuild between shows.',
  },
  {
    title: 'Mobile-friendly run of show',
    detail:
      'Phone and tablet layouts for the event list and ROS grid — usable on the floor, not just at a desktop.',
  },
  {
    title: 'Customizable & integration-ready',
    detail:
      'Custom columns, personalized notes, offline mode, and the ability to push or pull data from any IoT platform or tool you want to integrate with — Companion/OSC, vMix, Google Sheets, and more.',
  },
];

type SystemId = 'sheets' | 'ontime' | 'ros';

/** Accent colors only — kept away from checkmark greens (yes) and ambers (partial). */
const SYSTEM_STYLES: Record<
  SystemId,
  {
    shortLabel: string;
    accent: string;
  }
> = {
  sheets: {
    shortLabel: 'Sheets',
    accent: '#0891B2', // cyan — distinct from yes/partial checkmarks and other columns
  },
  ontime: {
    shortLabel: 'OnTime',
    accent: '#E11D48', // timer red (not orange/amber)
  },
  ros: {
    shortLabel: 'ROS',
    accent: '#A855F7', // purple — clear of yes/partial/no markers
  },
};

type ComparisonTab = 'top10' | 'compare' | 'screens';

const COMPARISON_TABS: { id: ComparisonTab; label: string; hint: string }[] = [
  { id: 'top10', label: 'Top 10', hint: 'Key ROS improvements' },
  { id: 'compare', label: 'Full comparison', hint: 'Overview + feature checklist' },
  { id: 'screens', label: 'Screens', hint: 'Mini UI previews' },
];

const ComparisonPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ComparisonTab>('top10');

  useEffect(() => {
    document.title = 'ROS vs Sheets + OnTime · Comparison';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-200 py-10">
      <div className={`mx-auto px-4 sm:px-6 ${activeTab === 'screens' ? 'max-w-6xl' : 'max-w-4xl'}`}>
        <header className="mb-8 space-y-3 text-center">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">What we had vs ROS 5.0</h1>
          <p className="mx-auto max-w-2xl text-sm text-slate-400">
            Our old setup was Sheets + OnTime — two separate tools. ROS combines most of it in one place.
          </p>
        </header>

        <div className="mb-8 flex justify-center">
          <div
            className="inline-grid w-full max-w-2xl grid-cols-3 gap-1 rounded-2xl border border-slate-700/80 bg-slate-950/60 p-1.5 shadow-inner"
            role="tablist"
            aria-label="Comparison sections"
          >
            {COMPARISON_TABS.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-xl px-4 py-3 text-center transition-all duration-200 ${
                    selected
                      ? 'text-white shadow-md ring-1 ring-slate-600/80'
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                  style={
                    selected
                      ? {
                          backgroundColor:
                            tab.id === 'top10'
                              ? 'rgba(168, 85, 247, 0.22)'
                              : tab.id === 'screens'
                                ? 'rgba(6, 182, 212, 0.15)'
                                : 'rgb(51 65 85 / 0.9)',
                          boxShadow:
                            tab.id === 'top10'
                              ? 'inset 0 -2px 0 0 rgba(168, 85, 247, 0.8)'
                              : tab.id === 'screens'
                                ? 'inset 0 -2px 0 0 #0891B2'
                                : 'inset 0 -2px 0 0 #0891B2',
                        }
                      : undefined
                  }
                >
                  <span className="block text-sm font-semibold tracking-tight">{tab.label}</span>
                  <span className={`mt-1 block text-[11px] leading-snug ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {tab.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === 'top10' && <TopTenPanel />}
        {activeTab === 'compare' && <ComparePanel />}
        {activeTab === 'screens' && <ShowcaseGallery />}
      </div>
    </div>
  );
};

function TopTenPanel() {
  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 sm:p-6 shadow-lg"
      role="tabpanel"
      aria-label="Top 10"
    >
      <div className="mb-8 text-center">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Top 10 — what ROS improves</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          Highlights vs our previous Sheets + OnTime setup. Switch to{' '}
          <strong className="font-medium text-slate-300">Full comparison</strong> for the overview and checklist.
        </p>
      </div>
      <ol className="mx-auto max-w-2xl space-y-5">
        {TOP_ROS_IMPROVEMENTS.map((item, index) => (
          <li key={item.title} className="flex gap-4">
            <span
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums"
              style={{
                color: SYSTEM_STYLES.ros.accent,
                backgroundColor: 'rgba(168, 85, 247, 0.12)',
                border: `1px solid rgba(168, 85, 247, 0.35)`,
              }}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <h3 className="text-sm font-semibold text-slate-100 sm:text-base">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-400 sm:text-sm">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ComparePanel() {
  return (
    <div role="tabpanel" aria-label="Full comparison" className="space-y-8">
      <section>
        <h2 className="text-lg font-bold text-white mb-4">Overview</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <SystemCard
            system="sheets"
            title="Google Sheets"
            subtitle="Spreadsheet + Apps Script"
            bullets={[
              'Schedule lives in rows and columns',
              'Formulas for times; tabs for extra days',
              'Apps Script adds custom exports & automation',
              'Not really built for phone use',
            ]}
          />
          <SystemCard
            system="ontime"
            title="OnTime"
            subtitle="Local network only"
            bullets={[
              'Timer software on the show LAN',
              'Countdown on a local display',
              'Load duration, start, stop manually',
              'Not linked to the spreadsheet automatically',
            ]}
          />
          <SystemCard
            system="ros"
            title="ROS 5.0"
            subtitle="Browser app (cloud)"
            bullets={[
              'Schedule + timers in one app',
              'Mobile event list & run of show layouts',
              'Live sync to Clock & other pages',
              'Resolume: Companion controls & media file times',
              'Can still export to Google Sheets',
            ]}
          />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          <strong style={{ color: SYSTEM_STYLES.sheets.accent }}>Sheets + Apps Script</strong> = spreadsheet first;
          scripts add the extra pieces.{' '}
          <strong style={{ color: SYSTEM_STYLES.ontime.accent }}>OnTime</strong> = timers on the local network only
          — separate from the sheet. <strong style={{ color: SYSTEM_STYLES.ros.accent }}>ROS</strong> = schedule and
          timers stay in sync for everyone online.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-white mb-3">Feature checklist</h2>
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <LegendItem support="yes" label="Yes" />
          <LegendItem support="partial" label="Partial / manual" />
          <LegendItem support="no" label="No" />
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80 shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-950/90 text-left">
                  <th className="px-4 py-3 font-semibold text-white">Feature</th>
                  {(['sheets', 'ontime', 'ros'] as SystemId[]).map((system) => (
                    <th
                      key={system}
                      className="w-28 border-l border-slate-800 px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide"
                      style={{
                        color: SYSTEM_STYLES[system].accent,
                        boxShadow: `inset 0 -3px 0 0 ${SYSTEM_STYLES[system].accent}`,
                      }}
                    >
                      {SYSTEM_STYLES[system].shortLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GROUPS.map((group) => (
                  <React.Fragment key={group}>
                    <tr className="bg-slate-800/60">
                      <td colSpan={4} className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        {group}
                      </td>
                    </tr>
                    {FEATURES.filter((f) => f.group === group).map((row) => (
                      <tr key={row.feature} className="border-t border-slate-800/80 hover:bg-slate-800/30">
                        <td className="px-4 py-2.5 text-slate-200">{row.feature}</td>
                        <td className="px-2 py-2.5 text-center">
                          <CheckCell support={row.sheets} />
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <CheckCell support={row.ontime} />
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <CheckCell support={row.ros} />
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function CheckCell({ support }: { support: Support }) {
  if (support === 'yes') {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-950/80 text-emerald-400"
        title="Yes"
        aria-label="Yes"
      >
        ✓
      </span>
    );
  }
  if (support === 'partial') {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-950/60 text-amber-400 text-xs font-bold"
        title="Partial or manual"
        aria-label="Partial"
      >
        ~
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-800/80 text-slate-600"
      title="No"
      aria-label="No"
    >
      —
    </span>
  );
}

function LegendItem({ support, label }: { support: Support; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CheckCell support={support} />
      {label}
    </span>
  );
}

function SystemCard({
  system,
  title,
  subtitle,
  bullets,
}: {
  system: SystemId;
  title: string;
  subtitle: string;
  bullets: string[];
}) {
  const accent = SYSTEM_STYLES[system].accent;
  return (
    <div
      className="rounded-xl border border-slate-700 bg-slate-900/90 p-4 pl-3"
      style={{ borderLeftWidth: 4, borderLeftColor: accent }}
    >
      <h2 className="text-base font-bold" style={{ color: accent }}>
        {title}
      </h2>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{subtitle}</p>
      <ul className="space-y-1.5 text-xs leading-snug text-slate-400">
        {bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="text-slate-600">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ComparisonPage;
