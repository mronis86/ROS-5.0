import React, { useEffect, useMemo, useRef, useState } from 'react';
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

type VogModalProps = {
  open: boolean;
  segmentName?: string;
  cueLabel?: string;
  initialText?: string;
  initialVoiceId?: string;
  initialVoiceName?: string;
  activeItemId?: number | null;
  selectedDay?: number;
  /** Full schedule rows (modal filters to those with VOG text for the All tab). */
  cues?: VogCueSummary[];
  readOnly?: boolean;
  onClose: () => void;
  onSave?: (next: { vogText: string; vogVoiceId: string; vogVoiceName: string }) => void;
  onSelectCue?: (itemId: number) => void;
  onApplyVoiceToCues?: (itemIds: number[], voiceId: string, voiceName: string) => void;
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

export default function VogModal({
  open,
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
  const [busy, setBusy] = useState<'preview' | 'download' | 'downloadAll' | null>(null);
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
  }, [open, initialText, initialVoiceId, activeItemId]);

  useEffect(() => {
    if (!open) return;
    setTab('cue');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingVoices(true);
      setError('');
      try {
        const st = await apiClient.getVogStatus();
        if (cancelled) return;
        setConfigured(st?.configured === true);
        if (!st?.configured) {
          setVoices([]);
          setError('ElevenLabs is not configured on Railway (ELEVENLABS_API_KEY).');
          return;
        }
        const pack = await apiClient.listVogVoices();
        if (cancelled) return;
        const list = Array.isArray(pack?.voices) ? pack.voices : [];
        setVoices(list);
        if (!voiceId && list[0]?.voiceId) setVoiceId(list[0].voiceId);
        if (!bulkVoiceId && (initialVoiceId || list[0]?.voiceId)) {
          setBulkVoiceId(initialVoiceId || list[0].voiceId);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load voices');
        }
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when opened
  }, [open]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
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

  const persist = () => {
    if (readOnly || !onSave) return;
    onSave({
      vogText: text.trim(),
      vogVoiceId: voiceId,
      vogVoiceName: voiceName,
    });
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
      setStatus('Playing MP3 preview (not saved to ROS).');
      persist();
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
        fileName: stem,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stem}.mp3`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('MP3 downloaded to this computer.');
      persist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  const applyBulkVoice = () => {
    if (readOnly || !onApplyVoiceToCues) return;
    if (!bulkVoiceId) {
      setError('Choose a voice to apply.');
      return;
    }
    const ids = vogCues.map((c) => c.id);
    if (!ids.length) {
      setError('No cues with VOG scripts to update.');
      return;
    }
    const name = bulkVoice?.name || bulkVoiceId;
    onApplyVoiceToCues(ids, bulkVoiceId, name);
    if (activeItemId != null && ids.includes(activeItemId)) {
      setVoiceId(bulkVoiceId);
    }
    setStatus(`Applied “${name}” to ${ids.length} VOG cue${ids.length === 1 ? '' : 's'}.`);
    setError('');
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

  const runDownloadAll = async () => {
    const targets = vogCues.filter((c) => selectedIds.has(c.id));
    if (!targets.length) {
      setError('Select at least one cue with a VOG script.');
      return;
    }
    setBusy('downloadAll');
    setError('');
    setStatus('');
    setBulkProgress(`0 / ${targets.length}`);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const usedNames = new Map<string, number>();
      for (let i = 0; i < targets.length; i++) {
        const cue = targets[i];
        const voiceForCue = String(cue.vogVoiceId || bulkVoiceId || voiceId || '').trim();
        if (!voiceForCue) {
          throw new Error(`Cue ${cue.cueLabel || cue.id} has no voice set.`);
        }
        setBulkProgress(`${i + 1} / ${targets.length} · ${cue.cueLabel || cue.segmentName || cue.id}`);
        const voiceLabel =
          voices.find((v) => v.voiceId === voiceForCue)?.name ||
          cue.vogVoiceName ||
          'voice';
        let stem = safeFileStem(
          [cue.cueLabel, cue.segmentName, voiceLabel].filter(Boolean).join(' - ')
        );
        const count = usedNames.get(stem) || 0;
        usedNames.set(stem, count + 1);
        if (count > 0) stem = `${stem} (${count + 1})`;
        const blob = await apiClient.downloadVogSpeech({
          text: cue.vogText.trim(),
          voiceId: voiceForCue,
          outputFormat: VOG_OUTPUT_FORMAT,
          fileName: stem,
        });
        zip.file(`${stem}.mp3`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeFileStem(
        selectedDay != null ? `VOG-day-${selectedDay}` : 'VOG-all'
      ) + '.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded ZIP with ${targets.length} MP3${targets.length === 1 ? '' : 's'}.`);
      setBulkProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk download failed');
      setStatus('');
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
      className={`px-3 py-1.5 text-sm font-semibold rounded-t-md border-b-2 transition-colors ${
        tab === id
          ? 'border-sky-400 text-white bg-slate-700/80'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl p-6 max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-xl border border-slate-500/50">
        <div className="mb-2 flex items-start justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-white">VOG · ElevenLabs</h2>
            <p className="text-sm text-slate-400 mt-1">
              {tab === 'cue' ? (
                <>
                  {cueLabel ? <span className="text-slate-200 font-semibold">{cueLabel}</span> : null}
                  {cueLabel && segmentName ? ' · ' : null}
                  {segmentName || 'This cue'}
                </>
              ) : (
                <>All cues with a VOG script{selectedDay != null ? ` · Day ${selectedDay}` : ''}</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              persist();
              onClose();
            }}
            className="text-slate-300 hover:text-white text-sm font-semibold px-2"
          >
            Close
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-600 mb-3 shrink-0">
          {tabBtn('cue', 'This cue')}
          {tabBtn('all', `All VOG (${vogCues.length})`)}
        </div>

        <p className="text-xs text-slate-400 mb-3 shrink-0">
          Preview and download use MP3 (ElevenLabs Starter). WAV at 44.1 kHz needs Pro+. The API key
          stays on Railway.
        </p>

        {configured === false && (
          <div className="mb-3 rounded-lg border border-amber-700/50 bg-amber-900/30 px-3 py-2 text-sm text-amber-100 shrink-0">
            Set <code className="bg-slate-900 px-1 rounded">ELEVENLABS_API_KEY</code> on Railway, then
            redeploy.
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === 'cue' ? (
            <>
              <label className="block text-xs text-slate-300 mb-1">Voice</label>
              <select
                value={voiceId}
                disabled={readOnly || loadingVoices || !voices.length}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full mb-3 rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 text-sm"
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

              <label className="block text-xs text-slate-300 mb-1">Script</label>
              <textarea
                value={text}
                disabled={readOnly}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Type the Voice of God script for this cue…"
                className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 text-sm mb-2"
              />
              <p className="text-xs text-slate-500 mb-2">{text.trim().length} characters</p>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2 mb-3">
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs text-slate-300 mb-1">Voice for all listed</label>
                  <select
                    value={bulkVoiceId}
                    disabled={readOnly || loadingVoices || !voices.length}
                    onChange={(e) => setBulkVoiceId(e.target.value)}
                    className="w-full rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 text-sm"
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
                  onClick={applyBulkVoice}
                  className="rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white text-sm font-semibold px-3 py-2"
                >
                  Apply voice to all
                </button>
                <button
                  type="button"
                  disabled={!!busy || !configured || selectedIds.size === 0}
                  onClick={() => void runDownloadAll()}
                  className="rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-3 py-2"
                >
                  {busy === 'downloadAll'
                    ? `Zipping… ${bulkProgress}`
                    : `Download selected (${selectedIds.size})`}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 mb-2 text-xs text-slate-300">
                {selectedDay != null && (
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dayOnly}
                      onChange={(e) => setDayOnly(e.target.checked)}
                      className="rounded border-slate-500"
                    />
                    Day {selectedDay} only
                  </label>
                )}
                <button type="button" className="underline hover:text-white" onClick={selectAllListed}>
                  Select all
                </button>
                <button type="button" className="underline hover:text-white" onClick={selectNone}>
                  Select none
                </button>
                <span className="text-slate-500">{vogCues.length} with script</span>
              </div>

              {vogCues.length === 0 ? (
                <div className="rounded-lg border border-slate-600 bg-slate-900/60 px-4 py-8 text-center text-sm text-slate-400">
                  No cues have a VOG script yet
                  {dayOnly && selectedDay != null ? ` on day ${selectedDay}` : ''}.
                </div>
              ) : (
                <div className="rounded-lg border border-slate-600 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-700 text-slate-200 text-left">
                      <tr>
                        <th className="px-2 py-2 w-8" />
                        <th className="px-2 py-2">Cue</th>
                        <th className="px-2 py-2">Segment</th>
                        <th className="px-2 py-2">Voice</th>
                        <th className="px-2 py-2 text-right">Chars</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vogCues.map((cue) => {
                        const active = cue.id === activeItemId;
                        return (
                          <tr
                            key={cue.id}
                            className={`border-t border-slate-600 ${
                              active ? 'bg-sky-950/50' : 'bg-slate-900/40 hover:bg-slate-700/40'
                            }`}
                          >
                            <td className="px-2 py-2 align-top">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(cue.id)}
                                onChange={() => toggleSelected(cue.id)}
                                className="rounded border-slate-500"
                              />
                            </td>
                            <td className="px-2 py-2 align-top">
                              <button
                                type="button"
                                className="text-sky-300 hover:text-sky-200 font-semibold text-left"
                                onClick={() => {
                                  persist();
                                  onSelectCue?.(cue.id);
                                  setTab('cue');
                                }}
                                title="Open this cue"
                              >
                                {cue.cueLabel || `ID ${cue.id}`}
                              </button>
                            </td>
                            <td className="px-2 py-2 align-top text-slate-200">
                              <div className="line-clamp-2">{cue.segmentName || '—'}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                                {cue.vogText.trim().slice(0, 120)}
                                {cue.vogText.trim().length > 120 ? '…' : ''}
                              </div>
                            </td>
                            <td className="px-2 py-2 align-top text-slate-300 whitespace-nowrap">
                              {cue.vogVoiceName || cue.vogVoiceId || '—'}
                            </td>
                            <td className="px-2 py-2 align-top text-right text-slate-400 tabular-nums">
                              {cue.vogText.trim().length}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200 shrink-0">
            {error}
          </div>
        )}
        {status && !error && (
          <p className="mt-3 text-sm text-emerald-300 shrink-0">{status}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 justify-end shrink-0">
          {tab === 'cue' && (
            <>
              <button
                type="button"
                disabled={!!busy || readOnly || !configured}
                onClick={() => void runPreview()}
                className="rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2"
              >
                {busy === 'preview' ? 'Previewing…' : 'Preview'}
              </button>
              <button
                type="button"
                disabled={!!busy || readOnly || !configured}
                onClick={() => void runDownload()}
                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2"
              >
                {busy === 'download' ? 'Downloading…' : 'Download MP3'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              persist();
              onClose();
            }}
            className="rounded-lg bg-slate-600 hover:bg-slate-500 text-white text-sm font-semibold px-4 py-2"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
