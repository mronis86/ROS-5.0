import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DEMO_EVENT, DEMO_SPEAKER_PHOTOS, SHOWCASE_FULL_CUE_COUNT } from './demoData';
import { getShowcaseScheduleTrt } from './showcaseFollowMode';
import { PROGRAM_TYPE_COLORS } from './showcaseConstants';
import { ShowcaseFakeCursor, showcaseTargetPoint, waitMs } from './ShowcaseFakeCursor';

type SpeakerDraft = {
  id: string;
  slot: number;
  location: string;
  fullName: string;
  title: string;
  org: string;
  photoLink: string;
};

type Phase = 'form' | 'speakers' | 'done';

const PROGRAM_TYPES = [
  'PreShow/End',
  'Podium Transition',
  'Panel Transition',
  'Full-Stage/Ted-Talk',
  'Break F&B/B2B',
];

const SHOT_TYPES = ['Wide', 'Medium', 'Two Shot', 'Close Up'];

const DEMO_SPEAKERS: Omit<SpeakerDraft, 'id'>[] = [
  {
    slot: 1,
    location: 'Podium',
    fullName: 'Elena Vasquez',
    title: 'Director of Research',
    org: 'DataWorks',
    photoLink: DEMO_SPEAKER_PHOTOS.elenaVasquez,
  },
  {
    slot: 2,
    location: 'Seat',
    fullName: 'Marcus Webb',
    title: 'CEO',
    org: 'InnovateLab',
    photoLink: DEMO_SPEAKER_PHOTOS.marcusWebb,
  },
  {
    slot: 3,
    location: 'Virtual',
    fullName: 'Priya Sharma',
    title: 'Industry Analyst',
    org: 'Global Insights',
    photoLink: DEMO_SPEAKER_PHOTOS.priyaSharma,
  },
];

const FINAL_FORM = {
  cue: '7',
  programType: 'Panel Transition',
  segmentName: 'Fireside Chat — Leadership Voices',
  shotType: 'Two Shot',
  durationHours: 0,
  durationMinutes: 20,
  durationSeconds: 0,
  hasPPT: false,
  hasQA: true,
  isPublic: true,
};

function displaySpeakersPreview(speakers: SpeakerDraft[]): string {
  return speakers
    .filter((s) => s.fullName.trim())
    .sort((a, b) => a.slot - b.slot)
    .map((s) => {
      const loc =
        s.location === 'Podium' ? 'P' : s.location === 'Seat' ? 'S' : s.location === 'Virtual' ? 'V' : 'M';
      return `${loc}${s.slot} - ${s.fullName}`;
    })
    .join('\n');
}

function speakersJson(speakers: SpeakerDraft[]): string {
  return JSON.stringify(
    speakers.map(({ slot, location, fullName, title, org, photoLink }) => ({
      id: `sp-${slot}`,
      slot,
      location,
      fullName,
      title,
      org,
      photoLink,
    }))
  );
}

