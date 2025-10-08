// import { supabase, isSupabaseConfigured } from './supabase'; // DISABLED: Supabase cleanup

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
  event_name_setting: string;
  master_start_time: string;
  settings: any;
  updated_at?: string;
}

export interface ScheduleItem {
  id?: string;
  created_at?: string;
  event_id: string;
  item_id: number;
  day: number;
  program_type: string;
  shot_type: string;
  segment_name: string;
  duration_hours: number;
  duration_minutes: number;
  duration_seconds: number;
  notes: string;
  assets: string;
  speakers: string;
  has_ppt: boolean;
  has_qa: boolean;
  timer_id: string;
  is_public: boolean;
  is_indented: boolean;
  custom_fields: any;
  updated_at?: string;
}

export interface CustomColumn {
  id?: string;
  created_at?: string;
  event_id: string;
  column_name: string;
  column_id: string;
  updated_at?: string;
}

export class DetailedDatabaseService {
  // Calendar Event Methods
  static async saveCalendarEvent(event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): Promise<CalendarEvent | null> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.saveCalendarToLocalStorage(event);
      }

      const { data, error } = await supabase
        .from('calendar_events')
        .insert([event])
        .select()
        .single();

      if (error) {
        console.error('Error saving calendar event:', error);
        return this.saveCalendarToLocalStorage(event);
      }

      return data;
    } catch (error) {
      console.error('Error saving calendar event:', error);
      return this.saveCalendarToLocalStorage(event);
    }
  }

  static async getCalendarEvents(): Promise<CalendarEvent[]> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.getCalendarFromLocalStorage();
      }

      const { data, error } = await supabase
        .from('calendar_events')
        .select('*')
        .order('date', { ascending: false });

      if (error) {
        console.error('Error fetching calendar events:', error);
        return this.getCalendarFromLocalStorage();
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching calendar events:', error);
      return this.getCalendarFromLocalStorage();
    }
  }

  // Run of Show Data Methods
  static async saveRunOfShowData(data: Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at'>): Promise<RunOfShowData | null> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.saveRunOfShowToLocalStorage(data);
      }

      const { data: result, error } = await supabase
        .from('run_of_show_data')
        .upsert([data], { onConflict: 'event_id' })
        .select()
        .single();

      if (error) {
        console.error('Error saving run of show data:', error);
        return this.saveRunOfShowToLocalStorage(data);
      }

      return result;
    } catch (error) {
      console.error('Error saving run of show data:', error);
      return this.saveRunOfShowToLocalStorage(data);
    }
  }

  static async getRunOfShowData(eventId: string): Promise<RunOfShowData | null> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.getRunOfShowFromLocalStorageById(eventId);
      }

      const { data, error } = await supabase
        .from('run_of_show_data')
        .select('*')
        .eq('event_id', eventId)
        .single();

      if (error) {
        console.error('Error fetching run of show data:', error);
        return this.getRunOfShowFromLocalStorageById(eventId);
      }

      return data;
    } catch (error) {
      console.error('Error fetching run of show data:', error);
      return this.getRunOfShowFromLocalStorageById(eventId);
    }
  }

  // Schedule Items Methods
  static async saveScheduleItems(eventId: string, items: Omit<ScheduleItem, 'id' | 'created_at' | 'updated_at' | 'event_id'>[]): Promise<ScheduleItem[]> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.saveScheduleItemsToLocalStorage(eventId, items);
      }

      // First, delete existing items for this event
      await supabase
        .from('schedule_items')
        .delete()
        .eq('event_id', eventId);

      // Then insert new items
      const itemsWithEventId = items.map(item => ({ ...item, event_id: eventId }));
      const { data, error } = await supabase
        .from('schedule_items')
        .insert(itemsWithEventId)
        .select();

      if (error) {
        console.error('Error saving schedule items:', error);
        return this.saveScheduleItemsToLocalStorage(eventId, items);
      }

      return data || [];
    } catch (error) {
      console.error('Error saving schedule items:', error);
      return this.saveScheduleItemsToLocalStorage(eventId, items);
    }
  }

  static async getScheduleItems(eventId: string): Promise<ScheduleItem[]> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.getScheduleItemsFromLocalStorage(eventId);
      }

      const { data, error } = await supabase
        .from('schedule_items')
        .select('*')
        .eq('event_id', eventId)
        .order('item_id', { ascending: true });

      if (error) {
        console.error('Error fetching schedule items:', error);
        return this.getScheduleItemsFromLocalStorage(eventId);
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching schedule items:', error);
      return this.getScheduleItemsFromLocalStorage(eventId);
    }
  }

  // Custom Columns Methods
  static async saveCustomColumns(eventId: string, columns: Omit<CustomColumn, 'id' | 'created_at' | 'updated_at' | 'event_id'>[]): Promise<CustomColumn[]> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.saveCustomColumnsToLocalStorage(eventId, columns);
      }

      // First, delete existing columns for this event
      await supabase
        .from('custom_columns')
        .delete()
        .eq('event_id', eventId);

      // Then insert new columns
      const columnsWithEventId = columns.map(column => ({ ...column, event_id: eventId }));
      const { data, error } = await supabase
        .from('custom_columns')
        .insert(columnsWithEventId)
        .select();

      if (error) {
        console.error('Error saving custom columns:', error);
        return this.saveCustomColumnsToLocalStorage(eventId, columns);
      }

      return data || [];
    } catch (error) {
      console.error('Error saving custom columns:', error);
      return this.saveCustomColumnsToLocalStorage(eventId, columns);
    }
  }

  static async getCustomColumns(eventId: string): Promise<CustomColumn[]> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.getCustomColumnsFromLocalStorage(eventId);
      }

      const { data, error } = await supabase
        .from('custom_columns')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching custom columns:', error);
        return this.getCustomColumnsFromLocalStorage(eventId);
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching custom columns:', error);
      return this.getCustomColumnsFromLocalStorage(eventId);
    }
  }

  // Delete Methods
  static async deleteRunOfShowData(eventId: string): Promise<boolean> {
    try {
      if (!isSupabaseConfigured) {
        console.warn('Supabase not configured, using localStorage fallback');
        return this.deleteRunOfShowFromLocalStorage(eventId);
      }

      // Delete in order due to foreign key constraints
      await supabase.from('schedule_items').delete().eq('event_id', eventId);
      await supabase.from('custom_columns').delete().eq('event_id', eventId);
      await supabase.from('run_of_show_data').delete().eq('event_id', eventId);

      return true;
    } catch (error) {
      console.error('Error deleting run of show data:', error);
      return this.deleteRunOfShowFromLocalStorage(eventId);
    }
  }

  // LocalStorage fallback methods (simplified for brevity)
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
    return newEvent;
  }

  private static getCalendarFromLocalStorage(): CalendarEvent[] {
    try {
      const stored = localStorage.getItem('calendar_events');
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return [];
    }
  }

  private static saveRunOfShowToLocalStorage(data: Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at'>): RunOfShowData {
    const runOfShowData = this.getAllRunOfShowFromLocalStorage();
    const newData: RunOfShowData = {
      ...data,
      id: Date.now().toString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const existingIndex = runOfShowData.findIndex(item => item.event_id === data.event_id);
    if (existingIndex >= 0) {
      runOfShowData[existingIndex] = newData;
    } else {
      runOfShowData.push(newData);
    }
    
    localStorage.setItem('run_of_show_data', JSON.stringify(runOfShowData));
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
    const data = this.getAllRunOfShowFromLocalStorage();
    return data.find(item => item.event_id === eventId) || null;
  }

  private static saveScheduleItemsToLocalStorage(eventId: string, items: Omit<ScheduleItem, 'id' | 'created_at' | 'updated_at' | 'event_id'>[]): ScheduleItem[] {
    const itemsWithEventId = items.map(item => ({
      ...item,
      id: Date.now().toString() + Math.random(),
      event_id: eventId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    localStorage.setItem(`schedule_items_${eventId}`, JSON.stringify(itemsWithEventId));
    return itemsWithEventId;
  }

  private static getScheduleItemsFromLocalStorage(eventId: string): ScheduleItem[] {
    try {
      const stored = localStorage.getItem(`schedule_items_${eventId}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading schedule items from localStorage:', error);
      return [];
    }
  }

  private static saveCustomColumnsToLocalStorage(eventId: string, columns: Omit<CustomColumn, 'id' | 'created_at' | 'updated_at' | 'event_id'>[]): CustomColumn[] {
    const columnsWithEventId = columns.map(column => ({
      ...column,
      id: Date.now().toString() + Math.random(),
      event_id: eventId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
    localStorage.setItem(`custom_columns_${eventId}`, JSON.stringify(columnsWithEventId));
    return columnsWithEventId;
  }

  private static getCustomColumnsFromLocalStorage(eventId: string): CustomColumn[] {
    try {
      const stored = localStorage.getItem(`custom_columns_${eventId}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error reading custom columns from localStorage:', error);
      return [];
    }
  }

  private static deleteRunOfShowFromLocalStorage(eventId: string): boolean {
    try {
      localStorage.removeItem(`schedule_items_${eventId}`);
      localStorage.removeItem(`custom_columns_${eventId}`);
      const data = this.getAllRunOfShowFromLocalStorage();
      const filteredData = data.filter(item => item.event_id !== eventId);
      localStorage.setItem('run_of_show_data', JSON.stringify(filteredData));
      return true;
    } catch (error) {
      console.error('Error deleting run of show data from localStorage:', error);
      return false;
    }
  }
}
