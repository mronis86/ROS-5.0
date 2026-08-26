import React from 'react';
import { normalizeDayLocations, type DayLocations } from '../types/Event';

type Props = {
  location: string;
  numberOfDays: number;
  dayLocations?: DayLocations;
  getLocationColor: (location: string) => string;
  /** denser layout for mobile cards */
  compact?: boolean;
};

const EventLocationCell: React.FC<Props> = ({
  location,
  numberOfDays,
  dayLocations,
  getLocationColor,
  compact = false,
}) => {
  const locs = normalizeDayLocations(location, numberOfDays, dayLocations);
  const days = Math.max(1, numberOfDays || 1);
  const values = Array.from({ length: days }, (_, i) => locs[i + 1]);
  const multi = new Set(values).size > 1;

  if (!multi) {
    return (
      <div className="flex items-center gap-1.5">
        <div className={`rounded-full shrink-0 ${getLocationColor(values[0])} ${compact ? 'h-2 w-2' : 'w-2.5 h-2.5'}`} />
        <span className={compact ? 'text-slate-300' : 'text-slate-300 text-sm'}>{values[0]}</span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? 'gap-0.5' : 'gap-1'}`} title="Different rooms across days">
      {values.map((loc, i) => (
        <div key={`d${i + 1}`} className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-medium text-slate-500 w-5 shrink-0">D{i + 1}</span>
          <div className={`rounded-full shrink-0 ${getLocationColor(loc)} ${compact ? 'h-2 w-2' : 'w-2 h-2'}`} />
          <span className={`truncate ${compact ? 'text-slate-300 text-xs' : 'text-slate-300 text-xs'}`}>
            {loc}
          </span>
        </div>
      ))}
    </div>
  );
};

export default EventLocationCell;
