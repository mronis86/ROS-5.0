import { Pool } from 'pg';

// Neon database configuration
const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

// Create connection pool
const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Check if database is properly configured
export const isDatabaseConfigured = !!connectionString;

// Type definitions (same as your existing ones)
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
  event_id: string;
  message: string;
  message_type: string;
  user_id?: string;
  updated_at?: string;
}

export interface ChangeLogEntry {
  id?: string;
  created_at?: string;
  event_id: string;
  user_id?: string;
  user_name?: string;
  action: string;
  table_name?: string;
  record_id?: string;
  old_values?: any;
  new_values?: any;
  metadata?: any;
}

// Database service class
export class NeonDatabaseService {
  // Generic query method
  static async query(text: string, params?: any[]): Promise<{ rows: any[], error?: any }> {
    try {
      const result = await pool.query(text, params);
      return { rows: result.rows };
    } catch (error) {
      console.error('Database query error:', error);
      return { rows: [], error };
    }
  }

  // Generic single row query
  static async querySingle(text: string, params?: any[]): Promise<{ row: any, error?: any }> {
    try {
      const result = await pool.query(text, params);
      return { row: result.rows[0] || null };
    } catch (error) {
      console.error('Database query error:', error);
      return { row: null, error };
    }
  }

  // Test database connection
  static async testConnection(): Promise<boolean> {
    try {
      const result = await pool.query('SELECT NOW()');
      console.log('✅ Database connection successful:', result.rows[0]);
      return true;
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      return false;
    }
  }

