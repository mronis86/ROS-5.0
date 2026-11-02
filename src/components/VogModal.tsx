import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiClient } from '../services/api-client';

export type VogVoiceOption = {
  voiceId: string;
  name: string;
  category?: string | null;
  description?: string | null;
  previewUrl?: string | null;
};

export type VogCueSummary = {
  id: number;
  day?: number;
  cueLabel: string;
  segmentName: string;
  vogText: string;
  vogVoiceId: string;
  vogVoiceName: string;
};

type VogSavePayload = { vogText: string; vogVoiceId: string; vogVoiceName: string };

type VogModalProps = {
  open: boolean;
  eventId?: string | null;
  segmentName?: string;
  cueLabel?: string;
  initialText?: string;
  initialVoiceId?: string;
  initialVoiceName?: string;
  activeItemId?: number | null;
  selectedDay?: number;
  cues?: VogCueSummary[];
  readOnly?: boolean;
  onClose: () => void;
  onSave?: (next: VogSavePayload) => void | Promise<void>;
  onSelectCue?: (itemId: number) => void;
  onApplyVoiceToCues?: (itemIds: number[], voiceId: string, voiceName: string) => void | Promise<void>;
};

const VOG_OUTPUT_FORMAT = 'mp3_44100_128';

function safeFileStem(raw: string) {
  return (
    String(raw || 'vog')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'vog'
  );
}

function hasVogText(text: string | undefined | null) {
  return String(text || '').trim().length > 0;
}

const fieldClass =
  'w-full rounded-lg border border-slate-600/70 bg-slate-950/70 text-white px-3 py-2.5 text-sm shadow-inner placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/35 focus:border-violet-400/50 disabled:opacity-60';

