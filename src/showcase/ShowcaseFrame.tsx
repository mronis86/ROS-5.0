import React from 'react';

type ShowcaseFrameProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onEnlarge?: () => void;
};

/** Minimal label above scaled production-fidelity preview. */
const ShowcaseFrame: React.FC<ShowcaseFrameProps> = ({ title, subtitle, children, onEnlarge }) => (
  <article className="group overflow-hidden rounded-xl border border-slate-700/90 bg-slate-900/50 shadow-lg transition-colors hover:border-slate-600">
    <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 px-4 py-2.5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{subtitle}</p>}
      </div>
      {onEnlarge && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEnlarge();
          }}
          className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-cyan-500/50 hover:bg-slate-700 hover:text-white"
          title={`Enlarge ${title}`}
        >
          Enlarge
        </button>
      )}
    </div>
    <div
      role={onEnlarge ? 'button' : undefined}
      tabIndex={onEnlarge ? 0 : undefined}
      onClick={onEnlarge}
      onKeyDown={
        onEnlarge
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEnlarge();
              }
            }
          : undefined
      }
      className={onEnlarge ? 'cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60' : ''}
    >
      {children}
    </div>
  </article>
);

export default ShowcaseFrame;
