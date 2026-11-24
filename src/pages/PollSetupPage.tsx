import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, MoreHorizontal } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  downloadWebQaQrPng,
  webQaQrImageUrl,
  type WebQaQrDownloadOptions,
} from '../lib/webQa';
import ConfirmModal from '../components/ConfirmModal';
import WebPollDesignEditor from '../components/WebPollDesignEditor';
import {
  DEFAULT_DISPLAY_STYLE,
  stylesForPollType,
  type WebPollDisplayStyle,
} from '../lib/webPollDisplayStyle';
import {
  acquireWebPollDesignLock,
  buildWebPollsCsv,
  clearWebPollResults,
  createWebPoll,
  downloadTextFile,
  fetchWebPollOverview,
  releaseWebPollDesignLock,
  rotateWebPollSession,
  setWebPollStatus,
  updateWebPoll,
  updateWebPollDisplayStyle,
  webPollAudienceUrl,
  webPollDesignFrozen,
  webPollDesignLockActive,
  webPollDisplayStyle,
  webPollEventAudienceUrl,
  type WebPoll,
  type WebPollCueSummary,
  type WebPollOverview,
  type WebPollType,
} from '../lib/webPolls';

type QrBgMode = 'white' | 'transparent' | 'custom';

const POLL_TYPES: { id: WebPollType; label: string }[] = [
  { id: 'single', label: 'Single choice' },
  { id: 'multi', label: 'Multi select' },
  { id: 'yesno', label: 'Yes / No' },
  { id: 'rating', label: 'Rating 1–5' },
  { id: 'ranked', label: 'Ranked' },
];

function defaultOptions(type: WebPollType): { label: string }[] {
  if (type === 'yesno') return [{ label: 'Yes' }, { label: 'No' }];
  if (type === 'rating') {
    return [1, 2, 3, 4, 5].map((n) => ({ label: String(n) }));
  }
  if (type === 'ranked') {
    return [{ label: 'Option A' }, { label: 'Option B' }, { label: 'Option C' }];
  }
  return [{ label: 'Option A' }, { label: 'Option B' }];
}

function statusTone(status: string) {
  if (status === 'open') return 'bg-emerald-500/20 text-emerald-300 border-emerald-600/40';
  if (status === 'closed' || status === 'finalizing') {
    return 'bg-amber-500/20 text-amber-200 border-amber-600/40';
  }
  if (status === 'final') return 'bg-sky-500/20 text-sky-200 border-sky-600/40';
  return 'bg-slate-700/60 text-slate-300 border-slate-600/50';
}

