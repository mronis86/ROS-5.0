import React, { useMemo, useState } from 'react';
import { reportUserIssue } from '../lib/reportUserIssue';
import { formatConsoleCaptureForReport, getConsoleCaptureSummary } from '../lib/consoleCapture';

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail?: string;
  userName?: string;
}

const ReportIssueModal: React.FC<ReportIssueModalProps> = ({ isOpen, onClose, userEmail, userName }) => {
  const [message, setMessage] = useState('');
  const [userNote, setUserNote] = useState('');
  const [includeConsole, setIncludeConsole] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const consoleSummary = useMemo(() => getConsoleCaptureSummary(), [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (submitting) return;
    setMessage('');
    setUserNote('');
    setIncludeConsole(true);
    setError(null);
    setSent(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError('Please describe what went wrong.');
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await reportUserIssue({
      message: trimmed,
      userNote: userNote.trim() || undefined,
      userEmail,
      userName,
      includeConsoleLog: includeConsole,
      consoleLog: includeConsole ? formatConsoleCaptureForReport() : undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Could not send report.');
      return;
    }
    setSent(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-8">
      <div
        className="w-full max-w-lg rounded-xl border border-slate-600 bg-slate-800 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <h2 id="report-issue-title" className="text-lg font-semibold text-white">
            Report an issue
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {sent ? (
          <div className="px-5 py-6 space-y-4">
            <p className="text-green-300 text-sm">
              Thank you — your report was sent to administrators. Include any extra context with your team if needed.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="px-5 py-5 space-y-4">
            <p className="text-slate-400 text-sm">
              Tell us what isn&apos;t working. Recent browser console errors can be included automatically to help debug.
            </p>

            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">
                What went wrong? <span className="text-red-400">*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                required
                placeholder="e.g. Password setup finished but I was not taken to the event list"
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Extra details (optional)</label>
              <textarea
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                rows={2}
                placeholder="Steps you took, event name, etc."
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm"
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeConsole}
                onChange={(e) => setIncludeConsole(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm text-slate-300">
                Include recent console errors/warnings ({consoleSummary.count} captured
                {consoleSummary.hasErrors ? ', includes errors' : ''})
              </span>
            </label>

            {import.meta.env.DEV ? (
              <p className="text-xs text-slate-500">
                Dev tip: run{' '}
                <code className="text-slate-400">simulateConsoleCaptureTest()</code> in the browser console, then
                submit a report to preview console capture in the email.
              </p>
            ) : null}

            {error ? (
              <div className="bg-red-900/80 border border-red-700 text-red-200 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            ) : null}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleClose}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-60 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-medium rounded-lg"
              >
                {submitting ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ReportIssueModal;
