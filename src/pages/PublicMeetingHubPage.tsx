import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApiBaseUrl } from '../services/api-client';
import { parseBoardAgenda, rowsLookTimed, type BoardAgendaRow } from '../lib/boardAgenda';
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

const PublicMeetingHubPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicHubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);

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
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 text-slate-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10 space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/90">{MEETING_HUB_LABEL}</p>
          <h1 className="mt-1 text-2xl font-bold text-white tracking-tight">Public web control</h1>
          <p className="mt-2 text-sm text-slate-400">
            Shared from this event’s Meeting Hub. View the agenda and open current PowerPoint decks. On the room PC,
            use PowerPoint Bridge → Meeting Hub to launch the same decks.
          </p>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-800/70 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : data ? (
          <>
            <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <h2 className="text-sm font-semibold text-white">Agenda</h2>
              {rowsLookTimed(data.agenda_items) ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-700">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-800 text-[11px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-semibold w-[9.5rem]">Times</th>
                        <th className="px-3 py-2 font-semibold">Subject</th>
                        <th className="px-3 py-2 font-semibold">Info</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.agenda_items.map((row, i) => (
                        <tr key={`${row.time}-${i}`} className="border-t border-slate-700/80">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-200">{row.time || '—'}</td>
                          <td className="px-3 py-2 text-slate-100">{row.subject || ''}</td>
                          <td className="px-3 py-2 text-slate-400">{row.info || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : data.agenda_text ? (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200">
                  {data.agenda_text}
                </pre>
              ) : (
                <p className="mt-3 text-sm text-slate-500">No agenda yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
              <h2 className="text-sm font-semibold text-white">PowerPoint decks</h2>
              <p className="mt-1 text-xs text-slate-400">Current versions only. Opens a download / view link.</p>
              {data.decks.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No PowerPoint decks uploaded yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.decks.map((deck) => (
                    <li
                      key={deck.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2.5"
                    >
                      <span className="text-sm font-medium text-slate-100 truncate">{deckLabel(deck)}</span>
                      <button
                        type="button"
                        disabled={!!openingId}
                        onClick={() => void openDeck(deck)}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                      >
                        {openingId === deck.id ? 'Opening…' : 'Open'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default PublicMeetingHubPage;
