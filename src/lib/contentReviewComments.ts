export type ReviewComment = {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
  createdById: string;
};

export type StageReviewEntry = {
  status: string;
  /** @deprecated Migrated to `comments` on load; not written for new data. */
  note?: string;
  comments?: ReviewComment[];
  /** Creative-team replies to reviewer feedback. */
  responseComments?: ReviewComment[];
  /** @deprecated Migrated to `responseComments` on load; not written for new data. */
  response?: string;
  updatedAt: string;
  updatedBy: string;
};

export function generateReviewCommentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatReviewCommentTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getStageComments(stage: StageReviewEntry | undefined | null): ReviewComment[] {
  if (!stage) return [];
  if (Array.isArray(stage.comments) && stage.comments.length > 0) {
    return stage.comments.filter((c) => c && typeof c.text === 'string' && c.text.trim());
  }
  const legacy = String(stage.note ?? '').trim();
  if (!legacy) return [];
  return [
    {
      id: `legacy-${legacy.slice(0, 24)}`,
      text: legacy,
      createdAt: stage.updatedAt || '',
      createdBy: stage.updatedBy || 'Unknown',
      createdById: '',
    },
  ];
}

export function getStageResponseComments(stage: StageReviewEntry | undefined | null): ReviewComment[] {
  if (!stage) return [];
  if (Array.isArray(stage.responseComments) && stage.responseComments.length > 0) {
    return stage.responseComments.filter((c) => c && typeof c.text === 'string' && c.text.trim());
  }
  const legacy = String(stage.response ?? '').trim();
  if (!legacy) return [];
  return [
    {
      id: `legacy-response-${legacy.slice(0, 24)}`,
      text: legacy,
      createdAt: stage.updatedAt || '',
      createdBy: stage.updatedBy || 'Creative',
      createdById: '',
    },
  ];
}

export function normalizeStageEntry(raw: Record<string, unknown> | StageReviewEntry | undefined): StageReviewEntry {
  if (!raw || typeof raw !== 'object') {
    return { status: 'pending', comments: [], responseComments: [], response: '', updatedAt: '', updatedBy: '' };
  }
  const comments = getStageComments(raw as StageReviewEntry);
  const responseComments = getStageResponseComments(raw as StageReviewEntry);
  return {
    status: String(raw.status ?? 'pending'),
    comments,
    responseComments,
    note: '',
    response: '',
    updatedAt: (raw.updatedAt ?? '').toString(),
    updatedBy: (raw.updatedBy ?? '').toString(),
  };
}

export function canDeleteReviewComment(
  comment: ReviewComment,
  userId: string,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  if (!userId || !comment.createdById) return false;
  return comment.createdById === userId;
}

export function stageHasComments(stage: StageReviewEntry | undefined | null): boolean {
  return getStageComments(stage).length > 0;
}
