import React from 'react';
import { parseSpeakers } from '../../showcase/photoShowcaseHelpers';
import type { GuestScheduleItem } from '../../lib/eventGuestLinks';
import { formatSpeakerLocation, formatNameForTwoLines } from '../../showcase/photoShowcaseHelpers';

type SpeakerPanel = 'photos' | 'info';

interface GuestSpeakersModalProps {
  open: boolean;
  item: GuestScheduleItem | null;
  panel: SpeakerPanel;
  onPanelChange: (panel: SpeakerPanel) => void;
  onClose: () => void;
}

const GuestSpeakersModal: React.FC<GuestSpeakersModalProps> = ({
  open,
  item,
  panel,
  onPanelChange,
  onClose,
}) => {
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
                const titleOrg = [speaker.title, speaker.org].filter(Boolean).join(', ');
                return (
                  <div key={`${speaker.slot ?? idx}`} className="flex flex-col items-center text-center max-w-[10rem]">
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
                    <div
                      className={`mt-2 font-bold text-white leading-tight ${name.needsSmallText ? 'text-sm' : 'text-base'}`}
                      dangerouslySetInnerHTML={{ __html: name.html }}
                    />
                    {titleOrg ? <p className="text-xs text-slate-400 mt-1">{titleOrg}</p> : null}
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
              {speakers.map((speaker, idx) => (
                <li
                  key={`${speaker.slot ?? idx}`}
                  className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3"
                >
                  <div className="font-semibold text-white text-lg">{speaker.fullName || 'Unnamed'}</div>
                  {[speaker.title, speaker.org].filter(Boolean).length ? (
                    <p className="text-sm text-slate-300 mt-1">
                      {[speaker.title, speaker.org].filter(Boolean).join(', ')}
                    </p>
                  ) : null}
                  {speaker.location ? (
                    <p className="text-xs text-slate-400 mt-2">{formatSpeakerLocation(speaker.location)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default GuestSpeakersModal;
