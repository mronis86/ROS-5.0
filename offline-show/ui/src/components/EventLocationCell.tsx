import React from 'react';
import {
  formatLocationLabel,
  normalizeDayLocationDetails,
  normalizeDayLocations,
  type DayLocationDetails,
  type DayLocations,
} from '../types/Event';

type Props = {
  location: string;
  numberOfDays: number;
  dayLocations?: DayLocations;
  locationDetail?: string;
  dayLocationDetails?: DayLocationDetails;
  getLocationColor: (location: string) => string;
  /** denser layout for mobile cards */
  compact?: boolean;
};

const EventLocationCell: React.FC<Props> = ({
  location,
  numberOfDays,
  dayLocations,
  locationDetail,
  dayLocationDetails,
  getLocationColor,
  compact = false,
}) => {
  const locs = normalizeDayLocations(location, numberOfDays, dayLocations);
  const details = normalizeDayLocationDetails(
    location,
    numberOfDays,
    dayLocations,
    locationDetail,
    dayLocationDetails
  );
  const days = Math.max(1, numberOfDays || 1);
  const values = Array.from({ length: days }, (_, i) => locs[i + 1]);
  const labels = values.map((loc, i) => formatLocationLabel(loc, details[i + 1]));
  const multi = new Set(values).size > 1 || new Set(labels).size > 1;

  if (!multi) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <div className={`rounded-full shrink-0 ${getLocationColor(values[0])} ${compact ? 'h-2 w-2' : 'w-2.5 h-2.5'}`} />
        <span className={`truncate ${compact ? 'text-slate-300' : 'text-slate-300 text-sm'}`} title={labels[0]}>
          {labels[0]}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${compact ? 'gap-0.5' : 'gap-1'}`} title="Different rooms across days">
      {labels.map((label, i) => (
        <div key={`d${i + 1}`} className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-medium text-slate-500 w-5 shrink-0">D{i + 1}</span>
          <div className={`rounded-full shrink-0 ${getLocationColor(values[i])} ${compact ? 'h-2 w-2' : 'w-2 h-2'}`} />
          <span className={`truncate ${compact ? 'text-slate-300 text-xs' : 'text-slate-300 text-xs'}`} title={label}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default EventLocationCell;
