import { DatabaseService } from './database';
import { apiClient } from './api-client';

export interface LocalChange {
  id: string;
  timestamp: Date;
  eventId: string;
  changeType: string;
  rowNumber?: number;
  cueNumber?: number;
  details?: string;
  segmentName?: string;
  synced: boolean;
}

class ChangeLogService {
  private localChanges: LocalChange[] = [];
  private syncTimer: NodeJS.Timeout | null = null;
  private readonly SYNC_DELAY = 5000; // 5 seconds
  private readonly MAX_BATCH_SIZE = 10;
  private readonly MAX_SYNC_ATTEMPTS = 3;

  constructor() {
    this.loadLocalChanges();
    this.startSyncTimer();
  }

  // Add a change to the local log
  addChange(change: Omit<LocalChange, 'id' | 'timestamp' | 'synced'>): void {
    const newChange: LocalChange = {
      ...change,
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      synced: false
    };

    this.localChanges.unshift(newChange); // Add to beginning for most recent first
    
    // Keep only last 1000 changes to prevent localStorage bloat
    if (this.localChanges.length > 1000) {
      this.localChanges = this.localChanges.slice(0, 1000);
    }
    
    this.saveLocalChanges();
    console.log('📝 Change logged:', newChange.changeType, newChange.details);
    
    // Trigger sync if we have enough changes
    if (this.localChanges.filter(c => !c.synced).length >= this.MAX_BATCH_SIZE) {
      this.syncChanges();
    }
  }

  // Get all local changes (synced and unsynced)
  getLocalChanges(): LocalChange[] {
    return [...this.localChanges];
  }

  // Get only unsynced changes
  getUnsyncedChanges(): LocalChange[] {
    return this.localChanges.filter(change => !change.synced);
  }

  // Get changes count
  getChangesCount(): { total: number; unsynced: number } {
    const total = this.localChanges.length;
    const unsynced = this.localChanges.filter(c => !c.synced).length;
    return { total, unsynced };
  }

  // Force reload local changes from localStorage
  reloadLocalChanges(): void {
    this.loadLocalChanges();
    console.log('🔄 Reloaded local changes:', this.localChanges.length);
  }

