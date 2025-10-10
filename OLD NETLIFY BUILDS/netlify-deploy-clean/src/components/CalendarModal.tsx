import React, { useState, useEffect } from 'react';
import { DatabaseService, CalendarEvent } from '../services/database';

interface CalendarModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadEvent: (event: CalendarEvent) => void;
}

const CalendarModal: React.FC<CalendarModalProps> = ({ isOpen, onClose, onLoadEvent }) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadEvents();
    }
  }, [isOpen]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const fetchedEvents = await DatabaseService.getCalendarEvents();
      setEvents(fetchedEvents);
    } catch (error) {
      console.error('Error loading events:', error);
    } finally {
      setLoading(false);
    }
  };


  const handleLoadEvent = (event: CalendarEvent) => {
    onLoadEvent(event);
    onClose();
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!confirm('Are you sure you want to delete this event?')) {
      return;
    }

    try {
      const success = await DatabaseService.deleteCalendarEvent(eventId);
      if (success) {
        setEvents(prev => prev.filter(event => event.id !== eventId));
        alert('Event deleted successfully!');
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Error deleting event');
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-600">
          <h2 className="text-xl font-bold text-white">📅 Load Events</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Load Existing Events */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Available Events</h3>
            <p className="text-slate-400 text-sm mb-4">
              Load events from your Supabase database. New events are automatically saved when you add them.
            </p>
            {loading ? (
              <div className="text-center py-8">
                <div className="text-slate-400">Loading events...</div>
              </div>
            ) : events.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-slate-400">No saved events found</div>
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className="bg-slate-700 rounded-lg p-4 flex items-center justify-between"
                  >
                    <div className="flex-1">
                      <h4 className="text-white font-medium">{event.name}</h4>
                      <p className="text-slate-400 text-sm">
                        {formatDate(event.date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLoadEvent(event)}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm transition-colors"
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeleteEvent(event.id!)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-600">
          <button
            onClick={onClose}
            className="w-full bg-slate-600 hover:bg-slate-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default CalendarModal;
