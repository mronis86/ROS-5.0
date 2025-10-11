import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Clock from '../components/Clock';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

const ClockPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // Get event ID from URL parameters
  const eventIdFromUrl = searchParams.get('eventId');
  
  // Get timer data from location state or use defaults
  const timerData = location.state || {};
  
  const [isRunning, setIsRunning] = useState(timerData.isRunning || false);
  const [elapsedTime, setElapsedTime] = useState(timerData.elapsedTime || 0);
  const [totalDuration, setTotalDuration] = useState(timerData.totalDuration || 0);
  const [message, setMessage] = useState('');
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [supabaseMessage, setSupabaseMessage] = useState(null);
  const [itemId, setItemId] = useState(timerData.itemId || null);
  const [eventId, setEventId] = useState(eventIdFromUrl || timerData.eventId || null);
  const [isLoading, setIsLoading] = useState(true);
  const [mainTimer, setMainTimer] = useState(timerData.mainTimer || null);
  const [secondaryTimer, setSecondaryTimer] = useState(timerData.secondaryTimer || null);

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

  // WebSocket-based real-time updates for timer messages AND timer state
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

    const loadActiveTimer = async () => {
      try {
        const activeTimer = await DatabaseService.getActiveTimer(eventId);
        console.log('⏱️ Clock: Loaded active timer from API:', activeTimer);
        
        if (activeTimer && activeTimer.is_active) {
          const numericItemId = typeof activeTimer.item_id === 'string' ? parseInt(activeTimer.item_id) : activeTimer.item_id;
          setItemId(numericItemId);
          setTotalDuration(activeTimer.duration_seconds || 0);
          
          if (activeTimer.is_running && activeTimer.started_at) {
            setIsRunning(true);
            // Calculate elapsed time from started_at
            const startedAt = new Date(activeTimer.started_at);
            const now = new Date();
            const elapsed = Math.floor((now - startedAt) / 1000);
            setElapsedTime(elapsed);
            console.log('⏱️ Clock: Timer is RUNNING, elapsed:', elapsed);
          } else {
            setIsRunning(false);
            setElapsedTime(0);
            console.log('⏱️ Clock: Timer is LOADED but not running');
          }
        }
      } catch (error) {
        console.error('❌ Clock: Error loading active timer:', error);
      }
    };

    loadMessage(); // Load initial data
    loadActiveTimer(); // Load timer state

    // Set up WebSocket connection for real-time updates
    const callbacks = {
      onTimerMessageUpdated: (data: any) => {
        console.log('📨 WebSocket: Timer message updated:', data);
        if (data && data.event_id === eventId) {
          setSupabaseMessage(data);
        }
      },
      onTimerUpdated: (data: any) => {
        console.log('⏱️ Clock: Timer updated via WebSocket:', data);
        if (data && data.event_id === eventId) {
          const numericItemId = typeof data.item_id === 'string' ? parseInt(data.item_id) : data.item_id;
          setItemId(numericItemId);
          setTotalDuration(data.duration_seconds || 0);
          
          if (data.timer_state === 'running' && data.started_at) {
            setIsRunning(true);
            setElapsedTime(data.elapsed_seconds || 0);
            console.log('⏱️ Clock: Timer RUNNING via WebSocket, elapsed:', data.elapsed_seconds);
          } else if (data.timer_state === 'loaded') {
            setIsRunning(false);
            setElapsedTime(0);
            console.log('⏱️ Clock: Timer LOADED via WebSocket');
          }
        }
      },
      onTimerStopped: (data: any) => {
        console.log('⏱️ Clock: Timer stopped via WebSocket');
        if (data && data.event_id === eventId) {
          setIsRunning(false);
          setElapsedTime(0);
        }
      },
      onTimersStopped: (data: any) => {
        console.log('⏱️ Clock: All timers stopped via WebSocket');
        if (data && data.event_id === eventId) {
          setIsRunning(false);
          setElapsedTime(0);
          setItemId(null);
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('📨 Clock: WebSocket connection status:', connected);
        if (connected) {
          // Reload data when reconnected
          loadMessage();
          loadActiveTimer();
        }
      }
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      console.log('📨 Cleaning up Clock WebSocket connection');
      socketClient.disconnect(eventId);
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

  // Clock page always runs in Supabase-only mode
  // No need to fetch data - Clock component will handle everything via Supabase

  return (
    <Clock
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
    />
  );
};

export default ClockPage;
