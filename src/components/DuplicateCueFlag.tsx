import React from 'react';
import { duplicateCueTooltip } from '../lib/cueDisplay';

const DuplicateCueFlag: React.FC<{ otherRowNumbers: number[] }> = ({ otherRowNumbers }) => {
  if (!otherRowNumbers.length) return null;
  const title = duplicateCueTooltip(otherRowNumbers);
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-bold bg-yellow-300 text-slate-900 border border-yellow-100 shadow-sm"
      title={title}
      aria-label={title}
    >
      Duplicate Cue #
    </span>
  );
};

export default DuplicateCueFlag;
