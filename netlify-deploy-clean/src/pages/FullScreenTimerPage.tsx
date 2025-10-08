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
      }
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      console.log('📨 Cleaning up FullScreenTimer WebSocket connection');
      socketClient.disconnect(eventId);
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

  return (
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
    />
  );
};

export default FullScreenTimerPage;
