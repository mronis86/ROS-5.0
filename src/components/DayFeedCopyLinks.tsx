import React from 'react';

type CopyFn = (text: string) => void | Promise<void>;

export function listDaysFromSchedule(
  scheduleItems: Array<{ day?: number | string | null }> | null | undefined,
  numberOfDays?: number | null
): number[] {
  const days = new Set<number>();
  for (const item of scheduleItems || []) {
    const d = Number(item?.day ?? 1);
    if (Number.isFinite(d) && d >= 1) days.add(d);
  }
  const settingsDays = Math.max(1, Number(numberOfDays) || 1);
  for (let d = 1; d <= settingsDays; d++) days.add(d);
  if (days.size === 0) days.add(1);
  return [...days].sort((a, b) => a - b);
}

function withDay(url: string, day: number): string {
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}day=${day}`;
}

/**
 * Per-day Copy buttons for multi-day vMix Data Source URLs.
 * Renders nothing when there is only one day.
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
  if (!days || days.length <= 1) return null;

  const rows: { label: string; url: string }[] = [];
  for (const day of days) {
    if (liveCsvUrl) rows.push({ label: `Day ${day} CSV (Railway)`, url: withDay(liveCsvUrl, day) });
    if (liveXmlUrl) rows.push({ label: `Day ${day} XML (Railway)`, url: withDay(liveXmlUrl, day) });
    if (cacheCsvUrl) rows.push({ label: `Day ${day} CSV (Cache)`, url: withDay(cacheCsvUrl, day) });
    if (cacheXmlUrl) rows.push({ label: `Day ${day} XML (Cache)`, url: withDay(cacheXmlUrl, day) });
  }

  return (
    <div className="mt-4 bg-amber-900/25 border border-amber-500/40 rounded p-4">
      <h4 className="font-semibold text-amber-200 mb-1 text-sm">Multi-day {feedLabel} feeds</h4>
      <p className="text-xs text-amber-100/80 mb-3">
        Copy a <strong>Day N</strong> URL into vMix so that Data Source only has that day&apos;s rows
        (row numbers restart at 1). Match the same day in the vMix bridge day filter.
      </p>
      <div className="space-y-2">
        {rows.map(({ label, url }) => (
          <div key={url} className="bg-gray-900/80 p-2.5 rounded border border-amber-500/20 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-amber-200 mb-0.5">{label}</div>
              <code className="text-green-400/90 break-all text-xs">{url}</code>
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
