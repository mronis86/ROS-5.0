import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import FullScreenTimer from '../components/FullScreenTimer';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

const FullScreenTimerPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Get timer data from location state or use defaults
  const timerData = location.state || {};
  
  const [isRunning, setIsRunning] = useState(timerData.isRunning || false);
  const [elapsedTime, setElapsedTime] = useState(timerData.elapsedTime || 0);
  const [totalDuration, setTotalDuration] = useState(timerData.totalDuration || 0);
  const [message, setMessage] = useState('');
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [supabaseMessage, setSupabaseMessage] = useState(null);
  const [itemId, setItemId] = useState(timerData.itemId || null);
  const [eventId, setEventId] = useState(timerData.eventId || null);
  const [mainTimer, setMainTimer] = useState(timerData.mainTimer || null);
  const [secondaryTimer, setSecondaryTimer] = useState(timerData.secondaryTimer || null);
  
  // Add hybrid timer data state for direct RunOfShowPage communication
  const [hybridTimerData, setHybridTimerData] = useState<any>(null);
  const [clockOffset, setClockOffset] = useState<number>(0); // Clock sync with server
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showDisconnectNotification, setShowDisconnectNotification] = useState(false);
  const [disconnectDuration, setDisconnectDuration] = useState('');
  const [disconnectTimer, setDisconnectTimer] = useState<NodeJS.Timeout | null>(null);
  const [hasShownModalOnce, setHasShownModalOnce] = useState(false);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          window.close();
          break;
        case ' ':
          e.preventDefault();
          setIsRunning(!isRunning);
          break;
        case 'r':
        case 'R':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setElapsedTime(0);
            setIsRunning(false);
          }
          break;
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
  }, [isRunning]);

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

  // WebSocket-based real-time updates for timer messages and direct RunOfShowPage communication
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

    // Set up WebSocket connection for real-time updates (both messages and timer data)
    const callbacks = {
      onTimerMessageUpdated: (data: any) => {
        console.log('📨 WebSocket: Timer message updated:', data);
        if (data && data.event_id === eventId) {
          setSupabaseMessage(data);
        }
      },
      onTimerUpdated: (data: any) => {
        console.log('📡 FullScreenTimer: Timer updated via WebSocket from RunOfShowPage');
        if (data && data.event_id === eventId) {
          // Update hybrid timer data directly from WebSocket (like RunOfShowPage)
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: data
          }));
          console.log('✅ FullScreenTimer: Timer updated via WebSocket:', data);
        }
      },
      onTimerStopped: (data: any) => {
        console.log('📡 FullScreenTimer: Timer stopped via WebSocket from RunOfShowPage');
        if (data && data.event_id === eventId) {
          // Clear hybrid timer data when stopped
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          console.log('✅ FullScreenTimer: Timer cleared via WebSocket');
        }
      },
      onTimersStopped: (data: any) => {
        console.log('📡 FullScreenTimer: All timers stopped via WebSocket from RunOfShowPage');
        if (data && data.event_id === eventId) {
          // Clear hybrid timer data when all stopped
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          console.log('✅ FullScreenTimer: All timers cleared via WebSocket');
        }
      },
      onSubCueTimerStarted: (data: any) => {
        console.log('📡 FullScreenTimer: Sub-cue timer started via WebSocket from RunOfShowPage');
        if (data && data.event_id === eventId) {
          // Update hybrid timer data with sub-cue timer
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: data
          }));
          console.log('✅ FullScreenTimer: Sub-cue timer started via WebSocket:', data);
        }
      },
      onSubCueTimerStopped: (data: any) => {
        console.log('📡 FullScreenTimer: Sub-cue timer stopped via WebSocket from RunOfShowPage');
        if (data && data.event_id === eventId) {
          // Clear hybrid timer data sub-cue timer
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: null
          }));
          console.log('✅ FullScreenTimer: Sub-cue timer stopped via WebSocket');
        }
      },
      onActiveTimersUpdated: (data: any) => {
        console.log('📡 FullScreenTimer: Active timers updated via WebSocket from RunOfShowPage');
        
        // Handle array format (from server broadcast)
        let timerData = data;
        if (Array.isArray(data) && data.length > 0) {
          timerData = data[0]; // Take first timer from array
          console.log('📡 FullScreenTimer: Processing first timer from array:', timerData);
        }
        
        if (timerData && timerData.event_id === eventId) {
          // Check if timer is stopped or inactive
          if (timerData.timer_state === 'stopped' || !timerData.is_active || timerData.is_running === false && timerData.is_active === false) {
            // Clear timer data when stopped
            setHybridTimerData(prev => ({
              ...prev,
              activeTimer: null
            }));
            console.log('✅ FullScreenTimer: Timer stopped via WebSocket - cleared timer data');
          } else {
            // Update timer data directly from WebSocket
            setHybridTimerData(prev => ({
              ...prev,
              activeTimer: timerData
            }));
            console.log('✅ FullScreenTimer: Active timer updated via WebSocket:', timerData);
          }
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📨 FullScreenTimer: WebSocket connection status:', connected);
        if (connected) {
          // Reload message when reconnected
          loadMessage();
        }
      },
      onServerTime: (data: { serverTime: string }) => {
        // Clock sync - calculate offset once
        const serverTime = new Date(data.serverTime).getTime();
        const clientTime = new Date().getTime();
        const offset = serverTime - clientTime;
        setClockOffset(offset);
        console.log('🕐 FullScreenTimer: Clock sync:', {
          serverTime: data.serverTime,
          clientTime: new Date().toISOString(),
          offsetMs: offset,
          offsetSeconds: Math.floor(offset / 1000)
        });
      }
    };

    socketClient.connect(eventId, callbacks);
    
    // Show disconnect timer modal only on first connect
    if (!hasShownModalOnce) {
      setShowDisconnectModal(true);
      setHasShownModalOnce(true);
    }

    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ FullScreenTimer: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(eventId);
        // Timer keeps running in background
      } else if (!socketClient.isConnected()) {
        console.log('👁️ FullScreenTimer: Tab visible - silently reconnecting WebSocket (no modal)');
        socketClient.connect(eventId, callbacks);
        loadMessage(); // Reload message on reconnect
        // Modal won't show again - timer still running
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('📨 Cleaning up FullScreenTimer WebSocket connection');
      socketClient.disconnect(eventId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (disconnectTimer) clearTimeout(disconnectTimer);
    };
  }, [eventId]);

  // Update timer data from parent window if available
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

  // Handle disconnect timer confirmation
  const handleDisconnectTimerConfirm = (hours: number, minutes: number) => {
    const totalMinutes = (hours * 60) + minutes;
    
    if (totalMinutes === 0) {
      alert('Please select a time greater than 0, or use "Never Disconnect"');
      return;
    }
    
    if (disconnectTimer) clearTimeout(disconnectTimer);
    
    const ms = totalMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      let timeText = '';
      if (hours > 0) timeText += `${hours}h `;
      if (minutes > 0) timeText += `${minutes}m`;
      
      console.log(`⏰ FullScreenTimerPage: Auto-disconnect timer expired (${timeText.trim()})`);
      console.log('📢 FullScreenTimerPage: Showing disconnect notification...');
      
      setDisconnectDuration(timeText.trim());
      setShowDisconnectNotification(true);
      console.log('✅ FullScreenTimerPage: Notification state set to true');
      
      setTimeout(() => {
        if (eventId) {
          socketClient.disconnect(eventId);
          console.log('🔌 FullScreenTimerPage: WebSocket disconnected');
        }
      }, 100);
    }, ms);
    
    setDisconnectTimer(timer);
    setShowDisconnectModal(false);
    
    let timeText = '';
    if (hours > 0) timeText += `${hours}h `;
    if (minutes > 0) timeText += `${minutes}m`;
    console.log(`⏰ FullScreenTimerPage: Disconnect timer set to ${timeText.trim()}`);
  };
  
  const handleNeverDisconnect = () => {
    if (disconnectTimer) clearTimeout(disconnectTimer);
    setDisconnectTimer(null);
    setShowDisconnectModal(false);
    console.log('⏰ FullScreenTimerPage: Disconnect timer set to Never');
  };
  
  const handleReconnect = () => {
    setShowDisconnectNotification(false);
    if (eventId) {
      socketClient.connect(eventId, {
        onTimerMessageUpdated: (data: any) => {
          if (data && data.event_id === eventId) {
            setSupabaseMessage(data);
          }
        }
      });
      setShowDisconnectModal(true);
    }
  };

  return (
    <>
      <FullScreenTimer
        isRunning={isRunning}
        elapsedTime={elapsedTime}
        totalDuration={totalDuration}
        onClose={handleClose}
        message={message}
        messageEnabled={messageEnabled}
        itemId={itemId}
        eventId={eventId}
        supabaseMessage={supabaseMessage}
        mainTimer={mainTimer}
        secondaryTimer={secondaryTimer}
        hybridTimerData={hybridTimerData}
        clockOffset={clockOffset}
      />
      
      {/* Disconnect Timer Modal */}
      {showDisconnectModal && <DisconnectTimerModal onConfirm={handleDisconnectTimerConfirm} onNever={handleNeverDisconnect} />}
      
      {/* Disconnect Notification */}
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
  
  React.useEffect(() => {
    if (hoursRef.current) hoursRef.current.scrollTop = hours * 50;
    if (minutesRef.current) minutesRef.current.scrollTop = minuteValues.indexOf(minutes) * 50;
  }, []);
  
  const handleHoursScroll = () => {
    if (!hoursRef.current) return;
    const index = Math.round(hoursRef.current.scrollTop / 50);
    setHours(Math.max(0, Math.min(index, 24)));
  };
  
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
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Hours</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl shadow-inner overflow-hidden">
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-blue-500/10 border-y border-slate-500/20 pointer-events-none z-10" />
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20" />
              <div ref={hoursRef} onScroll={handleHoursScroll} className="h-full overflow-y-scroll scrollbar-hide pt-24 pb-24 snap-y snap-mandatory" style={{ scrollBehavior: 'smooth' }}>
                {Array.from({length: 25}, (_, i) => (
                  <div key={i} className={`h-12 flex items-center justify-center text-2xl font-medium snap-center transition-all ${hours === i ? 'text-slate-100 scale-110' : 'text-slate-600 scale-90'}`}>{i}</div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="text-slate-300 text-4xl font-light mt-10">:</div>
          
          <div className="flex flex-col items-center gap-4">
            <div className="text-slate-300 text-sm font-medium uppercase tracking-wider">Minutes</div>
            <div className="relative w-32 h-56 bg-slate-900 border border-slate-600 rounded-2xl shadow-inner overflow-hidden">
              <div className="absolute top-1/2 left-0 right-0 h-12 -translate-y-1/2 bg-blue-500/10 border-y border-slate-500/20 pointer-events-none z-10" />
              <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-900 to-transparent pointer-events-none z-20" />
              <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-900 to-transparent pointer-events-none z-20" />
              <div ref={minutesRef} onScroll={handleMinutesScroll} className="h-full overflow-y-scroll scrollbar-hide pt-24 pb-24 snap-y snap-mandatory" style={{ scrollBehavior: 'smooth' }}>
                {minuteValues.map(m => (
                  <div key={m} className={`h-12 flex items-center justify-center text-2xl font-medium snap-center transition-all ${minutes === m ? 'text-slate-100 scale-110' : 'text-slate-600 scale-90'}`}>{m}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button onClick={() => onConfirm(hours, minutes)} className="flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-600/30">✓ Confirm</button>
          <button onClick={onNever} className="flex-1 px-8 py-4 bg-slate-600 hover:bg-slate-500 rounded-xl text-slate-200 text-lg font-medium transition transform hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-600/30">∞ Never Disconnect</button>
        </div>
        
        <p className="mt-6 text-sm text-slate-500 text-center">⚠️ "Never" may increase database costs</p>
      </div>
    </div>
  );
};

const DisconnectNotification: React.FC<{ duration: string; onReconnect: () => void }> = ({ duration, onReconnect }) => {
  React.useEffect(() => {
    console.log('🔔 FullScreenTimer DisconnectNotification mounted:', duration);
    return () => console.log('🔔 FullScreenTimer DisconnectNotification unmounted');
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
          <button onClick={onReconnect} className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white text-base font-medium whitespace-nowrap transition transform hover:-translate-y-1 hover:shadow-lg hover:shadow-blue-600/40">🔄 Reconnect</button>
        </div>
      </div>
    </>
  );
};

export default FullScreenTimerPage;
