import React, { useMemo } from 'react';
import type { ParsedSpeaker } from '../../showcase/photoShowcaseHelpers';
import { useLedAnimationPreview } from '../../hooks/useLedAnimationPreview';
import { getLedOutputAnimatorStyle } from '../../lib/ledOutputAnimation';
import type { LedOutputAnimation } from '../../types/ledOutput';
import type { LedLayoutConfig } from '../../types/ledText';
import LedCanvas from './LedCanvas';
import LedFreeformRenderer from './LedFreeformRenderer';

export type LedAnimationPreviewContent = {
  layout: LedLayoutConfig;
  title: string;
  speakersBySlot: Map<number, ParsedSpeaker | null>;
};

type LedOutputAnimationPreviewProps = {
  animation: LedOutputAnimation;
  content: LedAnimationPreviewContent | null;
};

const btnClass =
  'px-2.5 py-1.5 rounded-md text-xs font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed';

const LedOutputAnimationPreview: React.FC<LedOutputAnimationPreviewProps> = ({
  animation,
  content,
}) => {
  const {
    phase,
    isPlaying,
    previewIn,
    previewOut,
    previewCycle,
    stop,
    handleAnimationEnd,
  } = useLedAnimationPreview(animation);

  const animator = useMemo(
    () => getLedOutputAnimatorStyle(phase, animation),
    [phase, animation]
  );

  const showGraphic = content != null && animator.visible;

  return (
    <div className="mt-3 pt-3 border-t border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs text-slate-400">Preview (current cue)</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={previewIn}
            disabled={!content || isPlaying}
            className={btnClass}
          >
            Animate in
          </button>
          <button
            type="button"
            onClick={previewOut}
            disabled={!content || isPlaying}
            className={btnClass}
          >
            Animate out
          </button>
          <button
            type="button"
            onClick={previewCycle}
            disabled={!content || isPlaying}
            className={`${btnClass} bg-cyan-700 hover:bg-cyan-600`}
          >
            Full cycle
          </button>
          {isPlaying ? (
            <button type="button" onClick={stop} className={`${btnClass} bg-slate-800`}>
              Stop
            </button>
          ) : null}
        </div>
      </div>

      {!content ? (
        <p className="text-xs text-slate-500">Select a cue to preview animation.</p>
      ) : (
        <LedCanvas fitParent className="bg-slate-950/80">
          {showGraphic ? (
            <div
              className={`w-full h-full led-editor-no-transition ${animator.className}`}
              style={animator.style}
              onAnimationEnd={handleAnimationEnd}
            >
              <LedFreeformRenderer
                layout={content.layout}
                title={content.title}
                speakersBySlot={content.speakersBySlot}
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-xs text-slate-600">Clear</span>
            </div>
          )}
        </LedCanvas>
      )}
    </div>
  );
};

export default LedOutputAnimationPreview;
