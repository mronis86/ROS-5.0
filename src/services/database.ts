import { apiClient } from './api-client';

// API Base URL for direct fetch calls
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.PROD 
    ? 'https://ros-50-production.up.railway.app'  // Your Railway URL
    : 'http://localhost:3001');

export interface CalendarEvent {
  id?: string;
  created_at?: string;
  name: string;
  date: string;
  schedule_data: any;
  updated_at?: string;
}

export interface RunOfShowData {
  id?: string;
  created_at?: string;
  event_id: string;
  event_name: string;
  event_date: string;
  schedule_items: any[];
  custom_columns: any[];
  settings: any;
  updated_at?: string;
  last_change_at?: string;
  last_modified_by?: string;
  last_modified_by_name?: string;
  last_modified_by_role?: string;
}

export interface TimerMessage {
  id?: string;
  created_at?: string;
  updated_at?: string;
  event_id: string;
  message: string;
  enabled: boolean;
  sent_by?: string;
  sent_by_name?: string;
  sent_by_role?: string;
  message_type?: string;
  priority?: number;
  expires_at?: string;
}



export class DatabaseService {
  // Calendar Event Methods
  static async saveCalendarEvent(event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): Promise<CalendarEvent | null> {
    try {
      console.log('🔄 Saving calendar event to API:', event);
      const data = await apiClient.createCalendarEvent(event);
      console.log('✅ Calendar event saved to API:', data);
      return data;
    } catch (error) {
      console.error('Error saving calendar event:', error);
      console.log('🔄 Falling back to localStorage...');
      return this.saveCalendarToLocalStorage(event);
    }
  }

  static async updateCalendarEvent(id: string, event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): Promise<CalendarEvent | null> {
    try {
      console.log('🔄 Updating calendar event via API:', id, event);
      
      const data = await apiClient.updateCalendarEvent(id, event);
      console.log('✅ Calendar event updated successfully:', data);
      return data;
    } catch (error) {
      console.error('❌ Exception updating calendar event:', error);
      return null;
    }
  }

  static async getCalendarEvents(): Promise<CalendarEvent[]> {
    try {
      console.log('🔄 Loading calendar events from API...');
      const data = await apiClient.getCalendarEvents();
      console.log('✅ Calendar events loaded from API:', data?.length || 0);
      return data || [];
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      console.log('🔄 Falling back to localStorage...');
      return this.getCalendarFromLocalStorage();
    }
  }

  static async getCalendarEvent(id: string): Promise<CalendarEvent | null> {
    try {
      console.log('🔄 Loading calendar event from API:', id);
      const data = await apiClient.getCalendarEvent(id);
      return data;
    } catch (error) {
      console.error('Error fetching calendar event:', error);
      return this.getCalendarFromLocalStorageById(id);
    }
  }

  static async deleteCalendarEvent(id: string): Promise<boolean> {
    try {
      console.log('🔄 Deleting calendar event via API:', id);
      const success = await apiClient.deleteCalendarEvent(id);
      return success;
    } catch (error) {
      console.error('Error deleting calendar event:', error);
      return this.deleteCalendarFromLocalStorage(id);
    }
  }

  // Enhanced Change Tracking Methods
  static async logChange(
    eventId: string,
    userId: string,
    userName: string,
    userRole: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'MOVE' | 'DUPLICATE' | 'ADD_ITEM' | 'REMOVE_ITEM' | 'FIELD_UPDATE',
    tableName: string,
    recordId?: string,
    fieldName?: string,
    oldValue?: any,
    newValue?: any,
    description?: string,
    rowNumber?: number,
    cueNumber?: number | string,
    metadata?: any
  ): Promise<string | null> {
    try {
      console.log('🔄 Logging change via API:', {
        eventId,
        userId,
        userName,
        userRole,
        action,
        tableName,
        recordId,
        fieldName,
        rowNumber,
        cueNumber
      });

      const changeData = {
        event_id: eventId,
        user_id: userId,
        user_name: userName,
        user_role: userRole,
        action,
        table_name: tableName,
        record_id: recordId || null,
        field_name: fieldName || null,
        old_value: oldValue ? JSON.stringify(oldValue) : null,
        new_value: newValue ? JSON.stringify(newValue) : null,
        description: description || null,
        metadata: metadata || {},
        row_number: rowNumber || null,
        cue_number: cueNumber ? (typeof cueNumber === 'string' ? parseInt(cueNumber, 10) : cueNumber) : null
      };

      const result = await apiClient.logChange(changeData);
      console.log('✅ Change logged:', { action, tableName, recordId, changeId: result });
      return result;
    } catch (error) {
      console.error('Error logging change:', error);
      return null;
    }
  }

  // Log multiple field changes for a single record
  static async logFieldChanges(
    eventId: string,
    userId: string,
    userName: string,
    userRole: string,
    tableName: string,
    recordId: string,
    changes: Array<{
      fieldName: string;
      oldValue: any;
      newValue: any;
    }>,
    description?: string
  ): Promise<void> {
    try {
      // Log each field change separately
      for (const change of changes) {
        await this.logChange(
          eventId,
          userId,
          userName,
          userRole,
          'UPDATE',
          tableName,
          recordId,
          change.fieldName,
          change.oldValue,
          change.newValue,
          description
        );
      }
    } catch (error) {
      console.error('Error logging field changes:', error);
    }
  }

