import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../services/api-client';

export type VogVoiceOption = {
  voiceId: string;
  name: string;
  category?: string | null;
  description?: string | null;
  previewUrl?: string | null;
};

type VogModalProps = {
  open: boolean;
  segmentName?: string;
  cueLabel?: string;
  initialText?: string;
  initialVoiceId?: string;
  initialVoiceName?: string;
  readOnly?: boolean;
  onClose: () => void;
  onSave?: (next: { vogText: string; vogVoiceId: string; vogVoiceName: string }) => void;
};

function safeFileStem(raw: string) {
  return (
    String(raw || 'vog')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'vog'
  );
}

export default function VogModal({
  open,
  segmentName,
  cueLabel,
  initialText = '',
  initialVoiceId = '',
  initialVoiceName = '',
  readOnly = false,
  onClose,
  onSave,
}: VogModalProps) {
  const [text, setText] = useState(initialText);
  const [voiceId, setVoiceId] = useState(initialVoiceId);
  const [voices, setVoices] = useState<VogVoiceOption[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
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
  }, [open, initialText, initialVoiceId]);

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
        outputFormat: 'wav_44100',
      });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
      setStatus('Playing preview (not saved to ROS).');
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
    setStatus('Generating WAV…');
    try {
      const stem = safeFileStem(
        [cueLabel, segmentName, voiceName || 'voice'].filter(Boolean).join(' - ')
      );
      const blob = await apiClient.downloadVogSpeech({
        text: text.trim(),
        voiceId,
        outputFormat: 'wav_44100',
        fileName: stem,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stem}.wav`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('WAV downloaded to this computer.');
      persist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
      setStatus('');
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl p-6 max-w-2xl w-full shadow-xl border border-slate-500/50">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">VOG · ElevenLabs</h2>
            <p className="text-sm text-slate-400 mt-1">
              {cueLabel ? <span className="text-slate-200 font-semibold">{cueLabel}</span> : null}
              {cueLabel && segmentName ? ' · ' : null}
              {segmentName || 'This cue'}
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

        <p className="text-xs text-slate-400 mb-4">
          Preview plays in the browser (not stored). Download saves a WAV to this computer. Audio is
          generated through the ROS API — the ElevenLabs key stays on Railway.
        </p>

        {configured === false && (
          <div className="mb-3 rounded-lg border border-amber-700/50 bg-amber-900/30 px-3 py-2 text-sm text-amber-100">
            Set <code className="bg-slate-900 px-1 rounded">ELEVENLABS_API_KEY</code> on Railway, then
            redeploy.
          </div>
        )}

        <label className="block text-xs text-slate-300 mb-1">Voice</label>
        <select
          value={voiceId}
          disabled={readOnly || loadingVoices || !voices.length}
          onChange={(e) => setVoiceId(e.target.value)}
          className="w-full mb-3 rounded-lg border border-slate-600 bg-slate-900 text-white px-3 py-2 text-sm"
        >
          {!voices.length && <option value="">{loadingVoices ? 'Loading voices…' : 'No voices'}</option>}
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
        <p className="text-xs text-slate-500 mb-4">{text.trim().length} characters</p>

        {error && (
          <div className="mb-3 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {status && !error && <p className="mb-3 text-sm text-emerald-300">{status}</p>}

        <div className="flex flex-wrap items-center gap-2 justify-end">
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
            {busy === 'download' ? 'Downloading…' : 'Download WAV'}
          </button>
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
