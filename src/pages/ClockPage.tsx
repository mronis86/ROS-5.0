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
  
  // Clock component handles its own timer state via WebSocket
  // ClockPage only manages messages to avoid state conflicts
  const [message, setMessage] = useState('');
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [supabaseMessage, setSupabaseMessage] = useState(null);
  const [eventId, setEventId] = useState(eventIdFromUrl || timerData.eventId || null);

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

    socketClient.connect(eventId, callbacks);

    // Handle tab visibility changes - disconnect when hidden to save costs
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('👁️ ClockPage: Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(eventId);
      } else if (!socketClient.isConnected()) {
        console.log('👁️ ClockPage: Tab visible - reconnecting WebSocket');
        socketClient.connect(eventId, callbacks);
        loadMessage(); // Reload message on reconnect
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('📨 Cleaning up ClockPage WebSocket connection');
      socketClient.disconnect(eventId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

  return (
    <Clock
      onClose={handleClose}
      message={message}
      messageEnabled={messageEnabled}
      eventId={eventId}
      supabaseMessage={supabaseMessage}
    />
  );
};

export default ClockPage;