export default function VogModal({
  open,
  eventId = null,
  segmentName,
  cueLabel,
  initialText = '',
  initialVoiceId = '',
  initialVoiceName = '',
  activeItemId = null,
  selectedDay,
  cues = [],
  readOnly = false,
  onClose,
  onSave,
  onSelectCue,
  onApplyVoiceToCues,
}: VogModalProps) {
  const [tab, setTab] = useState<'cue' | 'all'>('cue');
  const [text, setText] = useState(initialText);
  const [voiceId, setVoiceId] = useState(initialVoiceId);
  const [bulkVoiceId, setBulkVoiceId] = useState('');
  const [dayOnly, setDayOnly] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [voices, setVoices] = useState<VogVoiceOption[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'download' | 'downloadAll' | 'save' | null>(null);
  const [bulkProgress, setBulkProgress] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(initialText || '');
    setVoiceId(initialVoiceId || '');
    setError('');
    setStatus('');
    setBulkProgress('');
    setBusy(null);
  }, [open, activeItemId, initialText, initialVoiceId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingVoices(true);
    void (async () => {
      try {
        const res = await apiClient.listVogVoices();
        if (cancelled) return;
        setConfigured(Boolean(res.configured));
        setVoices(res.voices || []);
        setVoiceId((prev) => {
          if (prev && res.voices?.some((v) => v.voiceId === prev)) return prev;
          return res.voices?.[0]?.voiceId || '';
        });
        setBulkVoiceId((prev) => {
          if (prev && res.voices?.some((v) => v.voiceId === prev)) return prev;
          return res.voices?.[0]?.voiceId || '';
        });
      } catch (err) {
        if (!cancelled) {
          setConfigured(false);
          setError(err instanceof Error ? err.message : 'Could not load voices');
        }
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceId === voiceId) || null,
    [voices, voiceId]
  );
  const voiceName = selectedVoice?.name || initialVoiceName || '';

  const bulkVoice = useMemo(
    () => voices.find((v) => v.voiceId === bulkVoiceId) || null,
    [voices, bulkVoiceId]
  );

  const vogCues = useMemo(() => {
    const withText = cues.filter((c) => hasVogText(c.vogText));
    if (!dayOnly || selectedDay == null) return withText;
    return withText.filter((c) => Number(c.day || 1) === Number(selectedDay));
  }, [cues, dayOnly, selectedDay]);

  useEffect(() => {
    setSelectedIds(new Set(vogCues.map((c) => c.id)));
  }, [vogCues]);

  const persist = async () => {
    if (readOnly || !onSave) return;
    await onSave({
      vogText: text.trim(),
      vogVoiceId: voiceId,
      vogVoiceName: voiceName,
    });
  };

  const saveAndClose = async () => {
    if (readOnly) {
      onClose();
      return;
    }
    setBusy('save');
    setError('');
    setStatus('Saving to Neon…');
    try {
      await persist();
      setStatus('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async () => {
    if (!text.trim() || !voiceId) {
      setError('Enter script text and choose a voice first.');
      return;
    }
    setBusy('preview');
    setError('');
    setStatus('Generating preview…');
    try {
      const blob = await apiClient.previewVogSpeech({
        text: text.trim(),
        voiceId,
        outputFormat: VOG_OUTPUT_FORMAT,
      });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
      setStatus('Playing MP3 preview.');
      try {
        await persist();
        setStatus('Playing MP3 preview · script saved.');
      } catch {
        setStatus('Playing MP3 preview · script not saved yet.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  const runDownload = async () => {
    if (!text.trim() || !voiceId) {
      setError('Enter script text and choose a voice first.');
      return;
    }
    setBusy('download');
    setError('');
    setStatus('Generating MP3…');
    try {
      const stem = safeFileStem(
        [cueLabel, segmentName, voiceName || 'voice'].filter(Boolean).join(' - ')
      );
      const blob = await apiClient.downloadVogSpeech({
        text: text.trim(),
        voiceId,
        outputFormat: VOG_OUTPUT_FORMAT,
        fileName: `${stem}.mp3`,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stem}.mp3`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('MP3 downloaded.');
      try {
        await persist();
        setStatus('MP3 downloaded · script saved.');
      } catch {
        setStatus('MP3 downloaded · script not saved yet.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllListed = () => setSelectedIds(new Set(vogCues.map((c) => c.id)));
  const selectNone = () => setSelectedIds(new Set());

  const applyBulkVoice = async () => {
    if (readOnly || !onApplyVoiceToCues || !bulkVoiceId || !bulkVoice) return;
    const ids = vogCues.map((c) => c.id);
    if (!ids.length) return;
    setBusy('save');
    setError('');
    setStatus(`Applying ${bulkVoice.name} to ${ids.length} cues…`);
    try {
      await onApplyVoiceToCues(ids, bulkVoice.voiceId, bulkVoice.name);
      setStatus(`Applied ${bulkVoice.name} to ${ids.length} cues.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk voice update failed');
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  const runDownloadAll = async () => {
    const selected = vogCues.filter((c) => selectedIds.has(c.id));
    if (!selected.length) {
      setError('Select at least one cue with a script.');
      return;
    }
    setBusy('downloadAll');
    setError('');
    setBulkProgress(`0/${selected.length}`);
    setStatus('Building ZIP…');
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let done = 0;
      for (const cue of selected) {
        const vid = cue.vogVoiceId || voiceId;
        if (!vid || !cue.vogText.trim()) {
          done += 1;
          setBulkProgress(`${done}/${selected.length}`);
          continue;
        }
        const blob = await apiClient.downloadVogSpeech({
          text: cue.vogText.trim(),
          voiceId: vid,
          outputFormat: VOG_OUTPUT_FORMAT,
        });
        const stem = safeFileStem(
          [cue.cueLabel, cue.segmentName, cue.vogVoiceName || 'voice'].filter(Boolean).join(' - ')
        );
        zip.file(`${stem}.mp3`, blob);
        done += 1;
        setBulkProgress(`${done}/${selected.length}`);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vog-day${selectedDay ?? 'all'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded ZIP (${done} files).`);
      setBulkProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ZIP download failed');
      setStatus('');
      setBulkProgress('');
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const tabBtn = (id: 'cue' | 'all', label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(id);
        setError('');
        setStatus('');
      }}
      className={`relative flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
        tab === id
          ? 'bg-slate-800 text-white shadow-sm'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
      {tab === id ? (
        <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-violet-400" />
      ) : null}
    </button>
  );

  const metaChip = (label: string, value: string, title?: string) => (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-600/70 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-300"
      title={title || value}
    >
      <span className="uppercase tracking-wide text-slate-500">{label}</span>
      <span className="truncate font-mono text-slate-200">{value}</span>
    </span>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[1px]"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex w-full max-w-3xl max-h-[84vh] flex-col overflow-hidden rounded-2xl border border-slate-600/50 bg-slate-850 shadow-2xl shadow-black/50"
        style={{ background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-violet-500 via-fuchsia-400/80 to-sky-400" />

        <div className="shrink-0 border-b border-slate-700/70 px-5 pt-3.5 pb-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-200 ring-1 ring-violet-400/30">
                  VOG
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  ElevenLabs · MP3
                </span>
                {readOnly ? (
                  <span className="rounded-md bg-slate-700/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                    View only
                  </span>
                ) : null}
              </div>
              <h2 className="truncate text-lg font-bold tracking-tight text-white">
                {tab === 'cue' ? segmentName || 'Voice of God' : 'All VOG scripts'}
              </h2>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {tab === 'cue' && cueLabel
                  ? metaChip('Cue', cueLabel)
                  : null}
                {tab === 'cue' && activeItemId != null
                  ? metaChip('Item', String(activeItemId), `schedule_item_id ${activeItemId}`)
                  : null}
                {eventId
                  ? metaChip(
                      'Event',
                      eventId.length > 12 ? `${eventId.slice(0, 8)}…` : eventId,
                      eventId
                    )
                  : null}
                {tab === 'all' ? (
                  <span className="inline-flex items-center rounded-md border border-slate-600/70 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-300">
                    {vogCues.length} script{vogCues.length === 1 ? '' : 's'}
                    {selectedDay != null ? ` · Day ${selectedDay}` : ''}
                  </span>
                ) : null}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={!!busy}
              className="rounded-lg px-2.5 py-1.5 text-lg leading-none text-slate-400 hover:bg-slate-700/70 hover:text-white disabled:opacity-50"
              title="Close without saving"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mt-2.5 flex rounded-lg bg-slate-950/55 p-1 ring-1 ring-slate-700/70">
            {tabBtn('cue', 'This cue')}
            {tabBtn('all', `All VOG (${vogCues.length})`)}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {configured === false && (
            <div className="mb-4 rounded-xl border border-amber-600/40 bg-amber-950/40 px-3 py-2.5 text-sm text-amber-100">
              Set <code className="rounded bg-black/30 px-1">ELEVENLABS_API_KEY</code> on Railway, then
              redeploy.
            </div>
          )}

          {tab === 'cue' ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-3">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Voice
                </label>
                <select
                  value={voiceId}
                  disabled={readOnly || loadingVoices || !voices.length}
                  onChange={(e) => setVoiceId(e.target.value)}
                  className={fieldClass}
                >
                  {!voices.length && (
                    <option value="">{loadingVoices ? 'Loading voices…' : 'No voices'}</option>
                  )}
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                      {v.category ? ` (${v.category})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-3">
                <div className="mb-1 flex items-end justify-between gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Script
                  </label>
                  <span className="tabular-nums text-[11px] text-slate-500">
                    {text.trim().length.toLocaleString()} chars
                  </span>
                </div>
                <textarea
                  value={text}
                  disabled={readOnly}
                  onChange={(e) => setText(e.target.value)}
                  rows={7}
                  placeholder="Type the Voice of God script for this cue…"
                  className={`${fieldClass} min-h-[9rem] max-h-[28vh] resize-y leading-relaxed`}
                />
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  Saves to Neon{' '}
                  <span className="font-mono text-slate-400">event_vog_scripts</span>
                  {eventId ? (
                    <>
                      {' '}
                      · event{' '}
                      <span className="font-mono text-slate-400" title={eventId}>
                        {eventId.slice(0, 8)}…
                      </span>
                    </>
                  ) : null}
                  {activeItemId != null ? (
                    <>
                      {' '}
                      · item{' '}
                      <span className="font-mono text-slate-400">{activeItemId}</span>
                    </>
                  ) : null}
                  . Audio on demand.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/35 p-3.5">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Voice for all listed
                    </label>
                    <select
                      value={bulkVoiceId}
                      disabled={readOnly || loadingVoices || !voices.length}
                      onChange={(e) => setBulkVoiceId(e.target.value)}
                      className={fieldClass}
                    >
                      {!voices.length && (
                        <option value="">{loadingVoices ? 'Loading voices…' : 'No voices'}</option>
                      )}
                      {voices.map((v) => (
                        <option key={v.voiceId} value={v.voiceId}>
                          {v.name}
                          {v.category ? ` (${v.category})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    disabled={readOnly || !bulkVoiceId || !vogCues.length || !!busy}
                    onClick={() => void applyBulkVoice()}
                    className="rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    Apply voice
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || !configured || selectedIds.size === 0}
                    onClick={() => void runDownloadAll()}
                    className="rounded-lg border border-emerald-600/40 bg-emerald-950/45 px-3.5 py-2.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/55 disabled:opacity-50"
                  >
                    {busy === 'downloadAll'
                      ? `Zipping… ${bulkProgress}`
                      : `Download ZIP (${selectedIds.size})`}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                {selectedDay != null && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={dayOnly}
                      onChange={(e) => setDayOnly(e.target.checked)}
                      className="rounded border-slate-500"
                    />
                    Day {selectedDay} only
                  </label>
                )}
                <button type="button" className="hover:text-white" onClick={selectAllListed}>
                  Select all
                </button>
                <span className="text-slate-600">·</span>
                <button type="button" className="hover:text-white" onClick={selectNone}>
                  Select none
                </button>
              </div>

              {vogCues.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-600 bg-slate-950/30 px-4 py-10 text-center text-sm text-slate-400">
                  No cues have a VOG script yet
                  {dayOnly && selectedDay != null ? ` on day ${selectedDay}` : ''}.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-700/70">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-950/80 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <tr>
                        <th className="w-10 px-3 py-2.5" />
                        <th className="px-3 py-2.5">Cue</th>
                        <th className="px-3 py-2.5">Segment / script</th>
                        <th className="px-3 py-2.5">Voice</th>
                        <th className="px-3 py-2.5 text-right">Chars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vogCues.map((cue) => {
                        const active = cue.id === activeItemId;
                        return (
                          <tr
                            key={cue.id}
                            className={`border-t border-slate-700/70 ${
                              active ? 'bg-violet-950/35' : 'bg-slate-900/25 hover:bg-slate-800/45'
                            }`}
                          >
                            <td className="px-3 py-2.5 align-top">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(cue.id)}
                                onChange={() => toggleSelected(cue.id)}
                                className="rounded border-slate-500"
                              />
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <button
                                type="button"
                                className="text-left font-semibold text-violet-300 hover:text-violet-200"
                                onClick={() => {
                                  void persist().finally(() => {
                                    onSelectCue?.(cue.id);
                                    setTab('cue');
                                  });
                                }}
                                title="Open this cue"
                              >
                                {cue.cueLabel || `ID ${cue.id}`}
                              </button>
                              <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                                item {cue.id}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-top text-slate-200">
                              <div className="line-clamp-2 font-medium">{cue.segmentName || '—'}</div>
                              <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">
                                {cue.vogText.trim().slice(0, 120)}
                                {cue.vogText.trim().length > 120 ? '…' : ''}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 align-top text-slate-300">
                              {cue.vogVoiceName || cue.vogVoiceId || '—'}
                            </td>
                            <td className="px-3 py-2.5 align-top text-right tabular-nums text-slate-400">
                              {cue.vogText.trim().length}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {(error || status) && (
          <div className="shrink-0 space-y-2 px-5 pb-1">
            {error && (
              <div className="rounded-lg border border-red-700/50 bg-red-950/50 px-3 py-2 text-sm text-red-200">
                {error}
              </div>
            )}
            {status && !error && (
              <p className="text-sm text-emerald-300">{status}</p>
            )}
          </div>
        )}

        <div className="shrink-0 border-t border-slate-700/70 px-5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {tab === 'cue' && (
                <>
                  <button
                    type="button"
                    disabled={!!busy || readOnly || !configured}
                    onClick={() => void runPreview()}
                    className="rounded-lg border border-slate-600 bg-slate-800/90 px-3.5 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {busy === 'preview' ? 'Previewing…' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy || readOnly || !configured}
                    onClick={() => void runDownload()}
                    className="rounded-lg border border-emerald-700/45 bg-emerald-950/40 px-3.5 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-900/55 disabled:opacity-50"
                  >
                    {busy === 'download' ? 'Downloading…' : 'Download MP3'}
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!!busy}
                onClick={onClose}
                className="rounded-lg border border-slate-600/80 px-3.5 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!!busy || readOnly}
                onClick={() => void saveAndClose()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500 disabled:opacity-50"
              >
                {busy === 'save' ? 'Saving…' : 'Save and Close'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
