import { supabase } from './supabase';

export interface BackupData {
  id: string;
  event_id: string;
  backup_name: string;
  backup_timestamp: string;
  schedule_data: any;
  custom_columns_data: any;
  event_data: any;
  backup_type: 'auto' | 'manual';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class BackupService {
  /**
   * Test if the backup table exists and is accessible
   */
  static async testBackupTable(): Promise<boolean> {
    try {
      console.log('🔄 Testing backup table access...');
      
      const { data, error } = await supabase
        .from('run_of_show_backups')
        .select('id')
        .limit(1);
      
      if (error) {
        console.error('❌ Backup table test failed:', error);
        return false;
      }
      
      console.log('✅ Backup table is accessible');
      return true;
    } catch (error) {
      console.error('❌ Backup table test error:', error);
      return false;
    }
  }

  /**
   * Create or update a daily backup of the current run of show data
   * @param eventId - The event ID to backup
   * @param scheduleData - The current schedule data
   * @param customColumnsData - The current custom columns data
   * @param eventData - The current event data
   * @param backupType - 'auto' or 'manual'
   * @param backupName - Custom name for the backup (optional)
   * @returns Promise with the created/updated backup data
   */
  static async createBackup(
    eventId: string,
    scheduleData: any[],
    customColumnsData: any[],
    eventData: any,
    backupType: 'auto' | 'manual' = 'auto',
    backupName?: string
  ): Promise<BackupData> {
    try {
      console.log(`🔄 Creating/updating ${backupType} backup for event: ${eventId}`);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      
      // Extract event details for easier filtering
      const eventName = eventData?.name || 'Unknown Event';
      const eventDate = eventData?.date ? new Date(eventData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const eventLocation = eventData?.location || null;
      
      // Generate backup name if not provided
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const finalBackupName = backupName || `${backupType === 'auto' ? 'Auto Backup' : 'Manual Backup'} - ${timestamp}`;
      
      // Check if a backup already exists for this event and date
      const { data: existingBackup, error: checkError } = await supabase
        .from('run_of_show_backups')
        .select('*')
        .eq('event_id', eventId)
        .eq('event_date', eventDate)
        .single();
      
      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }
      
      let result;
      
      if (existingBackup) {
        // Update existing backup
        console.log(`🔄 Updating existing backup for ${eventName} on ${eventDate}`);
        
        const { data, error } = await supabase
          .from('run_of_show_backups')
          .update({
            backup_name: finalBackupName,
            schedule_data: scheduleData,
            custom_columns_data: customColumnsData,
            event_data: eventData,
            backup_type: backupType,
            event_name: eventName,
            event_location: eventLocation,
            schedule_items_count: scheduleData?.length || 0,
            custom_columns_count: customColumnsData?.length || 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingBackup.id)
          .select()
          .single();
        
        if (error) {
          throw error;
        }
        
        result = data;
        console.log(`✅ Backup updated successfully: ${data.backup_name}`);
      } else {
        // Create new backup
        console.log(`🔄 Creating new backup for ${eventName} on ${eventDate}`);
        
        const { data, error } = await supabase
          .from('run_of_show_backups')
          .insert({
            event_id: eventId,
            backup_name: finalBackupName,
            schedule_data: scheduleData,
            custom_columns_data: customColumnsData,
            event_data: eventData,
            backup_type: backupType,
            event_name: eventName,
            event_date: eventDate,
            event_location: eventLocation,
            schedule_items_count: scheduleData?.length || 0,
            custom_columns_count: customColumnsData?.length || 0,
            created_by: user.id
          })
          .select()
          .single();
        
        if (error) {
          throw error;
        }
        
        result = data;
        console.log(`✅ Backup created successfully: ${data.backup_name}`);
      }
      
      return result;
      
    } catch (error) {
      console.error('❌ Error creating/updating backup:', error);
      throw new Error(`Failed to create/update backup: ${error.message}`);
    }
  }
  
  /**
   * Get all backups for a specific event
   * @param eventId - The event ID to get backups for
   * @returns Promise with array of backup data
   */
  static async getBackupsForEvent(eventId: string): Promise<BackupData[]> {
    try {
      console.log(`🔄 Fetching backups for event: ${eventId}`);
      console.log(`🔄 Supabase client status:`, supabase ? 'Connected' : 'Not connected');
      
      const { data, error } = await supabase
        .from('run_of_show_backups')
        .select('*')
        .eq('event_id', eventId)
        .order('backup_timestamp', { ascending: false });
      
      console.log(`🔄 Supabase query result:`, { data, error });
      
      if (error) {
        console.error('❌ Supabase error details:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        });
        throw error;
      }
      
      console.log(`✅ Found ${data?.length || 0} backups for event: ${eventId}`);
      console.log(`📊 Backup data:`, data);
      return data || [];
      
    } catch (error) {
      console.error('❌ Error fetching backups:', error);
      console.error('❌ Error type:', typeof error);
      console.error('❌ Error message:', error.message);
      throw new Error(`Failed to fetch backups: ${error.message}`);
    }
  }

  /**
   * Get backups with filtering and sorting
   * @param filters - Filter options
   * @returns Promise with array of backup data
   */
  static async getBackupsWithFilters(filters: {
    eventId?: string;
    eventName?: string;
    eventDate?: string;
    backupType?: 'auto' | 'manual';
    sortBy?: 'newest' | 'oldest' | 'event' | 'type';
    limit?: number;
  } = {}): Promise<BackupData[]> {
    try {
      console.log('🔄 Fetching backups with filters:', filters);
      
      let query = supabase
        .from('run_of_show_backups')
        .select('*');

      // Apply filters
      if (filters.eventId) {
        query = query.eq('event_id', filters.eventId);
      }
      if (filters.eventName) {
        query = query.ilike('event_name', `%${filters.eventName}%`);
      }
      if (filters.eventDate) {
        query = query.eq('event_date', filters.eventDate);
      }
      if (filters.backupType) {
        query = query.eq('backup_type', filters.backupType);
      }

      // Apply sorting
      switch (filters.sortBy) {
        case 'oldest':
          query = query.order('backup_timestamp', { ascending: true });
          break;
        case 'event':
          query = query.order('event_name', { ascending: true });
          break;
        case 'type':
          query = query.order('backup_type', { ascending: true });
          break;
        case 'newest':
        default:
          query = query.order('backup_timestamp', { ascending: false });
          break;
      }

      // Apply limit
      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;
      
      if (error) {
        throw error;
      }
      
      console.log(`✅ Found ${data?.length || 0} backups with filters`);
      return data || [];
      
    } catch (error) {
      console.error('❌ Error fetching backups with filters:', error);
      throw new Error(`Failed to fetch backups: ${error.message}`);
    }
  }
  
  /**
   * Restore data from a specific backup
   * @param backupId - The backup ID to restore from
   * @returns Promise with the restored data
   */
  static async restoreFromBackup(backupId: string): Promise<{
    scheduleData: any[];
    customColumnsData: any[];
    eventData: any;
    backupName: string;
    backupTimestamp: string;
  }> {
    try {
      console.log(`🔄 Restoring from backup: ${backupId}`);
      
      const { data, error } = await supabase
        .from('run_of_show_backups')
        .select('*')
        .eq('id', backupId)
        .single();
      
      if (error) {
        throw error;
      }
      
      if (!data) {
        throw new Error('Backup not found');
      }
      
      console.log(`✅ Restored from backup: ${data.backup_name}`);
      return {
        scheduleData: data.schedule_data || [],
        customColumnsData: data.custom_columns_data || [],
        eventData: data.event_data || {},
        backupName: data.backup_name,
        backupTimestamp: data.backup_timestamp
      };
      
    } catch (error) {
      console.error('❌ Error restoring from backup:', error);
      throw new Error(`Failed to restore from backup: ${error.message}`);
    }
  }
  
  /**
   * Delete a specific backup
   * @param backupId - The backup ID to delete
   * @returns Promise with success status
   */
  static async deleteBackup(backupId: string): Promise<boolean> {
    try {
      console.log(`🔄 Deleting backup: ${backupId}`);
      
      const { error } = await supabase
        .from('run_of_show_backups')
        .delete()
        .eq('id', backupId);
      
      if (error) {
        throw error;
      }
      
      console.log(`✅ Backup deleted successfully: ${backupId}`);
      return true;
      
    } catch (error) {
      console.error('❌ Error deleting backup:', error);
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }
  
  /**
   * Get backup statistics for an event
   * @param eventId - The event ID to get stats for
   * @returns Promise with backup statistics
   */
  static async getBackupStats(eventId: string): Promise<{
    totalBackups: number;
    lastBackup: string | null;
    autoBackups: number;
    manualBackups: number;
  }> {
    try {
      const backups = await this.getBackupsForEvent(eventId);
      
      const autoBackups = backups.filter(b => b.backup_type === 'auto').length;
      const manualBackups = backups.filter(b => b.backup_type === 'manual').length;
      const lastBackup = backups.length > 0 ? backups[0].backup_timestamp : null;
      
      return {
        totalBackups: backups.length,
        lastBackup,
        autoBackups,
        manualBackups
      };
      
    } catch (error) {
      console.error('❌ Error getting backup stats:', error);
      throw new Error(`Failed to get backup stats: ${error.message}`);
    }
  }
}
