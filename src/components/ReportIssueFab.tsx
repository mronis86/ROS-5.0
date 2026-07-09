import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ReportIssueModal from './ReportIssueModal';

/**
 * Bottom-right report control. Subtle warning icon at rest; label on hover.
 */
const ReportIssueFab: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <div className="group/fab fixed bottom-4 right-4 z-40">
        <div
          className="pointer-events-none absolute bottom-full right-0 mb-1.5 flex flex-col items-end opacity-0 translate-y-1 transition-all duration-200 ease-out group-hover/fab:translate-y-0 group-hover/fab:opacity-100 group-focus-within/fab:translate-y-0 group-focus-within/fab:opacity-100 max-sm:hidden"
          aria-hidden
        >
          <span className="block whitespace-nowrap rounded-lg border border-amber-400/50 bg-slate-800/95 px-2 py-1 text-[11px] font-semibold text-amber-300 shadow-lg shadow-black/30 ring-1 ring-inset ring-white/[0.06] backdrop-blur-md">
            Report Issue
          </span>
          <span
            className="mr-3.5 h-0 w-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-amber-400/50"
            aria-hidden
          />
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-600/80 bg-slate-800/95 text-amber-400/90 shadow-md shadow-black/25 ring-1 ring-inset ring-white/[0.06] backdrop-blur-md transition-all duration-200 ease-out opacity-60 hover:scale-[1.04] hover:border-amber-500/45 hover:bg-slate-800 hover:text-amber-300 hover:opacity-100 hover:shadow-lg hover:shadow-amber-950/20 focus:outline-none focus-visible:scale-[1.04] focus-visible:border-amber-500/50 focus-visible:text-amber-300 focus-visible:opacity-100 max-sm:opacity-75 max-sm:active:scale-[0.98]"
          aria-label="Report Issue"
          title="Report an issue to administrators"
        >
          <AlertTriangle
            className="h-4 w-4"
            strokeWidth={2.25}
            fill="currentColor"
            fillOpacity={0.18}
            aria-hidden
          />
        </button>
      </div>

      <ReportIssueModal
        isOpen={open}
        onClose={() => setOpen(false)}
        userEmail={user.email}
        userName={user.full_name}
      />
    </>
  );
};

export default ReportIssueFab;
