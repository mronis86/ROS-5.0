import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessAccessManager } from '../services/auth-service';
import { apiClient } from '../services/api-client';
import { DatabaseService } from '../services/database';
import {
  buildPostShowReportHtml,
  openPostShowReportPrint,
  type ComplaintLineNote,
} from '../lib/postShowReport';
import {
  diffScheduleAgainstBaseline,
  parseRehearsalBaseline,
  type BaselineDiffRow,
} from '../lib/rehearsalBaseline';
import {
  COMPLAINT_LINE_CATEGORIES,
  COMPLAINT_LINE_CATEGORY_LABELS,
  normalizeComplaintLineCategory,
  type ComplaintLineCategory,
} from '../lib/complaintLine';

type EventLite = {
  id: string;
  name?: string;
  date?: string;
  location?: string;
};

type SectionId = 'complaints' | 'diffs';
type ComplaintFilter = 'all' | ComplaintLineCategory;

function parseScheduleData(raw: unknown): { location?: string } | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as { location?: string };
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as { location?: string };
    } catch {
      return null;
    }
  }
  return null;
}

function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function DiffKindPill({ kind }: { kind: BaselineDiffRow['kind'] }) {
  const styles =
    kind === 'added'
      ? 'bg-emerald-900/50 text-emerald-200'
      : kind === 'removed'
        ? 'bg-red-900/50 text-red-200'
        : 'bg-amber-900/50 text-amber-200';
  const label = kind === 'added' ? 'Added' : kind === 'removed' ? 'Removed' : 'Changed';
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${styles}`}>
      {label}
    </span>
  );
}

const PostShowReportPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const urlParams = new URLSearchParams(location.search);
  const eventIdParam = urlParams.get('eventId') || '';
  const eventNameParam = urlParams.get('eventName') || '';

  const [event, setEvent] = useState<EventLite>({
    id: eventIdParam,
    name: eventNameParam || undefined,
  });
  const [complaints, setComplaints] = useState<ComplaintLineNote[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [baseline, setBaseline] = useState<ReturnType<typeof parseRehearsalBaseline>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('complaints');
  const [complaintFilter, setComplaintFilter] = useState<ComplaintFilter>('all');

  const allowed = canAccessAccessManager(user);
  const eventId = event.id || eventIdParam;

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [notesRes, ros, mode] = await Promise.all([
        apiClient.getComplaintLineNotes(eventId),
        DatabaseService.getRunOfShowData(eventId),
        apiClient.getShowMode(eventId),
      ]);

      const scheduleItems = Array.isArray(ros?.schedule_items) ? ros.schedule_items : [];

      setComplaints((notesRes?.notes || []) as ComplaintLineNote[]);
      setSchedule(scheduleItems);
      setBaseline(
        parseRehearsalBaseline(mode?.rehearsalBaseline) ||
          parseRehearsalBaseline(ros?.settings?.rehearsal_baseline)
      );

      const rosDate = ros?.event_date
        ? typeof ros.event_date === 'string' && ros.event_date.length >= 10
          ? ros.event_date.slice(0, 10)
          : new Date(ros.event_date).toISOString().split('T')[0]
        : undefined;

      setEvent((prev) => ({
        id: eventId,
        name: prev.name || ros?.event_name || eventNameParam || 'Untitled event',
        date: prev.date || rosDate,
        location: prev.location,
      }));

      try {
        const calEvent: any = await DatabaseService.getCalendarEvent(eventId);
        if (calEvent) {
          const scheduleData = parseScheduleData(calEvent.schedule_data);
          const loc = scheduleData?.location ?? calEvent.location ?? '';
          const dateObj = calEvent.date ? new Date(calEvent.date) : null;
          const simpleDate = dateObj ? dateObj.toISOString().split('T')[0] : '';
          setEvent((prev) => ({
            id: eventId,
            name: prev.name || calEvent.name || eventNameParam || 'Untitled event',
            date: prev.date || simpleDate,
            location: prev.location || loc,
          }));
        }
      } catch {
        /* calendar lookup optional */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [eventId, eventNameParam]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const diffs = useMemo(
    () => diffScheduleAgainstBaseline(schedule, baseline),
    [schedule, baseline]
  );

  const filteredComplaints = useMemo(() => {
    const sorted = [...complaints].sort(
      (a, b) => Date.parse(a.created_at || '') - Date.parse(b.created_at || '')
    );
    if (complaintFilter === 'all') return sorted;
    return sorted.filter(
      (n) => normalizeComplaintLineCategory(n.category) === complaintFilter
    );
  }, [complaints, complaintFilter]);

  const html = useMemo(() => {
    if (!eventId) return '';
    return buildPostShowReportHtml({
      event: {
        id: eventId,
        name: event.name || eventNameParam || 'Untitled event',
        date: event.date,
        location: event.location,
      },
      complaints,
      schedule,
      rehearsalBaseline: baseline,
    });
  }, [event, eventId, eventNameParam, complaints, schedule, baseline]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold mb-2">Post-show report</h1>
          <p className="text-slate-400 text-sm mb-4">Event Managers and Admins only.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const sectionTabs: { id: SectionId; label: string; count: number }[] = [
    { id: 'complaints', label: 'Complaint Line', count: complaints.length },
    { id: 'diffs', label: 'Show vs rehearsal', count: diffs.length },
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 h-auto py-3 min-h-16">
            <div>
              <button
                type="button"
                onClick={() => window.close()}
                className="text-slate-300 hover:text-white transition-colors text-sm mb-1"
              >
                ← Back to Run of Show
              </button>
              <h1 className="text-lg font-semibold">Post-show report</h1>
              <p className="text-slate-400 text-sm">
                {[event.name || eventNameParam || 'Event', event.date, event.location]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="px-3 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded-lg text-sm"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => openPostShowReportPrint(html)}
                disabled={loading || !html}
                className="px-3 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg text-sm font-medium"
              >
                Print / Save PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {error ? (
          <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-red-200 text-sm">
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-slate-400 text-sm">Loading report…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Complaints</div>
                <div className="text-2xl font-semibold text-white mt-1">{complaints.length}</div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Schedule diffs</div>
                <div className="text-2xl font-semibold text-white mt-1">{diffs.length}</div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">Baseline</div>
                <div className="text-sm font-medium text-white mt-2 leading-snug">
                  {baseline?.capturedAt ? formatWhen(baseline.capturedAt) : 'Not frozen yet'}
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500">
              Who-changed-what history stays in Change Log. This report is notes + final schedule vs rehearsal.
            </p>

            <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2">
              {sectionTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSection(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    activeSection === tab.id
                      ? 'bg-rose-700 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                  <span className="ml-1.5 text-xs opacity-80">({tab.count})</span>
                </button>
              ))}
            </div>

            {activeSection === 'complaints' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500 mr-1">Filter:</span>
                  <button
                    type="button"
                    onClick={() => setComplaintFilter('all')}
                    className={`px-2.5 py-1 rounded text-xs ${
                      complaintFilter === 'all'
                        ? 'bg-slate-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    All
                  </button>
                  {COMPLAINT_LINE_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setComplaintFilter(cat)}
                      className={`px-2.5 py-1 rounded text-xs ${
                        complaintFilter === cat
                          ? 'bg-slate-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {COMPLAINT_LINE_CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-800/40 overflow-hidden">
                  {filteredComplaints.length === 0 ? (
                    <p className="px-4 py-8 text-center text-slate-500 text-sm">
                      {complaints.length === 0
                        ? 'No complaint-line notes recorded.'
                        : 'No notes in this category.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-700/80">
                      {filteredComplaints.map((note) => (
                        <li key={note.id} className="px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1.5">
                            <span className="uppercase tracking-wide text-rose-300 font-semibold">
                              {
                                COMPLAINT_LINE_CATEGORY_LABELS[
                                  normalizeComplaintLineCategory(note.category)
                                ]
                              }
                            </span>
                            <span>{formatWhen(note.created_at)}</span>
                            <span>{note.user_name || 'Unknown'}</span>
                          </div>
                          <p className="text-sm text-slate-100 whitespace-pre-wrap leading-relaxed">
                            {note.content}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            )}

            {activeSection === 'diffs' && (
              <section className="rounded-lg border border-slate-700 bg-slate-800/40 overflow-hidden">
                {!baseline ? (
                  <p className="px-4 py-8 text-center text-slate-500 text-sm">
                    No rehearsal baseline on file. Enter In-Show to freeze one.
                  </p>
                ) : diffs.length === 0 ? (
                  <p className="px-4 py-8 text-center text-slate-500 text-sm">
                    Schedule matches baseline from {formatWhen(baseline.capturedAt)}.
                  </p>
                ) : (
                  <>
                    <div className="px-4 py-2.5 border-b border-slate-700 text-xs text-slate-500">
                      Baseline {formatWhen(baseline.capturedAt)} · {baseline.itemCount} rows
                    </div>
                    <ul className="divide-y divide-slate-700/80">
                      {diffs.map((d, i) => (
                        <li key={`${d.kind}-${d.itemId}-${d.field || ''}-${i}`} className="px-4 py-3.5">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <DiffKindPill kind={d.kind} />
                            {d.cue ? (
                              <span className="text-xs text-slate-400">Cue {d.cue}</span>
                            ) : null}
                            <span className="text-sm text-slate-200 font-medium">
                              {d.segmentName || `Item ${d.itemId}`}
                            </span>
                          </div>
                          {d.kind === 'changed' ? (
                            <p className="text-sm text-slate-300">
                              <span className="text-slate-500">{d.fieldLabel || d.field}: </span>
                              {d.before || '(empty)'} → {d.after || '(empty)'}
                            </p>
                          ) : d.kind === 'added' ? (
                            <p className="text-xs text-slate-500">New row after baseline</p>
                          ) : (
                            <p className="text-xs text-slate-500">
                              Present in rehearsal baseline, missing now
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PostShowReportPage;
