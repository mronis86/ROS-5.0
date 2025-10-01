import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Clock from '../components/Clock';
import { DatabaseService } from '../services/database';
import { supabase } from '../services/supabase';

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

  // Real-time subscription for timer message changes
  useEffect(() => {
    if (!eventId) return;

    const loadMessage = async () => {
      try {
        const message = await DatabaseService.getTimerMessage(eventId);
        setSupabaseMessage(message);
        console.log('📨 Loaded timer message from Supabase:', message);
      } catch (error) {
        console.error('❌ Error loading timer message:', error);
      }
    };

    loadMessage(); // Load initial data

    // Set up real-time subscription for timer_messages table
    const messageSubscription = supabase
      .channel('timer_messages_changes')
      .on(
        'postgres_changes',
        { 
          event: '*', 
          schema: 'public', 
          table: 'timer_messages', 
          filter: `event_id=eq.${eventId}` 
        },
        (payload) => {
          console.log('📨 Real-time timer message change detected:', payload);
          loadMessage(); // Reload message data when changes occur
        }
      )
      .subscribe();

    return () => {
      console.log('📨 Cleaning up timer message subscription');
      supabase.removeChannel(messageSubscription);
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