export default function PollSetupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const eventId = params.get('eventId') || '';
  const eventName = params.get('eventName') || 'Event';
  const cueFromUrl = Number(params.get('cueItemId') || params.get('cueId') || '');

  const qs = useMemo(
    () =>
      `eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`,
    [eventId, eventName]
  );

  const [overview, setOverview] = useState<WebPollOverview | null>(null);
  const [selectedCueId, setSelectedCueId] = useState<number | null>(
    Number.isFinite(cueFromUrl) && cueFromUrl > 0 ? cueFromUrl : null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAudience, setCopiedAudience] = useState(false);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showQrDownload, setShowQrDownload] = useState(false);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrFg, setQrFg] = useState('#111827');
  const [qrBgMode, setQrBgMode] = useState<QrBgMode>('white');
  const [qrBgCustom, setQrBgCustom] = useState('#ffffff');
  const [qrBorderPx, setQrBorderPx] = useState(16);
  const [qrBorderColor, setQrBorderColor] = useState('#111827');
  const [qrMargin, setQrMargin] = useState(4);
  const [qrSize, setQrSize] = useState(1024);

  const [question, setQuestion] = useState('');
  const [pollType, setPollType] = useState<WebPollType>('single');
  const [optionLabels, setOptionLabels] = useState(() =>
    defaultOptions('single').map((o) => o.label)
  );
  const [createStyle, setCreateStyle] = useState<WebPollDisplayStyle>(() => ({
    ...DEFAULT_DISPLAY_STYLE,
  }));
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [clearBusyId, setClearBusyId] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<WebPoll | null>(null);
  const [menuPollId, setMenuPollId] = useState<string | null>(null);
  const [designPollId, setDesignPollId] = useState<string | null>(null);
  const [designDraft, setDesignDraft] = useState<WebPollDisplayStyle | null>(null);
  const [designBusy, setDesignBusy] = useState(false);
  const [designMsg, setDesignMsg] = useState<string | null>(null);
  const [designConfirmChecked, setDesignConfirmChecked] = useState(false);
  const [editPollId, setEditPollId] = useState<string | null>(null);
  const [editQuestion, setEditQuestion] = useState('');
  const [editPollType, setEditPollType] = useState<WebPollType>('single');
  const [editOptionLabels, setEditOptionLabels] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editStructureLocked, setEditStructureLocked] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) {
      setError('Missing eventId');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const data = await fetchWebPollOverview(eventId);
      setOverview(data);
      setSelectedCueId((prev) => {
        if (prev && data.poll_cues.some((c) => c.id === prev)) return prev;
        if (Number.isFinite(cueFromUrl) && data.poll_cues.some((c) => c.id === cueFromUrl)) {
          return cueFromUrl;
        }
        return data.poll_cues[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load poll management');
    } finally {
      setLoading(false);
    }
  }, [eventId, cueFromUrl]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    setOptionLabels(defaultOptions(pollType).map((o) => o.label));
    setCreateStyle((prev) => {
      const allowed = stylesForPollType(pollType);
      const nextStyle = allowed.some((s) => s.id === prev.resultStyle)
        ? prev.resultStyle
        : allowed[0]?.id || prev.resultStyle;
      return { ...prev, resultStyle: nextStyle };
    });
  }, [pollType]);

  const selectedCue: WebPollCueSummary | null = useMemo(() => {
    if (!overview || selectedCueId == null) return null;
    return overview.poll_cues.find((c) => c.id === selectedCueId) || null;
  }, [overview, selectedCueId]);

  const cuePolls: WebPoll[] = selectedCue?.polls || [];

  const eventAudienceUrl = overview?.session?.public_token
    ? webPollEventAudienceUrl(overview.session.public_token)
    : '';
  const qrUrl = eventAudienceUrl ? webQaQrImageUrl(eventAudienceUrl, 140) : '';

  const qrDownloadOpts = useMemo((): WebQaQrDownloadOptions => {
    const bg =
      qrBgMode === 'transparent'
        ? 'transparent'
        : qrBgMode === 'custom'
          ? qrBgCustom
          : '#ffffff';
    return {
      size: qrSize,
      fg: qrFg,
      bg,
      margin: qrMargin,
      borderPx: qrBorderPx,
      borderColor: qrBorderColor,
    };
  }, [qrBgMode, qrBgCustom, qrBorderColor, qrBorderPx, qrFg, qrMargin, qrSize]);

  const qrPreviewUrl = eventAudienceUrl
    ? webQaQrImageUrl(eventAudienceUrl, {
        size: 160,
        fg: qrFg,
        bg: qrBgMode === 'transparent' ? 'ffffff' : qrDownloadOpts.bg,
        margin: qrMargin,
      })
    : '';

  const selectCue = (id: number) => {
    setSelectedCueId(id);
    setShowCreate(false);
    setDesignPollId(null);
    setDesignDraft(null);
    setDesignMsg(null);
    setEditPollId(null);
    setMenuPollId(null);
    navigate(`/polls-setup?${qs}&cueItemId=${id}`, { replace: true });
  };

  const closeEdit = () => {
    setEditPollId(null);
    setEditQuestion('');
    setEditOptionLabels([]);
    setEditStructureLocked(false);
  };

  const openEdit = (poll: WebPoll) => {
    if (editPollId === poll.id) {
      closeEdit();
      return;
    }
    if (webPollDesignFrozen(poll)) {
      setError('Poll content is locked while open. Close voting to edit question, type, or options.');
      return;
    }
    setShowCreate(false);
    setDesignPollId(null);
    setDesignDraft(null);
    setDesignMsg(null);
    setError(null);
    setEditPollId(poll.id);
    setEditQuestion(poll.question || '');
    setEditPollType(poll.poll_type);
    setEditOptionLabels(
      (poll.options || []).map((o) => o.label).filter(Boolean).length >= 2
        ? (poll.options || []).map((o) => o.label)
        : defaultOptions(poll.poll_type).map((o) => o.label)
    );
    setEditStructureLocked(
      Number(poll.received_count || 0) > 0 || Number(poll.counted_count || 0) > 0
    );
  };

  const onSaveEdit = async (e: React.FormEvent, poll: WebPoll) => {
    e.preventDefault();
    if (!editPollId || editBusy) return;
    const q = editQuestion.trim();
    if (!q) return;
    setEditBusy(true);
    setError(null);
    try {
      const payload: {
        question: string;
        pollType?: WebPollType;
        options?: { label: string }[];
      } = { question: q };
      if (!editStructureLocked) {
        payload.pollType = editPollType;
        payload.options =
          editPollType === 'rating'
            ? defaultOptions('rating')
            : editOptionLabels
                .map((label) => label.trim())
                .filter(Boolean)
                .map((label) => ({ label }));
      }
      await updateWebPoll(poll.id, payload);
      closeEdit();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update poll');
    } finally {
      setEditBusy(false);
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || busy || selectedCueId == null) return;
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const options =
        pollType === 'rating'
          ? defaultOptions('rating')
          : optionLabels
              .map((label) => label.trim())
              .filter(Boolean)
              .map((label) => ({ label }));
      const poll = await createWebPoll(eventId, {
        question: q,
        pollType,
        options,
        cueItemId: selectedCueId,
        displayStyle: createStyle,
      });
      setQuestion('');
      setOptionLabels(defaultOptions(pollType).map((o) => o.label));
      setCreateStyle({ ...DEFAULT_DISPLAY_STYLE });
      setShowCreate(false);
      await load();
      try {
        const locked = await acquireWebPollDesignLock(poll.id);
        setDesignPollId(locked.id);
        setDesignDraft(webPollDisplayStyle(locked));
      } catch {
        setDesignPollId(poll.id);
        setDesignDraft(webPollDisplayStyle(poll));
      }
      setDesignConfirmChecked(false);
      setDesignMsg(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (poll: WebPoll) => {
    const url = webPollAudienceUrl(poll.public_token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(poll.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* ignore */
    }
  };

  const openDesign = async (poll: WebPoll) => {
    if (designPollId === poll.id) {
      try {
        await releaseWebPollDesignLock(poll.id);
      } catch {
        /* ignore unlock errors when closing panel */
      }
      setDesignPollId(null);
      setDesignDraft(null);
      setDesignMsg(null);
      setDesignConfirmChecked(false);
      await load();
      return;
    }
    if (webPollDesignFrozen(poll)) {
      setError('Design is frozen while the poll is open. Close voting to edit look again.');
      return;
    }
    setError(null);
    setShowCreate(false);
    closeEdit();
    try {
      const locked = await acquireWebPollDesignLock(poll.id);
      setDesignPollId(locked.id);
      setDesignDraft(webPollDisplayStyle(locked));
      setDesignConfirmChecked(false);
      setDesignMsg(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock design');
    }
  };

  const saveDesign = async (poll: WebPoll) => {
    if (!designDraft || designBusy || webPollDesignFrozen(poll)) return;
    if (!designConfirmChecked) {
      setError('Check Confirm design, then Save.');
      return;
    }
    setDesignBusy(true);
    setDesignMsg(null);
    try {
      const live = webPollDisplayStyle(poll);
      const next: WebPollDisplayStyle = {
        ...designDraft,
        surfaces: {
          ...designDraft.surfaces,
          onAir: Boolean(live.surfaces.onAir),
        },
      };
      const updated = await updateWebPollDisplayStyle(poll.id, next, {
        designConfirmed: true,
      });
      setDesignDraft(webPollDisplayStyle(updated));
      setDesignMsg('Design saved & confirmed');
      // Close editor so Open can enable from the refreshed poll row.
      try {
        await releaseWebPollDesignLock(poll.id);
      } catch {
        /* ignore */
      }
      setDesignPollId(null);
      setDesignDraft(null);
      setDesignConfirmChecked(false);
      await load();
      window.setTimeout(() => setDesignMsg(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save design');
    } finally {
      setDesignBusy(false);
    }
  };

  const setPollOpenClosed = async (poll: WebPoll, next: 'open' | 'closed') => {
    if (statusBusyId) return;
    if (next === 'open' && !poll.design_confirmed) {
      setError('Confirm design before opening the poll.');
      return;
    }
    setStatusBusyId(poll.id);
    setError(null);
    try {
      if (next === 'open' && designPollId === poll.id) {
        setDesignPollId(null);
        setDesignDraft(null);
      }
      await setWebPollStatus(poll.id, next);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update poll');
    } finally {
      setStatusBusyId(null);
    }
  };

  const requestClearResults = (poll: WebPoll) => {
    setMenuPollId(null);
    setClearTarget(poll);
  };

  const confirmClearResults = async () => {
    const poll = clearTarget;
    if (!poll || clearBusyId) return;
    setClearBusyId(poll.id);
    setError(null);
    try {
      await clearWebPollResults(poll.id);
      setClearTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear results');
    } finally {
      setClearBusyId(null);
    }
  };

  const downloadReport = () => {
    if (!overview?.polls?.length) return;
    setReportBusy(true);
    try {
      const lookup = new Map(
        (overview.poll_cues || []).map((c) => [
          c.id,
          { cue: c.cue, segment_name: c.segment_name },
        ])
      );
      const csv = buildWebPollsCsv(overview.polls, lookup);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadTextFile(`web-polls-${stamp}.csv`, csv);
    } finally {
      setReportBusy(false);
    }
  };

  const copyEventLink = async () => {
    if (!eventAudienceUrl) return;
    try {
      await navigator.clipboard.writeText(eventAudienceUrl);
      setCopiedAudience(true);
      window.setTimeout(() => setCopiedAudience(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const rotateQr = async () => {
    if (!eventId || rotateBusy) return;
    if (!window.confirm('Generate a new audience QR / link? The old QR will stop working.')) return;
    setRotateBusy(true);
    setError(null);
    try {
      await rotateWebPollSession(eventId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not rotate poll link');
    } finally {
      setRotateBusy(false);
    }
  };

  const downloadQr = async () => {
    if (!eventAudienceUrl || qrBusy) return;
    setQrBusy(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const safeName = (eventName || 'event')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      await downloadWebQaQrPng(
        eventAudienceUrl,
        `web-polls-qr-${safeName || 'event'}-${stamp}.png`,
        qrDownloadOpts
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not download QR');
    } finally {
      setQrBusy(false);
    }
  };

  if (!eventId) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-slate-300">Open Web Polls from an event’s main menu.</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600"
          >
            Back to events
          </button>
        </div>
      </div>
    );
  }

  const current = overview?.current_cue;
  const inPollCue = overview?.in_poll_cue === true;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/90 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-sky-300/90 font-semibold">
              Web Polls · Setup
            </p>
            <h1 className="text-xl font-bold leading-tight">{eventName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => navigate(`/polls-control?${qs}`)}
              className="px-3 py-1.5 text-sm rounded bg-sky-800 hover:bg-sky-700"
            >
              Control
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  `/run-of-show?eventId=${encodeURIComponent(eventId)}&eventName=${encodeURIComponent(eventName)}`
                )
              }
              className="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600"
            >
              Back to ROS
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-5">
        {loading && !overview ? (
          <p className="text-slate-400">Loading poll management…</p>
        ) : error ? (
          <div className="rounded-lg border border-rose-700/50 bg-rose-950/30 px-4 py-3 text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <aside className="rounded-xl border border-slate-700 bg-slate-900/80 p-4 space-y-4 h-fit">
            <div>
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Audience QR</h2>
              <p className="text-xs text-slate-400 mb-2">
                Unique per event. Scan to open whichever poll is currently open.
              </p>
              <div className="flex items-start gap-3">
                {qrUrl ? (
                  <div className="rounded-md bg-white p-1.5 shrink-0">
                    <img
                      src={qrUrl}
                      alt="Poll audience QR code"
                      width={112}
                      height={112}
                      className="block w-28 h-28"
                    />
                  </div>
                ) : (
                  <div className="h-28 w-28 rounded-md bg-slate-800 animate-pulse shrink-0" />
                )}
                <div className="min-w-0 space-y-2 pt-0.5 flex-1">
                  <button
                    type="button"
                    onClick={() => setShowQrDownload((v) => !v)}
                    className="w-full px-2.5 py-1.5 text-xs font-semibold rounded bg-slate-700 hover:bg-slate-600"
                  >
                    {showQrDownload ? 'Hide download options' : 'Download QR…'}
                  </button>
                  <button
                    type="button"
                    disabled={rotateBusy}
                    onClick={() => void rotateQr()}
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {rotateBusy ? 'Rotating…' : 'New QR / link'}
                  </button>
                </div>
              </div>
            </div>

            {showQrDownload ? (
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3 space-y-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                  Download options
                </p>
                <div
                  className="rounded-md p-2 inline-block"
                  style={{
                    background:
                      qrBgMode === 'transparent'
                        ? 'repeating-conic-gradient(#cbd5e1 0% 25%, #f8fafc 0% 50%) 50% / 12px 12px'
                        : qrBgMode === 'custom'
                          ? qrBgCustom
                          : '#ffffff',
                    boxShadow:
                      qrBorderPx > 0
                        ? `0 0 0 ${Math.min(8, Math.max(2, Math.round(qrBorderPx / 8)))}px ${qrBorderColor}`
                        : undefined,
                  }}
                >
                  {qrPreviewUrl ? (
                    <img
                      src={qrPreviewUrl}
                      alt="QR download preview"
                      width={96}
                      height={96}
                      className="block w-24 h-24"
                      style={{
                        mixBlendMode: qrBgMode === 'transparent' ? 'multiply' : undefined,
                      }}
                    />
                  ) : null}
                </div>

                <label className="block text-xs text-slate-400">
                  Code color
                  <input
                    type="color"
                    value={qrFg}
                    onChange={(e) => setQrFg(e.target.value)}
                    className="mt-1 w-full h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                  />
                </label>

                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400">Background</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['white', 'White'],
                        ['transparent', 'Transparent'],
                        ['custom', 'Custom'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setQrBgMode(id)}
                        className={`px-2 py-1 text-[11px] rounded border ${
                          qrBgMode === id
                            ? 'border-sky-500 bg-sky-900/40 text-white'
                            : 'border-slate-600 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {qrBgMode === 'custom' ? (
                    <input
                      type="color"
                      value={qrBgCustom}
                      onChange={(e) => setQrBgCustom(e.target.value)}
                      className="w-full h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                    />
                  ) : null}
                </div>

                <label className="block text-xs text-slate-400">
                  Border ({qrBorderPx}px)
                  <input
                    type="range"
                    min={0}
                    max={64}
                    step={2}
                    value={qrBorderPx}
                    onChange={(e) => setQrBorderPx(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>
                {qrBorderPx > 0 ? (
                  <label className="block text-xs text-slate-400">
                    Border color
                    <input
                      type="color"
                      value={qrBorderColor}
                      onChange={(e) => setQrBorderColor(e.target.value)}
                      className="mt-1 w-full h-8 rounded cursor-pointer bg-transparent border border-slate-600"
                    />
                  </label>
                ) : null}

                <label className="block text-xs text-slate-400">
                  Quiet zone ({qrMargin})
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={qrMargin}
                    onChange={(e) => setQrMargin(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>

                <label className="block text-xs text-slate-400">
                  Export size
                  <select
                    value={qrSize}
                    onChange={(e) => setQrSize(Number(e.target.value))}
                    className="mt-1 w-full rounded bg-slate-900 border border-slate-600 px-2 py-1.5 text-sm text-white"
                  >
                    <option value={512}>512 px</option>
                    <option value={1024}>1024 px</option>
                    <option value={2048}>2048 px</option>
                  </select>
                </label>

                <button
                  type="button"
                  disabled={!eventAudienceUrl || qrBusy}
                  onClick={() => void downloadQr()}
                  className="w-full px-3 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-40 font-semibold text-sm"
                >
                  {qrBusy ? 'Preparing PNG…' : 'Download PNG'}
                </button>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                Public link
              </label>
              <div className="text-xs break-all text-sky-200 bg-slate-950/70 border border-slate-700 rounded-lg px-2.5 py-2">
                {eventAudienceUrl || '…'}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyEventLink()}
                  className="px-3 py-1.5 text-sm rounded bg-sky-700 hover:bg-sky-600 inline-flex items-center gap-1.5"
                >
                  {copiedAudience ? <Check className="w-3.5 h-3.5" /> : null}
                  {copiedAudience ? 'Copied' : 'Copy link'}
                </button>
                <a
                  href={eventAudienceUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className={`px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 ${
                    !eventAudienceUrl ? 'pointer-events-none opacity-40' : ''
                  }`}
                >
                  Open
                </a>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-700/80">
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Live cue</h2>
              <p className="text-xs text-slate-400 mb-2">
                {inPollCue ? 'Current loaded cue has Poll checked.' : 'Not currently in a Poll cue.'}
              </p>
              {current ? (
                <div
                  className={`rounded-lg border px-3 py-2 ${
                    inPollCue
                      ? 'border-emerald-600/50 bg-emerald-950/30'
                      : 'border-slate-700 bg-slate-950/50'
                  }`}
                >
                  <p className="text-sm font-medium">
                    {current.cue || `Item #${current.id}`}
                    {inPollCue ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-200">
                        poll cue
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-slate-400 truncate">{current.segment_name || '—'}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No cue loaded yet.</p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-700/80">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold mb-2">
                Counts
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-slate-700 px-2 py-1.5">
                  <span className="text-slate-500">All</span>
                  <p className="text-lg font-semibold tabular-nums">{overview?.counts.all ?? 0}</p>
                </div>
                <div className="rounded border border-slate-700 px-2 py-1.5">
                  <span className="text-slate-500">Open</span>
                  <p className="text-lg font-semibold tabular-nums text-emerald-300">
                    {overview?.counts.open ?? 0}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={reportBusy || !(overview?.polls?.length)}
              onClick={downloadReport}
              className="w-full px-3 py-2 text-sm rounded bg-sky-800 hover:bg-sky-700 disabled:opacity-40 font-semibold"
            >
              {reportBusy ? 'Preparing…' : 'Download polls CSV'}
            </button>
          </aside>

          <div className="space-y-5">
            <section className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-4 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Cues with Poll</h2>
                <p className="text-xs text-slate-400">
                  Parent cues with the Poll checkbox in ROS. Select one to create, open/close, or
                  edit design for its polls.
                </p>
              </div>

              {(overview?.poll_cues || []).length === 0 ? (
                <p className="text-slate-400 text-sm py-6 text-center border border-dashed border-slate-700 rounded-lg">
                  No cues have Poll checked yet. Check <span className="text-white">Poll</span> on a
                  rundown row, then refresh.
                </p>
              ) : (
                <ul className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
                  {(overview?.poll_cues || []).map((cue) => {
                    const isSelected = selectedCueId === cue.id;
                    const isCurrent = current?.id === cue.id;
                    return (
                      <li key={cue.id}>
                        <button
                          type="button"
                          onClick={() => selectCue(cue.id)}
                          className={`w-full px-3 py-2.5 text-left flex flex-wrap items-center justify-between gap-2 transition-colors ${
                            isSelected
                              ? 'bg-sky-950/40 ring-1 ring-inset ring-sky-600/40'
                              : isCurrent
                                ? 'bg-emerald-950/20 hover:bg-slate-900'
                                : 'bg-slate-950/40 hover:bg-slate-900'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-sm">
                              {cue.cue || `Item #${cue.id}`}
                              {isCurrent ? (
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-200">
                                  current
                                </span>
                              ) : null}
                            </p>
                            <p className="text-xs text-slate-400 truncate">
                              {cue.segment_name || '—'}
                            </p>
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums shrink-0">
                            {cue.poll_count || 0} poll{(cue.poll_count || 0) === 1 ? '' : 's'}
                            {(cue.open_count || 0) > 0 ? (
                              <span className="ml-2 text-emerald-300">{cue.open_count} open</span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {selectedCue ? (
              <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
                      Selected cue
                    </p>
                    <h3 className="text-lg font-semibold">
                      {selectedCue.cue || `Item #${selectedCue.id}`}
                    </h3>
                    <p className="text-sm text-slate-400">{selectedCue.segment_name || '—'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate((v) => !v);
                      closeEdit();
                      setDesignPollId(null);
                      setDesignDraft(null);
                    }}
                    className="px-3 py-1.5 text-sm rounded bg-sky-600 hover:bg-sky-500 font-semibold"
                  >
                    {showCreate ? 'Cancel' : 'New poll for this cue'}
                  </button>
                </div>

                {showCreate ? (
                  <form
                    onSubmit={(e) => void onCreate(e)}
                    className="rounded-lg border border-slate-700 bg-slate-950/60 p-4 space-y-3"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                        Question
                      </label>
                      <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        maxLength={280}
                        required
                        placeholder="What should we decide?"
                        className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                        Type
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {POLL_TYPES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setPollType(t.id)}
                            className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                              pollType === t.id
                                ? 'border-sky-500 bg-sky-950/40 text-sky-100'
                                : 'border-slate-600 bg-slate-950 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {pollType !== 'rating' ? (
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-slate-400">Options</label>
                        {optionLabels.map((label, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              value={label}
                              onChange={(e) => {
                                const next = [...optionLabels];
                                next[i] = e.target.value;
                                setOptionLabels(next);
                              }}
                              maxLength={80}
                              className="flex-1 rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                            />
                            {optionLabels.length > 2 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setOptionLabels(optionLabels.filter((_, j) => j !== i))
                                }
                                className="px-2.5 rounded-lg border border-slate-600 text-slate-400 hover:bg-slate-800"
                              >
                                −
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {optionLabels.length < 8 && pollType !== 'yesno' ? (
                          <button
                            type="button"
                            onClick={() =>
                              setOptionLabels([
                                ...optionLabels,
                                `Option ${String.fromCharCode(65 + optionLabels.length)}`,
                              ])
                            }
                            className="text-xs text-sky-300 hover:text-sky-200"
                          >
                            + Add option
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500">Rating uses fixed options 1–5.</p>
                    )}
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Design
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Results layout, colors, and surface options for this poll.
                        </p>
                      </div>
                      <WebPollDesignEditor
                        pollType={pollType}
                        value={createStyle}
                        onChange={setCreateStyle}
                        question={question.trim() || 'Poll question'}
                        previewOptions={optionLabels
                          .map((label) => label.trim())
                          .filter(Boolean)
                          .map((label) => ({ label }))}
                        dense
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy || !question.trim()}
                      className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-sm font-semibold"
                    >
                      {busy ? 'Creating…' : 'Create draft'}
                    </button>
                  </form>
                ) : null}

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Polls on this cue
                  </h4>
                  {cuePolls.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No polls yet — create one for this cue.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {cuePolls.map((poll) => {
                        const audience = webPollAudienceUrl(poll.public_token);
                        const statusBusy = statusBusyId === poll.id;
                        const isOpen = poll.status === 'open';
                        const designing = designPollId === poll.id && designDraft;
                        const editing = editPollId === poll.id;
                        const frozen = webPollDesignFrozen(poll);
                        const lockActive = webPollDesignLockActive(poll);
                        const confirmed = Boolean(poll.design_confirmed);
                        const menuOpen = menuPollId === poll.id;
                        const styleLabel =
                          stylesForPollType(poll.poll_type).find(
                            (s) => s.id === webPollDisplayStyle(poll).resultStyle
                          )?.label || webPollDisplayStyle(poll).resultStyle;
                        return (
                          <li
                            key={poll.id}
                            className="rounded-lg border border-slate-700 bg-slate-950/50 overflow-hidden"
                          >
                            <div className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                  <span
                                    className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${statusTone(poll.status)}`}
                                  >
                                    {poll.status}
                                  </span>
                                  {frozen ? (
                                    <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border border-amber-700/50 text-amber-100">
                                      Locked
                                    </span>
                                  ) : confirmed ? (
                                    <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border border-emerald-700/50 text-emerald-300">
                                      Design confirmed
                                    </span>
                                  ) : (
                                    <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border border-amber-700/50 text-amber-200">
                                      Needs design confirmation
                                    </span>
                                  )}
                                  <span className="text-[11px] text-slate-500 tabular-nums">
                                    {poll.received_count}/{poll.counted_count}
                                  </span>
                                  {lockActive && !frozen ? (
                                    <span className="text-[10px] text-sky-300/90">
                                      Editing: {poll.design_lock_name || 'operator'}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="font-medium text-white truncate">{poll.question}</p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {poll.poll_type} · {styleLabel}
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2 shrink-0 sm:justify-end">
                                {editing ? (
                                  <button
                                    type="button"
                                    onClick={() => openEdit(poll)}
                                    className="px-2.5 py-1.5 text-xs rounded border border-violet-500 bg-violet-950/40 text-violet-100 font-semibold"
                                  >
                                    Cancel edit
                                  </button>
                                ) : null}
                                {designing ? (
                                  <button
                                    type="button"
                                    onClick={() => void openDesign(poll)}
                                    className="px-2.5 py-1.5 text-xs rounded border border-sky-500 bg-sky-950/40 text-sky-100 font-semibold"
                                  >
                                    Close design
                                  </button>
                                ) : null}
                                {!frozen && !designing ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMenuPollId(null);
                                      void openDesign(poll);
                                    }}
                                    className="px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-200 hover:bg-slate-800 font-semibold"
                                  >
                                    Design
                                  </button>
                                ) : null}
                                {isOpen ? (
                                  <button
                                    type="button"
                                    disabled={statusBusy}
                                    onClick={() => void setPollOpenClosed(poll, 'closed')}
                                    className="px-2.5 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white font-semibold disabled:opacity-40"
                                  >
                                    {statusBusy ? '…' : 'Close'}
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={statusBusy || !confirmed}
                                    title={
                                      !confirmed
                                        ? 'Confirm design before opening'
                                        : 'Open poll for voting'
                                    }
                                    onClick={() => void setPollOpenClosed(poll, 'open')}
                                    className="px-2.5 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold disabled:opacity-40"
                                  >
                                    {statusBusy ? '…' : 'Open'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuPollId(null);
                                    navigate(
                                      `/polls-control?${qs}&pollId=${encodeURIComponent(poll.id)}`
                                    );
                                  }}
                                  className="px-2.5 py-1.5 text-xs rounded bg-violet-700 hover:bg-violet-600 font-semibold"
                                >
                                  Control
                                </button>
                                <div className="relative">
                                  <button
                                    type="button"
                                    aria-label="More poll actions"
                                    aria-expanded={menuOpen}
                                    onClick={() =>
                                      setMenuPollId((id) => (id === poll.id ? null : poll.id))
                                    }
                                    className={`p-1.5 rounded border ${
                                      menuOpen
                                        ? 'border-slate-500 bg-slate-800 text-white'
                                        : 'border-slate-600 text-slate-300 hover:bg-slate-800'
                                    }`}
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </button>
                                  {menuOpen ? (
                                    <div className="absolute right-0 top-full mt-1 z-30 min-w-[11rem] rounded-lg border border-slate-600 bg-slate-900 shadow-xl py-1">
                                      {!frozen && !editing ? (
                                        <button
                                          type="button"
                                          className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                                          onClick={() => {
                                            setMenuPollId(null);
                                            openEdit(poll);
                                          }}
                                        >
                                          Edit question / type
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 inline-flex items-center gap-2"
                                        onClick={() => {
                                          setMenuPollId(null);
                                          void copyLink(poll);
                                        }}
                                      >
                                        {copiedId === poll.id ? (
                                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5" />
                                        )}
                                        {copiedId === poll.id ? 'Copied' : 'Copy audience link'}
                                      </button>
                                      <a
                                        href={audience}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
                                        onClick={() => setMenuPollId(null)}
                                      >
                                        Open audience
                                      </a>
                                      <button
                                        type="button"
                                        disabled={clearBusyId === poll.id}
                                        className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
                                        onClick={() => requestClearResults(poll)}
                                      >
                                        Clear results…
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            {editing ? (
                              <form
                                onSubmit={(e) => void onSaveEdit(e, poll)}
                                className="border-t border-slate-800 px-3 py-3 space-y-3 bg-slate-950/80"
                              >
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                                    Question
                                  </label>
                                  <input
                                    value={editQuestion}
                                    onChange={(e) => setEditQuestion(e.target.value)}
                                    maxLength={280}
                                    required
                                    className="w-full rounded-lg bg-slate-950 border border-slate-600 px-3 py-2.5 text-white focus:outline-none focus:border-violet-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                                    Type
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    {POLL_TYPES.map((t) => (
                                      <button
                                        key={t.id}
                                        type="button"
                                        disabled={editStructureLocked}
                                        onClick={() => {
                                          if (editStructureLocked) return;
                                          setEditPollType(t.id);
                                          setEditOptionLabels(
                                            defaultOptions(t.id).map((o) => o.label)
                                          );
                                        }}
                                        className={`px-3 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-40 ${
                                          editPollType === t.id
                                            ? 'border-violet-500 bg-violet-950/40 text-violet-100'
                                            : 'border-slate-600 bg-slate-950 text-slate-300 hover:border-slate-500'
                                        }`}
                                      >
                                        {t.label}
                                      </button>
                                    ))}
                                  </div>
                                  {editStructureLocked ? (
                                    <p className="text-[11px] text-amber-200/90 mt-1.5">
                                      Type and options are locked after votes. Question can still
                                      change.
                                    </p>
                                  ) : null}
                                </div>
                                {!editStructureLocked && editPollType !== 'rating' ? (
                                  <div className="space-y-2">
                                    <label className="block text-xs font-semibold text-slate-400">
                                      Options
                                    </label>
                                    {editOptionLabels.map((label, i) => (
                                      <div key={i} className="flex gap-2">
                                        <input
                                          value={label}
                                          onChange={(e) => {
                                            const next = [...editOptionLabels];
                                            next[i] = e.target.value;
                                            setEditOptionLabels(next);
                                          }}
                                          maxLength={80}
                                          className="flex-1 rounded-lg bg-slate-950 border border-slate-600 px-3 py-2 text-white focus:outline-none focus:border-violet-500"
                                        />
                                        {editOptionLabels.length > 2 ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setEditOptionLabels(
                                                editOptionLabels.filter((_, j) => j !== i)
                                              )
                                            }
                                            className="px-2.5 rounded-lg border border-slate-600 text-slate-400 hover:bg-slate-800"
                                          >
                                            −
                                          </button>
                                        ) : null}
                                      </div>
                                    ))}
                                    {editOptionLabels.length < 8 && editPollType !== 'yesno' ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setEditOptionLabels([
                                            ...editOptionLabels,
                                            `Option ${String.fromCharCode(65 + editOptionLabels.length)}`,
                                          ])
                                        }
                                        className="text-xs text-violet-300 hover:text-violet-200"
                                      >
                                        + Add option
                                      </button>
                                    ) : null}
                                  </div>
                                ) : !editStructureLocked ? (
                                  <p className="text-xs text-slate-500">
                                    Rating uses fixed options 1–5.
                                  </p>
                                ) : null}
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="submit"
                                    disabled={editBusy || !editQuestion.trim()}
                                    className="px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50 font-semibold"
                                  >
                                    {editBusy ? 'Saving…' : 'Save poll'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={closeEdit}
                                    className="px-3 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-800"
                                  >
                                    Cancel
                                  </button>
                                  <span className="text-[11px] text-slate-500">
                                    Content save clears design confirm — open Design, confirm, and
                                    save again before Open.
                                  </span>
                                </div>
                              </form>
                            ) : designing ? (
                              <div className="border-t border-slate-800 px-3 py-3 space-y-3 bg-slate-950/80">
                                <WebPollDesignEditor
                                  pollType={poll.poll_type}
                                  value={designDraft}
                                  onChange={setDesignDraft}
                                  question={poll.question}
                                  previewOptions={(poll.options || []).map((o) => ({
                                    id: o.id,
                                    label: o.label,
                                    color: o.color,
                                    votes: o.vote_count,
                                  }))}
                                />
                                <div className="flex flex-wrap items-center gap-3">
                                  <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      className="rounded border-slate-600 bg-slate-900"
                                      checked={designConfirmChecked}
                                      onChange={(e) => setDesignConfirmChecked(e.target.checked)}
                                    />
                                    Confirm design
                                  </label>
                                  <button
                                    type="button"
                                    disabled={designBusy || !designConfirmChecked}
                                    title={
                                      designConfirmChecked
                                        ? 'Save look and mark design confirmed for Open'
                                        : 'Check Confirm design, then save'
                                    }
                                    onClick={() => void saveDesign(poll)}
                                    className="px-3 py-1.5 text-xs rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50 font-semibold"
                                  >
                                    {designBusy ? 'Saving…' : 'Save design'}
                                  </button>
                                  {designMsg ? (
                                    <span className="text-xs text-emerald-300">{designMsg}</span>
                                  ) : (
                                    <span className="text-[11px] text-slate-500">
                                      Check Confirm, then Save — required before Open. On-air stays
                                      with Control.
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : lockActive && !frozen ? (
                              <div className="border-t border-slate-800 px-3 py-2 bg-slate-950/40">
                                <span className="text-[11px] text-slate-500">
                                  Design locked by {poll.design_lock_name || 'another operator'}
                                </span>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>

      <ConfirmModal
        isOpen={Boolean(clearTarget)}
        onClose={() => {
          if (!clearBusyId) setClearTarget(null);
        }}
        onConfirm={() => void confirmClearResults()}
        title="Clear all poll results?"
        message={
          clearTarget
            ? `This permanently deletes ${Number(clearTarget.received_count || 0)} received / ${Number(clearTarget.counted_count || 0)} counted vote(s), empties the inbox (Neon + Redis), and resets option totals to zero.\n\nQuestion, options, and design are kept. This cannot be undone.`
            : ''
        }
        confirmLabel={clearBusyId ? 'Clearing…' : 'Clear results'}
        cancelLabel="Keep results"
        confirmClassName="bg-rose-700 hover:bg-rose-600"
      />
    </div>
  );
}
