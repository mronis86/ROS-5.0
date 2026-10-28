import React, { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { GuestScheduleItem } from '../../lib/eventGuestLinks';
import {
  formatNameForTwoLines,
  formatSpeakerLocation,
  parseSpeakers,
} from '../../showcase/photoShowcaseHelpers';

type SpeakerPanel = 'photos' | 'info';

interface GuestSpeakersModalProps {
  open: boolean;
  item: GuestScheduleItem | null;
  panel: SpeakerPanel;
  onPanelChange: (panel: SpeakerPanel) => void;
  onClose: () => void;
}

async function copyText(value: string): Promise<boolean> {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function speakerSubInfo(speaker: { title?: string; org?: string }): string {
  return [speaker.title, speaker.org].filter(Boolean).join(', ');
}

function CopyFieldButton({
  copyKey,
  value,
  copiedKey,
  label,
  onCopy,
}: {
  copyKey: string;
  value: string;
  copiedKey: string | null;
  label: string;
  onCopy: (key: string, value: string) => void;
}) {
  const text = String(value || '').trim();
  if (!text) return null;
  const copied = copiedKey === copyKey;
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, text)}
      className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-sky-200 hover:bg-slate-700/80"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

const GuestSpeakersModal: React.FC<GuestSpeakersModalProps> = ({
  open,
  item,
  panel,
  onPanelChange,
  onClose,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = useCallback(async (key: string, value: string) => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1600);
  }, []);

  if (!open || !item) return null;

  const speakers = parseSpeakers(item.speakersText || item.speakers).filter(
    (s) => s.fullName || s.photoLink
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-slate-600 bg-slate-900 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-speakers-title"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div className="min-w-0">
            <h2 id="guest-speakers-title" className="font-semibold text-white truncate">
              Speakers · {item.segmentName || 'Cue'}
            </h2>
            {item.cue ? <p className="text-xs text-slate-400 font-mono">CUE {item.cue}</p> : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex rounded-md border border-slate-600 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => onPanelChange('photos')}
                className={`px-3 py-1.5 font-semibold ${
                  panel === 'photos' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Photos
              </button>
              <button
                type="button"
                onClick={() => onPanelChange('info')}
                className={`px-3 py-1.5 font-semibold border-l border-slate-600 ${
                  panel === 'info' ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                Info
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-lg leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {speakers.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No speakers on this cue.</p>
          ) : panel === 'photos' ? (
            <div className="flex flex-wrap justify-center gap-6">
              {speakers.map((speaker, idx) => {
                const name = formatNameForTwoLines(speaker.fullName || 'Unnamed');
                const titleOrg = speakerSubInfo(speaker);
                const slotKey = speaker.slot ?? idx;
                return (
                  <div key={`${slotKey}`} className="flex flex-col items-center text-center max-w-[12rem]">
                    <img
                      src={speaker.photoLink || '/speaker-placeholder.svg'}
                      alt={speaker.fullName || 'Speaker'}
                      className="w-28 h-36 rounded-lg object-cover border-2 border-slate-500 shadow-lg"
                      style={{ objectPosition: 'center top' }}
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = '/speaker-placeholder.svg';
                      }}
                    />
                    <div className="mt-2 flex items-start justify-center gap-0.5 max-w-full">
                      <div
                        className={`font-bold text-white leading-tight ${name.needsSmallText ? 'text-sm' : 'text-base'}`}
                        dangerouslySetInnerHTML={{ __html: name.html }}
                      />
                      <CopyFieldButton
                        copyKey={`name-${slotKey}`}
                        value={speaker.fullName || ''}
                        copiedKey={copiedKey}
                        label="name"
                        onCopy={(key, value) => void handleCopy(key, value)}
                      />
                    </div>
                    {titleOrg ? (
                      <div className="mt-1 flex items-start justify-center gap-0.5 max-w-full">
                        <p className="text-xs text-slate-400">{titleOrg}</p>
                        <CopyFieldButton
                          copyKey={`info-${slotKey}`}
                          value={titleOrg}
                          copiedKey={copiedKey}
                          label="title and organization"
                          onCopy={(key, value) => void handleCopy(key, value)}
                        />
                      </div>
                    ) : null}
                    {speaker.location ? (
                      <p className="text-xs text-slate-300 mt-1 bg-slate-800 px-2 py-0.5 rounded">
                        {formatSpeakerLocation(speaker.location)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="space-y-3">
              {speakers.map((speaker, idx) => {
                const titleOrg = speakerSubInfo(speaker);
                const slotKey = speaker.slot ?? idx;
                return (
                  <li
                    key={`${slotKey}`}
                    className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3"
                  >
                    <div className="flex items-start gap-1.5 min-w-0">
                      <div className="font-semibold text-white text-lg min-w-0 break-words">
                        {speaker.fullName || 'Unnamed'}
                      </div>
                      <CopyFieldButton
                        copyKey={`name-${slotKey}`}
                        value={speaker.fullName || ''}
                        copiedKey={copiedKey}
                        label="name"
                        onCopy={(key, value) => void handleCopy(key, value)}
                      />
                    </div>
                    {titleOrg ? (
                      <div className="flex items-start gap-1.5 mt-1 min-w-0">
                        <p className="text-sm text-slate-300 min-w-0 break-words">{titleOrg}</p>
                        <CopyFieldButton
                          copyKey={`info-${slotKey}`}
                          value={titleOrg}
                          copiedKey={copiedKey}
                          label="title and organization"
                          onCopy={(key, value) => void handleCopy(key, value)}
                        />
                      </div>
                    ) : null}
                    {speaker.location ? (
                      <p className="text-xs text-slate-400 mt-2">{formatSpeakerLocation(speaker.location)}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default GuestSpeakersModal;
