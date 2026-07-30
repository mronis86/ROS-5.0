import React from 'react';
import { Megaphone } from 'lucide-react';

interface ComplaintLineFabProps {
  onOpen: () => void;
}

/**
 * Bottom-right capture control for Complaint Line (sits above Report Issue FAB).
 */
const ComplaintLineFab: React.FC<ComplaintLineFabProps> = ({ onOpen }) => {
  return (
    <div className="group/fab fixed bottom-[4.25rem] right-4 z-40">
      <div
        className="pointer-events-none absolute bottom-full right-0 mb-1.5 flex flex-col items-end opacity-0 translate-y-1 transition-all duration-200 ease-out group-hover/fab:translate-y-0 group-hover/fab:opacity-100 group-focus-within/fab:translate-y-0 group-focus-within/fab:opacity-100 max-sm:hidden"
        aria-hidden
      >
        <span className="block whitespace-nowrap rounded-lg border border-rose-400/50 bg-slate-800/95 px-2 py-1 text-[11px] font-semibold text-rose-300 shadow-lg shadow-black/30 ring-1 ring-inset ring-white/[0.06] backdrop-blur-md">
          Complaint Line
          <span className="ml-1.5 font-normal text-rose-400/80">Ctrl+Shift+X</span>
        </span>
        <span
          className="mr-3.5 h-0 w-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-rose-400/50"
          aria-hidden
        />
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-600/80 bg-slate-800/95 text-rose-400/90 shadow-md shadow-black/25 ring-1 ring-inset ring-white/[0.06] backdrop-blur-md transition-all duration-200 ease-out opacity-70 hover:scale-[1.04] hover:border-rose-500/45 hover:bg-slate-800 hover:text-rose-300 hover:opacity-100 hover:shadow-lg hover:shadow-rose-950/20 focus:outline-none focus-visible:scale-[1.04] focus-visible:border-rose-500/50 focus-visible:text-rose-300 focus-visible:opacity-100 max-sm:opacity-80 max-sm:active:scale-[0.98]"
        aria-label="Complaint Line"
        title="Complaint Line (Ctrl/Cmd+Shift+X)"
      >
        <Megaphone className="h-4 w-4" strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  );
};

export default ComplaintLineFab;
