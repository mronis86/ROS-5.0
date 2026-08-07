import React from 'react';

/** Toast + clock mark for the Time Toast control and popup. */
export const TimeToastIcon: React.FC<{
  className?: string;
  title?: string;
}> = ({ className = 'h-5 w-5', title }) => (
  <img
    src="/time-toast-icon.png"
    alt=""
    title={title}
    className={`inline-block object-contain select-none ${className}`}
    draggable={false}
  />
);

export default TimeToastIcon;
