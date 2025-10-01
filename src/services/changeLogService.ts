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

  // Sync changes to API (temporarily disabled - using localStorage only)
  async syncChanges(): Promise<boolean> {
    try {
      const unsyncedChanges = this.getUnsyncedChanges();
      if (unsyncedChanges.length === 0) {
        return true;
      }

      console.log(`🔄 Syncing ${unsyncedChanges.length} changes to API...`);

      try {
        // For now, just mark all changes as synced to localStorage
        // TODO: Implement API sync when change log endpoints are ready
        this.localChanges = this.localChanges.map(change => ({
          ...change,
          synced: true
        }));
        
        this.saveLocalChanges();
        console.log('✅ All changes synced to localStorage (API sync disabled)');
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

  // Sync changes for a specific event (placeholder for future API implementation)
  private async syncEventChanges(eventId: string, changes: LocalChange[]): Promise<void> {
    try {
      console.log(`📤 Syncing ${changes.length} changes for event ${eventId}`);
      
      // TODO: Implement API call to sync changes
      // For now, just log that we would sync these changes
      console.log('📝 Changes to sync:', changes.map(c => ({
        type: c.changeType,
        details: c.details,
        timestamp: c.timestamp
      })));
      
    } catch (error) {
      console.error('❌ Error syncing event changes:', error);
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

  // Clear master change log (placeholder for future API implementation)
  async clearMasterChangeLog(eventId: string): Promise<{ success: boolean; error?: string; deletedCount: number }> {
    try {
      console.log('🔄 Clearing master change log for event:', eventId);
      
      // TODO: Implement API call to clear master change log
      console.log('📝 Would clear master change log for event:', eventId);
      
      return { 
        success: true, 
        error: null, 
        deletedCount: 0 
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

  // Get master change log from API (temporarily disabled - using localStorage only)
  async getMasterChangeLog(eventId: string, limit: number = 100): Promise<any[]> {
    try {
      console.log('🔄 Fetching master change log from API for event:', eventId);
      
      // For now, just return empty array since we're not syncing to API yet
      // TODO: Implement API-based change log when endpoints are ready
      console.log('📊 Master change log disabled - using localStorage only');
      return [];
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