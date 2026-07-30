/**
 * Build printable HTML for the post-show report:
 * Complaint Line notes + Show vs rehearsal (schedule vs frozen baseline).
 * Activity history stays in Change Log — not duplicated here.
 */

import {
  COMPLAINT_LINE_CATEGORY_LABELS,
  normalizeComplaintLineCategory,
  type ComplaintLineCategory,
} from './complaintLine';
import {
  diffScheduleAgainstBaseline,
  type BaselineDiffRow,
  type RehearsalBaseline,
} from './rehearsalBaseline';

export type ComplaintLineNote = {
  id: string;
  event_id: string;
  user_id: string;
  user_name?: string | null;
  category: ComplaintLineCategory | string;
  content: string;
  created_at: string;
  updated_at?: string;
};

export type PostShowReportInput = {
  event: {
    id: string;
    name?: string;
    date?: string;
    location?: string;
  };
  complaints: ComplaintLineNote[];
  schedule: unknown[];
  rehearsalBaseline: RehearsalBaseline | null;
  generatedAt?: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatWhen(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function categoryLabel(category: unknown): string {
  const key = normalizeComplaintLineCategory(category);
  return COMPLAINT_LINE_CATEGORY_LABELS[key];
}

function complaintRowHtml(note: ComplaintLineNote): string {
  return `
    <tr>
      <td>${escapeHtml(formatWhen(note.created_at))}</td>
      <td><span class="pill">${escapeHtml(categoryLabel(note.category))}</span></td>
      <td class="wrap">${escapeHtml(note.content)}</td>
      <td>${escapeHtml(note.user_name || 'Unknown')}</td>
    </tr>`;
}

function diffRowHtml(diff: BaselineDiffRow): string {
  if (diff.kind === 'added') {
    return `
      <tr>
        <td><span class="pill ok">Added</span></td>
        <td>${escapeHtml(diff.cue || '—')}</td>
        <td>${escapeHtml(diff.segmentName || '—')}</td>
        <td colspan="2">New row after baseline</td>
      </tr>`;
  }
  if (diff.kind === 'removed') {
    return `
      <tr>
        <td><span class="pill bad">Removed</span></td>
        <td>${escapeHtml(diff.cue || '—')}</td>
        <td>${escapeHtml(diff.segmentName || '—')}</td>
        <td colspan="2">Present in rehearsal baseline, missing now</td>
      </tr>`;
  }
  return `
    <tr>
      <td><span class="pill warn">Changed</span></td>
      <td>${escapeHtml(diff.cue || '—')}</td>
      <td>${escapeHtml(diff.segmentName || '—')}</td>
      <td>${escapeHtml(diff.fieldLabel || diff.field || '')}</td>
      <td>${escapeHtml(diff.before || '(empty)')} → ${escapeHtml(diff.after || '(empty)')}</td>
    </tr>`;
}

export function buildPostShowReportHtml(input: PostShowReportInput): string {
  const generatedAt = input.generatedAt || new Date().toISOString();
  const baseline = input.rehearsalBaseline || null;
  const diffs = diffScheduleAgainstBaseline(
    (input.schedule || []) as Parameters<typeof diffScheduleAgainstBaseline>[0],
    baseline
  );
  const complaints = [...(input.complaints || [])].sort(
    (a, b) => Date.parse(a.created_at || '') - Date.parse(b.created_at || '')
  );

  const eventName = input.event.name || 'Untitled event';
  const baselineLabel = baseline?.capturedAt
    ? `Rehearsal baseline captured ${formatWhen(baseline.capturedAt)} · ${baseline.itemCount} rows`
    : 'No rehearsal baseline yet — enter In-Show to freeze one for Show vs rehearsal.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Post-show report — ${escapeHtml(eventName)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 0; padding: 32px; background: #fff; }
    h1 { font-size: 28px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 10px; border-bottom: 1px solid #ccc; padding-bottom: 6px; }
    .meta { color: #444; font-size: 13px; line-height: 1.5; margin-bottom: 8px; }
    .muted { color: #666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e5e5e5; }
    th { background: #f4f4f4; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
    td.wrap { white-space: pre-wrap; word-break: break-word; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eee; font-size: 11px; font-weight: 700; }
    .pill.ok { background: #dcfce7; color: #166534; }
    .pill.bad { background: #fee2e2; color: #991b1b; }
    .pill.warn { background: #fef3c7; color: #92400e; }
    .empty { color: #666; font-style: italic; padding: 12px 0; }
    @media print {
      body { padding: 12px; }
      h2 { page-break-after: avoid; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>Post-show report</h1>
  <div class="meta">
    <div><strong>${escapeHtml(eventName)}</strong></div>
    <div>${escapeHtml(input.event.date || '—')}${input.event.location ? ` · ${escapeHtml(input.event.location)}` : ''}</div>
    <div class="muted">Generated ${escapeHtml(formatWhen(generatedAt))}</div>
    <div class="muted">${escapeHtml(baselineLabel)}</div>
    <div class="muted">For who-changed-what history, use Change Log in Run of Show.</div>
  </div>

  <h2>Complaint Line (${complaints.length})</h2>
  ${
    complaints.length === 0
      ? '<p class="empty">No complaint-line notes recorded.</p>'
      : `<table>
      <thead><tr><th>When</th><th>Category</th><th>Note</th><th>Author</th></tr></thead>
      <tbody>${complaints.map(complaintRowHtml).join('')}</tbody>
    </table>`
  }

  <h2>Show vs rehearsal (${diffs.length})</h2>
  ${
    !baseline
      ? '<p class="empty">No rehearsal baseline on file. Enter In-Show to freeze one.</p>'
      : diffs.length === 0
        ? `<p class="empty">Schedule matches baseline captured ${escapeHtml(formatWhen(baseline.capturedAt))}.</p>`
        : `<p class="muted">Baseline captured ${escapeHtml(formatWhen(baseline.capturedAt))} · ${baseline.itemCount} rows</p>
    <table>
      <thead><tr><th>Kind</th><th>Cue</th><th>Segment</th><th>Field</th><th>Change</th></tr></thead>
      <tbody>${diffs.map(diffRowHtml).join('')}</tbody>
    </table>`
  }
</body>
</html>`;
}

export function openPostShowReportPrint(html: string): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
}
