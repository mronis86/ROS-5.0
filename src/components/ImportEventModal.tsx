import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../services/database';
import { Event } from '../types/Event';

export interface ImportEventResult {
  scheduleItems: any[];
  customColumns: any[];
}

interface ImportEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEventId: string | undefined;
  onImport: (result: ImportEventResult) => void;
}

const ImportEventModal: React.FC<ImportEventModalProps> = ({
  isOpen,
  onClose,
  currentEventId,
  onImport
}) => {
  const [events, setEvents] = useState<Event[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceEventId, setSelectedSourceEventId] = useState<string>('');
  const [importSchedule, setImportSchedule] = useState(true);
  const [importCustomColumns, setImportCustomColumns] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSearchQuery('');
    setSelectedSourceEventId('');
    const loadEvents = async () => {
      setIsLoading(true);
      try {
        const calendarEvents = await DatabaseService.getCalendarEvents();
        const eventList: Event[] = (calendarEvents || []).map((calEvent: any) => {
          const dateObj = new Date(calEvent.date);
          const simpleDate = dateObj.toISOString().split('T')[0];
          return {
            id: calEvent.id || '',
            name: calEvent.name || 'Untitled',
            date: simpleDate,
            location: calEvent.schedule_data?.location || 'Great Hall',
            numberOfDays: calEvent.schedule_data?.numberOfDays || 1,
            timezone: calEvent.schedule_data?.timezone || 'America/New_York'
          };
        });
        setEvents(eventList);
      } catch (err) {
        console.error('Error loading events:', err);
        setError('Failed to load events');
      } finally {
        setIsLoading(false);
      }
    };
    loadEvents();
  }, [isOpen]);

  const availableEvents = events.filter(e => e.id && e.id !== currentEventId);

  // Filter by search: name (case-insensitive) or date (YYYY-MM-DD or partial like 2024-01)
  const filteredEvents = availableEvents.filter(ev => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const nameMatch = (ev.name || '').toLowerCase().includes(q);
    const dateMatch = (ev.date || '').includes(q) || (ev.date || '').replace(/-/g, '').includes(q.replace(/-/g, ''));
    return nameMatch || dateMatch;
  });

  const handleImport = async () => {
    if (!selectedSourceEventId || (!importSchedule && !importCustomColumns)) {
      setError('Please select a source event and at least one option to import.');
      return;
    }

    setIsImporting(true);
    setError(null);
    try {
      const runOfShowData = await DatabaseService.getRunOfShowData(selectedSourceEventId);
      if (!runOfShowData) {
        setError('No data found for the selected event.');
        return;
      }

      const scheduleItems = runOfShowData.schedule_items || [];
      const customColumns = runOfShowData.custom_columns || [];

      // Regenerate IDs for schedule items to avoid conflicts
      const idMap = new Map<number, number>();
      let nextId = Date.now();
      const newScheduleItems = importSchedule ? scheduleItems.map((item: any, index: number) => {
        const oldId = item.id;
        const newId = nextId + index;
        if (oldId !== undefined) idMap.set(oldId, newId);
        return {
          ...item,
          id: newId
        };
      }) : [];

      // Regenerate IDs for custom columns
      const colIdMap = new Map<string, string>();
      const newCustomColumns = importCustomColumns ? customColumns.map((col: any, index: number) => {
        const newId = `col-${Date.now()}-${index}`;
        if (col.id) colIdMap.set(col.id, newId);
        return {
          ...col,
          id: newId
        };
      }) : [];

      // Remap or strip customFields in schedule items
      if (importSchedule) {
        if (importCustomColumns && colIdMap.size > 0) {
          newScheduleItems.forEach((item: any) => {
            if (item.customFields && typeof item.customFields === 'object') {
              const updated: Record<string, string> = {};
              Object.entries(item.customFields).forEach(([key, value]) => {
                const newKey = colIdMap.get(key) ?? key; // Preserve 'cue' and other non-column keys
                updated[newKey] = value as string;
              });
              item.customFields = updated;
            }
          });
        } else {
          // Schedule only: keep only cue in customFields (target has different custom columns)
          newScheduleItems.forEach((item: any) => {
            const cue = item.customFields?.cue;
            item.customFields = cue !== undefined ? { cue } : {};
          });
        }
      }

      onImport({
        scheduleItems: newScheduleItems,
        customColumns: newCustomColumns
      });
      onClose();
    } catch (err) {
      console.error('Error importing from event:', err);
      setError('Failed to import data. Please try again.');
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-600 shadow-xl max-w-md mx-4 w-full">
        <h3 className="text-white text-xl font-semibold mb-4">
          Import from Another Event
        </h3>
        <p className="text-slate-300 text-sm mb-4">
          Copy schedule and/or custom columns from an existing event into the current event.
        </p>

        {isLoading ? (
          <div className="text-center py-8 text-slate-400">Loading events...</div>
        ) : (
          <>
            <div className="mb-4">
              <label className="block text-slate-300 text-sm font-medium mb-2">Source Event</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or date (e.g. 2025-01)"
                className="w-full px-3 py-2 mb-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
              />
              <div className="max-h-40 overflow-y-auto border border-slate-600 rounded bg-slate-700">
                {filteredEvents.length === 0 ? (
                  <p className="px-3 py-4 text-slate-400 text-sm text-center">
                    {availableEvents.length === 0 ? 'No other events found.' : 'No events match your search.'}
                  </p>
                ) : (
                  filteredEvents.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => setSelectedSourceEventId(ev.id)}
                      className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                        selectedSourceEventId === ev.id
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-200 hover:bg-slate-600'
                      }`}
                    >
                      {ev.name} <span className="text-slate-400">({ev.date})</span>
                    </button>
                  ))
                )}
              </div>
              {selectedSourceEventId && (
                <p className="text-emerald-400 text-xs mt-1">
                  Selected: {events.find(e => e.id === selectedSourceEventId)?.name} ({events.find(e => e.id === selectedSourceEventId)?.date})
                </p>
              )}
            </div>

            <div className="mb-6 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importSchedule}
                  onChange={(e) => setImportSchedule(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-300">Import Schedule (all rows)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importCustomColumns}
                  onChange={(e) => setImportCustomColumns(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-slate-300">Import Custom Columns</span>
              </label>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-900/50 border border-red-600 rounded text-red-200 text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!selectedSourceEventId || (!importSchedule && !importCustomColumns) || isImporting}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ImportEventModal;
