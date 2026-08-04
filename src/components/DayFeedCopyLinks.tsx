import React from 'react';

type CopyFn = (text: string) => void | Promise<void>;

export function listDaysFromSchedule(
  scheduleItems: Array<{ day?: number | string | null }> | null | undefined,
  numberOfDays?: number | null
): number[] {
  const days = new Set<number>();
  let maxFromItems = 1;
  for (const item of scheduleItems || []) {
    const d = Number(item?.day ?? 1);
    if (Number.isFinite(d) && d >= 1) {
      days.add(d);
      if (d > maxFromItems) maxFromItems = d;
    }
  }
  const settingsDays = Math.max(1, Number(numberOfDays) || 0);
  const total = Math.max(maxFromItems, settingsDays, 1);
  for (let d = 1; d <= total; d++) days.add(d);
  return [...days].sort((a, b) => a - b);
}

function withDay(url: string, day: number): string {
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}day=${day}`;
}

/**
 * Per-day Copy buttons for vMix Data Source URLs on the VMIX Instructions tab.
 * Always shows at least Day 1–2 so multi-day operators can copy without hunting.
 */
export const DayFeedCopyLinks: React.FC<{
  days: number[];
  /** Base URL already including eventId, e.g. …/schedule.csv?eventId=… */
  liveXmlUrl?: string;
  liveCsvUrl?: string;
  cacheXmlUrl?: string;
  cacheCsvUrl?: string;
  copyToClipboard: CopyFn;
  /** Short label for this feed type, e.g. "Schedule" */
  feedLabel?: string;
}> = ({
  days,
  liveXmlUrl,
  liveCsvUrl,
  cacheXmlUrl,
  cacheCsvUrl,
  copyToClipboard,
  feedLabel = 'Schedule',
}) => {
  const detected = (days || []).filter((d) => Number.isFinite(d) && d >= 1);
  const maxDetected = detected.length ? Math.max(...detected) : 1;
  // Always offer at least Day 1 and Day 2; extend if the schedule has more days.
  const displayDays = Array.from({ length: Math.max(maxDetected, 2) }, (_, i) => i + 1);

  const rows: { label: string; url: string }[] = [];
  for (const day of displayDays) {
    if (liveCsvUrl) rows.push({ label: `Day ${day} · CSV`, url: withDay(liveCsvUrl, day) });
    if (liveXmlUrl) rows.push({ label: `Day ${day} · XML`, url: withDay(liveXmlUrl, day) });
    if (cacheCsvUrl) rows.push({ label: `Day ${day} · CSV (cache)`, url: withDay(cacheCsvUrl, day) });
    if (cacheXmlUrl) rows.push({ label: `Day ${day} · XML (cache)`, url: withDay(cacheXmlUrl, day) });
  }

  return (
    <div className="bg-amber-900/30 border border-amber-500/50 rounded-lg p-4">
      <h3 className="font-semibold text-amber-200 mb-1">Multi-day {feedLabel} URLs</h3>
      <p className="text-xs text-amber-100/90 mb-3">
        For multi-day shows, copy a <strong>Day N</strong> URL into vMix Data Sources so that table
        only has that day&apos;s rows (rows restart at 1). Set the vMix bridge day filter to the same day.
        Single-day shows can keep using the full URLs below.
      </p>
      <div className="space-y-2">
        {rows.map(({ label, url }) => (
          <div
            key={url}
            className="bg-gray-900/80 p-2.5 rounded border border-amber-500/25 flex items-center justify-between gap-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-amber-200 mb-0.5">{label}</div>
              <code className="text-green-400 break-all text-xs">{url}</code>
            </div>
            <button
              type="button"
              onClick={() => void copyToClipboard(url)}
              className="shrink-0 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-colors"
            >
              Copy
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DayFeedCopyLinks;
