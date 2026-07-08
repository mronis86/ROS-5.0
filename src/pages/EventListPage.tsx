import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Event, EventFormData, LOCATION_OPTIONS, DAYS_OPTIONS, TIMEZONE_OPTIONS, EVENT_TYPE_OPTIONS, RECORD_STREAMING_OPTIONS } from '../types/Event';
import { DatabaseService } from '../services/database';
import { apiClient, getApiBaseUrl } from '../services/api-client';
import { useAuth } from '../contexts/AuthContext';
import { canAccessProductionDashboard, canAccessAdmin, canAccessAccessManager } from '../services/auth-service';
import RoleSelectionModal from '../components/RoleSelectionModal';
import EventListMobileView from '../components/mobile-layouts/EventListMobileView';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { isQuickModeCalendarEvent, clearQuickModeNewSessionDedupe } from '../lib/quickModeEvent';
import QuickModeBoltIcon from '../components/QuickModeBoltIcon';
import EventListRowActions from '../components/EventListRowActions';

type EventListTab = 'upcoming' | 'past' | 'quickMode';

const EventListPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isNarrowViewport = useNarrowViewport();
  const [events, setEvents] = useState<Event[]>([]);
  const [activeTab, setActiveTab] = useState<EventListTab>('upcoming');
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
    timezone: 'America/New_York',
    eventType: 'Staged Production',
    recordStreaming: 'None'
  });
  const [formData, setFormData] = useState<EventFormData>({
    name: '',
    date: '',
    location: 'Great Hall',
    numberOfDays: 1,
    timezone: 'America/New_York',
    eventType: 'Staged Production',
    recordStreaming: 'None'
  });
  
  // Role selection state
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Delete confirmation modal: require user to type generated code to confirm
  const [eventToDelete, setEventToDelete] = useState<Event | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [quickModeSelectedIds, setQuickModeSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteTargets, setBulkDeleteTargets] = useState<Event[]>([]);

  const openNewQuickMode = () => {
    clearQuickModeNewSessionDedupe();
    navigate('/quick-mode?new=1');
  };

  const generateDeleteCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
  };

  // Clear any legacy local-server preference (app uses Railway only)
  useEffect(() => {
    localStorage.removeItem('forceLocalServer');
  }, []);

  // Load events from Supabase and localStorage on component mount
  useEffect(() => {
    loadEventsFromSupabase();
  }, []);

  useEffect(() => {
    const tab = (location.state as { tab?: EventListTab } | null)?.tab;
    if (tab === 'quickMode') {
      setActiveTab('quickMode');
    }
  }, [location.state]);

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
      apiClient.invalidateCalendarEventsCache();
      console.log('🔄 Loading events from Neon database...');
      console.log('🌐 API Base URL:', getApiBaseUrl());
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
            calendarId: calEvent.id,
            name: calEvent.name,
            date: simpleDate, // Use simple date format for filtering
            originalDate: calEvent.date, // Keep original for reference
            location: calEvent.schedule_data?.location || 'Great Hall',
            numberOfDays: calEvent.schedule_data?.numberOfDays || 1,
            timezone: calEvent.schedule_data?.timezone || 'America/New_York',
            eventType: calEvent.schedule_data?.eventType || 'Staged Production',
            recordStreaming: calEvent.schedule_data?.recordStreaming || 'None',
            isQuickMode: isQuickModeCalendarEvent(calEvent),
            created_at: calEvent.created_at || new Date().toISOString(),
            updated_at: calEvent.updated_at || new Date().toISOString()
          };
          
          console.log(`🌍 Event "${calEvent.name}" timezone:`, {
            rawTimezone: calEvent.schedule_data?.timezone,
            finalTimezone: transformedEvent.timezone,
            scheduleData: calEvent.schedule_data
          });
          
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
      timezone: formData.timezone || 'America/New_York',
      eventType: formData.eventType || 'Staged Production',
      recordStreaming: formData.recordStreaming || 'None',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Close modal first to prevent layout shift
    setShowAddModal(false);
    setFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1, timezone: 'America/New_York', eventType: 'Staged Production', recordStreaming: 'None' });
    
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
          eventId: newEvent.id,
          timezone: newEvent.timezone,
          eventType: newEvent.eventType,
          recordStreaming: newEvent.recordStreaming
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
          timezone: newEvent.timezone || 'America/New_York',
          lastSaved: new Date().toISOString(),
          show_mode: 'rehearsal',
          track_was_durations: false
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
      eventType: editFormData.eventType,
      recordStreaming: editFormData.recordStreaming,
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
    setEditFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1, timezone: 'America/New_York', eventType: 'Staged Production', recordStreaming: 'None' });
    
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
            timezone: updatedEvent.timezone,
            eventType: updatedEvent.eventType,
            recordStreaming: updatedEvent.recordStreaming
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

  const closeDeleteConfirmModal = () => {
    setEventToDelete(null);
    setBulkDeleteTargets([]);
    setDeleteConfirmInput('');
    setDeleteConfirmCode('');
  };

  const deleteEventFully = async (event: Event) => {
    const calendarId = event.calendarId || event.id;
    try {
      await DatabaseService.deleteRunOfShowData(calendarId);
    } catch (error) {
      console.error('Error deleting run-of-show data:', error);
    }
    try {
      await DatabaseService.deleteCalendarEvent(calendarId);
    } catch (error) {
      console.error('Error deleting calendar event:', error);
    }
  };

  const deleteConfirmPhrase = deleteConfirmCode ? `DELETE ${deleteConfirmCode}` : '';
  const deleteConfirmMatch = deleteConfirmPhrase.length > 0 && deleteConfirmInput.trim() === deleteConfirmPhrase;

  const performDeleteEvent = async () => {
    if (!deleteConfirmMatch) return;

    if (bulkDeleteTargets.length > 0) {
      const targets = bulkDeleteTargets;
      const ids = new Set(targets.map((e) => e.id));
      setIsDeleting(true);
      closeDeleteConfirmModal();
      setEvents((prev) => prev.filter((event) => !ids.has(event.id)));
      setQuickModeSelectedIds(new Set());
      try {
        for (const event of targets) {
          await deleteEventFully(event);
        }
      } finally {
        setIsDeleting(false);
        loadEventsFromSupabase();
      }
      return;
    }

    if (!eventToDelete) return;
    const id = eventToDelete.id;
    setIsDeleting(true);
    closeDeleteConfirmModal();
    setEvents((prev) => prev.filter((event) => event.id !== id));
    try {
      await deleteEventFully(eventToDelete);
    } finally {
      setIsDeleting(false);
    }
  };

  const openBulkDeleteConfirm = (targetEvents: Event[]) => {
    if (targetEvents.length === 0) return;
    setEventToDelete(null);
    setBulkDeleteTargets(targetEvents);
    setDeleteConfirmInput('');
    setDeleteConfirmCode(generateDeleteCode());
  };

  const toggleQuickModeSelected = (id: string) => {
    setQuickModeSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDeleteConfirmModal = (event: Event) => {
    setBulkDeleteTargets([]);
    setEventToDelete(event);
    setDeleteConfirmInput('');
    setDeleteConfirmCode(generateDeleteCode());
  };

  const clearQuickModeSelection = () => setQuickModeSelectedIds(new Set());

  const openEditModal = (event: Event) => {
    setEditingEvent(event);
    setEditFormData({
      name: event.name,
      date: event.date,
      location: event.location,
      numberOfDays: event.numberOfDays,
      timezone: event.timezone || 'America/New_York',
      eventType: event.eventType || 'Staged Production',
      recordStreaming: event.recordStreaming || 'None'
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
      
      const runOfShowPath = isNarrowViewport ? '/run-of-show-mobile' : '/run-of-show';
      navigate(runOfShowPath, { state: { event: selectedEvent, userRole: role } });
      
      // Close modal and reset state
      setShowRoleModal(false);
      setSelectedEvent(null);
    }
  };


  const getEventTypeColor = (eventType: string) => {
    const opt = EVENT_TYPE_OPTIONS.find(o => o.value === eventType);
    return opt?.color ?? 'bg-slate-500';
  };

  const getRecordStreamingColor = (recordStreaming: string) => {
    const opt = RECORD_STREAMING_OPTIONS.find(o => o.value === recordStreaming);
    return opt?.color ?? 'bg-slate-500';
  };

  // Short labels for Event Type (pill style) and Broadcast Options (compact)
  const getEventTypeShortLabel = (eventType: string) => {
    const map: Record<string, string> = {
      'Staged Production': 'Staged',
      'Studio Hit': 'Studio',
      'General Meeting': 'Meeting',
      'Hollow Square': 'Hollow',
    };
    return map[eventType] ?? eventType;
  };

  const getRecordStreamingShort = (recordStreaming: string) => {
    if (recordStreaming === 'Record') return { label: 'Rec', title: 'Record' };
    if (recordStreaming === 'Streaming') return { label: 'Stream', title: 'Streaming' };
    return { label: 'None', title: 'None' };
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
      const searchMatch = searchTerm === '' || 
        event.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.location.toLowerCase().includes(searchTerm.toLowerCase());

      if (activeTab === 'quickMode') {
        return Boolean(event.isQuickMode) && searchMatch;
      }

      // Parse date without timezone conversion
      const [year, month, day] = event.date.split('-').map(Number);
      const eventDate = new Date(year, month - 1, day); // month is 0-indexed
      
      const dateMatch = activeTab === 'upcoming' 
        ? eventDate >= today 
        : eventDate < today;
      
      const locationMatch = filterLocation === 'all' || event.location === filterLocation;
      const daysMatch = filterDays === 'all' || event.numberOfDays.toString() === filterDays;
      
      const passes = dateMatch && locationMatch && daysMatch && searchMatch && !event.isQuickMode;
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
      if (activeTab === 'quickMode') {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTs - aTs;
      }
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
  const quickModeEventCount = events.filter((e) => e.isQuickMode).length;
  const bulkDeleteSelection = filteredEvents.filter((e) => quickModeSelectedIds.has(e.id));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200 pt-[var(--app-header-height)]">
      {/* Header */}
      <div className="text-center py-3 pt-4 mt-0">
        <h1 className="text-xl font-bold text-white mb-0.5">
          📅 Event List Calendar
        </h1>
        <p className="text-sm text-slate-400 mb-1">
          Manage your events and schedules
        </p>
        {canAccessAdmin(user) || canAccessAccessManager(user) || canAccessProductionDashboard(user) ? (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {canAccessAdmin(user) ? (
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="rounded-lg border border-amber-600/60 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-900/50"
              >
                Open Admin
              </button>
            ) : null}
            {canAccessAccessManager(user) && !canAccessAdmin(user) ? (
              <button
                type="button"
                onClick={() => navigate('/access-manager')}
                className="rounded-lg border border-amber-600/60 bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-900/50"
              >
                Manage Access
              </button>
            ) : null}
            {canAccessProductionDashboard(user) ? (
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="rounded-lg border border-cyan-600/60 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/50"
              >
                Open Production Dashboard
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Main Content */}
      <div className={`mx-auto w-full ${isNarrowViewport ? 'max-w-lg px-3' : 'max-w-6xl px-6'}`}>
        {!isNarrowViewport ? (
          <>
        {/* Tabs + Add New Event on one row */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
          <div className="bg-slate-800 rounded-lg p-0.5 flex">
            <button
              onClick={() => setActiveTab('upcoming')}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'upcoming'
                  ? 'bg-green-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📅 Upcoming Events
            </button>
            <button
              onClick={() => setActiveTab('past')}
              className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'past'
                  ? 'bg-orange-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              📋 Past Events
            </button>
            <button
              onClick={() => {
                setActiveTab('quickMode');
                clearQuickModeSelection();
              }}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                activeTab === 'quickMode'
                  ? 'bg-yellow-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <QuickModeBoltIcon className="h-3.5 w-3.5" />
              Quick Mode{quickModeEventCount > 0 ? ` (${quickModeEventCount})` : ''}
            </button>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            + Add New Event
          </button>
          <button
            type="button"
            onClick={openNewQuickMode}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
            title="Open Quick Mode for ad-hoc timers"
          >
            Open Quick Mode
          </button>
        </div>

        {activeTab === 'quickMode' && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 bg-purple-950/40 border border-purple-700/50 rounded-lg">
            <p className="text-sm text-purple-200">
              Quick Mode sessions are timer workspaces. Select entries below to delete old or duplicate sessions.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickModeSelectedIds(new Set(filteredEvents.map((e) => e.id)))}
                disabled={filteredEvents.length === 0}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded-lg"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearQuickModeSelection}
                disabled={quickModeSelectedIds.size === 0}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded-lg"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => openBulkDeleteConfirm(bulkDeleteSelection)}
                disabled={bulkDeleteSelection.length === 0 || isDeleting}
                className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              >
                Delete selected ({bulkDeleteSelection.length})
              </button>
              <button
                type="button"
                onClick={() => openBulkDeleteConfirm(filteredEvents)}
                disabled={filteredEvents.length === 0 || isDeleting}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
              >
                Delete all ({filteredEvents.length})
              </button>
            </div>
          </div>
        )}

        {/* Search and Filter */}
        <div className="flex justify-center mb-4">
          <div className="bg-slate-800 rounded-lg p-3 w-full max-w-4xl">
            <div className="flex items-center gap-4 justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">🔍 Search:</span>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search events by name or location..."
                    className="w-80 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm">📍 Filter by location:</span>
                  <select
                    value={filterLocation}
                    onChange={(e) => setFilterLocation(e.target.value)}
                    disabled={activeTab === 'quickMode'}
                    className="px-3 py-1.5 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm disabled:opacity-50"
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
                className="px-3 py-1.5 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors text-sm text-white"
                title="Refresh events list"
              >
                {isLoading ? '🔄 Refreshing...' : '🔄 Refresh'}
              </button>
            </div>
            
            {/* Info message below search bar */}
            <div className="mt-2 text-center">
              <p className="text-xs text-slate-400">
                ℹ️ Events don't auto-refresh. Click "Refresh" to check for new events.
              </p>
            </div>
          </div>
        </div>

        {/* Events List */}
        <div className="bg-slate-800 rounded-xl p-4 shadow-2xl">
          {isLoading && (
            <div className="text-center py-2 mb-2">
              <div className="text-blue-400 text-sm">🔄 Loading events...</div>
            </div>
          )}
          <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700">
                  <tr>
                    {activeTab === 'quickMode' && (
                      <th className="px-2 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600 w-10">
                        <span className="sr-only">Select</span>
                      </th>
                    )}
                    <th className="px-3 py-2 text-left text-slate-300 font-semibold text-sm border-r border-slate-600 min-w-[220px] w-[28%]">Event Name</th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">Date</th>
                    {activeTab !== 'quickMode' && (
                      <>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">Location</th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">Type</th>
                    <th className="px-2 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600 min-w-[5.5rem]" title="Broadcast Options">Broadcast</th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">Duration</th>
                    <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">Timezone</th>
                      </>
                    )}
                    {activeTab === 'quickMode' && (
                      <th className="px-3 py-2 text-center text-slate-300 font-semibold text-sm border-r border-slate-600">Created</th>
                    )}
                    <th className="px-2 py-2 text-center text-slate-300 font-semibold text-sm">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.length === 0 ? (
                    <tr>
                      <td colSpan={activeTab === 'quickMode' ? 5 : 8} className="px-4 py-12 text-center">
                        <div className="mb-4 flex justify-center">
                          {activeTab === 'upcoming' ? (
                            <span className="text-6xl">📅</span>
                          ) : activeTab === 'quickMode' ? (
                            <QuickModeBoltIcon className="h-14 w-14 text-yellow-500" />
                          ) : (
                            <span className="text-6xl">📋</span>
                          )}
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">
                          {activeTab === 'quickMode' ? 'No Quick Mode sessions' : `No ${activeTab} events`}
                        </h3>
                        <p className="text-slate-400">
                          {activeTab === 'upcoming' 
                            ? 'Add your first upcoming event to get started!'
                            : activeTab === 'quickMode'
                              ? 'Open Quick Mode to start timers. Sessions appear here for cleanup.'
                              : 'Past events will appear here once you have some.'
                          }
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredEvents.map((event) => (
                      <tr key={event.id} className="border-b border-slate-600">
                        {activeTab === 'quickMode' && (
                          <td className="px-2 py-2 text-center border-r border-slate-600">
                            <input
                              type="checkbox"
                              checked={quickModeSelectedIds.has(event.id)}
                              onChange={() => toggleQuickModeSelected(event.id)}
                              className="h-4 w-4 rounded border-slate-500"
                              aria-label={`Select ${event.name}`}
                            />
                          </td>
                        )}
                        <td className="px-3 py-2 text-white font-medium text-sm border-r border-slate-600 min-w-[220px] w-[28%]">
                          <div className="flex items-center gap-2 flex-wrap">
                            {event.name}
                            {event.isQuickMode && (
                              <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-purple-600 text-white">
                                Quick
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-300 text-sm border-r border-slate-600 text-center">
                          {formatDate(event.date)}
                        </td>
                        {activeTab !== 'quickMode' && (
                          <>
                        <td className="px-3 py-2 border-r border-slate-600">
                          <div className="flex items-center gap-1.5">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${getLocationColor(event.location)}`}></div>
                            <span className="text-slate-300 text-sm">{event.location}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 border-r border-slate-600">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium text-white ${getEventTypeColor(event.eventType || 'Staged Production')}`}
                            title={event.eventType || 'Staged Production'}
                          >
                            {getEventTypeShortLabel(event.eventType || 'Staged Production')}
                          </span>
                        </td>
                        <td className="px-2 py-2 border-r border-slate-600 min-w-[5.5rem] text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium text-white ${getRecordStreamingColor(event.recordStreaming || 'None')}`}
                            title={getRecordStreamingShort(event.recordStreaming || 'None').title}
                          >
                            {getRecordStreamingShort(event.recordStreaming || 'None').label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-300 text-sm border-r border-slate-600 text-center">
                          {event.numberOfDays} day{event.numberOfDays > 1 ? 's' : ''}
                        </td>
                        <td className="px-3 py-2 text-slate-300 border-r border-slate-600">
                          <span className="text-xs font-mono">
                            {event.timezone || 'America/New_York'}
                          </span>
                        </td>
                          </>
                        )}
                        {activeTab === 'quickMode' && (
                          <td className="px-3 py-2 text-slate-400 text-xs border-r border-slate-600 text-center font-mono">
                            {event.created_at ? new Date(event.created_at).toLocaleString() : '—'}
                          </td>
                        )}
                        <td className="px-2 py-2 min-w-[9.5rem] text-center">
                          <EventListRowActions
                            layout="table"
                            mode={activeTab === 'quickMode' ? 'quickMode' : 'standard'}
                            onLaunch={() => launchRunOfShow(event)}
                            onEdit={() => openEditModal(event)}
                            onDelete={() => openDeleteConfirmModal(event)}
                            onOpenQuickMode={() => navigate(`/quick-mode?eventId=${encodeURIComponent(event.id)}`)}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </>
        ) : (
          <EventListMobileView
            filteredEvents={filteredEvents}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            filterLocation={filterLocation}
            onFilterLocationChange={setFilterLocation}
            filterDays={filterDays}
            onFilterDaysChange={setFilterDays}
            isLoading={isLoading}
            onRefresh={() => loadEventsFromSupabase()}
            onAddClick={() => setShowAddModal(true)}
            onQuickMode={openNewQuickMode}
            onOpenQuickModeSession={(event) => navigate(`/quick-mode?eventId=${encodeURIComponent(event.id)}`)}
            quickModeEventCount={quickModeEventCount}
            onBulkDeleteQuickMode={() => openBulkDeleteConfirm(filteredEvents)}
            onClearQuickModeSelection={clearQuickModeSelection}
            onLaunch={launchRunOfShow}
            onEdit={openEditModal}
            onDelete={openDeleteConfirmModal}
            formatDate={formatDate}
            getLocationColor={getLocationColor}
            getEventTypeColor={getEventTypeColor}
            getEventTypeShortLabel={getEventTypeShortLabel}
            getRecordStreamingColor={getRecordStreamingColor}
            getRecordStreamingShort={getRecordStreamingShort}
          />
        )}
      </div>

      {/* Add Event Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-4 max-w-2xl w-full max-h-[90vh] flex flex-col">
            <h2 className="text-lg font-bold text-white mb-3 shrink-0">
              <span style={{ filter: 'brightness(0) invert(1)' }}>📅</span> Add New Event
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 overflow-y-auto min-h-0 flex-1 pr-1">
              <div className="col-span-2">
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
                <label className="block text-slate-300 text-sm font-medium mb-1">Event Type</label>
                <select
                  value={formData.eventType || 'Staged Production'}
                  onChange={(e) => setFormData(prev => ({ ...prev, eventType: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Broadcast Options</label>
                <select
                  value={formData.recordStreaming || 'None'}
                  onChange={(e) => setFormData(prev => ({ ...prev, recordStreaming: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {RECORD_STREAMING_OPTIONS.map((option) => (
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
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Timezone</label>
                <select
                  value={formData.timezone || 'America/New_York'}
                  onChange={(e) => setFormData(prev => ({ ...prev, timezone: e.target.value }))}
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
            <footer className="mt-4 pt-4 border-t border-slate-600 shrink-0 flex gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1, timezone: 'America/New_York', eventType: 'Staged Production', recordStreaming: 'None' });
                }}
                className="flex-1 px-4 py-2.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addEvent}
                className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Add Event
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Delete confirmation modal - must type phrase to confirm */}
      {(eventToDelete || bulkDeleteTargets.length > 0) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full border border-slate-600 shadow-xl">
            <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
              <span className="text-red-400">⚠️</span>
              {bulkDeleteTargets.length > 0 ? `Delete ${bulkDeleteTargets.length} Quick Mode Sessions` : 'Delete Event'}
            </h2>
            <p className="text-slate-300 text-sm mb-3">
              {bulkDeleteTargets.length > 0 ? (
                <>
                  This will permanently delete <strong className="text-white">{bulkDeleteTargets.length}</strong> Quick Mode session(s) and their timer data. This cannot be undone.
                </>
              ) : (
                <>
                  This will permanently delete <strong className="text-white">{eventToDelete?.name}</strong> and its Run of Show data. This cannot be undone.
                </>
              )}
            </p>
            <p className="text-slate-400 text-xs mb-2">
              Copy or type the phrase below to confirm:
            </p>
            <code className="block mb-3 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-amber-300 text-sm font-mono tracking-wider select-all">
              DELETE {deleteConfirmCode}
            </code>
            <input
              type="text"
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder="Paste or type the phrase above"
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-500 focus:border-red-500 focus:outline-none text-sm mb-4"
              autoComplete="off"
            />
            <div className="flex gap-3">
              <button
                onClick={closeDeleteConfirmModal}
                className="flex-1 px-4 py-2.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={performDeleteEvent}
                disabled={!deleteConfirmMatch}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Event Modal */}
      {editingEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-4 max-w-2xl w-full max-h-[90vh] flex flex-col">
            <h2 className="text-lg font-bold text-white mb-3 shrink-0">
              <span style={{ filter: 'brightness(0) invert(1)' }}>✏️</span> Edit Event
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 overflow-y-auto min-h-0 flex-1 pr-1">
              <div className="col-span-2">
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
                <label className="block text-slate-300 text-sm font-medium mb-1">Event Type</label>
                <select
                  value={editFormData.eventType || 'Staged Production'}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, eventType: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Broadcast Options</label>
                <select
                  value={editFormData.recordStreaming || 'None'}
                  onChange={(e) => setEditFormData(prev => ({ ...prev, recordStreaming: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:border-blue-500 focus:outline-none text-sm"
                >
                  {RECORD_STREAMING_OPTIONS.map((option) => (
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
            <footer className="mt-4 pt-4 border-t border-slate-600 shrink-0 flex gap-3">
              <button
                onClick={() => {
                  setEditingEvent(null);
                  setEditFormData({ name: '', date: '', location: 'Great Hall', numberOfDays: 1, timezone: 'America/New_York', eventType: 'Staged Production', recordStreaming: 'None' });
                }}
                className="flex-1 px-4 py-2.5 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={editEvent}
                className="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Update Event
              </button>
            </footer>
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