  // Start periodic sync timer
  startSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    
    this.syncTimer = setInterval(() => {
      const unsyncedChanges = this.getUnsyncedChanges();
      if (unsyncedChanges.length > 0) {
        console.log(`🔄 Auto-syncing ${unsyncedChanges.length} changes...`);
        this.syncChanges();
      }
    }, this.SYNC_DELAY);
  }

  stopSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // Sync changes to API
  async syncChanges(): Promise<boolean> {
    try {
      const unsyncedChanges = this.getUnsyncedChanges();
      if (unsyncedChanges.length === 0) {
        return true;
      }

      console.log(`🔄 Syncing ${unsyncedChanges.length} changes to API...`);

      try {
        // Group changes by event ID
        const groupedChanges = this.groupChangesByEvent(unsyncedChanges);
        
        // Sync each event's changes
        for (const [eventId, changes] of groupedChanges.entries()) {
          await this.syncEventChanges(eventId, changes);
        }
        
        // Mark all changes as synced
        this.localChanges = this.localChanges.map(change => ({
          ...change,
          synced: true
        }));
        
        this.saveLocalChanges();
        console.log('✅ All changes synced to API');
        return true;
      } catch (error) {
        console.error('❌ Error syncing changes:', error);
        return false;
      }
    } catch (error) {
      console.error('❌ Error syncing changes:', error);
      return false;
    }
  }

  // Group changes by event ID
  private groupChangesByEvent(changes: LocalChange[]): Map<string, LocalChange[]> {
    const grouped = new Map<string, LocalChange[]>();
    
    for (const change of changes) {
      if (!grouped.has(change.eventId)) {
        grouped.set(change.eventId, []);
      }
      grouped.get(change.eventId)!.push(change);
    }
    
    return grouped;
  }

  // Sync changes for a specific event
  private async syncEventChanges(eventId: string, changes: LocalChange[]): Promise<void> {
    try {
      console.log(`📤 Syncing ${changes.length} changes for event ${eventId}`);
      console.log('📤 Changes to sync:', changes.map(c => ({ type: c.changeType, details: c.details })));
      
      // Use API client to log changes
      for (const change of changes) {
        try {
          const changeData = {
            event_id: change.eventId,
            user_id: change.eventId, // Will be extracted from metadata if available
            user_name: 'System',
            action: change.changeType,
            table_name: 'run_of_show_data',
            record_id: change.eventId,
            old_value: null,
            new_value: change.details,
            description: change.details,
            metadata: { 
              segmentName: change.segmentName,
              rowNumber: change.rowNumber,
              cueNumber: change.cueNumber
            }
          };
          
          console.log('📤 Sending change to API:', changeData);
          const result = await apiClient.logChange(changeData);
          console.log('✅ Change logged successfully:', result);
        } catch (error) {
          console.error('❌ Error logging individual change:', error);
          console.error('❌ Error details:', error.message, error.stack);
        }
      }
      
      console.log(`✅ Synced ${changes.length} changes for event ${eventId}`);
    } catch (error) {
      console.error('❌ Error syncing event changes:', error);
      console.error('❌ Error details:', error.message, error.stack);
      throw new Error(`Failed to sync changes for event ${eventId}: ${error.message}`);
    }
  }

  // Load local changes from localStorage
  private loadLocalChanges(): void {
    try {
      const stored = localStorage.getItem('runofshow_local_changes');
      if (stored) {
        const parsed = JSON.parse(stored);
        this.localChanges = parsed.map((change: any) => ({
          ...change,
          timestamp: new Date(change.timestamp)
        }));
      }
    } catch (error) {
      console.error('Error loading local changes:', error);
      this.localChanges = [];
    }
  }

  // Save local changes to localStorage
  private saveLocalChanges(): void {
    try {
      localStorage.setItem('runofshow_local_changes', JSON.stringify(this.localChanges));
    } catch (error) {
      console.error('Error saving local changes:', error);
    }
  }

  // Clear all local changes (for testing)
  clearLocalChanges(): void {
    this.localChanges = [];
    this.saveLocalChanges();
    console.log('🗑️ Local changes cleared');
  }

  // Clear master change log
  async clearMasterChangeLog(eventId: string): Promise<{ success: boolean; error?: string; deletedCount: number }> {
    try {
      console.log('🔄 Clearing master change log for event:', eventId);
      
      // Call API to delete change log entries
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/change-log/${eventId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to clear change log: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log(`✅ Cleared ${result.deletedCount || 0} change log entries`);
      
      return { 
        success: true, 
        error: null, 
        deletedCount: result.deletedCount || 0 
      };
    } catch (error) {
      console.error('❌ Error clearing master change log:', error);
      return { 
        success: false, 
        error: error.message || 'Unexpected error', 
        deletedCount: 0 
      };
    }
  }

  // Get master change log from API
  async getMasterChangeLog(eventId: string, limit: number = 100): Promise<any[]> {
    try {
      console.log('🔄 Fetching master change log from API for event:', eventId);
      
      const changes = await apiClient.getChangeLog(eventId, limit);
      console.log(`📊 Fetched ${changes.length} changes from master log`);
      return changes;
    } catch (error) {
      console.error('❌ Error getting master change log:', error);
      return [];
    }
  }

  // Export changes as JSON
  exportChangesAsJSON(): string {
    return JSON.stringify(this.localChanges, null, 2);
  }

  // Export changes as CSV
  exportChangesAsCSV(): string {
    if (this.localChanges.length === 0) {
      return 'No changes to export';
    }

    const headers = [
      'Timestamp',
      'Event ID',
      'Change Type',
      'Row Number',
      'Cue Number',
      'Details',
      'Segment Name',
      'Synced'
    ];

    const rows = this.localChanges.map(change => [
      change.timestamp.toISOString(),
      change.eventId,
      change.changeType,
      change.rowNumber?.toString() || '',
      change.cueNumber?.toString() || '',
      change.details || '',
      change.segmentName || '',
      change.synced ? 'Yes' : 'No'
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}

// Create a singleton instance
export const changeLogService = new ChangeLogService();