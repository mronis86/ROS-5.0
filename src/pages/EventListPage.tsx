import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Event, EventFormData, LOCATION_OPTIONS, DAYS_OPTIONS, TIMEZONE_OPTIONS } from '../types/Event';
import { DatabaseService } from '../services/database';
import { apiClient } from '../services/api-client';
import { useAuth } from '../contexts/AuthContext';
import RoleSelectionModal from '../components/RoleSelectionModal';

const EventListPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterLocation, setFilterLocation] = useState<string>('all');
  const [filterDays, setFilterDays] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editFormData, setEditFormData] = useState<EventFormData>({
    name: '',
    date: '',
    location: 'Great Hall',
    numberOfDays: 1,
    timezone: 'America/New_York'
  });
  const [formData, setFormData] = useState<EventFormData>({
    name: '',
    date: '',
    location: 'Great Hall',
    numberOfDays: 1,
    timezone: 'America/New_York'
  });
  
  // Role selection state
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Server toggle state
  const [forceLocal, setForceLocal] = useState(() => {
    const saved = localStorage.getItem('forceLocalServer');
    return saved === 'true';
  });


  // Load events from Supabase and localStorage on component mount
  useEffect(() => {
    loadEventsFromSupabase();
  }, []);

  // Auto-refresh disabled to reduce database usage - users can manually refresh
  // useEffect(() => {
  //   const interval = setInterval(() => {
  //     console.log('🔄 Auto-refreshing events list...');
  //     loadEventsFromSupabase();
  //   }, 300000); // 5 minutes
  //
  //   return () => clearInterval(interval);
  // }, []);

  const loadEventsFromSupabase = async () => {
    try {
      setIsLoading(true);
      console.log('🔄 Loading events from Neon database...');
      console.log('🌐 API Base URL:', import.meta.env.VITE_API_BASE_URL || 'Not set (using default)');
      console.log('🌐 Environment:', import.meta.env.PROD ? 'Production' : 'Development');
      
      // Always try Supabase first
      const calendarEvents = await DatabaseService.getCalendarEvents();
      console.log('📊 Raw calendar events from Neon:', calendarEvents);
      
      if (calendarEvents && calendarEvents.length > 0) {
        console.log('🔍 Processing calendar events:', calendarEvents.length);
        
        // Convert CalendarEvents to Events
        const eventsFromSupabase = calendarEvents.map((calEvent, index) => {
          console.log(`🔍 Processing event ${index}:`, {
            id: calEvent.id,
            name: calEvent.name,
            date: calEvent.date,
            schedule_data: calEvent.schedule_data,
            created_at: calEvent.created_at
          });
          
          // Convert ISO date to simple date format for filtering
          const dateObj = new Date(calEvent.date);
          const simpleDate = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD format
          
          const transformedEvent = {
            id: calEvent.id || Date.now().toString(),
            name: calEvent.name,
            date: simpleDate, // Use simple date format for filtering
            originalDate: calEvent.date, // Keep original for reference
            location: calEvent.schedule_data?.location || 'Great Hall',
            numberOfDays: calEvent.schedule_data?.numberOfDays || 1,
            timezone: calEvent.schedule_data?.timezone || 'America/New_York',
            created_at: calEvent.created_at || new Date().toISOString(),
            updated_at: calEvent.updated_at || new Date().toISOString()
          };
          
          console.log(`✅ Transformed event ${index}:`, transformedEvent);
          return transformedEvent;
        });
        
        console.log('📊 All transformed events:', eventsFromSupabase);
        setEvents(eventsFromSupabase);
        console.log('✅ Loaded events from Neon:', eventsFromSupabase.length);
        console.log('📋 Final events state:', eventsFromSupabase);
      } else {
        console.log('ℹ️ No events found in Neon, checking localStorage...');
        
        // Only fallback to localStorage if Supabase returns empty
        const savedEvents = localStorage.getItem('events');
        if (savedEvents) {
          try {
            const parsedEvents = JSON.parse(savedEvents);
            setEvents(parsedEvents);
            console.log('📱 Loaded events from localStorage fallback:', parsedEvents.length);
          } catch (error) {
            console.error('Error loading events from localStorage:', error);
          }
        } else {
          console.log('📭 No events found in either Neon or localStorage');
          setEvents([]);
        }
      }
    } catch (error) {
      console.error('❌ Error loading events from Neon:', error);
      // Fallback to localStorage only on error
      const savedEvents = localStorage.getItem('events');
      if (savedEvents) {
        try {
          const parsedEvents = JSON.parse(savedEvents);
          setEvents(parsedEvents);
          console.log('📱 Fallback to localStorage due to error:', parsedEvents.length);
        } catch (parseError) {
          console.error('Error parsing localStorage events:', parseError);
          setEvents([]);
        }
      } else {
        setEvents([]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Save events to localStorage whenever events change
  useEffect(() => {
    localStorage.setItem('events', JSON.stringify(events));
  }, [events]);

  const addEvent = async () => {
    if (!formData.name || !formData.date || !formData.location) {
      alert('Please fill in all fields');
      return;
    }

    // Generate a unique ID for the event
    const eventId = `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const newEvent: Event = {
      id: eventId,
      name: formData.name,
      date: formData.date,
      location: formData.location,
      numberOfDays: formData.numberOfDays,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Close modal first to prevent layout shift
    setShowAddModal(false);
    setFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1 });
    
    // Add event to local list immediately
    setEvents(prev => [...prev, newEvent]);

    // Save to Supabase automatically - both calendar event AND Run of Show data
    try {
      console.log('💾 Saving new event to Neon:', newEvent);
      
      // Save calendar event with the unique event ID
      const calendarEvent = {
        name: newEvent.name,
        date: newEvent.date,
        schedule_data: {
          location: newEvent.location,
          numberOfDays: newEvent.numberOfDays,
          eventId: newEvent.id
        }
      };
      
      const savedCalendarEvent = await DatabaseService.saveCalendarEvent(calendarEvent);
      console.log('✅ Calendar event saved to Neon:', savedCalendarEvent);

      // Create initial Run of Show data with the same unique event ID
      const runOfShowData = await DatabaseService.saveRunOfShowData({
        event_id: newEvent.id, // This is the key that links both tables
        event_name: newEvent.name,
        event_date: newEvent.date,
        schedule_items: [], // Empty schedule to start
        custom_columns: [], // Empty custom columns to start
        settings: {
          eventName: newEvent.name,
          masterStartTime: '',
          lastSaved: new Date().toISOString()
        }
      }, {
        userId: user?.id || 'unknown',
        userName: user?.user_metadata?.full_name || user?.email || 'Unknown User',
        userRole: 'EDITOR' // Events are typically created by editors
      });
      console.log('✅ Run of Show data created in Neon:', runOfShowData);
      
      // Reload events from Supabase to ensure we have the latest data
      setTimeout(() => {
        console.log('🔄 Reloading events after save...');
        loadEventsFromSupabase();
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error auto-saving event to Neon:', error);
      // Don't show error to user since the event was still added locally
    }
  };

  const editEvent = async () => {
    console.log('🔧 EDIT EVENT CALLED!', { editingEvent, editFormData });
    
    if (!editingEvent || !editFormData.name || !editFormData.date || !editFormData.location) {
      console.error('❌ Validation failed:', { editingEvent, editFormData });
      alert('Please fill in all fields');
      return;
    }

    const updatedEvent: Event = {
      ...editingEvent,
      name: editFormData.name,
      date: editFormData.date,
      location: editFormData.location,
      numberOfDays: editFormData.numberOfDays,
      timezone: editFormData.timezone,
      updated_at: new Date().toISOString()
    };

    console.log('📝 About to update event:', {
      original: editingEvent,
      updated: updatedEvent,
      changes: {
        name: editingEvent.name !== updatedEvent.name,
        date: editingEvent.date !== updatedEvent.date,
        location: editingEvent.location !== updatedEvent.location,
        numberOfDays: editingEvent.numberOfDays !== updatedEvent.numberOfDays
      }
    });

    // Close modal first
    setEditingEvent(null);
    setEditFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1, timezone: 'America/New_York' });
    
    // Update local list immediately for instant feedback
    setEvents(prev => prev.map(event => 
      event.id === editingEvent.id ? updatedEvent : event
    ));
    console.log('✅ Local UI updated');

    // Update via API (works with both local and Railway)
    try {
      console.log('💾 Starting API update for event:', updatedEvent);
      
      // Clear cache first to ensure we get fresh data
      await apiClient.clearCache();
      console.log('🗑️ Cache cleared');
      
      // Get all calendar events to find the matching one
      const calendarEvents: any = await apiClient.getCalendarEvents();
      console.log('📊 Fetched calendar events:', calendarEvents.length);
      
      const matchingCalendarEvent = calendarEvents.find((calEvent: any) => 
        calEvent.schedule_data?.eventId === editingEvent.id || 
        calEvent.id === editingEvent.id ||
        calEvent.name === editingEvent.name
      );
      
      console.log('🔍 Looking for calendar event to update:', {
        editingEventId: editingEvent.id,
        editingEventName: editingEvent.name,
        matchingCalendarEvent: matchingCalendarEvent
      });
      
      if (matchingCalendarEvent?.id) {
        const updatedCalendarEvent = {
          name: updatedEvent.name,
          date: updatedEvent.date,
          schedule_data: {
            ...matchingCalendarEvent.schedule_data, // Preserve existing schedule_data FIRST
            location: updatedEvent.location,         // Then override with new values
            numberOfDays: updatedEvent.numberOfDays,
            eventId: updatedEvent.id,
            timezone: updatedEvent.timezone
          }
        };
        
        console.log('📝 Updating calendar event via API:', updatedCalendarEvent);
        console.log('📝 Schedule data being sent:', updatedCalendarEvent.schedule_data);
        await apiClient.updateCalendarEvent(matchingCalendarEvent.id, updatedCalendarEvent);
        console.log('✅ Calendar event updated via API');
      } else {
        console.warn('⚠️ No matching calendar event found for update');
      }

      // Update Run of Show data via API
      console.log('📝 Updating run of show data for event:', editingEvent.id);
      
      // First, get the existing run of show data to preserve schedule items
      try {
        const existingData: any = await apiClient.getRunOfShowData(editingEvent.id);
        
        if (existingData) {
          // Update with preserved schedule items and updated settings
          await apiClient.saveRunOfShowData({
            event_id: editingEvent.id,
            event_name: updatedEvent.name,
            event_date: updatedEvent.date,
            schedule_items: existingData.schedule_items || [],
            custom_columns: existingData.custom_columns || [],
            settings: {
              ...existingData.settings,
              eventName: updatedEvent.name,
              eventDate: updatedEvent.date,
              location: updatedEvent.location,
              numberOfDays: updatedEvent.numberOfDays,
              timezone: updatedEvent.timezone,
              lastSaved: new Date().toISOString()
            },
            last_modified_by: user?.id,
            last_modified_by_name: (user as any)?.user_metadata?.full_name || user?.email || 'Unknown User',
            last_modified_by_role: (user as any)?.user_metadata?.role || 'Unknown'
          });
          console.log('✅ Run of Show data updated via API');
        } else {
          console.log('ℹ️ No existing run of show data for this event, skipping update');
        }
      } catch (rosError) {
        console.warn('⚠️ Could not update run of show data:', rosError);
        // Don't fail the whole update if run of show data update fails
      }
      
      // Reload events to ensure we have the latest data
      setTimeout(() => {
        console.log('🔄 Reloading events after update...');
        loadEventsFromSupabase();
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error updating event via API:', error);
      console.error('❌ Error details:', error);
      alert('Error updating event in database. Please try again.');
      
      // Revert local changes on error
      loadEventsFromSupabase();
    }
  };

  const deleteEvent = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this event?')) {
      // Remove from local list immediately
      setEvents(prev => prev.filter(event => event.id !== id));

      // Delete from Supabase automatically - both calendar event AND Run of Show data
      try {
        // Find the event to get its details
        const eventToDelete = events.find(event => event.id === id);
        if (eventToDelete) {
          // Delete Run of Show data first
          await DatabaseService.deleteRunOfShowData(id);
          console.log('Run of Show data deleted from Supabase automatically');

          // Try to find and delete the corresponding calendar event
          const calendarEvents = await DatabaseService.getCalendarEvents();
          const matchingCalendarEvent = calendarEvents.find(calEvent => 
            calEvent.schedule_data?.eventId === id || calEvent.name === eventToDelete.name
          );
          
          if (matchingCalendarEvent?.id) {
            await DatabaseService.deleteCalendarEvent(matchingCalendarEvent.id);
            console.log('Calendar event deleted from Supabase automatically');
          }
        }
      } catch (error) {
        console.error('Error auto-deleting event from Supabase:', error);
        // Don't show error to user since the event was still deleted locally
      }
    }
  };

  const openEditModal = (event: Event) => {
    setEditingEvent(event);
    setEditFormData({
      name: event.name,
      date: event.date,
      location: event.location,
      numberOfDays: event.numberOfDays,
      timezone: event.timezone || 'America/New_York'
    });
  };

  const launchRunOfShow = (event: Event) => {
    // Always show role selection modal when clicking Launch
    setSelectedEvent(event);
    setShowRoleModal(true);
  };

  const handleRoleSelected = async (role: string) => {
    if (selectedEvent && user?.id) {
      // Save role to Supabase user_sessions table
      try {
        const username = user.user_metadata?.full_name || user.email || 'Unknown';
        await DatabaseService.saveUserSession(selectedEvent.id, user.id, username, role);
        console.log('✅ Role saved to Supabase from EventListPage:', role);
      } catch (error) {
        console.error('❌ Failed to save role to Supabase from EventListPage:', error);
        // Don't prevent navigation if Supabase save fails
      }
      
      // Navigate to RunOfShow with the selected role
      navigate('/run-of-show', { state: { event: selectedEvent, userRole: role } });
      
      // Close modal and reset state
      setShowRoleModal(false);
      setSelectedEvent(null);
    }
  };


  const getLocationColor = (location: string) => {
    const locationOption = LOCATION_OPTIONS.find(opt => opt.value === location);
    return locationOption ? locationOption.color : 'bg-gray-600';
  };


  const isValidDate = (date: Date) => {
    return date instanceof Date && !isNaN(date.getTime());
  };

  const formatDate = (dateString: string) => {
    // Parse the date string directly without timezone conversion
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'America/New_York' // EST/EDT timezone
    });
  };

  const getFilteredEvents = () => {
    console.log('🔍 Filtering events:', {
      totalEvents: events.length,
      activeTab,
      filterLocation,
      filterDays,
      searchTerm,
      events: events.map(e => ({ id: e.id, name: e.name, date: e.date }))
    });
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today
    
    const filtered = events.filter(event => {
      // Parse date without timezone conversion
      const [year, month, day] = event.date.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day); // month is 0-indexed
      
      const dateMatch = activeTab === 'upcoming' 
        ? eventDate >= today 
        : eventDate < today;
      
      const locationMatch = filterLocation === 'all' || event.location === filterLocation;
      const daysMatch = filterDays === 'all' || event.numberOfDays.toString() === filterDays;
      const searchMatch = searchTerm === '' || 
        event.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.location.toLowerCase().includes(searchTerm.toLowerCase());
      
      const passes = dateMatch && locationMatch && daysMatch && searchMatch;
      console.log(`🔍 Event "${event.name}" filter result:`, {
        dateMatch,
        locationMatch,
        daysMatch,
        searchMatch,
        passes,
        eventDate: isValidDate(eventDate) ? eventDate.toISOString() : 'Invalid Date',
        now: isValidDate(now) ? now.toISOString() : 'Invalid Date'
      });
      
      return passes;
    }).sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return activeTab === 'upcoming' 
        ? dateA.getTime() - dateB.getTime()
        : dateB.getTime() - dateA.getTime();
    });
    
    console.log('📊 Filtered events result:', filtered.length, filtered.map(e => e.name));
    return filtered;
  };

  const filteredEvents = getFilteredEvents();

  // Determine which server to use based on toggle
  const getApiBaseUrl = () => {
    if (forceLocal) {
      return 'http://localhost:3002';
    }
    return import.meta.env.VITE_API_BASE_URL || 
      (import.meta.env.PROD ? 'https://ros-50-production.up.railway.app' : 'http://localhost:3002');
  };
  
  const apiBaseUrl = getApiBaseUrl();
  const isUsingLocal = apiBaseUrl.includes('localhost');
  
  // Save toggle state and override API URL
  useEffect(() => {
    localStorage.setItem('forceLocalServer', forceLocal.toString());
    // Force override the API base URL in the services
    if (forceLocal) {
      (window as any).__FORCE_LOCAL_API__ = true;
      (window as any).__LOCAL_API_URL__ = 'http://localhost:3002';
    } else {
      (window as any).__FORCE_LOCAL_API__ = false;
    }
  }, [forceLocal]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-16">
      {/* Subtle Server Status Indicator */}
      <div className="fixed top-16 left-0 right-0 z-40 bg-slate-800 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-6 py-2 flex items-center justify-end gap-3">
          <div className="flex items-center gap-2 text-xs">
            <div className={`w-1.5 h-1.5 rounded-full ${isUsingLocal ? 'bg-green-400' : 'bg-blue-400'} animate-pulse`}></div>
            <span className="text-slate-400">
              {isUsingLocal ? '🏠 Local' : '☁️ Railway'}
            </span>
          </div>
          
          <button
            onClick={() => {
              setForceLocal(!forceLocal);
              setTimeout(() => {
                window.location.reload();
              }, 100);
            }}
            className={`px-3 py-1 ${isUsingLocal ? 'bg-green-600 hover:bg-green-500' : 'bg-blue-600 hover:bg-blue-500'} text-white rounded text-xs font-medium transition-colors`}
            title={`Currently using ${isUsingLocal ? 'Local' : 'Railway'} server. Click to switch.`}
          >
            Switch Server
          </button>
        </div>
      </div>
      
      {/* Header */}
      <div className="text-center py-8 mt-10">
        <h1 className="text-4xl font-bold text-white mb-2">
          📅 Event List Calendar
        </h1>
        <p className="text-xl text-slate-400 mb-4">
          Manage your events and schedules
        </p>
        
        {user && (
          <div className="text-center mb-6">
            <p className="text-white font-medium text-lg">
              Welcome back, {user.user_metadata?.full_name || user.email}!
            </p>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6">
        {/* Tabs */}
        <div className="flex justify-center mb-8">
          <div className="bg-slate-800 rounded-lg p-1 flex">
            <button
              onClick={() => setActiveTab('upcoming')}
              className={`px-6 py-3 rounded-md font-semibold transition-colors ${
                activeTab === 'upcoming'
                  ? 'bg-green-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📅 Upcoming Events
            </button>
            <button
              onClick={() => setActiveTab('past')}
              className={`px-6 py-3 rounded-md font-semibold transition-colors ${
                activeTab === 'past'
                  ? 'bg-orange-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📋 Past Events
            </button>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex justify-center mb-6">
          <div className="bg-slate-800 rounded-lg p-4 w-full max-w-4xl">
            <div className="flex items-center gap-6 justify-between">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">🔍 Search:</span>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search events by name or location..."
                    className="w-80 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">📍 Filter by location:</span>
                  <select
                    value={filterLocation}
                    onChange={(e) => setFilterLocation(e.target.value)}
                    className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                  >
                    <option value="all">All Locations</option>
                    {LOCATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              {/* Refresh Button */}
              <button
                onClick={() => {
                  console.log('🔄 Manual refresh triggered');
                  loadEventsFromSupabase();
                }}
                disabled={isLoading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-sm"
                title="Refresh events list"
              >
                {isLoading ? '🔄 Refreshing...' : '🔄 Refresh'}
              </button>
            </div>
            
            {/* Info message below search bar */}
            <div className="mt-3 text-center">
              <p className="text-xs text-slate-400">
                ℹ️ Events don't auto-refresh. Click "Refresh" to check for new events.
              </p>
            </div>
          </div>
        </div>

        {/* Add Event Button */}
        <div className="flex justify-center mb-8">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            + Add New Event
          </button>
        </div>

        {/* Events List */}
        <div className="bg-slate-800 rounded-xl p-6 shadow-2xl">
          {isLoading && (
            <div className="text-center py-4 mb-4">
              <div className="text-blue-400 text-lg">🔄 Loading events...</div>
            </div>
          )}
          <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold border-r border-slate-600">Event Name</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold border-r border-slate-600">Date</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold border-r border-slate-600">Location</th>
                    <th className="px-4 py-3 text-left text-slate-300 font-semibold border-r border-slate-600">Duration</th>
                    <th className="px-4 py-3 text-center text-slate-300 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center">
                        <div className="text-6xl mb-4">
                          {activeTab === 'upcoming' ? '📅' : '📋'}
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">
                          No {activeTab} events
                        </h3>
                        <p className="text-slate-400">
                          {activeTab === 'upcoming' 
                            ? 'Add your first upcoming event to get started!'
                            : 'Past events will appear here once you have some.'
                          }
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredEvents.map((event) => (
                      <tr key={event.id} className="border-b border-slate-600">
                        <td className="px-4 py-3 text-white font-medium border-r border-slate-600">
                          {event.name}
                        </td>
                        <td className="px-4 py-3 text-slate-300 border-r border-slate-600">
                          {formatDate(event.date)}
                        </td>
                        <td className="px-4 py-3 border-r border-slate-600">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${getLocationColor(event.location)}`}></div>
                            <span className="text-slate-300">{event.location}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-300 border-r border-slate-600">
                          {event.numberOfDays} day{event.numberOfDays > 1 ? 's' : ''}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() => launchRunOfShow(event)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
                            >
                              Launch
                            </button>
                            <button
                              onClick={() => openEditModal(event)}
                              className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteEvent(event.id)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-4 max-w-sm w-full">
            <h2 className="text-lg font-bold text-white mb-4">
              <span style={{ filter: 'brightness(0) invert(1)' }}>📅</span> Add New Event
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Event Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter event name"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                  style={{
                    colorScheme: 'dark'
                  }}
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Location</label>
                <select
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {LOCATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Duration</label>
                <select
                  value={formData.numberOfDays}
                  onChange={(e) => setFormData(prev => ({ ...prev, numberOfDays: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {DAYS_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days} day{days > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1 });
                }}
                className="flex-1 px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={addEvent}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium"
              >
                Add Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Event Modal */}
      {editingEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-4 max-w-sm w-full">
            <h2 className="text-lg font-bold text-white mb-4">
              <span style={{ filter: 'brightness(0) invert(1)' }}>✏️</span> Edit Event
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Event Name</label>
                <input
                  type="text"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter event name"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Date</label>
                <input
                  type="date"
                  value={editFormData.date}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                  style={{
                    colorScheme: 'dark'
                  }}
                />
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Location</label>
                <select
                  value={editFormData.location}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, location: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {LOCATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Duration</label>
                <select
                  value={editFormData.numberOfDays}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, numberOfDays: parseInt(e.target.value) }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {DAYS_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days} day{days > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Timezone</label>
                <select
                  value={editFormData.timezone || 'America/New_York'}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setEditingEvent(null);
                  setEditFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1, timezone: 'America/New_York' });
                }}
                className="flex-1 px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={editEvent}
                className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium"
              >
                Update Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Role Selection Modal */}
      <RoleSelectionModal
        isOpen={showRoleModal}
        onClose={() => {
          setShowRoleModal(false);
          setSelectedEvent(null);
        }}
        onRoleSelected={handleRoleSelected}
        eventId={selectedEvent?.id || ''}
      />

    </div>
  );
};

export default EventListPage;
