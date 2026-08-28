import React, { useCallback, useState } from 'react';
import {
  type ReviewComment,
  canDeleteReviewComment,
  formatReviewCommentTime,
} from '../lib/contentReviewComments';

export type ContentReviewCommentsPanelProps = {
  comments: ReviewComment[];
  title: string;
  canPost: boolean;
  currentUserId: string;
  isAdmin: boolean;
  onAddComment: (text: string) => void;
  onDeleteComment: (commentId: string) => void;
  emptyMessage?: string;
  variant?: 'default' | 'amber' | 'violet';
};

const VARIANT_STYLES = {
  default: {
    card: 'border-slate-600/80 bg-slate-900/50',
    author: 'text-slate-300',
    text: 'text-slate-200',
    time: 'text-slate-500',
  },
  amber: {
    card: 'border-amber-700/50 bg-amber-950/30',
    author: 'text-amber-200/90',
    text: 'text-amber-50/95',
    time: 'text-amber-200/60',
  },
  violet: {
    card: 'border-violet-700/50 bg-violet-950/30',
    author: 'text-violet-300/90',
    text: 'text-violet-100',
    time: 'text-violet-300/60',
  },
};

const ContentReviewCommentsPanel: React.FC<ContentReviewCommentsPanelProps> = ({
  comments,
  title,
  canPost,
  currentUserId,
  isAdmin,
  onAddComment,
  onDeleteComment,
  emptyMessage = 'No comments yet.',
  variant = 'default',
}) => {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const styles = VARIANT_STYLES[variant];

  const postComment = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    onAddComment(text);
    setDraft('');
    setComposing(false);
  }, [draft, onAddComment]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
        {comments.length > 0 ? (
          <span className="text-[10px] tabular-nums text-slate-500">{comments.length}</span>
        ) : null}
      </div>

      {comments.length === 0 && !composing ? (
        <p className="text-[10px] text-slate-500">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {comments.map((comment) => {
            const deletable = canDeleteReviewComment(comment, currentUserId, isAdmin);
            return (
              <li
                key={comment.id}
                className={`rounded border px-2.5 py-2 ${styles.card}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={`text-[11px] font-semibold ${styles.author}`}>
                        {comment.createdBy || 'Unknown'}
                      </span>
                      {comment.createdAt ? (
                        <span className={`text-[10px] ${styles.time}`}>
                          {formatReviewCommentTime(comment.createdAt)}
                        </span>
                      ) : null}
                    </div>
                    <p className={`mt-1 text-xs whitespace-pre-wrap break-words ${styles.text}`}>
                      {comment.text}
                    </p>
                  </div>
                  {deletable ? (
                    <button
                      type="button"
                      onClick={() => onDeleteComment(comment.id)}
                      className="shrink-0 rounded border border-rose-700/60 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 hover:bg-rose-950/50"
                      title="Delete comment"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canPost ? (
        composing ? (
          <div className="flex flex-col gap-1.5 rounded border border-slate-600 bg-slate-900/80 p-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Write a comment…"
              className="w-full resize-y rounded border border-slate-500 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-orange-400 focus:ring-2 focus:ring-orange-400/30"
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={postComment}
                disabled={!draft.trim()}
                className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40"
              >
                Post
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  setComposing(false);
                }}
                className="rounded border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="w-full rounded-lg border border-dashed border-slate-600 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-orange-500/60 hover:bg-slate-900/80 hover:text-orange-100"
          >
            + Add comment
          </button>
        )
      ) : null}
    </div>
  );
};

export default ContentReviewCommentsPanel;
