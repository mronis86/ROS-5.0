import React from 'react';
import type { EventAccessRequestItem } from '../lib/eventAccessRequest';

type EventAccessRequestsBannerProps = {
  requests: EventAccessRequestItem[];
  busyId: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
};

function formatRequestDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const EventAccessRequestsBanner: React.FC<EventAccessRequestsBannerProps> = ({
  requests,
  busyId,
  onApprove,
  onDeny,
}) => {
  if (!requests.length) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-600/60 bg-amber-950/40 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-slate-900">
          {requests.length}
        </span>
        <p className="text-sm font-semibold text-amber-100">
          Event access {requests.length === 1 ? 'request' : 'requests'}
        </p>
      </div>
      <ul className="space-y-2">
        {requests.map((request) => {
          const busy = busyId === request.id;
          const who = request.requesterName || request.requesterEmail || 'User';
          const when = formatRequestDate(request.eventDate);
          return (
            <li
              key={request.id}
              className="flex flex-col gap-2 rounded-md border border-amber-800/50 bg-slate-950/40 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {who}
                  <span className="font-normal text-slate-400"> wants </span>
                  {request.eventName}
                </p>
                <p className="truncate text-[11px] text-slate-400">
                  {request.requesterEmail}
                  {when ? ` · ${when}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onApprove(request.id)}
                  className="min-h-[32px] rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {busy ? 'Saving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeny(request.id)}
                  className="min-h-[32px] rounded-md border border-slate-600 bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-60"
                >
                  Deny
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default EventAccessRequestsBanner;