export const AddItemShowcaseContent: React.FC = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const segmentRef = useRef<HTMLInputElement>(null);
  const speakersFieldRef = useRef<HTMLDivElement>(null);
  const addSpeakerBtnRef = useRef<HTMLButtonElement>(null);
  const saveSpeakersRef = useRef<HTMLButtonElement>(null);
  const addItemBtnRef = useRef<HTMLButtonElement>(null);
  const nameInputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const [phase, setPhase] = useState<Phase>('form');
  const [form, setForm] = useState({
    cue: '',
    programType: 'Panel Transition',
    segmentName: '',
    shotType: '',
    durationHours: 0,
    durationMinutes: 0,
    durationSeconds: 0,
    hasPPT: false,
    hasQA: false,
    isPublic: true,
    speakersText: '',
  });
  const [speakers, setSpeakers] = useState<SpeakerDraft[]>([]);
  const [typingSpeakerIdx, setTypingSpeakerIdx] = useState(-1);
  const [showNewRow, setShowNewRow] = useState(false);
  const [cursor, setCursor] = useState({ x: 640, y: 360, visible: false, clicking: false });
  const demoRunningRef = useRef(false);

  const moveTo = useCallback(async (el: HTMLElement | null, click = false) => {
    if (!el) return;
    const pt = showcaseTargetPoint(el, rootRef.current, { anchor: click ? 'center' : 'tap' });
    setCursor((c) => ({ ...c, x: pt.x, y: pt.y, visible: true, clicking: false }));
    await waitMs(380);
    if (click) {
      setCursor((c) => ({ ...c, clicking: true }));
      await waitMs(180);
      setCursor((c) => ({ ...c, clicking: false }));
    }
  }, []);

  const typeText = async (text: string, setter: (v: string) => void) => {
    for (let i = 1; i <= text.length; i++) {
      setter(text.slice(0, i));
      await waitMs(42);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const reset = () => {
      setPhase('form');
      setForm({
        cue: '',
        programType: 'Panel Transition',
        segmentName: '',
        shotType: '',
        durationHours: 0,
        durationMinutes: 0,
        durationSeconds: 0,
        hasPPT: false,
        hasQA: false,
        isPublic: true,
        speakersText: '',
      });
      setSpeakers([]);
      setTypingSpeakerIdx(-1);
      setShowNewRow(false);
      setCursor((c) => ({ ...c, visible: false }));
    };

    const addSpeakerWithTyping = async (index: number) => {
      const draft = DEMO_SPEAKERS[index];
      const id = `speaker-${index}-${Date.now()}`;
      setSpeakers((prev) => [
        ...prev,
        {
          id,
          slot: draft.slot,
          location: draft.location,
          fullName: '',
          title: '',
          org: '',
          photoLink: '',
        },
      ]);
      setTypingSpeakerIdx(index);
      await waitMs(400);

      const input = nameInputRefs.current[index];
      await moveTo(input);
      await waitMs(200);
      const targetName = draft.fullName;
      for (let c = 1; c <= targetName.length; c++) {
        if (cancelled) return;
        const partial = targetName.slice(0, c);
        setSpeakers((prev) =>
          prev.map((s, idx) =>
            idx === index
              ? {
                  ...s,
                  fullName: partial,
                  title: c === targetName.length ? draft.title : s.title,
                  org: c === targetName.length ? draft.org : s.org,
                  photoLink: c === targetName.length ? draft.photoLink : s.photoLink,
                }
              : s
          )
        );
        await waitMs(36);
      }
      await waitMs(350);
      setTypingSpeakerIdx(-1);
    };

    const run = async () => {
      if (demoRunningRef.current) return;
      demoRunningRef.current = true;
      reset();
      await waitMs(900);
      if (cancelled) return;

      setCursor((c) => ({ ...c, visible: true }));

      setForm((f) => ({ ...f, cue: FINAL_FORM.cue }));
      await waitMs(350);
      await moveTo(segmentRef.current);
      await typeText(FINAL_FORM.segmentName, (v) => setForm((f) => ({ ...f, segmentName: v })));
      await waitMs(300);
      setForm((f) => ({
        ...f,
        shotType: FINAL_FORM.shotType,
        durationMinutes: FINAL_FORM.durationMinutes,
        hasQA: true,
      }));
      await waitMs(400);

      await moveTo(speakersFieldRef.current, true);
      setPhase('speakers');
      setSpeakers([]);
      await waitMs(500);

      for (let i = 0; i < DEMO_SPEAKERS.length; i++) {
        if (cancelled) return;
        await moveTo(addSpeakerBtnRef.current, true);
        await addSpeakerWithTyping(i);
        await waitMs(500);
      }

      if (cancelled) return;
      await moveTo(saveSpeakersRef.current, true);
      const finalSpeakers = DEMO_SPEAKERS.map((s, i) => ({
        id: `sp-${i}`,
        ...s,
      }));
      setSpeakers(finalSpeakers);
      setForm((f) => ({ ...f, speakersText: speakersJson(finalSpeakers) }));
      setPhase('form');
      await waitMs(700);

      await moveTo(addItemBtnRef.current, true);
      setPhase('done');
      setShowNewRow(true);
      setCursor((c) => ({ ...c, visible: false }));
      await waitMs(4200);
      if (cancelled) return;

      reset();
      demoRunningRef.current = false;
      await waitMs(800);
      if (!cancelled) run();
    };

    run();
    return () => {
      cancelled = true;
      demoRunningRef.current = false;
    };
  }, [moveTo]);

  const ptColor = PROGRAM_TYPE_COLORS[form.programType] || '#374151';
  const previewSpeakers = (() => {
    if (form.speakersText) {
      try {
        return displaySpeakersPreview(JSON.parse(form.speakersText) as SpeakerDraft[]);
      } catch {
        return '';
      }
    }
    if (speakers.length > 0) return displaySpeakersPreview(speakers);
    return '';
  })();

  const trt = getShowcaseScheduleTrt();

  return (
    <div
      ref={rootRef}
      className="relative w-full h-full overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 text-white"
    >
      <ShowcaseFakeCursor
        x={cursor.x}
        y={cursor.y}
        visible={cursor.visible}
        clicking={cursor.clicking}
        moveMs={380}
      />

      {/* Dimmed ROS background */}
      <div className="absolute inset-0 opacity-40 pointer-events-none">
        <div className="px-6 pt-14 pb-4">
          <h1 className="text-lg font-bold">{DEMO_EVENT.name}</h1>
          <p className="text-xs text-slate-400">
            Schedule - TRT {trt.hours}h {trt.minutes}m {trt.seconds}s · {SHOWCASE_FULL_CUE_COUNT} cues · In-Show
          </p>
        </div>
        <div className="mx-6 border border-slate-600 rounded-lg overflow-hidden">
          <div className="h-10 bg-slate-700 flex items-center px-4 text-xs font-bold gap-6">
            <span>CUE</span>
            <span>Segment Name</span>
            <span>Speakers</span>
          </div>
          {['CUE 5 — Awards Presentation', 'CUE 6 — Product Demo'].map((label, i) => (
            <div
              key={label}
              className={`h-12 border-t border-slate-600 flex items-center px-4 text-xs text-slate-300 ${
                i % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'
              }`}
            >
              {label}
            </div>
          ))}
          {showNewRow && (
            <div className="h-12 border-t border-slate-600 flex items-center px-4 text-xs bg-blue-950 ring-2 ring-inset ring-blue-400 animate-[rowFlash_600ms_ease-out]">
              <span className="font-bold text-white">CUE 7 — {FINAL_FORM.segmentName}</span>
              <span className="ml-auto text-slate-300">3 speakers</span>
            </div>
          )}
        </div>
      </div>

      {/* Add Schedule Item modal */}
      {phase !== 'speakers' && (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/50">
          <div className="bg-slate-800 rounded-lg max-w-lg w-full max-h-[92%] flex flex-col shadow-2xl border border-slate-600">
            <div className="flex items-center justify-between p-4 border-b border-slate-600 shrink-0">
              <h2 className="text-lg font-bold text-white">Add Schedule Item</h2>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.isPublic} readOnly className="rounded" />
                <span className="text-slate-300 text-sm">Public</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Cue</label>
                  <div className="flex">
                    <div className="flex items-center px-2 py-2 bg-slate-600 border border-slate-600 border-r-0 rounded-l text-white text-sm font-medium min-w-[40px]">
                      CUE
                    </div>
                    <input
                      readOnly
                      value={form.cue}
                      className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-r text-white text-sm"
                      placeholder="1, 1.1, 1A…"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Program Type</label>
                  <select
                    readOnly
                    value={form.programType}
                    className="w-full px-3 py-2 border-2 border-slate-500 rounded text-white text-sm pointer-events-none"
                    style={{
                      backgroundColor: ptColor,
                      color: form.programType === 'Sub Cue' ? '#000' : '#fff',
                    }}
                  >
                    {PROGRAM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Segment Name</label>
                <input
                  ref={segmentRef}
                  readOnly
                  value={form.segmentName}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm ring-2 ring-blue-400/40"
                  placeholder="Enter segment name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Shot Type</label>
                  <select
                    readOnly
                    value={form.shotType}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                  >
                    <option value="">Select Shot Type</option>
                    {SHOT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Duration</label>
                  <div className="flex gap-1 items-center">
                    <input
                      readOnly
                      value={form.durationHours}
                      className="w-12 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center"
                    />
                    <span className="text-slate-400">:</span>
                    <input
                      readOnly
                      value={String(form.durationMinutes).padStart(2, '0')}
                      className="w-12 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center"
                    />
                    <span className="text-slate-400">:</span>
                    <input
                      readOnly
                      value={String(form.durationSeconds).padStart(2, '0')}
                      className="w-12 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm text-center"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" readOnly checked={form.hasPPT} className="rounded" />
                  <span className="text-slate-300 text-sm">Has PPT</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" readOnly checked={form.hasQA} className="rounded" />
                  <span className="text-slate-300 text-sm">Has QA</span>
                </label>
              </div>

              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Speakers</label>
                <div
                  ref={speakersFieldRef}
                  className={`w-full px-3 py-2 bg-slate-700 border rounded text-sm min-h-[72px] transition-colors ${
                    previewSpeakers ? 'border-green-500/60 ring-1 ring-green-500/30' : 'border-slate-600'
                  }`}
                >
                  {previewSpeakers ? (
                    <pre className="text-sm text-left text-slate-200 whitespace-pre-wrap font-sans m-0">
                      {previewSpeakers}
                    </pre>
                  ) : (
                    <span className="text-slate-400">Click to add speakers…</span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-600 shrink-0">
              <div className="flex gap-2">
                <button
                  ref={addItemBtnRef}
                  type="button"
                  className={`flex-1 px-3 py-2 font-medium rounded text-sm transition-colors ${
                    previewSpeakers
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                      : 'bg-blue-600/70 text-white'
                  }`}
                >
                  Add Item
                </button>
                <button type="button" className="flex-1 px-3 py-2 bg-slate-600 text-white font-medium rounded text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Speakers modal */}
      {phase === 'speakers' && (
        <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-slate-800 rounded-xl max-w-3xl w-full max-h-[94%] flex flex-col shadow-2xl border border-slate-600">
            <div className="flex justify-between items-center p-4 border-b border-slate-700 shrink-0">
              <h2 className="text-lg font-bold text-white">Edit Speakers ({speakers.length}/7)</h2>
              <span className="text-slate-500 text-xl">✕</span>
            </div>

            <div className="flex-1 p-4 overflow-y-auto min-h-0">
              <button
                ref={addSpeakerBtnRef}
                type="button"
                className="mb-4 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg text-sm"
              >
                + Add Speaker {speakers.length < 7 && `(${7 - speakers.length} slots remaining)`}
              </button>

              <div className="space-y-3">
                {speakers.map((speaker, idx) => (
                  <div
                    key={speaker.id}
                    className={`bg-slate-700 rounded-lg p-4 border transition-colors ${
                      typingSpeakerIdx === idx ? 'border-blue-400 ring-1 ring-blue-400/50' : 'border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-semibold text-white">Speaker {speaker.slot}</h3>
                      <span className="w-7 h-7 bg-red-600 rounded flex items-center justify-center text-white text-sm">
                        ✕
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-white text-xs font-medium mb-1">Slot</label>
                        <select
                          readOnly
                          value={speaker.slot}
                          className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                        >
                          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-white text-xs font-medium mb-1">Location</label>
                        <select
                          readOnly
                          value={speaker.location}
                          className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                        >
                          {['Podium', 'Seat', 'Moderator', 'Virtual'].map((l) => (
                            <option key={l} value={l}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-white text-xs font-medium mb-1">Full Name</label>
                        <input
                          ref={(el) => {
                            nameInputRefs.current[idx] = el;
                          }}
                          readOnly
                          value={speaker.fullName}
                          className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                          placeholder="Enter full name"
                        />
                      </div>
                      <div>
                        <label className="block text-white text-xs font-medium mb-1">Title</label>
                        <input
                          readOnly
                          value={speaker.title}
                          className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-white text-xs font-medium mb-1">Organization</label>
                        <input
                          readOnly
                          value={speaker.org}
                          className="w-full px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-white text-xs font-medium mb-1">Photo Link</label>
                        <div className="flex gap-2 items-center">
                          <input
                            readOnly
                            value={speaker.photoLink}
                            className="flex-1 px-2 py-1.5 bg-slate-600 border border-slate-500 rounded text-white text-xs truncate"
                          />
                          {speaker.photoLink && (
                            <img
                              src={speaker.photoLink}
                              alt=""
                              className="w-10 h-10 rounded object-cover border-2 border-slate-500"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {speakers.length === 0 && (
                  <div className="text-center py-6 text-slate-400 text-sm">
                    No speakers yet. Click &quot;Add Speaker&quot; to get started.
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-700 p-4 shrink-0">
              <button
                ref={saveSpeakersRef}
                type="button"
                className="w-full px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg text-sm"
              >
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes rowFlash {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
