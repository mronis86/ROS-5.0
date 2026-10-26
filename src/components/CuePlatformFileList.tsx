import React from 'react';
import type { EventCueFile } from '../services/api-client';
import { cueFileDisplayName } from '../lib/cueFileVersions';
import { formatCueFileExpiry, formatCueFileSize } from './AssetRetentionNotice';

function uploadedLabel(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function sortFiles(files: EventCueFile[]): EventCueFile[] {
  return [...files].sort((a, b) => {
    const name = cueFileDisplayName(a).localeCompare(cueFileDisplayName(b), undefined, {
      sensitivity: 'base',
    });
    if (name) return name;
    return (Number(b.version) || 0) - (Number(a.version) || 0);
  });
}

export default function CuePlatformFileList({
  files,
  canEdit = false,
  usingId = null,
  onOpen,
  onDownload,
  onDelete,
  onUseVersion,
}: {
  files: EventCueFile[];
  canEdit?: boolean;
  usingId?: string | null;
  onOpen: (fileId: string) => void;
  onDownload: (file: EventCueFile) => void;
  onDelete?: (fileId: string) => void;
  onUseVersion?: (file: EventCueFile) => void;
}) {
  const rows = sortFiles(files);
  if (!rows.length) return <p className="text-sm text-slate-400">No platform files on this cue yet.</p>;

  return (
    <div className="space-y-2">
      {rows.map((file) => {
        const versioned = (file.versionCount || 1) > 1;
        const displayName = cueFileDisplayName(file);
        return (
          <div
            key={file.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded px-3 py-2 ${
              file.isCurrent === false && versioned
                ? 'bg-slate-800/80 border border-slate-600'
                : 'bg-slate-800 border border-slate-600'
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(file.id)}
                  className="text-left text-cyan-300 hover:underline font-medium truncate"
                >
                  {displayName}
                </button>
                {versioned ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      file.isCurrent
                        ? 'bg-emerald-700 text-emerald-50'
                        : 'bg-slate-600 text-slate-100'
                    }`}
                  >
                    {file.isCurrent ? `Current · v${file.version}` : `Older · v${file.version}`}
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-slate-400">
                {[
                  versioned ? `Version ${file.version} of ${file.versionCount}` : null,
                  uploadedLabel(file.createdAt),
                  formatCueFileSize(file.sizeBytes),
                  file.uploadedByName,
                  `Deletes ${formatCueFileExpiry(file.expiresAt) || 'in 4 months'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && versioned && file.isCurrent === false && onUseVersion ? (
                <button
                  type="button"
                  disabled={!!usingId}
                  onClick={() => onUseVersion(file)}
                  className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-sm rounded disabled:opacity-50"
                >
                  {usingId === file.id ? 'Switching…' : 'Use this version'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onDownload(file)}
                className="px-3 py-1.5 bg-cyan-700 hover:bg-cyan-600 text-white text-sm rounded"
              >
                Download
              </button>
              {canEdit && onDelete ? (
                <button
                  type="button"
                  onClick={() => onDelete(file.id)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm rounded"
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
