import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApiBaseUrl } from '../services/api-client';
import {
  estimateAgendaPosition,
  formatClockLabel,
  parseBoardAgenda,
  rowsLookTimed,
  type BoardAgendaRow,
} from '../lib/boardAgenda';
import { MEETING_HUB_LABEL } from '../types/Event';
import { versionedFileName } from '../lib/cueFileVersions';

type HubDeck = {
  id: string;
  original_name: string;
  versionedName?: string;
  version?: number;
  versionCount?: number;
  mime_type?: string | null;
  size_bytes?: number | null;
};

type PublicHubPayload = {
  event_id: string;
  agenda_text: string;
  agenda_items: BoardAgendaRow[];
  decks: HubDeck[];
};

function deckLabel(deck: HubDeck): string {
  return (
    deck.versionedName ||
    versionedFileName(deck.original_name, deck.version, deck.versionCount) ||
    deck.original_name
  );
}

function deckTitle(deck: HubDeck): string {
  const label = deckLabel(deck);
  return label.replace(/\.(pptx?|pdf)$/i, '');
}

type HubTab = 'control' | 'agenda';

const PublicMeetingHubPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicHubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<HubTab>('control');

  const load = useCallback(async () => {
    if (!token) {
      setError('Missing link token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${getApiBaseUrl().replace(/\/$/, '')}/api/public/meeting-hub/${encodeURIComponent(token)}?t=${Date.now()}`,
        { headers: { Accept: 'application/json' } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not load (${res.status})`);
      const items = Array.isArray(body.agenda_items) ? body.agenda_items : [];
      const parsed = items.length ? items : parseBoardAgenda(body.agenda_text || '');
      setData({
        event_id: body.event_id,
        agenda_text: body.agenda_text || '',
        agenda_items: rowsLookTimed(parsed) ? parsed : items,
        decks: Array.isArray(body.decks) ? body.decks : [],
      });
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Could not load Meeting Hub');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const position = useMemo(
    () => (data ? estimateAgendaPosition(data.agenda_items, now) : null),
    [data, now]
  );

  const nowSubject =
    position?.current?.row.subject ||
    (position?.status === 'before'
      ? 'Not started'
      : position?.status === 'after'
        ? 'Complete'
        : position?.status === 'unknown'
          ? '—'
          : '—');
  const nextSubject = position?.next?.row.subject || '—';

  const openDeck = async (deck: HubDeck) => {
    if (!token) return;
    setOpeningId(deck.id);
    setError('');
    try {
      const res = await fetch(
        `${getApiBaseUrl().replace(/\/$/, '')}/api/public/meeting-hub/${encodeURIComponent(token)}/assets/${encodeURIComponent(deck.id)}/url`,
        { headers: { Accept: 'application/json' } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not open deck');
      window.open(body.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open deck');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-950 text-slate-100 flex flex-col">
      <div className="mx-auto flex h-full w-full max-w-5xl min-h-0 flex-col px-4 pt-4 sm:px-6 sm:pt-5">
        <header className="shrink-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-400/90">
              {MEETING_HUB_LABEL}
            </p>
            <h1 className="mt-0.5 text-xl sm:text-2xl font-bold tracking-tight text-white">
              {tab === 'control' ? 'Launch a deck' : 'Full agenda'}
            </h1>
          </div>
          <div className="shrink-0 rounded-xl border border-slate-700/80 bg-slate-900/80 px-2.5 py-1.5 text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 leading-none">Clock</p>
            <p className="mt-0.5 text-lg sm:text-xl font-semibold tabular-nums text-white leading-none">
              {formatClockLabel(now)}
            </p>
          </div>
        </header>

        <div
          role="tablist"
          aria-label="Meeting Hub views"
          className="mt-3 shrink-0 flex rounded-xl border border-slate-700 bg-slate-900/80 p-1"
        >
          {(
            [
              { id: 'control' as const, label: 'Control' },
              { id: 'agenda' as const, label: 'Agenda' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`flex-1 rounded-lg px-3 py-2.5 text-sm sm:text-base font-semibold touch-manipulation transition ${
                  active
                    ? 'bg-emerald-700 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {error ? (
          <div className="mt-3 shrink-0 rounded-xl border border-red-800/70 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <main className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 [-webkit-overflow-scrolling:touch]">
          {loading ? (
            <p className="py-10 text-center text-slate-400">Loading…</p>
          ) : data ? (
            tab === 'control' ? (
              <section aria-label="PowerPoint decks" role="tabpanel">
                {data.decks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 px-4 py-10 text-center text-slate-400">
                    No PowerPoint decks uploaded yet.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-4 sm:gap-5">
                    {data.decks.map((deck) => {
                      const busy = openingId === deck.id;
                      return (
                        <li key={deck.id}>
                          <button
                            type="button"
                            disabled={!!openingId}
                            onClick={() => void openDeck(deck)}
                            className="group flex w-full min-h-[5.25rem] sm:min-h-[5.75rem] items-center justify-between gap-4 rounded-2xl border-2 border-emerald-700/60 bg-emerald-950/40 px-5 py-4 sm:px-6 sm:py-5 text-left transition active:scale-[0.99] hover:border-emerald-500 hover:bg-emerald-900/50 disabled:opacity-60 touch-manipulation"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
                                PowerPoint{deck.version ? ` · v${deck.version}` : ''}
                              </p>
                              <p className="mt-1 text-lg sm:text-xl font-semibold text-white leading-snug break-words">
                                {deckTitle(deck)}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-xl bg-emerald-600 px-5 py-3.5 text-base font-bold text-white group-hover:bg-emerald-500">
                              {busy ? 'Opening…' : 'Launch'}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : (
              <section aria-label="Full agenda" role="tabpanel">
                {rowsLookTimed(data.agenda_items) ? (
                  <ol className="space-y-1">
                    {data.agenda_items.map((row, i) => {
                      const isCurrent = position?.current?.index === i;
                      const isNext = position?.next?.index === i;
                      return (
                        <li
                          key={`${row.time}-${i}`}
                          className={`flex gap-3 rounded-lg px-2.5 py-2.5 ${
                            isCurrent ? 'bg-amber-950/35' : isNext ? 'bg-sky-950/25' : ''
                          }`}
                        >
                          <span className="shrink-0 w-[5.75rem] sm:w-32 text-xs sm:text-sm tabular-nums text-slate-400">
                            {row.time || '—'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm sm:text-base leading-snug ${
                                isCurrent ? 'font-semibold text-white' : 'text-slate-200'
                              }`}
                            >
                              {row.subject || '—'}
                            </p>
                            {row.info ? (
                              <p className="mt-0.5 text-xs sm:text-sm text-slate-500">{row.info}</p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : data.agenda_text ? (
                  <pre className="whitespace-pre-wrap rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
                    {data.agenda_text}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-400">No agenda yet.</p>
                )}
              </section>
            )
          ) : null}
        </main>

        <footer
          aria-label="Agenda estimate"
          className="shrink-0 border-t border-slate-800 bg-slate-950 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 rounded-lg border border-amber-500/35 bg-amber-950/25 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-400 leading-none">
                Now
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-white leading-tight">
                {nowSubject}
              </p>
            </div>
            <div className="min-w-0 rounded-lg border border-sky-600/35 bg-sky-950/20 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-400 leading-none">
                Next
              </p>
              <p className="mt-1 truncate text-sm font-semibold text-white leading-tight">
                {nextSubject}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PublicMeetingHubPage;
