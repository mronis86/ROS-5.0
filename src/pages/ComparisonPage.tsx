import React, { useEffect } from 'react';

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
  { group: 'Production', feature: 'Reports / export after show', sheets: 'partial', ontime: 'no', ros: 'yes' },
  { group: 'Production', feature: 'Teleprompter / scripts follow', sheets: 'no', ontime: 'no', ros: 'yes' },

  { group: 'Resolume', feature: 'Companion controls', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Resolume', feature: 'Media file time extraction', sheets: 'no', ontime: 'no', ros: 'yes' },

  { group: 'Mobile', feature: 'Phone-friendly event list', sheets: 'no', ontime: 'no', ros: 'yes' },
  { group: 'Mobile', feature: 'Phone-friendly run of show', sheets: 'no', ontime: 'no', ros: 'yes' },
];

const GROUPS = [...new Set(FEATURES.map((f) => f.group))];

const ComparisonPage: React.FC = () => {
  useEffect(() => {
    document.title = 'ROS vs Sheets + OnTime · Comparison';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-slate-200 py-10">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <header className="mb-8 space-y-3">
          <h1 className="text-2xl font-bold text-white">What we had vs ROS 5.0</h1>
          <p className="text-sm text-slate-400">
            Simple checklist — what each tool could do. Our old setup was two separate tools; ROS combines most of it in
            one place.
          </p>
        </header>

        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <SystemCard
            title="Google Sheets"
            subtitle="Spreadsheet + Apps Script"
            tone="amber"
            bullets={[
              'Schedule lives in rows and columns',
              'Formulas for times; tabs for extra days',
              'Apps Script adds custom exports & automation',
              'Not really built for phone use',
            ]}
          />
          <SystemCard
            title="OnTime"
            subtitle="Local network only"
            tone="slate"
            bullets={[
              'Timer software on the show LAN',
              'Countdown on a local display',
              'Load duration, start, stop manually',
              'Not linked to the spreadsheet automatically',
            ]}
          />
          <SystemCard
            title="ROS 5.0"
            subtitle="Browser app (cloud)"
            tone="cyan"
            bullets={[
              'Schedule + timers in one app',
              'Mobile event list & run of show layouts',
              'Live sync to Clock & other pages',
              'Resolume: Companion controls & media file times',
              'Can still export to Google Sheets',
            ]}
          />
        </div>

        <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-400">
          <LegendItem support="yes" label="Yes" />
          <LegendItem support="partial" label="Partial / manual" />
          <LegendItem support="no" label="No" />
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80 shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-950/80 text-left">
                  <th className="px-4 py-3 font-semibold text-white">Feature</th>
                  <th className="w-28 px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-amber-300/90">
                    Sheets
                  </th>
                  <th className="w-28 px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    OnTime
                  </th>
                  <th className="w-28 px-2 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-cyan-300/90">
                    ROS
                  </th>
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

        <p className="mt-6 text-xs leading-relaxed text-slate-500">
          <strong className="text-slate-400">Sheets + Apps Script</strong> = spreadsheet first; scripts add the extra
          pieces. <strong className="text-slate-400">OnTime</strong> = timers on the local network only — separate from
          the sheet. <strong className="text-slate-400">ROS</strong> = schedule and timers stay in sync for everyone
          online. Edit this list in <code className="text-slate-400">src/pages/ComparisonPage.tsx</code>.
        </p>
      </div>
    </div>
  );
};

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
  title,
  subtitle,
  tone,
  bullets,
}: {
  title: string;
  subtitle: string;
  tone: 'amber' | 'slate' | 'cyan';
  bullets: string[];
}) {
  const border =
    tone === 'amber' ? 'border-amber-700/40' : tone === 'cyan' ? 'border-cyan-700/40' : 'border-slate-600';
  const accent =
    tone === 'amber' ? 'text-amber-300' : tone === 'cyan' ? 'text-cyan-300' : 'text-slate-300';
  return (
    <div className={`rounded-xl border ${border} bg-slate-900/60 p-4`}>
      <h2 className={`text-base font-bold ${accent}`}>{title}</h2>
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