  // Get change log for an event
  static async getChangeLog(eventId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      console.log('🔄 Loading change log from API:', { eventId, limit, offset });
      const data = await apiClient.getChangeLog(eventId, limit);
      return data || [];
    } catch (error) {
      console.error('Error fetching change log:', error);
      return [];
    }
  }

  // Get change log for a specific record
  static async getRecordChangeLog(
    eventId: string, 
    tableName: string, 
    recordId: string, 
    limit: number = 20
  ): Promise<any[]> {
    try {
      // API-based implementation

      // API-based implementation - placeholder
      console.log('🔄 Loading record change log from API:', { eventId, tableName, recordId, limit });
      return [];
    } catch (error) {
      console.error('Error fetching record change log:', error);
      return [];
    }
  }

  // Get change log summary for an event
  static async getChangeLogSummary(eventId: string): Promise<any | null> {
    try {
      // API-based implementation

      // API-based implementation - placeholder
      console.log('🔄 Loading change log summary from API:', { eventId });
      return null;
    } catch (error) {
      console.error('Error fetching change log summary:', error);
      return null;
    }
  }

  // Cleanup old change logs
  static async cleanupOldChangeLogs(): Promise<number> {
    try {
      // API-based implementation

      // API-based implementation - placeholder
      console.log('🔄 Cleaning up old change logs via API');
      return 0;
    } catch (error) {
      console.error('Error cleaning up old change logs:', error);
      return 0;
    }
  }

  // Run of Show Data Methods
  static async saveRunOfShowData(
    data: Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at' | 'last_change_at' | 'last_modified_by' | 'last_modified_by_name' | 'last_modified_by_role'>,
    userInfo?: { userId: string; userName: string; userRole: string }
  ): Promise<RunOfShowData | null> {
    try {
      console.log('🔄 Saving run of show data to Neon:', {
        eventId: data.event_id,
        scheduleItemsCount: data.schedule_items?.length || 0,
        customColumnsCount: data.custom_columns?.length || 0,
        settingsKeys: Object.keys(data.settings || {}),
        userInfo: userInfo ? `${userInfo.userName} (${userInfo.userRole})` : 'No user info'
      });

      // Add user information to the data
      const dataWithUser = {
        ...data,
        last_modified_by: userInfo?.userId,
        last_modified_by_name: userInfo?.userName,
        last_modified_by_role: userInfo?.userRole
      };

      const result = await apiClient.saveRunOfShowData(dataWithUser);
      return result;
    } catch (error) {
      console.error('❌ Error saving run of show data:', error);
      console.error('❌ Error details:', error.message, error.details, error.hint);
      // Fallback to localStorage with user info if available
      const fallbackData = {
        ...data,
        last_modified_by: userInfo?.userId,
        last_modified_by_name: userInfo?.userName,
        last_modified_by_role: userInfo?.userRole,
        updated_at: new Date().toISOString()
      };
      return this.saveRunOfShowToLocalStorage(fallbackData);
    }
  }

  static async updateRunOfShowData(eventId: string, updates: Partial<Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at' | 'last_change_at' | 'last_modified_by' | 'last_modified_by_name' | 'last_modified_by_role'>>): Promise<RunOfShowData | null> {
    try {
      console.log('🔄 Updating run of show data via API for event:', eventId, updates);
      
      // API-based implementation - placeholder
      console.log('🔄 Updating run of show data via API:', eventId, updates);
      return null;
    } catch (error) {
      console.error('❌ Exception updating run of show data:', error);
      return null;
    }
  }

  static async getRunOfShowData(eventId: string): Promise<RunOfShowData | null> {
    try {
      console.log('🔄 Loading run of show data from API for event:', eventId);
      
      const data = await apiClient.getRunOfShowData(eventId);
      
      console.log('✅ Run of show data loaded from API:', data ? 'Found' : 'Not found');
      if (data) {
        console.log('🔍 Data structure:', {
          hasScheduleItems: !!data.schedule_items,
          scheduleItemsLength: data.schedule_items?.length || 0,
          hasCustomColumns: !!data.custom_columns,
          customColumnsLength: data.custom_columns?.length || 0,
          hasSettings: !!data.settings
        });
      }
      return data;
    } catch (error) {
      console.error('❌ Exception in getRunOfShowData:', error);
      console.log('🔄 Falling back to localStorage due to exception...');
      return this.getRunOfShowFromLocalStorageById(eventId);
    }
  }

  static async deleteRunOfShowData(eventId: string): Promise<boolean> {
    try {
      if (true) { // Always use localStorage fallback since we're not using Supabase
        console.warn('Supabase not configured, using localStorage fallback');
        return this.deleteRunOfShowFromLocalStorage(eventId);
      }

      const { error } = await supabase
        .from('run_of_show_data')
        .delete()
        .eq('event_id', eventId);

      if (error) {
        console.error('Error deleting run of show data:', error);
        return this.deleteRunOfShowFromLocalStorage(eventId);
      }

      return true;
    } catch (error) {
      console.error('Error deleting run of show data:', error);
      return this.deleteRunOfShowFromLocalStorage(eventId);
    }
  }

  // LocalStorage fallback methods for Calendar Events
  private static saveCalendarToLocalStorage(event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): CalendarEvent {
    const events = this.getCalendarFromLocalStorage();
    const newEvent: CalendarEvent = {
      ...event,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    events.unshift(newEvent);
    localStorage.setItem('calendar_events', JSON.stringify(events));
    console.log('✅ Calendar event saved to localStorage');
    return newEvent;
  }

  private static getCalendarFromLocalStorage(): CalendarEvent[] {
    try {
      const stored = localStorage.getItem('calendar_events');
      const events = stored ? JSON.parse(stored) : [];
      console.log('✅ Calendar events loaded from localStorage:', events.length);
      return events;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return [];
    }
  }

  private static getCalendarFromLocalStorageById(id: string): CalendarEvent | null {
    const events = this.getCalendarFromLocalStorage();
    return events.find(event => event.id === id) || null;
  }

  private static deleteCalendarFromLocalStorage(id: string): boolean {
    try {
      const events = this.getCalendarFromLocalStorage();
      const filteredEvents = events.filter(event => event.id !== id);
      localStorage.setItem('calendar_events', JSON.stringify(filteredEvents));
      return true;
    } catch (error) {
      console.error('Error deleting from localStorage:', error);
      return false;
    }
  }

  // LocalStorage fallback methods for Run of Show data
  private static saveRunOfShowToLocalStorage(data: Omit<RunOfShowData, 'id' | 'created_at'>): RunOfShowData {
    const runOfShowData = this.getAllRunOfShowFromLocalStorage();
    const now = new Date().toISOString();
    
    const existingIndex = runOfShowData.findIndex(item => item.event_id === data.event_id);
    let newData: RunOfShowData;
    
    if (existingIndex >= 0) {
      // Update existing record - implement last_change_at logic
      const existingData = runOfShowData[existingIndex];
      const lastChangeAt = existingData.last_change_at || now;
      
      newData = {
        ...data,
        id: existingData.id,
        created_at: existingData.created_at,
        updated_at: now,
        last_change_at: lastChangeAt
      };
      runOfShowData[existingIndex] = newData;
    } else {
      // Insert new record - last_change_at same as updated_at
      newData = {
        ...data,
        id: Date.now().toString(),
        created_at: now,
        updated_at: now,
        last_change_at: now
      };
      runOfShowData.push(newData);
    }
    
    localStorage.setItem('run_of_show_data', JSON.stringify(runOfShowData));
    console.log('✅ Run of show data saved to localStorage');
    return newData;
  }

  private static getAllRunOfShowFromLocalStorage(): RunOfShowData[] {
    try {
      const stored = localStorage.getItem('run_of_show_data');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading run of show data from localStorage:', error);
      return [];
    }
  }

  private static getRunOfShowFromLocalStorageById(eventId: string): RunOfShowData | null {
    console.log('🔄 Loading from localStorage for event:', eventId);
    const data = this.getAllRunOfShowFromLocalStorage();
    console.log('🔍 All localStorage data:', data);
    const found = data.find(item => item.event_id === eventId);
    console.log('🔍 Found data for event:', found ? 'Yes' : 'No');
    if (found) {
      console.log('🔍 Found data structure:', {
        hasScheduleItems: !!found.schedule_items,
        scheduleItemsLength: found.schedule_items?.length || 0,
        hasCustomColumns: !!found.custom_columns,
        customColumnsLength: found.custom_columns?.length || 0,
        hasSettings: !!found.settings
      });
    }
    return found || null;
  }

  private static deleteRunOfShowFromLocalStorage(eventId: string): boolean {
    try {
      const data = this.getAllRunOfShowFromLocalStorage();
      const filteredData = data.filter(item => item.event_id !== eventId);
      localStorage.setItem('run_of_show_data', JSON.stringify(filteredData));
      return true;
    } catch (error) {
      console.error('Error deleting run of show data from localStorage:', error);
      return false;
    }
  }

  // Change detection methods
  static async checkForChanges(eventId: string, localLastChangeAt?: string): Promise<{
    hasChanges: boolean;
    lastChangeAt?: string;
    updatedAt?: string;
    lastModifiedBy?: string;
    lastModifiedByName?: string;
  }> {
    try {
      console.log('🔍 Checking for changes via API:', { eventId, localLastChangeAt });
      
      // API-based implementation - placeholder
      console.log('🔄 Checking for changes via API:', { eventId, localLastChangeAt });
      return { hasChanges: false };
    } catch (error) {
      console.error('❌ Error checking for changes:', error);
      return { hasChanges: false };
    }
  }

  // Dynamic loading method that preserves timers and state
  static async loadChangesDynamically(eventId: string): Promise<RunOfShowData | null> {
    try {
      console.log('🔄 Loading changes dynamically for event:', eventId);
      
      if (true) { // Always use localStorage fallback since we're not using Supabase
        return this.getRunOfShowFromLocalStorageById(eventId);
      }

      const { data, error } = await supabase
        .from('run_of_show_data')
        .select('*')
        .eq('event_id', eventId)
        .single();

      if (error) {
        console.error('❌ Error loading changes:', error);
        return null;
      }

      console.log('✅ Changes loaded successfully');
      return data;
    } catch (error) {
      console.error('❌ Error loading changes dynamically:', error);
      return null;
    }
  }

  // Authenticated User Session Tracking - New Structure
  static async saveUserSession(eventId: string, userId: string, username: string, role: string): Promise<boolean> {
    try {
      console.log('🔄 Saving authenticated user session via API:', { eventId, userId, username, role });
      
      // API-based implementation - placeholder
      console.log('🔄 Saving user session via API:', { eventId, userId, username, role });
      return this.saveUserSessionToLocalStorage(eventId, username, role);
    } catch (error) {
      console.error('Error saving user session:', error);
      return this.saveUserSessionToLocalStorage(eventId, username, role);
    }
  }

  // Get current user session
  static async getCurrentUserSession(userId: string, eventId?: string): Promise<any | null> {
    try {
      console.log('🔄 Getting current user session via API:', { userId, eventId });
      
      // API-based implementation - placeholder
      console.log('🔄 Getting current user session via API:', { userId, eventId });
      return this.getCurrentUserSessionFromLocalStorage();
    } catch (error) {
      console.error('Error getting current user session:', error);
      return this.getCurrentUserSessionFromLocalStorage();
    }
  }

  // Update user activity
  static async updateUserActivity(userId: string): Promise<void> {
    try {
      console.log('🔄 Updating user activity via API:', userId);
      
      // API-based implementation - placeholder
      console.log('🔄 Updating user activity via API:', userId);
    } catch (error) {
      console.error('Error updating user activity:', error);
    }
  }

  // Clean up inactive sessions (older than 24 hours)
  static async cleanupInactiveSessions(): Promise<void> {
    try {
      console.log('🔄 Cleaning up inactive sessions via API');
      
      // API-based implementation - placeholder
      console.log('🔄 Cleaning up inactive sessions via API');
    } catch (error) {
      console.error('Error cleaning up inactive sessions:', error);
    }
  }

  // Note: Active users tracking removed - focusing on simple user session tracking

  // LocalStorage fallback for user session
  private static saveUserSessionToLocalStorage(eventId: string, username: string, role: string): boolean {
    try {
      const userData = {
        event_id: eventId,
        username: username,
        role: role,
        session_started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        is_active: true
      };

      // Save current session
      localStorage.setItem(`current_user_session_${username}`, JSON.stringify(userData));
      
      // Also save role info separately for easy access
      localStorage.setItem(`user_role_${eventId}_${username}`, role);

      console.log('✅ User session saved to localStorage');
      return true;
    } catch (error) {
      console.error('Error saving user session to localStorage:', error);
      return false;
    }
  }

  // LocalStorage fallback for getting current user session
  private static getCurrentUserSessionFromLocalStorage(): any | null {
    try {
      // Find the most recent active session
      const keys = Object.keys(localStorage);
      let latestSession = null;
      let latestTime = 0;

      for (const key of keys) {
        if (key.startsWith('current_user_session_')) {
          const sessionData = JSON.parse(localStorage.getItem(key) || '{}');
          if (sessionData.is_active && sessionData.last_activity_at) {
            const sessionTime = new Date(sessionData.last_activity_at).getTime();
            if (sessionTime > latestTime) {
              latestTime = sessionTime;
              latestSession = sessionData;
            }
          }
        }
      }

      console.log('🔍 Retrieved user session from localStorage:', latestSession);
      return latestSession;
    } catch (error) {
      console.error('Error getting current user session from localStorage:', error);
      return null;
    }
  }

  // Note: Active users localStorage fallback removed - using simple user session tracking

  // ===== TIMER SYNCHRONIZATION =====
  
  // Start a timer and save to Supabase for cross-client sync
  // Load a CUE (set loaded but not started)
  static async loadCue(eventId: string, itemId: number, userId: string, totalDurationSeconds: number, rowNumber?: number, cueDisplay?: string, timerId?: string): Promise<boolean> {
    try {
      console.log('🔄 Loading CUE via API:', { eventId, itemId, userId, totalDurationSeconds, rowNumber, cueDisplay, timerId });
      console.log('🔄 DatabaseService.loadCue parameters:', {
        eventId,
        itemId,
        userId,
        totalDurationSeconds,
        rowNumber,
        cueDisplay,
        timerId
      });
      
      const response = await fetch(`${API_BASE_URL}/api/active-timers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId,
          user_id: userId,
          timer_state: 'loaded',
          is_active: true,
          is_running: false,
          started_at: null,
          last_loaded_cue_id: itemId,
          cue_is: cueDisplay,
          duration_seconds: totalDurationSeconds
        })
      });

      if (response.ok) {
        console.log('✅ CUE loaded successfully via API');
        return true;
      } else {
        console.error('❌ Failed to load CUE via API:', response.status, response.statusText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error loading CUE:', error);
      return false;
    }
  }

  static async startTimer(eventId: string, itemId: number, userId: string, totalDurationSeconds: number, startedAt?: Date, rowNumber?: number, cueDisplay?: string, timerId?: string): Promise<boolean> {
    try {
      console.log('🔄 Starting timer via API:', { eventId, itemId, userId, totalDurationSeconds, startedAt, rowNumber, cueDisplay, timerId });
      
      const response = await fetch(`${API_BASE_URL}/api/active-timers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId,
          user_id: userId,
          timer_state: 'running',
          is_active: true,
          is_running: true,
          started_at: startedAt || new Date().toISOString(),
          last_loaded_cue_id: itemId,
          cue_is: cueDisplay,
          duration_seconds: totalDurationSeconds
        })
      });

      if (response.ok) {
        console.log('✅ Timer started successfully via API');
        return true;
      } else {
        console.error('❌ Failed to start timer via API:', response.status, response.statusText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error starting timer:', error);
      return false;
    }
  }

  // Stop a timer
  static async stopTimer(eventId: string, itemId: number, userId: string, userName?: string, userRole?: string): Promise<boolean> {
    try {
      console.log('🔄 Stopping timer via API:', { eventId, itemId, userId, userName, userRole });
      
      const response = await fetch(`${API_BASE_URL}/api/active-timers/stop`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId,
          user_id: userId,
          user_name: userName || 'Unknown User',
          user_role: userRole || 'VIEWER'
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Timer stopped successfully via API:', result.stopped ? 'Timer stopped' : 'No active timer found');
        return result.stopped;
      } else {
        console.error('❌ Failed to stop timer via API:', response.status, response.statusText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error stopping timer:', error);
      return false;
    }
  }

  // Update timer duration
  static async updateTimerDuration(eventId: string, itemId: number, newDurationSeconds: number): Promise<boolean> {
    try {
      console.log(`🔄 Updating timer duration via API for event ${eventId}, item ${itemId} to ${newDurationSeconds}s`);

      const response = await fetch(`${API_BASE_URL}/api/active-timers/${eventId}/${itemId}/duration`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          duration_seconds: newDurationSeconds
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Timer duration updated successfully via API:', result);
        return true;
      } else {
        console.error('❌ Failed to update timer duration via API:', response.status, response.statusText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error updating timer duration:', error);
      return false;
    }
  }

  // Stop all active timers for an event
  static async stopAllTimersForEvent(eventId: string, userId: string, userName?: string, userRole?: string): Promise<boolean> {
    try {
      console.log('🔄 Stopping all timers via API:', { eventId, userId, userName, userRole });
      
      const response = await fetch(`${API_BASE_URL}/api/active-timers/stop-all`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          user_id: userId,
          user_name: userName || 'Unknown User',
          user_role: userRole || 'VIEWER'
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ All timers stopped successfully via API:', result.message);
        return true;
      } else {
        console.error('❌ Failed to stop all timers via API:', response.status, response.statusText);
        return false;
      }
    } catch (error) {
      console.error('❌ Error stopping all timers:', error);
      return false;
    }
  }

  // Get current active timer for an event with real-time elapsed/remaining calculations
  static async getActiveTimer(eventId: string): Promise<any | null> {
    try {
      console.log('🔄 Getting active timer via API:', eventId);
      
      const response = await fetch(`${API_BASE_URL}/api/active-timers/${eventId}`);
      if (response.ok) {
        const timers = await response.json();
        return timers.length > 0 ? timers[0] : null;
      }
      return null;
    } catch (error) {
      console.error('Error getting active timer:', error);
      return null;
    }
  }

  // Subscribe to timer changes for real-time updates
  static subscribeToTimerChanges(eventId: string, callback: (payload: any) => void) {
    // Real-time updates are handled via Socket.IO and SSE, not Supabase
    console.warn('Real-time updates handled via Socket.IO and SSE');
    return null;
  }

  // Sub-cue Timer Functions
  static async hasActiveSubCueTimer(eventId: string) {
    try {
      console.log('🔄 Checking active sub-cue timer via API:', eventId);
      
      const response = await fetch(`${API_BASE_URL}/api/sub-cue-timers/${eventId}`);
      if (response.ok) {
        const timers = await response.json();
        return { data: timers.length > 0, error: null };
      }
      return { data: false, error: null };
    } catch (error) {
      console.error('❌ Error checking active sub-cue timer:', error);
      return { data: false, error };
    }
  }

  static async getActiveSubCueTimer(eventId: string) {
    try {
      console.log('🔄 Getting active sub-cue timer via API:', eventId);
      
      const response = await fetch(`${API_BASE_URL}/api/sub-cue-timers/${eventId}`);
      if (response.ok) {
        const timers = await response.json();
        return { data: timers.length > 0 ? timers[0] : null, error: null };
      }
      return { data: null, error: null };
    } catch (error) {
      console.error('❌ Error getting active sub-cue timer:', error);
      return { data: null, error };
    }
  }

  static async getActiveSubCueTimers(eventId: string) {
    try {
      console.log('🔄 Getting active sub-cue timers via API:', eventId);
      
      const response = await fetch(`${API_BASE_URL}/api/sub-cue-timers/${eventId}`);
      if (response.ok) {
        const timers = await response.json();
        return { data: timers, error: null };
      }
      return { data: [], error: null };
    } catch (error) {
      console.error('❌ Error getting active sub-cue timers:', error);
      return { data: [], error };
    }
  }

  static async startSubCueTimer(eventId: string, itemId: number, userId: string, durationSeconds: number, rowNumber?: number, cueDisplay?: string, timerId?: string, userName?: string, userRole?: string) {
    try {
      console.log('🔄 Starting sub-cue timer via API:', { eventId, itemId, userId, durationSeconds, rowNumber, cueDisplay, timerId, userName, userRole });
      
      const response = await fetch(`${API_BASE_URL}/api/sub-cue-timers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId,
          user_id: userId,
          user_name: userName || 'Unknown User',
          user_role: userRole || 'VIEWER',
          duration_seconds: durationSeconds,
          row_number: rowNumber,
          cue_display: cueDisplay,
          timer_id: timerId,
          is_active: true,
          is_running: true,
          started_at: new Date().toISOString()
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Sub-cue timer started successfully via API:', result);
        return { data: result, error: null };
      } else {
        console.error('❌ Failed to start sub-cue timer via API:', response.status, response.statusText);
        return { data: null, error: { message: `HTTP ${response.status}` } };
      }
    } catch (error) {
      console.error('❌ Error starting sub-cue timer:', error);
      return { data: null, error };
    }
  }

  static async expireCompletedSubCueTimers() {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping expire completed sub-cue timers');
        return { data: 0, error: null };
      }

      const { data, error } = await supabase.rpc('expire_completed_sub_cue_timers');

      if (error) {
        console.error('❌ Error expiring completed sub-cue timers:', error);
        return { data: 0, error };
      }

      return { data: data || 0, error: null };
    } catch (error) {
      console.error('❌ Error expiring completed sub-cue timers:', error);
      return { data: 0, error };
    }
  }

  static async stopSubCueTimer(eventId: string, itemId?: number) {
    try {
      console.log('🔄 Stopping sub-cue timer via API:', { eventId, itemId });
      
      // Update all sub-cue timers for this event to stopped
      const response = await fetch(`${API_BASE_URL}/api/sub-cue-timers/stop`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId || null
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Sub-cue timer stopped successfully via API:', result);
        return { data: result, error: null };
      } else {
        console.error('❌ Failed to stop sub-cue timer via API:', response.status, response.statusText);
        return { data: null, error: { message: `HTTP ${response.status}` } };
      }
    } catch (error) {
      console.error('❌ Error stopping sub-cue timer:', error);
      return { data: null, error };
    }
  }

  // Secondary Timer Functions
  static async getActiveSecondaryTimer(eventId: string) {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping get active secondary timer');
        return { data: null, error: null };
      }

      // Try RPC function first, fallback to direct table query
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_active_secondary_timer_for_event', {
        p_event_id: eventId
      });

      if (rpcError && rpcError.code === 'PGRST204') {
        // RPC function doesn't exist, try secondary_timers table first
        console.log('🔄 RPC function not found, trying secondary_timers table');
        
        const { data: secondaryData, error: secondaryError } = await supabase
          .from('secondary_timers')
          .select('*')
          .eq('event_id', eventId)
          .eq('is_active', true)
          .eq('is_running', true)
          .order('created_at', { ascending: false })
          .limit(1);

        if (secondaryError && (secondaryError.code === '42P01' || secondaryError.message.includes('does not exist'))) {
          // secondary_timers table doesn't exist, use sub_cue_timers as fallback
          console.log('🔄 secondary_timers table not found, using sub_cue_timers as secondary timer');
          
          const { data: subCueData, error: subCueError } = await supabase
            .from('sub_cue_timers')
            .select('*')
            .eq('event_id', eventId)
            .eq('is_active', true)
            .eq('is_running', true)
            .order('created_at', { ascending: false })
            .limit(1);

          if (subCueError) {
            console.error('❌ Error getting sub-cue timers as secondary timer:', subCueError);
            return { data: null, error: subCueError };
          }

          console.log('✅ Using sub-cue timer as secondary timer:', subCueData && subCueData.length > 0 ? subCueData[0] : null);
          return { data: subCueData && subCueData.length > 0 ? subCueData[0] : null, error: null };
        }

        if (secondaryError) {
          console.error('❌ Error getting active secondary timer from table:', secondaryError);
          return { data: null, error: secondaryError };
        }

        return { data: secondaryData && secondaryData.length > 0 ? secondaryData[0] : null, error: null };
      }

      if (rpcError) {
        console.error('❌ Error getting active secondary timer:', rpcError);
        // If it's a 404 or table doesn't exist, return null data instead of error
        if (rpcError.code === 'PGRST204' || rpcError.message.includes('does not exist')) {
          return { data: null, error: null };
        }
        return { data: null, error: rpcError };
      }

      return { data: rpcData && rpcData.length > 0 ? rpcData[0] : null, error: null };
    } catch (error) {
      console.error('❌ Error getting active secondary timer:', error);
      return { data: null, error };
    }
  }


  static async startSecondaryTimer(eventId: string, itemId: number, userId: string, durationSeconds: number) {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping start secondary timer');
        return { data: null, error: null };
      }

      const { data, error } = await supabase.rpc('start_secondary_timer_for_event', {
        p_event_id: eventId,
        p_item_id: itemId,
        p_user_id: userId,
        p_duration_seconds: durationSeconds
      });

      if (error) {
        console.error('❌ Error starting secondary timer:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('❌ Error starting secondary timer:', error);
      return { data: null, error };
    }
  }

  static async stopSecondaryTimer(eventId: string) {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping stop secondary timer');
        return { data: null, error: null };
      }

      const { data, error } = await supabase.rpc('stop_secondary_timer_for_event', {
        p_event_id: eventId
      });

      if (error) {
        console.error('❌ Error stopping secondary timer:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('❌ Error stopping secondary timer:', error);
      return { data: null, error };
    }
  }

  static async updateSecondaryTimerRemaining(eventId: string, remainingSeconds: number) {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping update secondary timer remaining');
        return { data: null, error: null };
      }

      const { data, error } = await supabase.rpc('update_secondary_timer_remaining', {
        p_event_id: eventId,
        p_remaining_seconds: remainingSeconds
      });

      if (error) {
        console.error('❌ Error updating secondary timer remaining:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('❌ Error updating secondary timer remaining:', error);
      return { data: null, error };
    }
  }

  // Clear all active timers for an event
  static async updateSubCueTimerRemaining(eventId: string, itemId: number, remainingSeconds: number): Promise<boolean> {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping update sub-cue timer remaining');
        return false;
      }

      const { error } = await supabase
        .from('sub_cue_timers')
        .update({ 
          remaining_seconds: remainingSeconds,
          updated_at: new Date().toISOString()
        })
        .eq('event_id', eventId)
        .eq('item_id', itemId.toString())
        .eq('is_active', true);

      if (error) {
        console.error('❌ Error updating sub-cue timer remaining time:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error updating sub-cue timer remaining time:', error);
      return false;
    }
  }

  static async clearAllActiveTimersForEvent(eventId: string): Promise<boolean> {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping clear all active timers');
        return false;
      }

      console.log('🔄 Clearing all active timers for event:', eventId);

      const { error } = await supabase
        .from('active_timers')
        .delete()
        .eq('event_id', eventId);

      if (error) {
        console.error('❌ Error clearing all active timers:', error);
        return false;
      }

      console.log('✅ All active timers cleared for event:', eventId);
      return true;
    } catch (error) {
      console.error('❌ Error clearing all active timers:', error);
      return false;
    }
  }

  // broadcastTimerAction function removed - using only active_timers real-time sync

  // getRecentTimerActions function removed - timer_actions table no longer used

  // Get completed cues for an event
  static async getCompletedCues(eventId: string) {
    try {
      console.log('🔄 Getting completed cues via API:', eventId);
      
      // API-based implementation - placeholder
      console.log('🔄 Getting completed cues via API:', eventId);
      return null;
    } catch (error) {
      console.error('❌ Error getting completed cues:', error);
      return null;
    }
  }

  // Mark a cue as completed
  static async markCueCompleted(eventId: string, itemId: number, cueId: string, userId: string, userName: string, userRole: string): Promise<boolean> {
    try {
      console.log('🟣 Marking cue as completed via API:', { eventId, itemId, userId, userName, userRole });
      
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/completed-cues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId,
          cue_id: cueId,
          user_id: userId,
          user_name: userName,
          user_role: userRole
        })
      });

      if (!response.ok) {
        console.error('❌ Failed to mark cue as completed:', response.status, response.statusText);
        return false;
      }

      const data = await response.json();
      console.log('✅ Cue marked as completed successfully:', { eventId, itemId, data });
      return true;
    } catch (error) {
      console.error('❌ Error marking cue as completed:', error);
      return false;
    }
  }

  // Unmark a cue as completed
  static async unmarkCueCompleted(eventId: string, itemId: number): Promise<boolean> {
    try {
      console.log('🟣 Unmarking cue as completed via API:', { eventId, itemId });
      
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/completed-cues`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId
        })
      });

      if (!response.ok) {
        console.error('❌ Failed to unmark cue as completed:', response.status, response.statusText);
        return false;
      }

      const data = await response.json();
      console.log('✅ Cue unmarked as completed:', { eventId, itemId, data });
      return true;
    } catch (error) {
      console.error('❌ Error unmarking cue as completed:', error);
      return false;
    }
  }

  // Clear all completed cues for an event
  static async clearCompletedCues(eventId: string): Promise<boolean> {
    try {
      console.log('🟣 Clearing all completed cues via API:', { eventId });
      
      // For now, just return true since this function is rarely used
      // TODO: Implement proper API endpoint for clearing all completed cues if needed
      console.log('✅ Cleared all completed cues for event (placeholder):', eventId);
      return true;
    } catch (error) {
      console.error('❌ Error clearing completed cues:', error);
      return false;
    }
  }

  // subscribeToTimerActions function removed - timer_actions table no longer used


  // Subscribe to table changes
  static subscribeToTableChanges(tableName: string, callback: (payload: any) => void, eventId?: string) {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.error('❌ Supabase client not initialized');
        return null;
      }

      const filter = eventId ? `event_id=eq.${eventId}` : undefined;
      
      return supabase
        .channel(`${tableName}_changes`)
        .on('postgres_changes', 
          { 
            event: '*', 
            schema: 'public', 
            table: tableName,
            filter: filter
          }, 
          callback
        )
        .subscribe();
    } catch (error) {
      console.error(`❌ Error setting up ${tableName} subscription:`, error);
      return null;
    }
  }

  // Update last loaded CUE
  static async updateLastLoadedCue(eventId: string, cueId: number, state: 'none' | 'loaded' | 'running' | 'stopped') {
    try {
      // Use API fallback since we're using Neon database
      console.log('🔄 Updating last loaded CUE via API:', { eventId, cueId, state });
      
      // For now, just return success since the active_timers table handles this
      return { data: { success: true }, error: null };
    } catch (error) {
      console.error('❌ Error updating last loaded CUE:', error);
      return { data: null, error };
    }
  }

  // Get last loaded CUE
  static async getLastLoadedCue(eventId: string) {
    try {
      console.log('🔄 Getting last loaded CUE via API:', eventId);
      
      // API-based implementation - placeholder
      console.log('🔄 Getting last loaded CUE via API:', eventId);
      return { data: null, error: null };
    } catch (error) {
      console.error('❌ Error getting last loaded CUE:', error);
      return { data: null, error };
    }
  }

  // Timer Message Methods
  static async saveTimerMessage(message: Omit<TimerMessage, 'id' | 'created_at' | 'updated_at'>): Promise<TimerMessage | null> {
    try {
      console.log('🔄 Saving timer message via API:', message);
      
      const response = await fetch(`${API_BASE_URL}/api/timer-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Timer message saved via API:', result);
        return result;
      } else {
        console.error('❌ Failed to save timer message via API:', response.status, response.statusText);
        return this.saveTimerMessageToLocalStorage(message);
      }
    } catch (error) {
      console.error('❌ Error saving timer message:', error);
      return this.saveTimerMessageToLocalStorage(message);
    }
  }

  static async getTimerMessage(eventId: string): Promise<TimerMessage | null> {
    try {
      console.log('🔄 Getting timer message via API:', eventId);
      
      const response = await fetch(`${API_BASE_URL}/api/timer-messages/${eventId}`);
      if (response.ok) {
        const messages = await response.json();
        return messages.length > 0 ? messages[0] : null;
      }
      return null;
    } catch (error) {
      console.error('❌ Error loading timer message:', error);
      return null;
    }
  }

  static async updateTimerMessage(id: string, updates: Partial<TimerMessage>): Promise<boolean> {
    try {
      console.log('🔄 Updating timer message via API:', { id, updates });
      
      const response = await fetch(`${API_BASE_URL}/api/timer-messages/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        console.log('✅ Timer message updated via API');
        return true;
      } else {
        console.error('❌ Failed to update timer message via API:', response.status, response.statusText);
        return this.updateTimerMessageInLocalStorage(id, updates);
      }
    } catch (error) {
      console.error('❌ Error updating timer message:', error);
      return this.updateTimerMessageInLocalStorage(id, updates);
    }
  }

  static async disableTimerMessage(id: string): Promise<boolean> {
    return this.updateTimerMessage(id, { enabled: false });
  }

  static async getTimerMessagesForEvent(eventId: string): Promise<TimerMessage[]> {
    try {
      console.log('🔄 Getting timer messages via API:', eventId);
      
      const response = await fetch(`${API_BASE_URL}/api/timer-messages/${eventId}`);
      if (response.ok) {
        const messages = await response.json();
        console.log('✅ Timer messages loaded via API:', messages.length);
        return messages;
      } else {
        console.error('❌ Failed to load timer messages via API:', response.status, response.statusText);
        return this.getTimerMessagesFromLocalStorage().filter(msg => msg.event_id === eventId);
      }
    } catch (error) {
      console.error('❌ Error loading timer messages:', error);
      return this.getTimerMessagesFromLocalStorage().filter(msg => msg.event_id === eventId);
    }
  }

  // Hybrid Timer Data Fetching - Get all timer data from Supabase
  // Get CUE data for a specific item
  static async getCueDataForItem(eventId: string, itemId: string): Promise<any | null> {
    try {
      if (true) { // Always use fallback since we're not using Supabase
        console.warn('⚠️ Supabase client not initialized, skipping get CUE data');
        return null;
      }

      // Try run_of_show_data table first, then other possible tables
      const possibleTables = ['run_of_show_data', 'schedule', 'items', 'schedule_items', 'event_items', 'cues', 'schedule_data', 'run_of_show', 'ros_items', 'event_schedule'];
      
      for (const tableName of possibleTables) {
        try {
          console.log(`🔄 Trying to fetch CUE data from table: ${tableName}`);
          
          // Try different query approaches for run_of_show_data
          if (tableName === 'run_of_show_data') {
            // Try multiple query approaches for run_of_show_data
            const queryApproaches = [
              // Approach 1: event_id + id
              () => supabase.from(tableName).select('*').eq('event_id', eventId).eq('id', itemId).single(),
              // Approach 2: just event_id (get all items for the event)
              () => supabase.from(tableName).select('*').eq('event_id', eventId),
              // Approach 3: try different field names
              () => supabase.from(tableName).select('*').eq('event_id', eventId).eq('item_id', itemId).single(),
              // Approach 4: try cue_id field
              () => supabase.from(tableName).select('*').eq('event_id', eventId).eq('cue_id', itemId).single()
            ];
            
            for (let i = 0; i < queryApproaches.length; i++) {
              try {
                console.log(`🔄 Trying query approach ${i + 1} for ${tableName}`);
                const { data, error } = await queryApproaches[i]();
                
                if (!error && data) {
                  console.log(`✅ Found CUE data in ${tableName} with approach ${i + 1}:`, data);
                  console.log(`🔍 CUE data fields:`, Object.keys(data));
                  
                  // Handle array result from approach 2
                  if (Array.isArray(data) && data.length > 0) {
                    console.log(`🔍 Array data length: ${data.length}`);
                    console.log(`🔍 First item fields:`, Object.keys(data[0]));
                    
                    const firstItem = data[0];
                    
                    // Check if schedule_items contains the CUE data
                    if (firstItem.schedule_items && Array.isArray(firstItem.schedule_items)) {
                      console.log(`🔍 Found schedule_items with ${firstItem.schedule_items.length} items`);
                      console.log(`🔍 First schedule item:`, firstItem.schedule_items[0]);
                      
                      // Look for the item that matches our item_id
                      const matchingScheduleItem = firstItem.schedule_items.find(item => 
                        item.id === itemId || 
                        item.item_id === itemId ||
                        item.cue_id === itemId
                      );
                      
                      if (matchingScheduleItem) {
                        console.log('✅ Found matching schedule item:', matchingScheduleItem);
                        return matchingScheduleItem;
                      } else {
                        console.log('ℹ️ No matching schedule item found, using first schedule item');
                        return firstItem.schedule_items[0];
                      }
                    }
                    
                    return firstItem; // Return the first item from the array
                  }
                  
                  return data;
                }
                
                if (error) {
                  console.log(`❌ Error with approach ${i + 1} for ${tableName}:`, error);
                }
              } catch (err) {
                console.log(`❌ Exception with approach ${i + 1} for ${tableName}:`, err);
              }
            }
          } else {
            // Standard query for other tables
            const { data, error } = await supabase
              .from(tableName)
              .select('*')
              .eq('event_id', eventId)
              .eq('id', itemId)
              .single();

            if (!error && data) {
              console.log(`✅ Found CUE data in table: ${tableName}`, data);
              console.log(`🔍 CUE data fields:`, Object.keys(data));
              return data;
            }
          }
        } catch (tableError) {
          console.log(`🔄 Table ${tableName} not found or error:`, tableError);
        }
      }
      
      console.log('🔄 No CUE data found in any table');
      return null;
    } catch (error) {
      console.error('❌ Error getting CUE data for item:', error);
      return null;
    }
  }

  static async getHybridTimerData(eventId: string): Promise<{
    activeTimer: any | null;
    secondaryTimer: any | null;
    subCueTimers: any[] | null;
    lastLoadedCue: any | null;
    timerMessage: TimerMessage | null;
    cueData: any | null;
  } | null> {
    try {
      if (true) { // Always use localStorage fallback since we're not using Supabase
        console.warn('Supabase not configured, cannot fetch hybrid timer data');
        return null;
      }

      console.log('🔄 Fetching hybrid timer data for event:', eventId);

      // Fetch all timer data in parallel
      const [
        activeTimerResult,
        secondaryTimerResult,
        subCueTimersResult,
        lastLoadedCueResult,
        timerMessageResult
      ] = await Promise.all([
        this.getActiveTimer(eventId),
        this.getActiveSecondaryTimer(eventId),
        this.getActiveSubCueTimers(eventId),
        this.getLastLoadedCue(eventId),
        this.getTimerMessage(eventId)
      ]);

      // Try to find CUE data in the active timer itself first
      let cueData = null;
      if (activeTimerResult) {
        console.log('🔍 Active timer full data structure:', activeTimerResult);
        console.log('🔍 Active timer fields:', Object.keys(activeTimerResult));
        
        // Check if CUE data is already in the active timer (cue_is column)
        if (activeTimerResult.cue_is) {
          console.log('✅ Found CUE data in active timer cue_is column:', activeTimerResult.cue_is);
          cueData = activeTimerResult;
        }
      }
      
      // If not found in active timer, try to fetch from run_of_show_data table using last_loaded_cue_id
      if (!cueData && activeTimerResult?.last_loaded_cue_id) {
        cueData = await this.getCueDataForItem(eventId, activeTimerResult.last_loaded_cue_id);
      }
      
      // Fallback to item_id if last_loaded_cue_id doesn't work
      if (!cueData && activeTimerResult?.item_id) {
        cueData = await this.getCueDataForItem(eventId, activeTimerResult.item_id);
      }
      
      // If we still don't have cueData, try to find it in the run_of_show_data using the item_id as a string match
      if (!cueData && activeTimerResult?.item_id) {
        try {
          console.log('🔄 Trying to find CUE data by matching item_id in run_of_show_data');
          const { data, error } = await supabase
            .from('run_of_show_data')
            .select('*')
            .eq('event_id', eventId);
          
          if (!error && data && data.length > 0) {
            console.log(`🔍 Found ${data.length} items in run_of_show_data`);
            // Look for an item that matches our item_id
            const matchingItem = data.find(item => 
              item.id === activeTimerResult.item_id || 
              item.item_id === activeTimerResult.item_id ||
              item.cue_id === activeTimerResult.item_id
            );
            
            if (matchingItem) {
              console.log('✅ Found matching CUE data:', matchingItem);
              cueData = matchingItem;
            } else {
              console.log('ℹ️ No matching item found, using first item as fallback');
              cueData = data[0];
            }
          }
        } catch (err) {
          console.log('❌ Error finding CUE data by matching:', err);
        }
      }

      // Use sub-cue timers as secondary timer if secondary timer is not available
      const secondaryTimer = secondaryTimerResult?.data || 
        (subCueTimersResult?.data && subCueTimersResult.data.length > 0 ? subCueTimersResult.data[0] : null);

      const result = {
        activeTimer: activeTimerResult,
        secondaryTimer: secondaryTimer,
        subCueTimers: subCueTimersResult?.data || null,
        lastLoadedCue: lastLoadedCueResult?.data || null,
        timerMessage: timerMessageResult,
        cueData: null // Disabled since tables don't exist
      };

      console.log('✅ Hybrid timer data fetched:', {
        hasActiveTimer: !!result.activeTimer,
        hasSecondaryTimer: !!result.secondaryTimer,
        hasSubCueTimers: !!result.subCueTimers?.length,
        hasLastLoadedCue: !!result.lastLoadedCue,
        hasTimerMessage: !!result.timerMessage
      });

      return result;
    } catch (error) {
      console.error('❌ Error fetching hybrid timer data:', error);
      return null;
    }
  }

  // Helper methods for localStorage fallback
  private static saveTimerMessageToLocalStorage(message: Omit<TimerMessage, 'id' | 'created_at' | 'updated_at'>): TimerMessage {
    const messages = this.getTimerMessagesFromLocalStorage();
    const newMessage: TimerMessage = {
      ...message,
      id: `local_${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    messages.push(newMessage);
    localStorage.setItem('timer_messages', JSON.stringify(messages));
    return newMessage;
  }

  private static getTimerMessagesFromLocalStorage(): TimerMessage[] {
    try {
      const stored = localStorage.getItem('timer_messages');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error loading timer messages from localStorage:', error);
      return [];
    }
  }

  private static getTimerMessageFromLocalStorage(eventId: string): TimerMessage | null {
    const messages = this.getTimerMessagesFromLocalStorage();
    return messages.find(msg => msg.event_id === eventId && msg.enabled) || null;
  }

  private static updateTimerMessageInLocalStorage(id: string, updates: Partial<TimerMessage>): boolean {
    try {
      const messages = this.getTimerMessagesFromLocalStorage();
      const index = messages.findIndex(msg => msg.id === id);
      if (index !== -1) {
        messages[index] = { ...messages[index], ...updates, updated_at: new Date().toISOString() };
        localStorage.setItem('timer_messages', JSON.stringify(messages));
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating timer message in localStorage:', error);
      return false;
    }
  }
}