  // Calendar Event Methods
  static async saveCalendarEvent(event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): Promise<CalendarEvent | null> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, using localStorage fallback');
        return this.saveCalendarEventToLocalStorage(event);
      }

      const { row, error } = await this.querySingle(
        `INSERT INTO calendar_events (name, date, schedule_data, created_at, updated_at) 
         VALUES ($1, $2, $3, NOW(), NOW()) 
         RETURNING *`,
        [event.name, event.date, JSON.stringify(event.schedule_data)]
      );

      if (error) {
        console.error('Error saving calendar event:', error);
        return this.saveCalendarEventToLocalStorage(event);
      }

      return row;
    } catch (error) {
      console.error('Exception in saveCalendarEvent:', error);
      return this.saveCalendarEventToLocalStorage(event);
    }
  }

  static async getCalendarEvents(): Promise<CalendarEvent[]> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, using localStorage fallback');
        return this.getCalendarEventsFromLocalStorage();
      }

      const { rows, error } = await this.query(
        'SELECT * FROM calendar_events ORDER BY date DESC'
      );

      if (error) {
        console.error('Error fetching calendar events:', error);
        return this.getCalendarEventsFromLocalStorage();
      }

      return rows;
    } catch (error) {
      console.error('Exception in getCalendarEvents:', error);
      return this.getCalendarEventsFromLocalStorage();
    }
  }

  // Run of Show Data Methods
  static async saveRunOfShowData(data: Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at'>): Promise<RunOfShowData | null> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, using localStorage fallback');
        return this.saveRunOfShowToLocalStorage(data);
      }

      const { row, error } = await this.querySingle(
        `INSERT INTO run_of_show_data 
         (event_id, event_name, event_date, schedule_items, custom_columns, settings, 
          last_modified_by, last_modified_by_name, last_modified_by_role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (event_id) 
         DO UPDATE SET 
           event_name = EXCLUDED.event_name,
           event_date = EXCLUDED.event_date,
           schedule_items = EXCLUDED.schedule_items,
           custom_columns = EXCLUDED.custom_columns,
           settings = EXCLUDED.settings,
           last_modified_by = EXCLUDED.last_modified_by,
           last_modified_by_name = EXCLUDED.last_modified_by_name,
           last_modified_by_role = EXCLUDED.last_modified_by_role,
           last_change_at = NOW(),
           updated_at = NOW()
         RETURNING *`,
        [
          data.event_id,
          data.event_name,
          data.event_date,
          JSON.stringify(data.schedule_items),
          JSON.stringify(data.custom_columns),
          JSON.stringify(data.settings),
          data.last_modified_by,
          data.last_modified_by_name,
          data.last_modified_by_role
        ]
      );

      if (error) {
        console.error('Error saving run of show data:', error);
        return this.saveRunOfShowToLocalStorage(data);
      }

      return row;
    } catch (error) {
      console.error('Exception in saveRunOfShowData:', error);
      return this.saveRunOfShowToLocalStorage(data);
    }
  }

  static async getRunOfShowData(eventId: string): Promise<RunOfShowData | null> {
    try {
      console.log('🔄 Loading run of show data from Neon for event:', eventId);
      console.log('🔍 Database configured:', isDatabaseConfigured);
      
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, using localStorage fallback');
        return this.getRunOfShowFromLocalStorageById(eventId);
      }

      console.log('🔍 Executing Neon query...');
      const { row, error } = await this.querySingle(
        'SELECT * FROM run_of_show_data WHERE event_id = $1',
        [eventId]
      );

      console.log('🔍 Neon query completed. Error:', error);
      console.log('🔍 Neon query data:', row);

      if (error) {
        console.error('❌ Error fetching run of show data:', error);
        console.log('🔄 Falling back to localStorage...');
        return this.getRunOfShowFromLocalStorageById(eventId);
      }

      console.log('✅ Run of show data loaded from Neon:', row ? 'Found' : 'Not found');
      if (row) {
        console.log('🔍 Data structure:', {
          hasScheduleItems: !!row.schedule_items,
          scheduleItemsLength: row.schedule_items?.length || 0,
          hasCustomColumns: !!row.custom_columns,
          customColumnsLength: row.custom_columns?.length || 0,
          hasSettings: !!row.settings
        });
      }
      return row;
    } catch (error) {
      console.error('❌ Exception in getRunOfShowData:', error);
      console.log('🔄 Falling back to localStorage due to exception...');
      return this.getRunOfShowFromLocalStorageById(eventId);
    }
  }

  static async updateRunOfShowData(eventId: string, updates: Partial<Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at' | 'last_change_at' | 'last_modified_by' | 'last_modified_by_name' | 'last_modified_by_role'>>): Promise<RunOfShowData | null> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, skipping update');
        return null;
      }

      const setClause = Object.keys(updates)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(', ');

      const values = [eventId, ...Object.values(updates)];
      
      const { row, error } = await this.querySingle(
        `UPDATE run_of_show_data SET ${setClause}, updated_at = NOW() WHERE event_id = $1 RETURNING *`,
        values
      );

      if (error) {
        console.error('❌ Error updating run of show data:', error);
        return null;
      }

      return row;
    } catch (error) {
      console.error('❌ Exception in updateRunOfShowData:', error);
      return null;
    }
  }

  // Completed Cues Methods
  static async getCompletedCues(eventId: string): Promise<any[]> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, returning empty array');
        return [];
      }

      const { rows, error } = await this.query(
        'SELECT * FROM completed_cues WHERE event_id = $1',
        [eventId]
      );

      if (error) {
        console.error('❌ Error fetching completed cues:', error);
        return [];
      }

      return rows;
    } catch (error) {
      console.error('❌ Exception in getCompletedCues:', error);
      return [];
    }
  }

  // Active Timers Methods
  static async getActiveTimers(eventId: string): Promise<any[]> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, returning empty array');
        return [];
      }

      const { rows, error } = await this.query(
        'SELECT * FROM active_timers WHERE event_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [eventId]
      );

      if (error) {
        console.error('❌ Error fetching active timers:', error);
        return [];
      }

      return rows;
    } catch (error) {
      console.error('❌ Exception in getActiveTimers:', error);
      return [];
    }
  }

  // Sub Cue Timers Methods
  static async getActiveSubCueTimers(eventId: string): Promise<any[]> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, returning empty array');
        return [];
      }

      const { rows, error } = await this.query(
        'SELECT * FROM sub_cue_timers WHERE event_id = $1 AND is_active = true AND is_running = true ORDER BY created_at DESC',
        [eventId]
      );

      if (error) {
        console.error('❌ Error fetching active sub-cue timers:', error);
        return [];
      }

      return rows;
    } catch (error) {
      console.error('❌ Exception in getActiveSubCueTimers:', error);
      return [];
    }
  }

  // Change Log Methods
  static async getChangeLog(eventId: string, limit: number = 100): Promise<ChangeLogEntry[]> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, returning empty array');
        return [];
      }

      // Try change_log_batches first, fallback to change_log
      const { rows: batches, error: batchesError } = await this.query(
        'SELECT * FROM change_log_batches WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2',
        [eventId, limit]
      );

      if (batchesError) {
        console.log('🔄 Falling back to regular change_log table...');
        const { rows, error } = await this.query(
          'SELECT * FROM change_log WHERE event_id = $1 ORDER BY created_at DESC LIMIT $2',
          [eventId, limit]
        );

        if (error) {
          console.error('❌ Error fetching change log:', error);
          return [];
        }

        return rows;
      }

      // Flatten batches if they exist
      const allChanges: ChangeLogEntry[] = [];
      for (const batch of batches) {
        if (batch.changes && Array.isArray(batch.changes)) {
          for (const change of batch.changes) {
            allChanges.push({
              ...change,
              batch_id: batch.id,
              batch_created_at: batch.created_at
            });
          }
        }
      }

      return allChanges;
    } catch (error) {
      console.error('❌ Exception in getChangeLog:', error);
      return [];
    }
  }

  // Timer Messages Methods
  static async getTimerMessagesForEvent(eventId: string): Promise<TimerMessage[]> {
    try {
      if (!isDatabaseConfigured) {
        console.warn('Database not configured, returning empty array');
        return [];
      }

      const { rows, error } = await this.query(
        'SELECT * FROM timer_messages WHERE event_id = $1 ORDER BY created_at DESC',
        [eventId]
      );

      if (error) {
        console.error('❌ Error fetching timer messages:', error);
        return [];
      }

      return rows;
    } catch (error) {
      console.error('❌ Exception in getTimerMessagesForEvent:', error);
      return [];
    }
  }

  // localStorage fallback methods (keep your existing localStorage functionality)
  private static saveCalendarEventToLocalStorage(event: Omit<CalendarEvent, 'id' | 'created_at' | 'updated_at'>): CalendarEvent | null {
    // Keep your existing localStorage logic
    return null;
  }

  private static getCalendarEventsFromLocalStorage(): CalendarEvent[] {
    // Keep your existing localStorage logic
    return [];
  }

  private static saveRunOfShowToLocalStorage(data: Omit<RunOfShowData, 'id' | 'created_at' | 'updated_at'>): RunOfShowData | null {
    // Keep your existing localStorage logic
    return null;
  }

  private static getRunOfShowFromLocalStorageById(eventId: string): RunOfShowData | null {
    // Keep your existing localStorage logic
    return null;
  }
}

// Export for backward compatibility
export const neonDatabase = NeonDatabaseService;

