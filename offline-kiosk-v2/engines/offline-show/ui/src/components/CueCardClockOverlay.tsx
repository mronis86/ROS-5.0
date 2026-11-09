import React from 'react';
import {
  type CueCardComment,
  type CueCardSlide,
  CUE_CARD_COMMENT_TYPES,
  CUE_CARD_DEFAULT_BG,
  CUE_CARD_DEFAULT_TEXT,
  bodyToDisplayHtml,
} from '../lib/cueCards';

/**
 * 16:9 cue card preview for Clock / Fullscreen Timer.
 * Kept separate from CueCardsPage so displays stay read-only.
 */
export const CueCardClockOverlay: React.FC<{
  slide: CueCardSlide;
  comments?: CueCardComment[];
  className?: string;
}> = ({ slide, comments = [], className = '' }) => {
  const bodyHtml = bodyToDisplayHtml(slide.body || '');
  const textColor = slide.textColor || CUE_CARD_DEFAULT_TEXT;
  const visible = comments.slice(0, 4);

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden bg-black ${className}`}
      style={{ backgroundColor: CUE_CARD_DEFAULT_BG, color: textColor }}
    >
      {bodyHtml ? (
        <div
          className="cue-card-body min-h-0 flex-1 overflow-y-auto px-8 py-6 text-[clamp(1.25rem,2.8vw,2.75rem)] leading-snug [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-8 [&_ol]:list-decimal [&_ol]:pl-8"
          style={{ paddingBottom: visible.length ? '7rem' : undefined }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-2xl text-slate-500">
          Empty slide
        </div>
      )}

      {visible.length > 0 ? (
        <div
          className="absolute bottom-3 left-3 right-3 grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`,
          }}
        >
          {visible.map((c) => {
            const meta = CUE_CARD_COMMENT_TYPES[c.type] || CUE_CARD_COMMENT_TYPES.GENERAL;
            return (
              <div
                key={c.id}
                className={`${meta.bgColor} max-h-28 overflow-hidden rounded-lg border-l-4 px-3 py-2 ${meta.borderColor}`}
              >
                <div className={`text-sm font-bold ${meta.color}`}>
                  {meta.icon} {meta.label}
                </div>
                <div className="mt-1 line-clamp-3 text-base font-semibold leading-snug text-white">
                  {c.text}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export default CueCardClockOverlay;
