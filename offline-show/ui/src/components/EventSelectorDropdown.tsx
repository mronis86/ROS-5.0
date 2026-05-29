import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Event } from '../types/Event';

export type EventFilter = 'all' | 'upcoming' | 'past';

function getTodayLocal(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function filterEvents(events: Event[], filter: EventFilter): Event[] {
  if (filter === 'all') return events;
  const today = getTodayLocal();
  if (filter === 'upcoming') return events.filter((e) => (e.date || '') >= today);
  return events.filter((e) => (e.date || '') < today);
}

interface EventSelectorDropdownProps {
  events: Event[];
  value: string | null;
  onChange: (event: Event) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  className?: string;
  selectClassName?: string;
  /** Max height of the scrollable list (default 200px) */
  listMaxHeight?: string | number;
}

export const EventSelectorDropdown: React.FC<EventSelectorDropdownProps> = ({
  events,
  value,
  onChange,
  disabled = false,
  loading = false,
  placeholder = 'Select event…',
  className = '',
  selectClassName = '',
  listMaxHeight = '200px',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState<EventFilter>('all');
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredEvents = useMemo(() => filterEvents(events, eventFilter), [events, eventFilter]);
  const selectedEvent = events.find((e) => e.id === value);
  const displayLabel = selectedEvent
    ? `${selectedEvent.name}${selectedEvent.date ? ` (${selectedEvent.date})` : ''}`
    : loading
      ? 'Loading…'
      : placeholder;

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const listHeight = typeof listMaxHeight === 'number' ? `${listMaxHeight}px` : listMaxHeight;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => !disabled && !loading && setIsOpen((o) => !o)}
        disabled={disabled || loading}
        className={`w-full flex items-center gap-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-0 ${selectClassName}`}
        title="Select which event to view"
      >
        <span className="truncate flex-1 text-left">{displayLabel}</span>
        <span className="flex-shrink-0 text-slate-400">▾</span>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-[60] bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
          {/* Upcoming / Past filter */}
          <div className="flex border-b border-slate-600 p-1 gap-1 bg-slate-700/50">
            {(['all', 'upcoming', 'past'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setEventFilter(f)}
                className={`flex-1 px-2 py-1 text-xs rounded capitalize ${
                  eventFilter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {/* Scrollable event list */}
          <div
            className="overflow-y-auto overflow-x-hidden"
            style={{ maxHeight: listHeight }}
          >
            {filteredEvents.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-400 text-center">
                No {eventFilter === 'all' ? '' : eventFilter} events
              </div>
            ) : (
              filteredEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => {
                    onChange(ev);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-600 transition-colors border-b border-slate-700/50 last:border-0 ${
                    ev.id === value ? 'bg-slate-600 text-white' : 'text-slate-200'
                  }`}
                >
                  {ev.name}
                  {ev.date ? ` (${ev.date})` : ''}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EventSelectorDropdown;
