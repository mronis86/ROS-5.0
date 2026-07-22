import { apiClient, getApiBaseUrl } from './api-client';
import { apiJsonHeaders } from '../lib/sessionAuth';

// Resolve at call time (LAN origin), not only at module load.
const apiBase = () => getApiBaseUrl();

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
  /** Always attach session/integration token when present (LAN ignores unknown Authorization). */
  private static apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const extra =
      init.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)
        ? (init.headers as Record<string, string>)
        : {};
    return fetch(url, {
      ...init,
      headers: { ...apiJsonHeaders(), ...extra },
    });
  }

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
      console.error('❌ Error details:', (error as any)?.message, (error as any)?.details, (error as any)?.hint);
      // Do not fall back to localStorage — that looks like a successful save while
      // Railway/SQLite never received the write (breaks cloud sync in Cloud on mode).
      throw error;
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

  static async saveOvertimeMinutes(eventId: string, itemId: number, overtimeMinutes: number): Promise<boolean> {
    try {
      console.log('🔄 Saving overtime minutes via API for event:', eventId, 'item:', itemId, 'overtime:', overtimeMinutes);
      
      const result = await apiClient.saveOvertimeMinutes(eventId, itemId, overtimeMinutes);
      
      console.log('✅ Overtime minutes saved via API:', result ? 'Success' : 'Failed');
      return !!result;
    } catch (error) {
      console.error('❌ Exception saving overtime minutes:', error);
      return false;
    }
  }

  static async getOvertimeMinutes(eventId: string): Promise<{[itemId: number]: number}> {
    try {
      console.log('🔄 Loading overtime minutes via API for event:', eventId);
      
      const result = await apiClient.getOvertimeMinutes(eventId);
      
      if (!result || !Array.isArray(result)) {
        console.log('📊 No overtime minutes found');
        return {};
      }
      
      // Convert array to object keyed by item_id
      const overtimeData: {[itemId: number]: number} = {};
      result.forEach((record: any) => {
        if (record.item_id) {
          // Handle both number and string types (in case DB stores as string)
          const overtimeValue = typeof record.overtime_minutes === 'number' 
            ? record.overtime_minutes 
            : parseFloat(record.overtime_minutes);
          
          if (!isNaN(overtimeValue)) {
            overtimeData[record.item_id] = overtimeValue;
          }
        }
      });
      
      console.log('✅ Loaded overtime minutes from API:', overtimeData);
      return overtimeData;
    } catch (error) {
      console.error('❌ Exception loading overtime minutes:', error);
      return {};
    }
  }

  static async saveShowStartOvertime(
    eventId: string, 
    itemId: number, 
    overtimeMinutes: number,
    scheduledTime: string,
    actualTime: string
  ): Promise<boolean> {
    try {
      console.log('🔄 Saving show start overtime via API:', { eventId, itemId, overtimeMinutes, scheduledTime, actualTime });
      
      const result = await apiClient.saveShowStartOvertime(eventId, itemId, overtimeMinutes, scheduledTime, actualTime);
      
      console.log('✅ Show start overtime saved via API:', result ? 'Success' : 'Failed');
      return !!result;
    } catch (error) {
      console.error('❌ Exception saving show start overtime:', error);
      return false;
    }
  }

  static async getShowStartOvertime(eventId: string): Promise<{overtimeMinutes: number, itemId: number} | null> {
    try {
      const result = await apiClient.getShowStartOvertime(eventId);
      console.log('✅ Loaded show start overtime from API:', result);
      return result;
    } catch (error) {
      console.error('❌ Exception getting show start overtime:', error);
      return null;
    }
  }

  static async getShowMode(eventId: string): Promise<'rehearsal' | 'in-show'> {
    try {
      const result = await apiClient.getShowMode(eventId);
      return result?.showMode === 'in-show' ? 'in-show' : 'rehearsal';
    } catch (error) {
      console.error('❌ Exception getting show mode:', error);
      return 'rehearsal';
    }
  }

  static async getShowSettings(eventId: string): Promise<{ showMode: 'rehearsal' | 'in-show'; trackWasDurations: boolean }> {
    try {
      const result = await apiClient.getShowMode(eventId);
      return {
        showMode: result?.showMode === 'in-show' ? 'in-show' : 'rehearsal',
        trackWasDurations: result?.trackWasDurations === true
      };
    } catch (error) {
      console.error('❌ Exception getting show settings:', error);
      return { showMode: 'rehearsal', trackWasDurations: false };
    }
  }

  static async saveShowMode(eventId: string, showMode: 'rehearsal' | 'in-show'): Promise<boolean> {
    try {
      await apiClient.saveShowMode(eventId, showMode);
      return true;
    } catch (error) {
      console.error('❌ Exception saving show mode:', error);
      return false;
    }
  }

  static async saveTrackWasDurations(eventId: string, trackWasDurations: boolean): Promise<boolean> {
    try {
      await apiClient.saveTrackWasDurations(eventId, trackWasDurations);
      return true;
    } catch (error) {
      console.error('❌ Exception saving track was durations:', error);
      return false;
    }
  }

  static async saveStartCueSelection(eventId: string, itemId: number): Promise<boolean> {
    try {
      console.log('🔄 Saving START cue selection via API:', { eventId, itemId });
      
      const result = await apiClient.saveStartCueSelection(eventId, itemId);
      
      console.log('✅ START cue selection saved via API:', result ? 'Success' : 'Failed');
      return !!result;
    } catch (error) {
      console.error('❌ Exception saving START cue selection:', error);
      return false;
    }
  }

  static async getStartCueSelection(eventId: string): Promise<{itemId: number} | null> {
    try {
      const result = await apiClient.getStartCueSelection(eventId);
      console.log('✅ Loaded START cue selection from API:', result);
      return result;
    } catch (error) {
      console.error('❌ Exception getting START cue selection:', error);
      return null;
    }
  }

  static async clearShowStartOvertime(eventId: string): Promise<boolean> {
    try {
      console.log('🔄 Clearing show start overtime via API:', eventId);
      
      const result = await apiClient.clearShowStartOvertime(eventId);
      
      console.log('✅ Show start overtime cleared via API:', result ? 'Success' : 'Failed');
      return !!result;
    } catch (error) {
      console.error('❌ Exception clearing show start overtime:', error);
      return false;
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
        
        // Debug logging for isIndented property
        if (data.schedule_items && Array.isArray(data.schedule_items)) {
          console.log('🔍 Database service - Raw schedule data from API:');
          data.schedule_items.forEach((item, index) => {
            console.log(`  Item ${index}:`, {
              id: item.id,
              cue: item.customFields?.cue,
              isIndented: item.isIndented,
              segmentName: item.segmentName
            });
          });
        }
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
       // Always use localStorage fallback since API path
        console.warn('Legacy path disabled, using localStorage fallback');
        return this.deleteRunOfShowFromLocalStorage(eventId);
      
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
      
       // Always use localStorage fallback since API path
        return this.getRunOfShowFromLocalStorageById(eventId);
      
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
  
  // Start a timer via API for cross-client sync
  // Load a CUE (set loaded but not started)
  static async loadCue(eventId: string, itemId: number, userId: string, totalDurationSeconds: number, rowNumber?: number, cueDisplay?: string, timerId?: string): Promise<Record<string, unknown> | null> {
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers`, {
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
        const row = await response.json().catch(() => null);
        console.log('✅ CUE loaded successfully via API');
        return row;
      } else {
        console.error('❌ Failed to load CUE via API:', response.status, response.statusText);
        return null;
      }
    } catch (error) {
      console.error('❌ Error loading CUE:', error);
      return null;
    }
  }

  static async startTimer(eventId: string, itemId: number, userId: string, totalDurationSeconds: number, startedAt?: Date, rowNumber?: number, cueDisplay?: string, timerId?: string): Promise<Record<string, unknown> | null> {
    try {
      console.log('🔄 Starting timer via API:', { eventId, itemId, userId, totalDurationSeconds, startedAt, rowNumber, cueDisplay, timerId });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers`, {
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
          started_at: startedAt?.toISOString(), // Send pre-calculated server time!
          last_loaded_cue_id: itemId,
          cue_is: cueDisplay,
          duration_seconds: totalDurationSeconds
        })
      });

      if (response.ok) {
        const row = await response.json().catch(() => null);
        console.log('✅ Timer started successfully via API');
        return row;
      } else {
        console.error('❌ Failed to start timer via API:', response.status, response.statusText);
        return null;
      }
    } catch (error) {
      console.error('❌ Error starting timer:', error);
      return null;
    }
  }

  // Stop a timer
  static async stopTimer(eventId: string, itemId: number, userId: string, userName?: string, userRole?: string): Promise<boolean> {
    try {
      console.log('🔄 Stopping timer via API:', { eventId, itemId, userId, userName, userRole });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers/stop`, {
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

      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers/${eventId}/${itemId}/duration`, {
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers/stop-all`, {
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers/${eventId}`);
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
    // Real-time updates are handled via Socket.IO and SSE
    console.warn('Real-time updates handled via Socket.IO and SSE');
    return null;
  }

  // Sub-cue Timer Functions
  static async hasActiveSubCueTimer(eventId: string) {
    try {
      console.log('🔄 Checking active sub-cue timer via API:', eventId);
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/sub-cue-timers/${eventId}`);
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/sub-cue-timers/${eventId}`);
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/sub-cue-timers/${eventId}`);
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/sub-cue-timers`, {
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
       // Always use fallback since API path
        console.warn('⚠️ Legacy path disabled, skipping expire completed sub-cue timers');
        return { data: 0, error: null };
      
    } catch (error) {
      console.error('❌ Error expiring completed sub-cue timers:', error);
      return { data: 0, error };
    }
  }

  static async stopSubCueTimer(eventId: string, itemId?: number) {
    try {
      console.log('🔄 Stopping sub-cue timer via API:', { eventId, itemId });
      
      // Update all sub-cue timers for this event to stopped
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/sub-cue-timers/stop`, {
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
       // Always use fallback since API path
        console.warn('⚠️ Legacy path disabled, skipping get active secondary timer');
        return { data: null, error: null };
      
    } catch (error) {
      console.error('❌ Error getting active secondary timer:', error);
      return { data: null, error };
    }
  }


  static async startSecondaryTimer(eventId: string, itemId: number, userId: string, durationSeconds: number) {
    try {
       // Always use fallback since API path
        console.warn('⚠️ Legacy path disabled, skipping start secondary timer');
        return { data: null, error: null };
      
    } catch (error) {
      console.error('❌ Error starting secondary timer:', error);
      return { data: null, error };
    }
  }

  static async stopSecondaryTimer(eventId: string) {
    try {
       // Always use fallback since API path
        console.warn('⚠️ Legacy path disabled, skipping stop secondary timer');
        return { data: null, error: null };
      
    } catch (error) {
      console.error('❌ Error stopping secondary timer:', error);
      return { data: null, error };
    }
  }

  static async updateSecondaryTimerRemaining(eventId: string, remainingSeconds: number) {
    try {
       // Always use fallback since API path
        console.warn('⚠️ Legacy path disabled, skipping update secondary timer remaining');
        return { data: null, error: null };
      
    } catch (error) {
      console.error('❌ Error updating secondary timer remaining:', error);
      return { data: null, error };
    }
  }

  // Clear all active timers for an event
  static async updateSubCueTimerRemaining(eventId: string, itemId: number, remainingSeconds: number): Promise<boolean> {
    try {
       // Always use fallback since API path
        console.warn('⚠️ Legacy path disabled, skipping update sub-cue timer remaining');
        return false;
      
    } catch (error) {
      console.error('Error updating sub-cue timer remaining time:', error);
      return false;
    }
  }

  static async clearAllActiveTimersForEvent(eventId: string): Promise<boolean> {
    try {
      // Use the existing stop-all endpoint instead of DELETE
      console.log('🔄 Clearing all active timers for event via API:', eventId);
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers/stop-all`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId
        })
      });

      if (!response.ok) {
        console.error('❌ Error clearing all active timers via API:', response.statusText);
        return false;
      }

      const result = await response.json();
      console.log('✅ All active timers cleared for event via API:', eventId, result);
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
      const response = await fetch(`${API_BASE_URL}/api/completed-cues/${eventId}`);
      if (!response.ok) {
        console.error('❌ Failed to get completed cues:', response.status, response.statusText);
        return null;
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('❌ Error getting completed cues:', error);
      return null;
    }
  }

  // Mark a cue as completed
  static async markCueCompleted(eventId: string, itemId: number, cueId: string, userId: string, userName: string, userRole: string): Promise<boolean> {
    try {
      console.log('🟣 Marking cue as completed via API:', { eventId, itemId, userId, userName, userRole });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/completed-cues`, {
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/completed-cues`, {
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
      console.log('🟣 Clearing all completed cues from Neon database via API:', { eventId });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/completed-cues/${eventId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.error('❌ Error clearing completed cues from Neon via API:', response.statusText);
        return false;
      }

      console.log('✅ Successfully deleted all completed cues from Neon database for event:', eventId);
      return true;
    } catch (error) {
      console.error('❌ Error clearing completed cues from Neon:', error);
      return false;
    }
  }

  // Clear all overtime minutes for an event
  static async clearOvertimeMinutes(eventId: string): Promise<boolean> {
    try {
      console.log('⏰ Clearing all overtime minutes from database via API:', { eventId });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/overtime-minutes/${eventId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.error('❌ Error clearing overtime minutes via API:', response.statusText);
        return false;
      }

      console.log('✅ Successfully deleted all overtime minutes from database for event:', eventId);
      return true;
    } catch (error) {
      console.error('❌ Error clearing overtime minutes:', error);
      return false;
    }
  }

  // CONTENT REVIEW (Neon: content_review_data)

  static async getContentReviewData(eventId: string): Promise<{
    event_id: string;
    reviews: Record<string, unknown>;
    stream_url: string | null;
    creative_pdf_url: string | null;
    active_stage: 'creative' | 'ros';
    side_rail_width_px: number | null;
    updated_at?: string;
  } | null> {
    try {
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/content-review/${eventId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        console.error('Failed to get content review data:', response.status, response.statusText);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting content review data:', error);
      return null;
    }
  }

  static async saveContentReviewData(
    eventId: string,
    payload: {
      reviews: Record<string, unknown>;
      stream_url?: string | null;
      creative_pdf_url?: string | null;
      active_stage?: 'creative' | 'ros';
      side_rail_width_px?: number | null;
      last_modified_by?: string;
      last_modified_by_name?: string;
    }
  ): Promise<boolean> {
    try {
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/content-review/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        console.error('Failed to save content review data:', response.status, response.statusText);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error saving content review data:', error);
      return false;
    }
  }

  // INDENTED CUES METHODS - Similar to completed cues but for indented/sub-cue relationships

  // Get indented cues for an event
  static async getIndentedCues(eventId: string) {
    try {
      console.log('🟠 Getting indented cues via API:', eventId);
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/indented-cues/${eventId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.error('❌ Failed to get indented cues:', response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      console.log('✅ Indented cues retrieved successfully:', data);
      return data;
    } catch (error) {
      console.error('❌ Error getting indented cues:', error);
      return null;
    }
  }

  // Mark a cue as indented (sub-cue of parent)
  static async markCueIndented(eventId: string, itemId: number, parentItemId: number, userId: string, userName: string, userRole: string): Promise<boolean> {
    try {
      console.log('🟠 Marking cue as indented via API:', { eventId, itemId, parentItemId, userId, userName, userRole });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/indented-cues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_id: eventId,
          item_id: itemId,
          parent_item_id: parentItemId,
          user_id: userId,
          user_name: userName,
          user_role: userRole
        })
      });

      if (!response.ok) {
        console.error('❌ Failed to mark cue as indented:', response.status, response.statusText);
        return false;
      }

      const data = await response.json();
      console.log('✅ Cue marked as indented successfully:', { eventId, itemId, parentItemId, data });
      return true;
    } catch (error) {
      console.error('❌ Error marking cue as indented:', error);
      return false;
    }
  }

  // Unmark a cue as indented
  static async unmarkCueIndented(eventId: string, itemId: number): Promise<boolean> {
    try {
      console.log('🟠 Unmarking cue as indented via API:', { eventId, itemId });
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/indented-cues/${eventId}/${itemId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.error('❌ Failed to unmark cue as indented:', response.status, response.statusText);
        return false;
      }

      console.log('✅ Cue unmarked as indented successfully');
      return true;
    } catch (error) {
      console.error('❌ Error unmarking cue as indented:', error);
      return false;
    }
  }

  // Clear all indented cues for an event
  static async clearIndentedCues(eventId: string): Promise<boolean> {
    try {
      console.log('🟠 Clearing indented cues via API:', eventId);
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/indented-cues/${eventId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        console.error('❌ Failed to clear indented cues:', response.status, response.statusText);
        return false;
      }

      console.log('✅ Indented cues cleared successfully');
      return true;
    } catch (error) {
      console.error('❌ Error clearing indented cues:', error);
      return false;
    }
  }

  // subscribeToTimerActions function removed - timer_actions table no longer used


  // Subscribe to table changes
  static subscribeToTableChanges(tableName: string, callback: (payload: any) => void, eventId?: string) {
    try {
       // Always use fallback since API path
        console.error('❌ Legacy path disabled');
        return null;
      
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/active-timers/${eventId}`);
      
      if (!response.ok) {
        console.log('ℹ️ No active timer found in database');
        return { data: null, error: null };
      }
      
      const data = await response.json();
      
      // Check if there's a last loaded cue in the active timer
      if (data && data.length > 0 && data[0].last_loaded_cue_id) {
        const lastLoadedCue = {
          item_id: data[0].last_loaded_cue_id,
          timer_state: data[0].timer_state,
          is_active: data[0].is_active
        };
        console.log('✅ Last loaded cue retrieved from active timer:', lastLoadedCue);
        return { data: lastLoadedCue, error: null };
      } else {
        console.log('ℹ️ No last loaded cue found in active timer');
        return { data: null, error: null };
      }
    } catch (error) {
      console.error('❌ Error getting last loaded CUE:', error);
      return { data: null, error };
    }
  }

  // Timer Message Methods
  static async saveTimerMessage(message: Omit<TimerMessage, 'id' | 'created_at' | 'updated_at'>): Promise<TimerMessage | null> {
    try {
      console.log('🔄 Saving timer message via API:', message);
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/timer-messages`, {
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/timer-messages/${eventId}`);
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/timer-messages/${id}`, {
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
      
      const response = await DatabaseService.apiFetch(`${apiBase()}/api/timer-messages/${eventId}`);
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

  // Legacy Supabase hybrid helpers — unused; API/Socket paths are used instead
  static async getCueDataForItem(_eventId: string, _itemId: string): Promise<any | null> {
    return null;
  }

  static async getHybridTimerData(_eventId: string): Promise<{
    activeTimer: any | null;
    secondaryTimer: any | null;
    subCueTimers: any[] | null;
    lastLoadedCue: any | null;
    timerMessage: TimerMessage | null;
    cueData: any | null;
  } | null> {
    return null;
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