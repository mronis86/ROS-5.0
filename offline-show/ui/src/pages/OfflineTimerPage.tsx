import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Clock from '../components/Clock';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';
import { Event } from '../types/Event';
import { EventSelectorDropdown } from '../components/EventSelectorDropdown';
import { fetchConnectivityStatus, type ConnectivitySnapshot } from '../services/connectivity-status';
import { onCloudModeChange } from '../services/socket-client';

/** Stage / confidence monitor — syncs via show server Socket.IO (LAN or cloud-bridged). */
const OfflineTimerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Get event ID from URL parameters
  const eventIdFromUrl = searchParams.get('eventId');

  // Get timer data from location state or use defaults
  const timerData = location.state || {};

  // Clock component handles its own timer state via WebSocket
  // ClockPage only manages messages to avoid state conflicts
  const [message, setMessage] = useState('');
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [supabaseMessage, setSupabaseMessage] = useState(null);
  const [eventId, setEventId] = useState(eventIdFromUrl || timerData.eventId || null);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [disconnectTimer, setDisconnectTimer] = useState<NodeJS.Timeout | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);

  // Event selector (same pattern as PhotoView / Green Room)
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(!!document.fullscreenElement);

  // Schedule items for current event (used to know if active cue should show time-of-day instead of countdown)
  const [scheduleItems, setScheduleItems] = useState<any[]>([]);

  // Periodic schedule sync (for Clock popup to pick up Timer changes from main window): enable/disable + countdown for UI
  const [scheduleSyncEnabled, setScheduleSyncEnabled] = useState(true);
  const [scheduleSyncCountdown, setScheduleSyncCountdown] = useState(60);
  const [connectivity, setConnectivity] = useState<ConnectivitySnapshot | null>(null);
  const [eventLabel, setEventLabel] = useState<string | null>(null);

  useEffect(() => {
    document.title = eventLabel
      ? `Offline Show · Timer · ${eventLabel}`
      : 'Offline Show · Timer';
  }, [eventLabel]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await fetchConnectivityStatus();
        if (!cancelled) setConnectivity(status);
      } catch {
        if (!cancelled) setConnectivity(null);
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 20_000);
    const unsubCloud = onCloudModeChange(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      window.clearInterval(id);
      unsubCloud();
    };
  }, []);

  useEffect(() => {
    if (!eventId) {
      setEventLabel(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await DatabaseService.getRunOfShowData(eventId);
        if (!cancelled) {
          setEventLabel(data?.event_name || eventId);
        }
      } catch {
        if (!cancelled) setEventLabel(eventId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Sync eventId from URL when it changes (e.g. user changed event via selector)
  useEffect(() => {
    if (eventIdFromUrl !== null && eventIdFromUrl !== eventId) {
      setEventId(eventIdFromUrl);
    }
  }, [eventIdFromUrl, eventId]);

  const [eventsRefreshSuccessAt, setEventsRefreshSuccessAt] = useState<number | null>(null);

  // Load events list for the event selector dropdown (callable for refresh)
  const loadEvents = useCallback(async (showSuccess = false) => {
    try {
      setEventsLoading(true);
      const calendarEvents = await DatabaseService.getCalendarEvents();
      const mapped: Event[] = (calendarEvents || []).map((calEvent: any) => {
        const dateObj = new Date(calEvent.date);
        const simpleDate = dateObj.toISOString().split('T')[0];
        return {
          id: calEvent.id || '',
          name: calEvent.name,
          date: simpleDate,
          location: calEvent.schedule_data?.location || '',
          numberOfDays: calEvent.schedule_data?.numberOfDays || 1,
          timezone: calEvent.schedule_data?.timezone,
          created_at: calEvent.created_at,
          updated_at: calEvent.updated_at
        };
      });
      mapped.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      setEvents(mapped.filter((e) => e.id));
    } catch (e) {
      console.warn('ClockPage: Failed to load events for selector:', e);
      setEvents([]);
    } finally {
      setEventsLoading(false);
      if (showSuccess) setEventsRefreshSuccessAt(Date.now());
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Load run-of-show schedule for current event so Clock can show time-of-day vs countdown per cue (Timer column)
  useEffect(() => {
    if (!eventId) {
      setScheduleItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await DatabaseService.getRunOfShowData(eventId);
        if (!cancelled && data?.schedule_items) {
          setScheduleItems(Array.isArray(data.schedule_items) ? data.schedule_items : []);
        } else if (!cancelled) {
          setScheduleItems([]);
        }
      } catch {
        if (!cancelled) setScheduleItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  // Periodic refetch (60s) when enabled, plus 1s tick to drive countdown display
  const SCHEDULE_POLL_INTERVAL_MS = 60000; // 60 seconds
  useEffect(() => {
    if (!eventId || !scheduleSyncEnabled) return;
    setScheduleSyncCountdown(60);
    const refetchInterval = setInterval(async () => {
      try {
        const data = await DatabaseService.getRunOfShowData(eventId);
        if (data?.schedule_items) {
          setScheduleItems(Array.isArray(data.schedule_items) ? data.schedule_items : []);
        }
        setScheduleSyncCountdown(60);
      } catch {
        setScheduleSyncCountdown(60);
      }
    }, SCHEDULE_POLL_INTERVAL_MS);
    const countdownInterval = setInterval(() => {
      setScheduleSyncCountdown((c) => (c <= 0 ? 60 : c - 1));
    }, 1000);
    return () => {
      clearInterval(refetchInterval);
      clearInterval(countdownInterval);
    };
  }, [eventId, scheduleSyncEnabled]);

  // When only one event exists and no event selected, auto-select it so schedule (and Timer/Time Of Day) loads
  useEffect(() => {
    if (eventsLoading || eventId) return;
    if (events.length === 1 && events[0]?.id) {
      setEventId(events[0].id);
      navigate(`/timer?eventId=${encodeURIComponent(events[0].id)}`, { replace: true });
    }
  }, [eventsLoading, eventId, events, navigate]);

  useEffect(() => {
    if (eventsRefreshSuccessAt == null) return;
    const t = setTimeout(() => setEventsRefreshSuccessAt(null), 2500);
    return () => clearTimeout(t);
  }, [eventsRefreshSuccessAt]);

  // Track fullscreen so we can hide event selector when in fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => setIsFullScreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          window.close();
          break;
        // Timer controls are managed by RunOfShowPage via WebSocket
        // Clock is a display-only component
        case '+':
        case '=':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Zoom in functionality could be added here
          }
          break;
        case '-':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            // Zoom out functionality could be added here
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Handle window close
  const handleClose = async () => {
    // Clear Supabase message if there's an active message
    if (eventId && (messageEnabled || supabaseMessage)) {
      try {
        const messages = await DatabaseService.getTimerMessagesForEvent(eventId);
        const activeMessage = messages.find(msg => msg.enabled);
        if (activeMessage) {
          await DatabaseService.disableTimerMessage(activeMessage.id!);
          console.log('✅ Message disabled in Supabase on close');
        }
      } catch (error) {
        console.error('❌ Error clearing message on close:', error);
      }
    }
    
    window.close();
  };

  // WebSocket-based real-time updates for timer messages ONLY
  // Timer state is now handled exclusively by Clock component to prevent flickering
  useEffect(() => {
    if (!eventId) return;

    const loadMessage = async () => {
      try {
        const message = await DatabaseService.getTimerMessage(eventId);
        setSupabaseMessage(message);
        console.log('📨 Loaded timer message from API:', message);
      } catch (error) {
        console.error('❌ Error loading timer message:', error);
      }
    };

    loadMessage(); // Load initial data

    // Set up WebSocket connection for timer messages only
    // Clock component handles its own timer WebSocket connection
    const callbacks = {
      onTimerMessageUpdated: (data: any) => {
        console.log('📨 WebSocket: Timer message updated:', data);
        if (data && data.event_id === eventId) {
          setSupabaseMessage(data);
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📨 ClockPage: WebSocket connection status:', connected);
        if (connected) {
          // Reload message when reconnected
          loadMessage();
        }
      }
    };

    const unsub = socketClient.connect(eventId, callbacks);

    // Show disconnect timer modal only on first connect
    if (!hasShownModalOnce) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }

    return () => {
      console.log('📨 Cleaning up ClockPage WebSocket connection');
      unsub();
      if (disconnectTimer) clearTimeout(disconnectTimer);
    };
  }, [eventId]);

  // DISABLED: postMessage updates - now using WebSocket only to prevent conflicts
  // The postMessage method was causing timer flipping because it conflicted with WebSocket updates
  // WebSocket provides authoritative timer data directly from the database
  /*
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'TIMER_UPDATE') {
        const { isRunning, elapsedTime, totalDuration, eventId, itemId, mainTimer, secondaryTimer } = event.data;
        if (isRunning !== undefined) setIsRunning(isRunning);
        if (elapsedTime !== undefined) setElapsedTime(elapsedTime);
        if (totalDuration !== undefined) setTotalDuration(totalDuration);
        if (eventId !== undefined) setEventId(eventId);
        if (itemId !== undefined) setItemId(itemId);
        if (mainTimer !== undefined) setMainTimer(mainTimer);
        if (secondaryTimer !== undefined) setSecondaryTimer(secondaryTimer);
      } else if (event.data.type === 'MESSAGE_UPDATE') {
        const { message, enabled } = event.data;
        if (message !== undefined) setMessage(message);
        if (enabled !== undefined) setMessageEnabled(enabled);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  */

  // Clock page always runs in WebSocket-only mode
  // Clock component handles all timer state via its own WebSocket connection
  // ClockPage only passes message data to avoid state conflicts

  // Handle disconnect timer confirmation
  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = (hours * 60) + minutes;
    
    if (totalMinutes === 0) {
      alert('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    
    // Clear any existing timer
    if (disconnectTimer) clearTimeout(disconnectTimer);
    
    // Start new disconnect timer
    const ms = totalMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      let timeText = '';
      if (hours > 0) timeText += `${hours}h `;
      if (minutes > 0) timeText += `${minutes}m`;
      
      console.log(`⏰ ClockPage: Auto-disconnect timer expired (${timeText.trim()})`);
      console.log('📢 ClockPage: Showing disconnect notification...');
      
      // Show notification only — keep socket alive so Clock keeps receiving timer updates
      setDisconnectDuration(timeText.trim());
      setShowDisconnectNotification(true);
      console.log('✅ ClockPage: Notification state set to true');
    }, ms);
    
    setDisconnectTimer(timer);
    setShowDisconnectModal(false);
    
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (minutes > 0) timeText += `${minutes}m`;
    console.log(`⏰ ClockPage: Disconnect timer set to ${timeText.trim()}`);
  };
  
  // Handle never disconnect
  const handleNeverDisconnect = () => {
    if (disconnectTimer) clearTimeout(disconnectTimer);
    setDisconnectTimer(null);
    setShowDisconnectModal(false);
    console.log('⏰ ClockPage: Disconnect timer set to Never');
  };
  
  // Handle reconnect from notification
  const handleReconnect = () => {
    setShowDisconnectNotification(false);
    if (eventId && !socketClient.isConnected()) {
      socketClient.connect(eventId, {
        onTimerMessageUpdated: (data: any) => {
          if (data && data.event_id === eventId) {
            setSupabaseMessage(data);
          }
        },
      });
    }
    setShowDisconnectModal(true);
  };

  const handleEventSelect = (selected: Event) => {
    setEventId(selected.id);
    setShowEventSelector(false);
    navigate(`/timer?eventId=${encodeURIComponent(selected.id)}`, { replace: true });
  };

  return (
    <>
      <div className="relative w-full min-h-screen">
        <Clock
        onClose={handleClose}
        message={message}
        messageEnabled={messageEnabled}
        eventId={eventId}
        supabaseMessage={supabaseMessage}
        scheduleItems={scheduleItems}
        offlineShowBadge
        cloudConnected={connectivity?.cloudConnected === true}
      />

        {/* Event Selector - left side below CURRENT TIME, fixed so it doesn't move on scroll; overflow-visible so dropdown can expand */}
        {!isFullScreen && events.length > 1 && (
          <div className="fixed top-[115px] left-4 z-[100] bg-black/50 backdrop-blur-sm rounded-lg p-3 space-y-2 overflow-visible">
            {showEventSelector ? (
              <div className="overflow-visible">
                <label className="text-sm text-gray-400 block mb-1">Event:</label>
                <EventSelectorDropdown
                  events={events}
                  value={eventId ?? null}
                  onChange={handleEventSelect}
                  disabled={eventsLoading}
                  loading={eventsLoading}
                  placeholder="Select event…"
                  selectClassName="min-w-[160px] max-w-[240px] px-3 py-2"
                  listMaxHeight="200px"
                />
                <button
                  type="button"
                  onClick={() => loadEvents(true)}
                  disabled={eventsLoading}
                  className="px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600 transition-colors w-full disabled:opacity-60 flex items-center justify-center gap-1"
                  title="Refresh events list"
                >
                  {eventsLoading ? (
                    '…'
                  ) : eventsRefreshSuccessAt ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Refreshed
                    </>
                  ) : (
                    'Refresh events'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEventSelector(false)}
                  className="px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600 transition-colors w-full"
                  title="Hide event selector"
                >
                  Hide
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowEventSelector(true)}
                className="px-3 py-2 text-sm rounded border border-slate-600 bg-slate-700 text-gray-300 hover:bg-slate-600 transition-colors w-full"
                title="Change event"
              >
                Change event
              </button>
            )}
          </div>
        )}

        {/* Schedule sync - bottom right (opposite Timer Status bottom left), countdown + enable checkbox */}
        {!isFullScreen && eventId && (
          <div className="fixed bottom-10 right-4 z-[100] bg-black/50 backdrop-blur-sm rounded-lg p-3 space-y-2 min-w-[140px]">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
              <input
                type="checkbox"
                checked={scheduleSyncEnabled}
                onChange={(e) => setScheduleSyncEnabled(e.target.checked)}
                className="rounded border-slate-500 bg-slate-700 text-blue-500 focus:ring-blue-500"
              />
              <span>Schedule sync</span>
            </label>
            {scheduleSyncEnabled ? (
              <div className="text-sm text-gray-400 font-mono" title="Refreshes run-of-show every 60s so Timer changes from main window appear here">
                Sync in {scheduleSyncCountdown}s
              </div>
            ) : (
              <div className="text-sm text-gray-500">Sync off</div>
            )}
          </div>
        )}
      </div>

      {/* Disconnect Timer Modal - same as Electron app */}
      {showDisconnectModal && <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />}
      
      {/* Disconnect Notification - same as Electron app */}
      {showDisconnectNotification && <DisconnectNotification duration={disconnectDuration} onReconnect={handleReconnect} />}
    </>
  );
};

// Disconnect Timer Modal Component
const DisconnectTimerModal: React.FC<{ onConfirm: (hours: number, mins: number) => void; onNever: () => void }> = ({ onConfirm, onNever }) => {
  const [hours, setHours] = useState(2);
  const [minutes, setMinutes] = useState(0);
  
  const minuteValues = [0, 5, 10, 15, 20, 25, 30];
  const hoursRef = React.useRef<HTMLDivElement>(null);
  const minutesRef = React.useRef<HTMLDivElement>(null);
  
  // Initialize scroll position on mount
  React.useEffect(() => {
    if (hoursRef.current) {
      hoursRef.current.scrollTop = hours * 50; // 50px per item
    }
    if (minutesRef.current) {
      minutesRef.current.scrollTop = minuteValues.indexOf(minutes) * 50;
    }
  }, []);
  
  // Handle scroll for hours
  const handleHoursScroll = () => {
    if (!hoursRef.current) return;
    const index = Math.round(hoursRef.current.scrollTop / 50);
    setHours(Math.max(0, Math.min(index, 24)));
  };
  
  // Handle scroll for minutes
  const handleMinutesScroll = () => {
    if (!minutesRef.current) return;
    const index = Math.round(minutesRef.current.scrollTop / 50);
    setMinutes(minuteValues[Math.max(0, Math.min(index, minuteValues.length - 1))]);
  };
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[999999]">
      <div className="bg-slate-800 p-10 rounded-2xl border border-slate-700 shadow-2xl max-w-3xl w-[90%]">
        <h3 className="text-slate-100 text-3xl font-semibold mb-2 text-center">⏰ Auto-Disconnect Timer</h3>
        <p className="text-slate-400 mb-8 text-center">How long should this connection stay active?</p>
        
        <div className="flex items-center justify-center gap-12 mb-10 py-8">
          {/* Hours Picker */}
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Hours</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl shadow-inner overflow-hidden">
              {/* Highlight bar */}
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-blue-500/10 border-y border-slate-500/20 pointer-events-none z-10" />
              {/* Fade gradients */}
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20" />
              {/* Scrollable list */}
              <div 
                ref={hoursRef}
                onScroll={handleHoursScroll}
                className="h-full overflow-y-scroll scrollbar-hide pt-24 pb-24 snap-y snap-mandatory"
                style={{ scrollBehavior: 'smooth' }}
              >
                {Array.from({length: 25}, (_, i) => (
                  <div 
                    key={i}
                    className={`h-12 flex items-center justify-center text-2xl font-medium snap-center transition-all ${
                      hours === i ? 'text-slate-100 scale-110' : 'text-slate-600 scale-90'
                    }`}
                  >
                    {i}
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="text-slate-300 text-4xl font-light mt-10">:</div>
          
          {/* Minutes Picker */}
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Minutes</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl shadow-inner overflow-hidden">
              {/* Highlight bar */}
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-blue-500/10 border-y border-slate-500/20 pointer-events-none z-10" />
              {/* Fade gradients */}
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20" />
              {/* Scrollable list */}
              <div 
                ref={minutesRef}
                onScroll={handleMinutesScroll}
                className="h-full overflow-y-scroll scrollbar-hide pt-24 pb-24 snap-y snap-mandatory"
                style={{ scrollBehavior: 'smooth' }}
              >
                {minuteValues.map(m => (
                  <div 
                    key={m}
                    className={`h-12 flex items-center justify-center text-2xl font-medium snap-center transition-all ${
                      minutes === m ? 'text-slate-100 scale-110' : 'text-slate-600 scale-90'
                    }`}
                  >
                    {m}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => onConfirm(hours, minutes)}
            className="flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/30"
          >
            ✓ Confirm
          </button>
          <button 
            onClick={onNever}
            className="flex-1 px-8 py-4 bg-slate-600 hover:bg-slate-500 rounded-xl text-slate-200 text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-600/30"
          >
            ∞ Never Disconnect
          </button>
        </div>
        
        <p className="mt-6 text-sm text-slate-500 text-center">⚠️ "Never" may increase database costs</p>
      </div>
    </div>
  );
};

// Disconnect Notification Component
const DisconnectNotification: React.FC<{ duration: string; onReconnect: () => void }> = ({ duration, onReconnect }) => {
  React.useEffect(() => {
    console.log('🔔 DisconnectNotification component mounted with duration:', duration);
    return () => console.log('🔔 DisconnectNotification component unmounted');
  }, []);
  
  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-70 z-[999998] animate-fade-in pointer-events-auto" />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[999999] animate-slide-in pointer-events-auto">
        <div className="bg-gradient-to-br from-slate-800 to-slate-700 p-10 rounded-2xl border-2 border-slate-600 shadow-2xl flex items-center gap-6 min-w-[450px]">
          <div className="text-6xl animate-pulse-slow">🔌</div>
          <div className="flex-1">
            <h4 className="text-slate-100 text-2xl font-semibold mb-2">Connection Closed</h4>
            <p className="text-slate-400 text-base">Auto-disconnected after {duration}</p>
          </div>
          <button 
            onClick={onReconnect}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-base font-medium whitespace-nowrap transition transform hover:-translate-y-1 hover:shadow-lg hover:shadow-blue-600/40"
          >
            🔄 Reconnect
          </button>
        </div>
      </div>
    </>
  );
};

export default OfflineTimerPage;
