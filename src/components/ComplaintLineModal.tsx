import React, { useEffect, useState } from 'react';
import { apiClient, type ComplaintLineNoteRow } from '../services/api-client';
import {
  COMPLAINT_LINE_CATEGORIES,
  COMPLAINT_LINE_CATEGORY_LABELS,
  normalizeComplaintLineCategory,
  type ComplaintLineCategory,
} from '../lib/complaintLine';

interface ComplaintLineModalProps {
  isOpen: boolean;
  onClose: () => void;
  eventId: string;
  userId: string;
  userName?: string;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const ComplaintLineModal: React.FC<ComplaintLineModalProps> = ({
  isOpen,
  onClose,
  eventId,
  userId,
  userName,
}) => {
  const [category, setCategory] = useState<ComplaintLineCategory>('complaint');
  const [content, setContent] = useState('');
  const [notes, setNotes] = useState<ComplaintLineNoteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (!isOpen || !eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await apiClient.getComplaintLineNotes(eventId);
        if (!cancelled) setNotes(res?.notes || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load notes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, eventId]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (submitting) return;
    setContent('');
    setCategory('complaint');
    setError(null);
    setSavedFlash(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      setError('Enter a note before saving.');
      return;
    }
    if (!eventId || !userId) {
      setError('Missing event or user.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await apiClient.createComplaintLineNote({
        event_id: eventId,
        user_id: userId,
        user_name: userName,
        category,
        content: trimmed,
      });
      setNotes((prev) => [...prev, created]);
      setContent('');
      setCategory('complaint');
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      await apiClient.deleteComplaintLineNote(id, eventId);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete note.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 py-8">
      <div
        className="w-full max-w-xl rounded-xl border border-slate-600 bg-slate-800 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="complaint-line-title"
      >
        <div className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 id="complaint-line-title" className="text-lg font-semibold text-white">
              Complaint Line
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Quick notes for the post-show report · Ctrl/Cmd+Shift+X
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-white text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-5 py-4 space-y-3 border-b border-slate-700">
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(normalizeComplaintLineCategory(e.target.value))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:border-rose-500"
            >
              {COMPLAINT_LINE_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {COMPLAINT_LINE_CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1.5">
              Note <span className="text-red-400">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              autoFocus
              placeholder="What happened? Who was involved? What needs follow-up?"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-rose-500 text-sm"
            />
          </div>

          {error ? <p className="text-red-300 text-sm">{error}</p> : null}
          {savedFlash ? <p className="text-green-300 text-sm">Saved to Complaint Line.</p> : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm"
            >
              {submitting ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="px-4 py-2.5 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              Close
            </button>
          </div>
        </form>

        <div className="px-5 py-3 overflow-y-auto flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-slate-300">This event ({notes.length})</h3>
            {loading ? <span className="text-xs text-slate-500">Loading…</span> : null}
          </div>
          {notes.length === 0 && !loading ? (
            <p className="text-slate-500 text-sm py-4 text-center">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {[...notes].reverse().map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border border-slate-600/80 bg-slate-900/40 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-rose-900/50 text-rose-200">
                        {COMPLAINT_LINE_CATEGORY_LABELS[normalizeComplaintLineCategory(note.category)]}
                      </span>
                      <span className="text-xs text-slate-500">{formatWhen(note.created_at)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(note.id)}
                      disabled={deletingId === note.id}
                      className="text-xs text-slate-500 hover:text-red-300 disabled:opacity-50"
                      title="Delete note"
                    >
                      {deletingId === note.id ? '…' : 'Delete'}
                    </button>
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{note.content}</p>
                  <p className="text-xs text-slate-500 mt-1">{note.user_name || 'Unknown'}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComplaintLineModal;
