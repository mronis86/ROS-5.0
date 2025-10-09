import { DatabaseService } from './database';

// API Base URL for direct fetch calls
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (import.meta.env.PROD 
    ? 'https://ros-50-production.up.railway.app'  // Your Railway URL
    : 'http://localhost:3002');

export interface BackupData {
  id: number;
  event_id: string;
  event_name: string;
  event_date: string;
  event_location?: string;
  backup_name: string;
  backup_timestamp: string;
  backup_type: 'auto' | 'manual';
  schedule_data: any[];
  custom_columns_data: any[];
  event_data: any;
  schedule_items_count: number;
  custom_columns_count: number;
  created_by: string;
  created_by_name?: string;
  created_by_role?: string;
  created_at: string;
  updated_at: string;
}

export class NeonBackupService {
  /**
   * Test if the backup table exists and is accessible
   */
  static async testBackupTable(): Promise<boolean> {
    try {
      console.log('🔄 Testing Neon backup table access...');
      
      const response = await fetch(`${API_BASE_URL}/api/backups/test`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.error('❌ Backup table test failed:', response.statusText);
        return false;
      }
      
      console.log('✅ Neon backup table is accessible');
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
   * @param userId - User ID creating the backup
   * @param userName - User name creating the backup
   * @param userRole - User role creating the backup
   * @returns Promise with the created/updated backup data
   */
  static async createBackup(
    eventId: string,
    scheduleData: any[],
    customColumnsData: any[],
    eventData: any,
    backupType: 'auto' | 'manual' = 'auto',
    backupName?: string,
    userId?: string,
    userName?: string,
    userRole?: string
  ): Promise<BackupData> {
    try {
      console.log(`🔄 Creating/updating ${backupType} backup for event: ${eventId}`);
      console.log(`🔍 API_BASE_URL: ${API_BASE_URL}`);
      
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
      
      const backupPayload = {
        event_id: eventId,
        event_name: eventName,
        event_date: eventDate,
        event_location: eventLocation,
        backup_name: finalBackupName,
        backup_type: backupType,
        schedule_data: scheduleData,
        custom_columns_data: customColumnsData,
        event_data: eventData,
        schedule_items_count: scheduleData?.length || 0,
        custom_columns_count: customColumnsData?.length || 0,
        created_by: userId || 'unknown',
        created_by_name: userName || 'Unknown User',
        created_by_role: userRole || 'VIEWER'
      };
      
      const fullUrl = `${API_BASE_URL}/api/backups`;
      console.log(`🔍 Full URL: ${fullUrl}`);
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(backupPayload),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log(`✅ Backup ${backupType === 'auto' ? 'created/updated' : 'created'} successfully: ${result.backup_name}`);
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
      
      const response = await fetch(`${API_BASE_URL}/api/backups/event/${eventId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log(`✅ Found ${data?.length || 0} backups for event: ${eventId}`);
      return data || [];
      
    } catch (error) {
      console.error('❌ Error fetching backups:', error);
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
      
      const queryParams = new URLSearchParams();
      if (filters.eventId) queryParams.append('eventId', filters.eventId);
      if (filters.eventName) queryParams.append('eventName', filters.eventName);
      if (filters.eventDate) queryParams.append('eventDate', filters.eventDate);
      if (filters.backupType) queryParams.append('backupType', filters.backupType);
      if (filters.sortBy) queryParams.append('sortBy', filters.sortBy);
      if (filters.limit) queryParams.append('limit', filters.limit.toString());
      
      const response = await fetch(`${API_BASE_URL}/api/backups?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
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
      
      const response = await fetch(`${API_BASE_URL}/api/backups/${backupId}/restore`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
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
      
      const response = await fetch(`${API_BASE_URL}/api/backups/${backupId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
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
