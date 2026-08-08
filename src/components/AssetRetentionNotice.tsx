import React from 'react';

export function formatCueFileExpiry(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatCueFileSize(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Explains 4-month platform retention vs third-party links. */
const AssetRetentionNotice: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-lg border border-amber-500/60 bg-amber-950/40 px-3 py-2.5 text-sm text-amber-50 ${className}`}>
    <p className="font-semibold text-amber-100">Platform uploads auto-delete after 4 months.</p>
    <p className="mt-1 leading-relaxed text-amber-100/90">
      You can upload files directly to ROS. Those files are automatically deleted after 4 months.
      If you need the file preserved, use a link via{' '}
      <span className="whitespace-nowrap">Third-Party</span>
      {' '}storage such as Dropbox, Google Drive, or OneDrive.
    </p>
  </div>
);

export default AssetRetentionNotice;
