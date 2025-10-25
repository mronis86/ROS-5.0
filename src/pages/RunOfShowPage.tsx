import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Event } from '../types/Event';
import { DatabaseService, TimerMessage } from '../services/database';
import { apiClient } from '../services/api-client';
import { changeLogService, LocalChange } from '../services/changeLogService';
import { NeonBackupService, BackupData } from '../services/neon-backup-service';

import { useAuth } from '../contexts/AuthContext';
import { sseClient } from '../services/sse-client';
import { socketClient } from '../services/socket-client';
import RoleSelectionModal from '../components/RoleSelectionModal';
import CompleteChangeLog from '../components/CompleteChangeLog';
import OSCModal from '../components/OSCModal';
import OSCModalSimple from '../components/OSCModalSimple';
import OSCModalSimplified from '../components/OSCModalSimplified';
import DisplayModal from '../components/DisplayModal';
import ExcelImportModal from '../components/ExcelImportModal';
// import { driftDetector } from '../services/driftDetector'; // REMOVED: Using WebSocket-only approach

// Speaker interface/type definition
interface Speaker {
  id: string;
  slot: number;
  location: 'Podium' | 'Seat' | 'Virtual' | 'Moderator';
  fullName: string;
  title: string;
  org: string;
  photoLink: string;
}

interface ScheduleItem {
  id: number;
  day: number;
  programType: string;
  shotType: string;
  segmentName: string;
  durationHours: number;
  durationMinutes: number;
  durationSeconds: number;
  notes: string;
  assets: string;
  speakers: string;
  speakersText: string;
  hasPPT: boolean;
  hasQA: boolean;
  timerId: string;
  customFields: Record<string, string>;
  isPublic: boolean;
  isIndented: boolean;
}

interface CustomColumn {
  name: string;
  id: string;
}

const RunOfShowPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  let event: Event = location.state?.event;
  let userRole: string = location.state?.userRole;
  
  // Authentication state
  const { user, loading: authLoading } = useAuth();
  const [currentUserRole, setCurrentUserRole] = useState<'VIEWER' | 'EDITOR' | 'OPERATOR'>('VIEWER');
  const [showRoleChangeModal, setShowRoleChangeModal] = useState(false);
  // Enhanced change log with local buffer and API sync
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [changeLog, setChangeLog] = useState<LocalChange[]>([]);
  const [masterChangeLog, setMasterChangeLog] = useState<any[]>([]);
  const [showMasterChangeLog, setShowMasterChangeLog] = useState(false);

  // Debounced change tracking
  const [pendingChanges, setPendingChanges] = useState<Map<string, any>>(new Map());
  const changeTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  
  // Add a ref to track processed changes to prevent duplicates
  const processedChangesRef = useRef(new Set());

  // Enhanced helper function to log detailed changes (immediate)
  const logChange = (action: string, description: string, details?: any) => {
    if ((currentUserRole !== 'EDITOR' && currentUserRole !== 'OPERATOR') || !user || !event?.id) {
      console.log('⚠️ Not logging change - missing requirements:', { 
        role: currentUserRole, 
        user: !!user, 
        event: !!event?.id 
      });
      return;
    }

    // Add row information to the description
    let enhancedDescription = description;
    let rowNumber: number | undefined;
    let cueNumber: string | undefined;
    
    if (details?.itemId) {
      rowNumber = schedule.findIndex(item => item.id === details.itemId) + 1;
      const item = schedule.find(item => item.id === details.itemId);
      cueNumber = item?.customFields?.cue || 'CUE';
      enhancedDescription = `ROW ${rowNumber} - ${formatCueDisplay(cueNumber)}: ${description}`;
    }
    
    // Add to local change buffer
    changeLogService.addChange({
      eventId: event.id,
      userId: user.id,
      userName: user.full_name || user.email || 'Unknown',
      userRole: currentUserRole,
      action,
      description: enhancedDescription,
      details,
      rowNumber,
      cueNumber,
      segmentName: details?.itemName || details?.segmentName
    });

    // Update local state for immediate UI feedback
    const localChanges = changeLogService.getLocalChanges();
    setChangeLog(localChanges.slice(0, 100)); // Keep last 100 changes
    
    console.log('📝 Change logged to buffer:', enhancedDescription);
  };

  // Smart debounced change logging function (waits 10 seconds after user stops editing, then 3s before saving)
  const logChangeDebounced = (changeKey: string, action: string, description: string, details?: any) => {
    if (currentUserRole !== 'EDITOR' && currentUserRole !== 'OPERATOR') {
      console.log('⚠️ Not logging change - user role is not EDITOR or OPERATOR:', currentUserRole);
      return;
    }

    // For text fields, use a more intelligent debouncing approach
    const isTextFieldChange = action === 'FIELD_UPDATE' && 
      (details?.fieldName?.includes('Name') || 
       details?.fieldName?.includes('segmentName') ||
       details?.fieldName?.includes('cue') ||
       details?.fieldName?.includes('custom'));

    // For text fields, use a single key per field to prevent multiple entries
    // For other fields, use the original key
    const baseKey = isTextFieldChange ? `text_${details?.itemId}_${details?.fieldName}` : changeKey;

    // Clear existing timeout for this base key
    const existingTimeout = changeTimeoutsRef.current.get(baseKey);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      changeTimeoutsRef.current.delete(baseKey);
    }

    // Remove any existing pending changes for this base key
    setPendingChanges(prev => {
      const newMap = new Map(prev);
      // Remove any existing changes for this base key
      for (const [key, value] of newMap.entries()) {
        if (value.originalKey === baseKey) {
          newMap.delete(key);
        }
      }
      return newMap;
    });

    // Add row information to the description and details
    let enhancedDescription = description;
    let enhancedDetails = { ...details };
    if (details?.itemId) {
      const rowNumber = schedule.findIndex(item => item.id === details.itemId) + 1;
      const item = schedule.find(item => item.id === details.itemId);
      const cueNumber = item?.customFields?.cue || 'CUE';
      enhancedDescription = `ROW ${rowNumber} - ${formatCueDisplay(cueNumber)}: ${description}`;
      enhancedDetails = {
        ...details,
        rowNumber,
        cueNumber
      };
    }

    // For text fields, update existing pending change instead of creating new ones
    if (isTextFieldChange) {
      // Update existing pending change for this field
      setPendingChanges(prev => {
        const newMap = new Map(prev);
        // Remove any existing pending changes for this field
        for (const [key, value] of newMap.entries()) {
          if (value.originalKey === baseKey) {
            newMap.delete(key);
          }
        }
        // Add the new pending change
    const uniqueKey = `${baseKey}_${Date.now()}`;
        newMap.set(uniqueKey, {
      action,
      description: enhancedDescription,
      details: enhancedDetails,
      timestamp: new Date(),
      user: user?.full_name || user?.email || 'Unknown User',
      originalKey: baseKey
        });
        
        console.log('📝 Updated text field pending change:', uniqueKey, 'for baseKey:', baseKey);
        console.log('📝 Total pending changes:', newMap.size);
        console.log('📝 Pending change details:', {
          action,
          description: enhancedDescription,
          baseKey,
          uniqueKey
        });
        
        return newMap;
      });
    } else {
      // For non-text fields, create new pending change
    const uniqueKey = `${baseKey}_${Date.now()}`;
    setPendingChanges(prev => {
      const newMap = new Map(prev.set(uniqueKey, {
        action,
        description: enhancedDescription,
        details: enhancedDetails,
        timestamp: new Date(),
        user: user?.full_name || user?.email || 'Unknown User',
        originalKey: baseKey
      }));
      
      console.log('📝 Added pending change:', uniqueKey, 'for baseKey:', baseKey);
      console.log('📝 Total pending changes:', newMap.size);
      console.log('📝 Pending change details:', {
        action,
        description: enhancedDescription,
        baseKey,
        uniqueKey
      });
      
      return newMap;
    });
    }

    // Set new timeout - only log to database after user stops editing
    const timeout = setTimeout(async () => {
      console.log('🕐 TIMEOUT FIRED for baseKey:', baseKey);
      setPendingChanges(prev => {
        // Find the pending change for this base key
        let pendingChange: any = null;
        let changeKey: string | null = null;
        console.log('🕐 TIMEOUT: Looking for baseKey:', baseKey);
        console.log('🕐 TIMEOUT: Available pending changes:', Array.from(prev.entries()).map(([k, v]) => ({ key: k, originalKey: v.originalKey })));
        
        for (const [key, value] of prev.entries()) {
          if (value.originalKey === baseKey) {
            pendingChange = value;
            changeKey = key;
            console.log('🕐 TIMEOUT: Found match - key:', key, 'originalKey:', value.originalKey);
            break;
          }
        }
        
        console.log('🕐 TIMEOUT: Found pending change:', pendingChange ? 'YES' : 'NO');
        console.log('🕐 TIMEOUT: Change key:', changeKey);
        console.log('🕐 TIMEOUT: Has change key in prev:', prev.has(changeKey || ''));
        
        // ✅ KEY FIX: Check if this change was already processed
        const changeId = `${baseKey}-${pendingChange?.timestamp?.getTime() || Date.now()}`;
        console.log('🕐 TIMEOUT: Change ID:', changeId);
        console.log('🕐 TIMEOUT: Already processed:', processedChangesRef.current.has(changeId));
        
        if (pendingChange && changeKey && prev.has(changeKey) && user && event?.id && 
            !processedChangesRef.current.has(changeId)) {
          
          console.log('🕐 TIMEOUT: Processing change...');
          
          // ✅ Mark this change as processed IMMEDIATELY
          processedChangesRef.current.add(changeId);
          
          // Add to new change log service
          const changeData = {
            eventId: event.id,
            userId: user.id,
            userName: user.full_name || user.email || 'Unknown',
            userRole: currentUserRole || 'VIEWER',
            action: pendingChange?.action || 'unknown',
            description: pendingChange?.description || 'unknown',
            details: pendingChange?.details || {},
            rowNumber: pendingChange?.details?.rowNumber,
            cueNumber: pendingChange?.details?.cueNumber,
            segmentName: pendingChange?.details?.itemName || pendingChange?.details?.segmentName
          };
          
          console.log('🔄 Adding change to service:', changeData);
          changeLogService.addChange(changeData);
          
          // Update local state for immediate UI feedback
          const localChanges = changeLogService.getLocalChanges();
          console.log('🔄 Local changes after adding to service:', localChanges.length);
          console.log('🔄 Latest change:', localChanges[localChanges.length - 1]);
          console.log('🔄 Current changeLog state length:', changeLog.length);
          setChangeLog(localChanges.slice(0, 100));
          console.log('🔄 Set changeLog to:', localChanges.slice(0, 100).length, 'changes');
          
          console.log('✅ Debounced change logged to change log service:', pendingChange?.description || 'unknown');
          console.log('🔄 Removed pending change from queue:', changeKey);
          
          // ✅ AUTO-SYNC AFTER SAVING THE CHANGE (with additional 2s delay)
          console.log('🔄 Auto-syncing changes after timeout... (with 3s additional delay)');
          setTimeout(() => {
            syncChanges().then(() => {
              console.log('✅ Auto-sync completed after timeout + 3s delay');
              // Set flag to skip next sync check to prevent user from getting their own changes reverted
              setSkipNextSync(true);
              console.log('⏭️ Set skipNextSync flag to prevent false reset');
            }).catch((error) => {
              console.error('❌ Auto-sync failed after timeout + 3s delay:', error);
            });
          }, 3000); // Additional 3-second delay before saving to API
          
          // Clean up timeout
          changeTimeoutsRef.current.delete(baseKey);
          
          // Return updated pending changes without this key
          const newMap = new Map(prev);
          newMap.delete(changeKey);
          console.log('🔄 Pending changes after removal:', newMap.size);
          console.log('🔄 Remaining pending keys:', Array.from(newMap.keys()));
          return newMap;
        } else {
          // ✅ Change was already processed or doesn't exist, just clean up timeout
          changeTimeoutsRef.current.delete(baseKey);
          if (processedChangesRef.current.has(changeId)) {
            console.log('⚠️ Prevented duplicate processing of change:', changeId);
          } else {
            console.log('ℹ️ Pending change already processed or removed:', baseKey);
          }
          
          // 🔧 FALLBACK: If we can't find the specific change, remove any old pending changes
          // This prevents stuck pending changes
          const now = Date.now();
          const newMap = new Map(prev);
          let removedCount = 0;
          
          for (const [key, value] of newMap.entries()) {
            const age = now - value.timestamp.getTime();
            if (age > 15000) { // Remove changes older than 15 seconds
              console.log('🧹 Removing stale pending change:', key, 'age:', age + 'ms');
              newMap.delete(key);
              removedCount++;
            }
          }
          
          if (removedCount > 0) {
            console.log('🧹 Removed', removedCount, 'stale pending changes');
            return newMap;
          }
          
          return prev;
        }
      });
        }, 5000); // 5 second delay - only log after user stops editing

    changeTimeoutsRef.current.set(baseKey, timeout);
    console.log('⏰ Set timeout for baseKey:', baseKey, 'in', 5000, 'ms');
    console.log('⏰ Total active timeouts:', changeTimeoutsRef.current.size);
  };

  // Helper function to log changes to database with proper row/cue info
  const logChangeToDatabase = async (
    action: string, 
    description: string, 
    details: any, 
    timestamp: Date
  ) => {
    if (!event?.id || !user?.id) return;

    try {
      // Get row number from the item ID
      const itemId = details?.itemId;
      const rowNumber = itemId ? schedule.findIndex(item => item.id === itemId) + 1 : undefined;
      
      // Get cue information
      const item = itemId ? schedule.find(item => item.id === itemId) : null;
      const cueNumber = item?.customFields?.cue ? parseInt(item.customFields.cue, 10) : null;
      
      const fieldName = details?.fieldName || null;
      const oldValue = details?.oldValue || null;
      const newValue = details?.newValue || null;

      // Log to database
      await DatabaseService.logChange(
        event.id,
        user.id,
        user.full_name || user.email || 'Unknown User',
        currentUserRole || 'VIEWER',
        action as any,
        'schedule_items',
        details?.itemId?.toString(),
        fieldName,
        oldValue,
        newValue,
        description,
        rowNumber,
        cueNumber || undefined,
        { timestamp: timestamp.toISOString() }
      );

      console.log('✅ Change logged to database:', { action, description, rowNumber, cueNumber });
    } catch (error) {
      console.error('❌ Error logging change to database:', error);
    }
  };
  
  // Helper function to get row and cue information
  const getRowInfo = (itemId: number) => {
    const item = schedule.find(item => item.id === itemId);
    if (!item) return { rowNumber: 'Unknown', cue: 'Unknown' };
    
    const rowIndex = schedule.findIndex(s => s.id === itemId);
    const cue = item.customFields?.cue || 'CUE';
    
    return {
      rowNumber: rowIndex + 1,
      cue: cue
    };
  };

  // Force finalize all pending changes (call this when user saves or navigates away)
  const finalizeAllPendingChanges = async () => {
    console.log('🔄 Finalizing all pending changes...');
    
    // Get current pending changes snapshot FIRST
    const pendingEntries = Array.from(pendingChanges.entries());
    
    if (pendingEntries.length === 0) {
      console.log('ℹ️ No pending changes to finalize');
      return;
    }
    
    // ✅ Clear all timeouts to prevent them from executing
    changeTimeoutsRef.current.forEach(timeout => {
      clearTimeout(timeout);
    });
    changeTimeoutsRef.current.clear();
    
    console.log(`🔄 Processing ${pendingEntries.length} pending changes immediately...`);
    
    // ✅ Process all changes and mark them as processed
    const processedIds = new Set();
    
    for (const [changeKey, pendingChange] of pendingEntries) {
      if (pendingChange && user && event?.id) {
        // Create unique ID for this change
        const changeId = `${pendingChange.originalKey || changeKey}-${pendingChange.timestamp.getTime()}`;
        
        // ✅ Skip if already processed
        if (processedChangesRef.current.has(changeId)) {
          console.log('⚠️ Skipping already processed change:', changeId);
          continue;
        }
        
        // ✅ Mark as processed FIRST
        processedChangesRef.current.add(changeId);
        processedIds.add(changeId);
        
        // Add row information to the description
        let enhancedDescription = pendingChange.description;
        let rowNumber: number | undefined;
        let cueNumber: string | undefined;
        
        if (pendingChange.details?.itemId) {
          rowNumber = schedule.findIndex(item => item.id === pendingChange.details.itemId) + 1;
          const item = schedule.find(item => item.id === pendingChange.details.itemId);
          cueNumber = item?.customFields?.cue || 'CUE';
          enhancedDescription = `ROW ${rowNumber} - ${formatCueDisplay(cueNumber)}: ${pendingChange.description}`;
        }
        
        // Process the pending change immediately
        changeLogService.addChange({
          eventId: event.id,
          userId: user.id,
          userName: user.full_name || user.email || 'Unknown',
          userRole: currentUserRole || 'VIEWER' || 'VIEWER',
          action: pendingChange.action,
          description: enhancedDescription,
          details: pendingChange.details,
          rowNumber,
          cueNumber,
          segmentName: pendingChange.details?.itemName || pendingChange.details?.segmentName
        });
        
        console.log('✅ Processed pending change immediately:', enhancedDescription);
      }
    }
    
    // ✅ Clear all pending changes
    setPendingChanges(new Map());
    
    // Update local state for immediate UI feedback
    const localChanges = changeLogService.getLocalChanges();
    setChangeLog(localChanges.slice(0, 100));
    
    console.log(`✅ All ${processedIds.size} pending changes processed immediately`);
    
    // ✅ AUTO-SYNC AFTER MANUAL FINALIZATION
    console.log('🔄 Auto-syncing changes after manual finalization...');
    try {
      await syncChanges();
      console.log('✅ Auto-sync completed after manual finalization');
    } catch (error) {
      console.error('❌ Auto-sync failed after manual finalization:', error);
    }
    
    // ✅ Optional: Clean up old processed change IDs after some time to prevent memory leaks
    setTimeout(() => {
      processedIds.forEach(id => {
        processedChangesRef.current.delete(id);
      });
      console.log('🧹 Cleaned up processed change tracking for', processedIds.size, 'changes');
    }, 60000); // Clean up after 1 minute
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      changeTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
    };
  }, []);

  // Periodic cleanup of stale pending changes
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      setPendingChanges(prev => {
        const now = Date.now();
        const newMap = new Map(prev);
        let removedCount = 0;
        
        for (const [key, value] of newMap.entries()) {
          const age = now - value.timestamp.getTime();
          if (age > 20000) { // Remove changes older than 20 seconds
            console.log('🧹 Periodic cleanup: Removing stale pending change:', key, 'age:', age + 'ms');
            newMap.delete(key);
            removedCount++;
          }
        }
        
        if (removedCount > 0) {
          console.log('🧹 Periodic cleanup: Removed', removedCount, 'stale pending changes');
        }
        
        return newMap;
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(cleanupInterval);
  }, []);

  // Update unsynced count when changes occur
  useEffect(() => {
    const unsynced = changeLogService.getChangesCount().unsynced;
    setUnsyncedCount(unsynced);
  }, [changeLog, pendingChanges]);

  // Fallback: Try to get event from localStorage if not in location state
  if (!event) {
    const savedEvents = localStorage.getItem('events');
    if (savedEvents) {
      const events = JSON.parse(savedEvents);
      // Get the most recent event as fallback
      event = events[events.length - 1];
    }
  }

  
  // Debug: Log the event data (reduced logging)
  if (process.env.NODE_ENV === 'development' && Math.random() < 0.01) { // Only log 1% of the time
    console.log('Event from location.state:', location.state?.event);
    console.log('Final event data:', event);
  }
  
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  
  // Overtime tracking - stores overtime minutes for each cue (automatic from hybrid timer)
  const [overtimeMinutes, setOvertimeMinutes] = useState<{[cueId: number]: number}>({});
  const [eventName, setEventName] = useState(event?.name || '');
  const [masterStartTime, setMasterStartTime] = useState('');
  const [dayStartTimes, setDayStartTimes] = useState<Record<number, string>>({});
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [eventTimezone, setEventTimezone] = useState<string>('America/New_York'); // Default to EST
  
  // Change tracking state
  const [lastChangeAt, setLastChangeAt] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [changeNotification, setChangeNotification] = useState<{
    show: boolean;
    lastModifiedBy?: string;
    lastModifiedByName?: string;
  }>({ show: false });
  const [showAddModal, setShowAddModal] = useState(false);
  const [showInsertRowModal, setShowInsertRowModal] = useState(false);
  const [insertRowPosition, setInsertRowPosition] = useState<number | null>(null);
  const [showCustomColumnModal, setShowCustomColumnModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [editingNotesItem, setEditingNotesItem] = useState<number | null>(null);
  const [showSpeakersModal, setShowSpeakersModal] = useState(false);
  const [editingSpeakersItem, setEditingSpeakersItem] = useState<number | null>(null);
  const [tempSpeakersText, setTempSpeakersText] = useState<Speaker[]>([]);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [editingAssetsItem, setEditingAssetsItem] = useState<number | null>(null);
  const [showViewAssetsModal, setShowViewAssetsModal] = useState(false);
  const [viewingAssetsItem, setViewingAssetsItem] = useState<number | null>(null);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [editingParticipantsItem, setEditingParticipantsItem] = useState<number | null>(null);
  const [tempSpeakers, setTempSpeakers] = useState<Speaker[]>([]);
  const [activeTimers, setActiveTimers] = useState<Record<number, boolean>>({});
  const [activeTimerIntervals, setActiveTimerIntervals] = useState<Record<number, NodeJS.Timeout>>({});
  const [subCueTimers, setSubCueTimers] = useState<Record<number, NodeJS.Timeout>>({});
  const [completedCues, setCompletedCues] = useState<Record<number, boolean>>({});
  const [indentedCues, setIndentedCues] = useState<Record<number, { parentId: number; userId: string; userName: string }>>({});
  const [startCueId, setStartCueId] = useState<number | null>(null);
  const [showStartOvertime, setShowStartOvertime] = useState<number>(0); // Minutes late (+) or early (-)
  
  const [secondaryTimer, setSecondaryTimer] = useState<{
    itemId: number;
    duration: number;
    remaining: number;
    isActive: boolean;
    startedAt: Date | null;
    timerState: 'loaded' | 'running' | 'stopped';
  } | null>(null);
  const [secondaryTimerInterval, setSecondaryTimerInterval] = useState<NodeJS.Timeout | null>(null);
  
  const [showGridHeaders, setShowGridHeaders] = useState(false);
  const [activeRowMenu, setActiveRowMenu] = useState<number | null>(null);
  const [activeItemMenu, setActiveItemMenu] = useState<number | null>(null);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [timerProgress, setTimerProgress] = useState<Record<number, { elapsed: number; total: number; startedAt: Date | null }>>({});
  const [subCueTimerProgress, setSubCueTimerProgress] = useState<Record<number, { elapsed: number; total: number; startedAt: Date | null }>>({});
  const [serverSyncedTimers, setServerSyncedTimers] = useState<Set<number>>(new Set());
  
  // ClockPage-style hybrid timer data for real-time updates
  const [hybridTimerData, setHybridTimerData] = useState<any>({ activeTimer: null });
  const [hybridTimerProgress, setHybridTimerProgress] = useState<{ elapsed: number; total: number }>({ elapsed: 0, total: 0 });
  const [clockOffset, setClockOffset] = useState<number>(0); // Offset between client and server clocks in ms
  const [selectedTimerId, setSelectedTimerId] = useState<number | null>(null);
  const [loadedItems, setLoadedItems] = useState<Record<number, boolean>>({});
  const [showMenuDropdown, setShowMenuDropdown] = useState(false);
  const [fullScreenTimerWindow, setFullScreenTimerWindow] = useState<Window | null>(null);
  const [clockWindow, setClockWindow] = useState<Window | null>(null);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showOSCModal, setShowOSCModal] = useState(false);
  const [showDisplayModal, setShowDisplayModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [backups, setBackups] = useState<BackupData[]>([]);
  const [backupStats, setBackupStats] = useState({
    totalBackups: 0,
    lastBackup: null as string | null,
    autoBackups: 0,
    manualBackups: 0
  });
  const [showRestorePreview, setShowRestorePreview] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupData | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [visibleColumns, setVisibleColumns] = useState({
    start: true,
    programType: true,
    duration: true,
    segmentName: true,
    shotType: true,
    pptQA: true,
    notes: true,
    assets: true,
    participants: false, // 👈 hidden now,
    speakers: true,
    public: true,
    custom: true
  });
  const [visibleCustomColumns, setVisibleCustomColumns] = useState<Record<string, boolean>>({});
  
  // Column widths state
  const [columnWidths, setColumnWidths] = useState({
    start: 128, // w-32 = 128px
    programType: 224, // w-56 = 224px
    duration: 224, // w-56 = 224px
    segmentName: 320, // w-80 = 320px
    shotType: 192, // w-48 = 192px
    pptQA: 192, // w-48 = 192px
    notes: 384, // w-96 = 384px
    assets: 192, // w-48 = 192px
    participants: 256, // w-64 = 256px
    speakers: 384, // w-96 = 384px (same as notes)
    public: 128, // w-32 = 128px
  });
  const [customColumnWidths, setCustomColumnWidths] = useState<Record<string, number>>({});
  
  // Follow feature state
  const [isFollowEnabled, setIsFollowEnabled] = useState(false);
  
  // Load follow state from localStorage on mount
  useEffect(() => {
    const savedFollowState = localStorage.getItem(`followEnabled_${event?.id}`);
    if (savedFollowState !== null) {
      setIsFollowEnabled(savedFollowState === 'true');
    }
  }, [event?.id]);
  
  // Save follow state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(`followEnabled_${event?.id}`, isFollowEnabled.toString());
  }, [isFollowEnabled, event?.id]);
  
  // Scroll to active item when activeItemId changes and follow is enabled
  useEffect(() => {
    if (isFollowEnabled && activeItemId) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        // Find the active row element
        const activeRow = document.querySelector(`[data-item-id="${activeItemId}"]`);
        if (activeRow) {
          // Calculate the row's position relative to the document
          const rowRect = activeRow.getBoundingClientRect();
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const rowTop = rowRect.top + scrollTop;
          
          // Find the column headers to calculate offset
          const columnHeaders = document.querySelector('#main-scroll-container .h-24');
          let headerHeight = 100; // Default fallback
          
          if (columnHeaders) {
            const headerRect = columnHeaders.getBoundingClientRect();
            headerHeight = headerRect.height + 20; // Add small gap
          }
          
          // Calculate scroll position to keep row visible below headers
          const extraOffset = 230; // Position the row nicely on screen
          const targetScrollPosition = rowTop - headerHeight - extraOffset;
          
          // Scroll to the calculated position
          window.scrollTo({
            top: Math.max(0, targetScrollPosition), // Don't scroll above the top
            behavior: 'smooth'
          });
          
          console.log('📜 Follow: Scrolled to active item:', activeItemId, 'position:', targetScrollPosition);
        }
      }, 150); // Slightly longer delay to ensure DOM is fully updated
    }
  }, [activeItemId, isFollowEnabled]);
  
  // Track stopped items for inactive styling
  const [stoppedItems, setStoppedItems] = useState<Set<number>>(new Set());
  
  // Helper function to format cue display with proper spacing
  const formatCueDisplay = (cue: string | undefined) => {
    if (!cue) return 'CUE';
    // If cue already has proper spacing, return as is
    if (cue.includes('CUE ')) return cue;
    // If cue is like "CUE2", convert to "CUE 2"
    if (cue.match(/^CUE\d+$/)) return cue.replace(/^CUE(\d+)$/, 'CUE $1');
    // For plain numbers or other formats, add "CUE " prefix
    return `CUE ${cue}`;
  };

  // Helper function to convert HTML to plain text with basic markdown-style formatting
  const cleanNotesForCSV = (htmlString: string): string => {
    if (!htmlString) return '';
    
    let cleaned = htmlString;
    
    // Convert bold tags to **text**
    cleaned = cleaned.replace(/<b>(.*?)<\/b>/gi, '**$1**');
    cleaned = cleaned.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
    
    // Convert italic tags to *text*
    cleaned = cleaned.replace(/<i>(.*?)<\/i>/gi, '*$1*');
    cleaned = cleaned.replace(/<em>(.*?)<\/em>/gi, '*$1*');
    
    // Convert underline tags to _text_
    cleaned = cleaned.replace(/<u>(.*?)<\/u>/gi, '_$1_');
    
    // Convert line breaks and paragraphs to actual newlines
    cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
    cleaned = cleaned.replace(/<\/p>/gi, '\n');
    cleaned = cleaned.replace(/<p>/gi, '');
    
    // Convert list items to bullet points
    cleaned = cleaned.replace(/<li>(.*?)<\/li>/gi, '• $1\n');
    cleaned = cleaned.replace(/<\/?ul>/gi, '');
    cleaned = cleaned.replace(/<\/?ol>/gi, '');
    
    // Remove any remaining HTML tags
    cleaned = cleaned.replace(/<[^>]*>/g, '');
    
    // Decode HTML entities
    cleaned = cleaned.replace(/&nbsp;/g, ' ');
    cleaned = cleaned.replace(/&amp;/g, '&');
    cleaned = cleaned.replace(/&lt;/g, '<');
    cleaned = cleaned.replace(/&gt;/g, '>');
    cleaned = cleaned.replace(/&quot;/g, '"');
    
    // Clean up extra whitespace but preserve intentional line breaks
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n'); // Max 2 consecutive newlines
    cleaned = cleaned.trim();
    
    return cleaned;
  };

  // Parse time string from Start column (e.g., "8:00 PM", "20:00", "1:30 PM")
  const parseTimeString = (timeStr: string): Date | null => {
    if (!timeStr || timeStr.trim() === '') return null;
    
    const now = new Date();
    const trimmed = timeStr.trim();
    
    // Try parsing 12-hour format with AM/PM
    const time12Match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (time12Match) {
      let hours = parseInt(time12Match[1]);
      const minutes = parseInt(time12Match[2]);
      const period = time12Match[3].toUpperCase();
      
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      
      const result = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
      return result;
    }
    
    // Try parsing 24-hour format
    const time24Match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (time24Match) {
      const hours = parseInt(time24Match[1]);
      const minutes = parseInt(time24Match[2]);
      const result = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
      return result;
    }
    
    return null;
  };

  // UTC utility functions with proper timezone conversion
  const getCurrentTimeUTC = (): Date => {
    return new Date(); // JavaScript Date objects are already UTC internally
  };

  // Convert a local time to UTC using the event timezone
  const convertLocalTimeToUTC = (localTime: Date, timezone: string): Date => {
    try {
      // The localTime from parseTimeString is already correctly representing the scheduled time
      // We just need to return it as-is since it's already in the correct timezone
      
      
      return localTime; // Return the input directly since it's already correct
    } catch (error) {
      console.warn('Error converting local time to UTC:', error);
      return localTime; // Fallback to original time
    }
  };

  // Debug popup to show event and timezone info
  const showEventDebugPopup = () => {
    const eventData = location.state?.event;
    const popupContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
        <h2>🔍 Event Debug Information</h2>
        <h3>Event Details:</h3>
        <ul>
          <li><strong>Event ID:</strong> ${eventData?.id || 'Not found'}</li>
          <li><strong>Event Name:</strong> ${eventData?.name || 'Not found'}</li>
          <li><strong>Event Date:</strong> ${eventData?.date || 'Not found'}</li>
          <li><strong>Event Location:</strong> ${eventData?.location || 'Not found'}</li>
        </ul>
        
        <h3>Timezone Information:</h3>
        <ul>
          <li><strong>Current eventTimezone State:</strong> ${eventTimezone || 'Not set'}</li>
          <li><strong>Event Timezone (from location.state):</strong> ${eventData?.timezone || 'Not found'}</li>
          <li><strong>Browser Timezone:</strong> ${Intl.DateTimeFormat().resolvedOptions().timeZone}</li>
          <li><strong>Current Time (Browser):</strong> ${new Date().toLocaleString()}</li>
          <li><strong>Current Time (Event TZ):</strong> ${eventTimezone ? new Date().toLocaleString('en-US', { timeZone: eventTimezone }) : 'N/A'}</li>
        </ul>
        
        <h3>API Data Check:</h3>
        <p>Check browser console for API response data and timezone loading logs.</p>
        
        <button onclick="window.close()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;
    
    const popup = window.open('', 'eventDebug', 'width=700,height=500,scrollbars=yes,resizable=yes');
    if (popup) {
      popup.document.write(popupContent);
      popup.document.title = 'Event Debug Information';
    }
  };

  // Get current time in the event timezone
  const getCurrentTimeInEventTimezone = (): Date => {
    if (!eventTimezone) return new Date();
    try {
      const now = new Date();
      const timeStr = now.toLocaleString("en-US", {
        timeZone: eventTimezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      return new Date(timeStr);
    } catch (error) {
      console.warn('Error getting current time in event timezone:', error);
      return new Date();
    }
  };

  // Track dependent rows for orange highlighting when CUE is loaded
  const [loadedCueDependents, setLoadedCueDependents] = useState<Set<number>>(new Set());
  
  // Track last loaded CUE for visual indication
  const [lastLoadedCueId, setLastLoadedCueId] = useState<number | null>(null);
  
  // Track if we're currently syncing sub-cue timer to prevent flickering
  const [isSyncingSubCue, setIsSyncingSubCue] = useState(false);
  
  // Toast notification state
  const [showTimeToast, setShowTimeToast] = useState(false);
  const [timeToastEnabled, setTimeToastEnabled] = useState(true); // New state to track if toast is enabled
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [timeStatus, setTimeStatus] = useState<'early' | 'late' | 'on-time' | null>(null);
  const [timeDifference, setTimeDifference] = useState(0);
  
  // Skip next sync when user makes a change
  const [skipNextSync, setSkipNextSync] = useState(false);
  
  // Track if user is actively editing
  const [isUserEditing, setIsUserEditing] = useState(false);
  const [editingTimeout, setEditingTimeout] = useState<NodeJS.Timeout | null>(null);
  
  // Countdown timer for sync check
  const [countdown, setCountdown] = useState(20);
  const [isSyncing, setIsSyncing] = useState(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Drag-to-scroll refs and state
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const stickyHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
    container: null as HTMLDivElement | null
  });
  
  // Function to handle user editing state
  const handleUserEditing = () => {
    console.log('✏️ User started editing - pausing sync');
    setIsUserEditing(true);
    
    // Clear existing timeout
    if (editingTimeout) {
      clearTimeout(editingTimeout);
    }
    
    // Set new timeout to resume syncing after 5 seconds of inactivity
    const timeout = setTimeout(() => {
      console.log('⏸️ User stopped editing - resuming sync');
      setIsUserEditing(false);
      // Restart countdown when user stops editing
      startCountdownTimer();
    }, 5000);
    
    setEditingTimeout(timeout);
  };

  // Function to handle modal editing state (stays paused until modal closes)
  const handleModalEditing = () => {
    console.log('✏️ Modal opened - pausing sync until closed');
    setIsUserEditing(true);
    
    // Clear any existing timeout since modal will stay open
    if (editingTimeout) {
      clearTimeout(editingTimeout);
      setEditingTimeout(null);
    }
  };

  // Countdown timer functions with WebSocket sync
  const startCountdownTimer = useCallback(() => {
    // Clear any existing countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    
    setCountdown(20);
    setIsSyncing(false);
    
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Trigger WebSocket sync when countdown reaches zero
          console.log('🔄 Countdown sync: Triggering WebSocket sync request');
          setIsSyncing(true);
          
          // Request fresh data via WebSocket
          if (socketClient && event?.id) {
            socketClient.emitSyncRequest();
            console.log('📡 Countdown sync: Emitted sync request via WebSocket');
          }
          
          setTimeout(() => {
            setIsSyncing(false);
            setCountdown(20); // Restart countdown
          }, 3000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    countdownIntervalRef.current = interval;
  }, [socketClient, event?.id]);

  const stopCountdownTimer = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(20);
    setIsSyncing(false);
  }, []);

  // Function to resume editing when modal closes
  const handleModalClosed = () => {
    console.log('✏️ Modal closed - resuming sync in 5 seconds');
    
    // Set timeout to resume syncing after 5 seconds
    const timeout = setTimeout(() => {
      console.log('⏸️ User stopped editing - resuming sync');
      setIsUserEditing(false);
      // Restart countdown when user stops editing
      startCountdownTimer();
    }, 5000);
    
    setEditingTimeout(timeout);
  };
  
  
  // Load user role from navigation state or localStorage
  useEffect(() => {
    // Don't run this effect until authentication has finished loading
    if (authLoading) {
      console.log('⏳ Authentication still loading, waiting...');
      return;
    }

    if (user && event?.id) {
      // First priority: check API for the most recent role (this will have the latest changes)
      const loadRoleFromAPI = async () => {
        try {
          console.log('🔍 Loading role from API for user:', user.id, 'event:', event.id);
          const userSession = await DatabaseService.getCurrentUserSession(user.id, event.id);
          console.log('📋 User session from API:', userSession);
          
          if (userSession && userSession.event_id === event.id && userSession.role) {
            setCurrentUserRole(userSession.role as 'VIEWER' | 'EDITOR' | 'OPERATOR');
            console.log('✅ Loaded role from localStorage:', userSession.role);
            
            // Also update localStorage to keep it in sync
            localStorage.setItem(`userRole_${event.id}`, userSession.role);
            console.log('💾 Updated localStorage with role:', userSession.role);
            return true;
          } else {
            console.log('❌ No valid role found in localStorage:', { 
              hasSession: !!userSession, 
              eventIdMatch: userSession?.event_id === event.id, 
              hasRole: !!userSession?.role,
              userSessionEventId: userSession?.event_id,
              currentEventId: event.id,
              userRole: userSession?.role
            });
          }
        } catch (error) {
          console.log('⚠️ Failed to load role from API:', error);
        }
        return false;
      };
      
      // First priority: check API for the most recent role (for persistence)
      loadRoleFromAPI().then(apiSuccess => {
        if (apiSuccess) {
          // Found role in API, use it
          console.log('✅ Using role from API');
          return;
        }
        
        // Second priority: role from navigation state (from Graphics page or other navigation)
        if (userRole && ['VIEWER', 'EDITOR', 'OPERATOR'].includes(userRole)) {
          setCurrentUserRole(userRole as 'VIEWER' | 'EDITOR' | 'OPERATOR');
          
          // Save user session to database
          DatabaseService.saveUserSession(
            event.id,
            user.id,
            user.full_name || user.email || 'Unknown',
            userRole
          ).then(success => {
            if (success) {
              console.log('✅ Role saved to API from navigation state:', userRole);
            } else {
              console.log('⚠️ Failed to save role to API, using localStorage only');
            }
          });
          
          // Also save to localStorage for immediate access
          localStorage.setItem(`userRole_${event.id}`, userRole);
          console.log('💾 Saved role to localStorage:', userRole);
          
          console.log('✅ Using role from navigation state (no API role found):', userRole);
          return;
        }
        
        // Third priority: check localStorage as final fallback
        const savedRole = localStorage.getItem(`userRole_${event.id}`);
        console.log('🔍 Checking localStorage for role:', { eventId: event.id, savedRole });
        if (savedRole && ['VIEWER', 'EDITOR', 'OPERATOR'].includes(savedRole)) {
          setCurrentUserRole(savedRole as 'VIEWER' | 'EDITOR' | 'OPERATOR');
          console.log('✅ Using role from localStorage fallback:', savedRole);
          
          // Try to save this role to API for future use
          DatabaseService.saveUserSession(
            event.id,
            user.id,
            user.full_name || user.email || 'Unknown',
            savedRole
          ).then(success => {
            if (success) {
              console.log('✅ Role synced to API from localStorage:', savedRole);
            } else {
              console.log('⚠️ Failed to sync role to API, keeping localStorage only');
            }
          });
          return;
        }
        
        // Fourth priority: check for any role in localStorage (any event)
        const allKeys = Object.keys(localStorage);
        const roleKeys = allKeys.filter(key => key.startsWith('userRole_'));
        console.log('🔍 Checking all localStorage role keys:', roleKeys);
        console.log('🔍 Current event ID:', event.id);
        console.log('🔍 All localStorage keys:', allKeys);
        
        if (roleKeys.length > 0) {
          const latestRoleKey = roleKeys[roleKeys.length - 1];
          const latestRole = localStorage.getItem(latestRoleKey);
          console.log('🔍 Found latest role in localStorage:', { key: latestRoleKey, role: latestRole });
          
          if (latestRole && ['VIEWER', 'EDITOR', 'OPERATOR'].includes(latestRole)) {
            setCurrentUserRole(latestRole as 'VIEWER' | 'EDITOR' | 'OPERATOR');
            console.log('✅ Using latest role from localStorage:', latestRole);
            
            // Save this role for the current event
            localStorage.setItem(`userRole_${event.id}`, latestRole);
            DatabaseService.saveUserSession(
              event.id,
              user.id,
              user.full_name || user.email || 'Unknown',
              latestRole
            ).then(success => {
              if (success) {
                console.log('✅ Role synced to API from latest localStorage:', latestRole);
              } else {
                console.log('⚠️ Failed to sync role to API, keeping localStorage only');
              }
            });
            return;
          }
        }
        
        // No role found anywhere, show role selection modal instead of redirecting
        console.log('❌ No role found, showing role selection modal');
        setShowRoleChangeModal(true);
      });
    } else if (!user && event?.id) {
      // If no user is authenticated, default to VIEWER role
      console.log('❌ No user authenticated, defaulting to VIEWER role');
      setCurrentUserRole('VIEWER');
    }
  }, [user, event?.id, authLoading, userRole, navigate]);

  // Load change log data and sync status
  useEffect(() => {
    if (event?.id) {
      console.log('🔄 Loading change log data for event:', event.id);
      
      // Force reload local changes from localStorage
      changeLogService.reloadLocalChanges();
      const localChanges = changeLogService.getLocalChanges();
      setChangeLog(localChanges.slice(0, 100));
      console.log('📝 Loaded local changes:', localChanges.length);
      
      // Load master change log from API
      loadMasterChangeLog();
      
      // Load completed cues from API
      loadCompletedCuesFromAPI();
      loadIndentedCuesFromAPI();
      
      // NOTE: loadActiveTimerFromAPI() is now called AFTER schedule is loaded
      // to prevent race condition where cue display text is missing
      
      // Load active sub-cue timers from API
      loadActiveSubCueTimersFromAPI();
      
      // Load active sub-cue timer from API
      loadActiveSubCueTimerFromAPI();
      
      // Test database connection
      testDatabaseConnection();
      
      // Set up periodic refresh
      const interval = setInterval(() => {
        const localChanges = changeLogService.getLocalChanges();
        setChangeLog(localChanges.slice(0, 100));
      }, 2000); // Refresh every 2 seconds
      
      return () => clearInterval(interval);
    }
  }, [event?.id]);

  // State for popup message
  const [showRunningTimerPopup, setShowRunningTimerPopup] = useState(false);
  const [runningTimerInfo, setRunningTimerInfo] = useState<{
    cueName: string;
    remainingTime: string;
  } | null>(null);
  const [hasCheckedRunningTimers, setHasCheckedRunningTimers] = useState(false);

  // Check for running timers AFTER schedule data is loaded (no CUE restoration)
  // Only check once on initial load, not when schedule changes
  useEffect(() => {
    if (event?.id && schedule.length > 0 && !hasCheckedRunningTimers) {
      console.log('🔄 Schedule loaded, checking for running timers for event:', event.id);
      checkForRunningTimers();
      setHasCheckedRunningTimers(true);
    }
  }, [event?.id, schedule.length, hasCheckedRunningTimers]);

  // DISABLED: Old timer sync polling - replaced by countdown sync below
  // This was causing conflicts with the new countdown sync system
  // useEffect(() => {
  //   if (!event?.id || !user?.id) {
  //     console.log('❌ Polling not started - missing event.id or user.id:', { eventId: event?.id, userId: user?.id });
  //     return;
  //   }
  //   // ... old polling code disabled to prevent conflicts
  // }, [event?.id, user?.id]);

  // Sync completed cues function
  const syncCompletedCues = async () => {
    if (!event?.id) return;
    
    try {
      const completedData = await apiClient.getCompletedCues(event.id);

      if (completedData) {
        const completedCuesMap: Record<number, boolean> = {};
        completedData.forEach((cue: any) => {
          if (cue.item_id) {
            completedCuesMap[cue.item_id] = true;
          }
        });
        setCompletedCues(completedCuesMap);
        console.log('🟣 Synced completed cues:', completedCuesMap);
      }
    } catch (error) {
      console.warn('⚠️ Error syncing completed cues:', error);
    }
  };

  // Sync sub-cue timers function
  const syncSubCueTimers = async () => {
    if (!event?.id) return;
    
    try {
      await loadActiveSubCueTimerFromAPI();
    } catch (error) {
      console.warn('⚠️ Error syncing sub-cue timers:', error);
    }
  };

  // Separate polling for completed cues sync
  useEffect(() => {
    if (!event?.id) return;
    
    // Initial sync
    syncCompletedCues();
    
    // DISABLED: WebSocket handles real-time updates, no polling needed
    // const interval = setInterval(syncCompletedCues, 2 * 60 * 1000);
    
    // return () => clearInterval(interval); // No interval to clean up
  }, [event?.id]);

  // Separate polling for sub-cue timers
  useEffect(() => {
    if (!event?.id) return;
    
    // Initial sync
    syncSubCueTimers();
    
    // DISABLED: WebSocket handles real-time updates, no polling needed
    // const interval = setInterval(syncSubCueTimers, 30 * 1000);
    
    // return () => clearInterval(interval); // No interval to clean up
  }, [event?.id]);

  // Separate polling for top text display (LOADED/RUNNING states) - no countdown interference
  useEffect(() => {
    if (!event?.id || !user?.id) return;
    
    const syncTopTextDisplay = async () => {
      try {
        const data = await apiClient.getActiveTimers(event.id);

        if (!data) {
          console.warn('⚠️ No timer data found');
          return;
        }

        const timerRecord = data?.[0];
        
        // Skip if this is the current user's change
        if (timerRecord && timerRecord.user_id === user.id) {
          return;
        }

        // Update only the top text display states, not countdown
        if (timerRecord) {
          const timerState = timerRecord.timer_state || 'unknown';
          const itemId = parseInt(timerRecord.item_id);
          const isActive = timerRecord.is_active;
          const startedAt = timerRecord.started_at;
          
          let actualState = timerState;
          if (timerState === 'unknown' || !timerState) {
            if (isActive && startedAt) {
              actualState = 'running';
            } else if (isActive) {
              actualState = 'loaded';
            } else {
              actualState = 'stopped';
            }
          }
          
          if (actualState === 'running') {
            setActiveItemId(itemId);
            setLoadedItems(prev => ({ ...prev, [itemId]: true }));
            setActiveTimers(prev => ({ ...prev, [itemId]: true }));
            // Set dependent rows for orange highlighting
            const currentIndex = schedule.findIndex(item => item.id === itemId);
            const dependentIds = new Set<number>();
            if (currentIndex !== -1) {
              for (let i = currentIndex + 1; i < schedule.length; i++) {
                if (schedule[i].isIndented) {
                  dependentIds.add(schedule[i].id);
                } else {
                  break;
                }
              }
            }
            setLoadedCueDependents(dependentIds);
            setLastLoadedCueId(itemId);
          } else if (actualState === 'loaded') {
            setActiveItemId(itemId);
            setLoadedItems(prev => ({ ...prev, [itemId]: true }));
            setActiveTimers({});
            // Set dependent rows for orange highlighting
            const currentIndex = schedule.findIndex(item => item.id === itemId);
            const dependentIds = new Set<number>();
            if (currentIndex !== -1) {
              for (let i = currentIndex + 1; i < schedule.length; i++) {
                if (schedule[i].isIndented) {
                  dependentIds.add(schedule[i].id);
                } else {
                  break;
                }
              }
            }
            setLoadedCueDependents(dependentIds);
            setLastLoadedCueId(itemId);
          } else if (actualState === 'stopped') {
            setActiveItemId(null);
            setLoadedItems({});
            setActiveTimers({});
            setLoadedCueDependents(new Set());
            setLastLoadedCueId(null);
          }
        } else {
          setActiveItemId(null);
          setLoadedItems({});
          setActiveTimers({});
          setLoadedCueDependents(new Set());
          setLastLoadedCueId(null);
        }
      } catch (error) {
        console.warn('⚠️ Top text sync error:', error);
      }
    };

    // Initial sync
    syncTopTextDisplay();
    
    // DISABLED: WebSocket handles real-time updates, no polling needed
    // const interval = setInterval(syncTopTextDisplay, 10 * 1000);
    
    // return () => clearInterval(interval); // No interval to clean up
  }, [event?.id, user?.id, schedule]);

  // Real-time WebSocket sync with 5-second reliability check
  useEffect(() => {
    if (!event?.id || !user) return;
    
    console.log('🔄 Setting up real-time WebSocket sync with 5-second reliability check');
    
    // 5-second reliability check to ensure WebSocket updates are processed
    const reliabilityInterval = setInterval(() => {
      // This doesn't make API calls - just ensures WebSocket updates are processed
      console.log('🔄 5s reliability: Ensuring WebSocket updates are processed');
      
      // Force a re-render to catch any missed WebSocket updates
      // This is very lightweight and doesn't add egress
      setLastChangeAt(prev => prev); // Trigger a state update
    }, 5000); // 5 seconds
    
    return () => {
      console.log('🧹 Cleaning up 5-second reliability check timer');
      clearInterval(reliabilityInterval);
    };
  }, [event?.id, user?.id]);

  // Cleanup on component unmount (drift detector removed)
  useEffect(() => {
    return () => {
      console.log('🔄 Cleaning up on component unmount');
      // Drift detector removed - using WebSocket-only approach
    };
  }, []);

  // Save current role to API whenever it changes (but not for initial VIEWER state)
  useEffect(() => {
    if (event?.id && user?.id && currentUserRole && currentUserRole !== 'VIEWER') {
      console.log('💾 Saving current role to API:', currentUserRole);
      try {
        const username = user.full_name || user.email || 'Unknown';
        DatabaseService.saveUserSession(event.id, user.id, username, currentUserRole);
        console.log('✅ Role saved to API:', currentUserRole);
      } catch (error) {
        console.error('❌ Failed to save role to API:', error);
      }
    }
  }, [event?.id, user?.id, currentUserRole]);

  // Also save role when component unmounts (navigating away) as backup (but not for VIEWER)
  useEffect(() => {
    return () => {
      if (event?.id && user?.id && currentUserRole && currentUserRole !== 'VIEWER') {
        console.log('💾 Saving current role to API before navigating away:', currentUserRole);
        try {
          const username = user.full_name || user.email || 'Unknown';
          DatabaseService.saveUserSession(event.id, user.id, username, currentUserRole);
          console.log('✅ Role saved to API on navigation away:', currentUserRole);
        } catch (error) {
          console.error('❌ Failed to save role to API on navigation away:', error);
        }
      }
    };
  }, [event?.id, user?.id, currentUserRole]);

  // Load completed cues from API
  const loadCompletedCuesFromAPI = async () => {
    if (!event?.id) return;

    try {
      console.log('🟣 Loading completed cues from API for event:', event.id);
      const completedCuesData = await DatabaseService.getCompletedCues(event.id);
      
      if (completedCuesData && completedCuesData.length > 0) {
        console.log('🟣 Found completed cues:', completedCuesData);
        
        // Convert the database data to completedCues state format
        const completedCuesMap: Record<number, boolean> = {};
        completedCuesData.forEach((cue: any) => {
          if (cue.item_id) {
            // Don't mark the currently loaded cue as completed
            if (activeItemId && cue.item_id === activeItemId) {
              console.log('🟣 Skipping currently loaded cue from completed cues:', cue.item_id);
              return;
            }
            completedCuesMap[cue.item_id] = true;
          }
        });
        
        setCompletedCues(completedCuesMap);
        console.log('🟣 Set completedCues state:', completedCuesMap);
      } else {
        console.log('🟣 No completed cues found');
      }
    } catch (error) {
      console.error('❌ Error loading completed cues from API:', error);
      console.log('💡 This means the completed_cues table or functions need to be created first');
      console.log('📋 Please check your Neon database setup');
    }
  };

  // Load indented cues from API
  const loadIndentedCuesFromAPI = async () => {
    if (!event?.id) return;

    try {
      console.log('🟠 Loading indented cues from API for event:', event.id);
      const indentedCuesData = await DatabaseService.getIndentedCues(event.id);
      
      if (indentedCuesData && indentedCuesData.length > 0) {
        console.log('🟠 Found indented cues:', indentedCuesData);
        
        // Convert the database data to indentedCues state format
        const indentedCuesMap: Record<number, { parentId: number; userId: string; userName: string }> = {};
        indentedCuesData.forEach((cue: any) => {
          if (cue.item_id && cue.parent_item_id) {
            indentedCuesMap[cue.item_id] = {
              parentId: cue.parent_item_id,
              userId: cue.user_id || '',
              userName: cue.user_name || ''
            };
          }
        });
        
        setIndentedCues(indentedCuesMap);
        console.log('🟠 Set indentedCues state:', indentedCuesMap);
      } else {
        console.log('🟠 No indented cues found');
        setIndentedCues({});
      }
    } catch (error) {
      console.error('❌ Error loading indented cues from API:', error);
      console.log('💡 This means the indented_cues table or functions need to be created first');
      console.log('📋 Please check your Neon database setup');
    }
  };

  // Find the parent cue for indenting (look up until we find a non-indented item)
  const findParentCue = (itemId: number): number | null => {
    const currentIndex = schedule.findIndex(item => item.id === itemId);
    if (currentIndex === -1) return null;
    
    // Look backwards through the schedule to find the first non-indented item
    for (let i = currentIndex - 1; i >= 0; i--) {
      const candidateParent = schedule[i];
      if (!indentedCues[candidateParent.id]) {
        return candidateParent.id;
      }
    }
    
    return null; // No parent found
  };

  // Toggle indented status for a cue
  const toggleIndentedCue = async (itemId: number) => {
    if (!event?.id || !user?.id) return;
    
    try {
      if (indentedCues[itemId]) {
        // Currently indented - remove it
        console.log('🟠 Removing indented status for item:', itemId);
        const success = await DatabaseService.unmarkCueIndented(event.id, itemId);
        if (success) {
          setIndentedCues(prev => {
            const newState = { ...prev };
            delete newState[itemId];
            return newState;
          });
          console.log('✅ Successfully removed indented status');
        }
      } else {
        // Not indented - add it with parent relationship
        const parentId = findParentCue(itemId);
        if (!parentId) {
          console.log('❌ No parent cue found for item:', itemId);
          return;
        }
        
        console.log('🟠 Adding indented status for item:', itemId, 'with parent:', parentId);
        const success = await DatabaseService.markCueIndented(
          event.id, 
          itemId, 
          parentId, 
          user.id, 
          user.name || 'Unknown User', 
          currentUserRole || 'VIEWER'
        );
        
        if (success) {
          setIndentedCues(prev => ({
            ...prev,
            [itemId]: {
              parentId: parentId,
              userId: user.id,
              userName: user.name || 'Unknown User'
            }
          }));
          console.log('✅ Successfully added indented status');
        }
      }
    } catch (error) {
      console.error('❌ Error toggling indented status:', error);
    }
  };

  // Simple countdown sync for Browser B - only updates timerProgress, doesn't touch top text
  const startCountdownSync = useCallback(() => {
    if (!event?.id) return;
    
    console.log('🔄 Starting countdown sync for Browser B');
    
    const syncInterval = setInterval(async () => {
      try {
        const activeTimer = await DatabaseService.getActiveTimer(event.id);
        if (activeTimer && activeTimer.timer_state === 'running' && activeTimer.started_at) {
          // Only update the countdown, don't touch other states
          // Additional safety check: ensure we have valid data before updating
          if (activeTimer.elapsed_seconds !== undefined && activeTimer.duration_seconds !== undefined) {
            setTimerProgress(prev => ({
              ...prev,
              [activeTimer.item_id]: {
                elapsed: activeTimer.elapsed_seconds,
                total: activeTimer.duration_seconds,
                startedAt: new Date(activeTimer.started_at)
              }
            }));
          }
        }
      } catch (error) {
        console.warn('⚠️ Failed to sync countdown from server:', error);
      }
    }, 1000);
    
    return syncInterval;
  }, [event?.id]);

  // Start countdown sync for Browser B - only updates countdown, not top text
  // DISABLED: Polling causes excessive API calls - using WebSocket instead
  useEffect(() => {
    if (!event?.id || !user?.id) return;
    
    // DISABLED: Polling causes excessive API calls
    // console.log('🔄 Starting countdown sync for Browser B');
    return;
    
    const syncInterval = setInterval(async () => {
      try {
        const activeTimer = await DatabaseService.getActiveTimer(event.id);
        if (activeTimer) {
          // Skip if this timer was started by the current user
          if (activeTimer.user_id === user.id) {
            console.log('⏭️ Skipping countdown sync - timer started by current user');
            return;
          }
          
          console.log('🔄 Browser B: Syncing timer from server:', {
            itemId: activeTimer.item_id,
            state: activeTimer.timer_state,
            elapsed: activeTimer.elapsed_seconds,
            total: activeTimer.duration_seconds,
            startedAt: activeTimer.started_at,
            userId: activeTimer.user_id,
            currentUserId: user.id
          });
          
          // Update timer progress for both loaded and running states
          setTimerProgress(prev => {
            const currentProgress = prev[activeTimer.item_id];
            
            // For running state, use server elapsed time and start local countdown
            if (activeTimer.timer_state === 'running' && activeTimer.started_at) {
              return {
                ...prev,
                [activeTimer.item_id]: {
                  elapsed: activeTimer.elapsed_seconds,
                  total: activeTimer.duration_seconds,
                  startedAt: new Date(activeTimer.started_at)
                }
              };
            } else {
              // For loaded state, use 0 elapsed
              return {
                ...prev,
                [activeTimer.item_id]: {
                  elapsed: 0,
                  total: activeTimer.duration_seconds,
                  startedAt: null
                }
              };
            }
          });

          // Timer monitoring removed - using WebSocket-only approach
          // WebSocket will handle all timer updates in real-time
          if (activeTimer.timer_state === 'running' && activeTimer.started_at) {
            console.log(`🔄 Browser B: Timer ${activeTimer.item_id} is running - WebSocket will handle updates`);
          }
        } else {
          // No active timer, clear any existing timer progress
          console.log('🔄 No active timer, clearing timer progress');
          setTimerProgress({});
        }
      } catch (error) {
        console.warn('⚠️ Failed to sync countdown from server:', error);
      }
    }, 1000);
    
    return () => {
      console.log('🔄 Cleaning up countdown sync');
      clearInterval(syncInterval);
    };
  }, [event?.id, user?.id]);

  // Load active timer from API for accurate cross-client sync
  const loadActiveTimerFromAPI = async () => {
    if (!event?.id) return;

    try {
      console.log('🔄 Checking for active timer in API for event:', event.id);
      const activeTimer = await DatabaseService.getActiveTimer(event.id);
      console.log('🔄 API response:', activeTimer);
      
      // Always sync timer state regardless of who initiated it
      // This ensures all browsers show the same "LOADED" or "RUNNING" state
      
      if (activeTimer) {
        console.log('🔄 Loading timer from API:', activeTimer);
        
        // Set the active item
        setActiveItemId(activeTimer.item_id);
        setLoadedItems(prev => ({ ...prev, [activeTimer.item_id]: true }));
        
        if (activeTimer.timer_state === 'running') {
          // Timer is running - set up with server timing
          console.log('🔄 Timer is running, setting up with server timing');
          setTimerProgress(prev => ({
            ...prev,
            [activeTimer.item_id]: {
              elapsed: activeTimer.elapsed_seconds,
              total: activeTimer.duration_seconds,
              startedAt: new Date(activeTimer.started_at)
            }
          }));

          // Start local timer interval that recalculates from server time every second
          const timer = setInterval(async () => {
            try {
              const currentTimer = await DatabaseService.getActiveTimer(event.id);
              if (currentTimer && currentTimer.item_id === activeTimer.item_id) {
                  setTimerProgress(prev => ({
                    ...prev,
                    [activeTimer.item_id]: {
                      elapsed: currentTimer.elapsed_seconds,
                      total: currentTimer.duration_seconds,
                      startedAt: new Date(currentTimer.started_at)
                    }
                  }));
              }
            } catch (error) {
              console.warn('⚠️ Failed to sync timer from server:', error);
            }
          }, 1000);
          
          setActiveTimerIntervals(prev => ({ ...prev, [activeTimer.item_id]: timer }));
        } else if (activeTimer.timer_state === 'loaded') {
          // Timer is loaded but not started
          console.log('🔄 Timer is loaded but not started');
          setTimerProgress(prev => ({
            ...prev,
            [activeTimer.item_id]: {
              elapsed: 0,
              total: activeTimer.duration_seconds,
              startedAt: null
            }
          }));
          
          // Clear any running timers
          Object.keys(activeTimers).forEach(timerId => {
            if (activeTimers[parseInt(timerId)]) {
              clearInterval(activeTimerIntervals[parseInt(timerId)]);
            }
          });
          setActiveTimers({});
        }
        
        // Set dependent rows for orange highlighting
        const item = schedule.find(s => s.id === activeTimer.item_id);
        if (item) {
          const currentIndex = schedule.findIndex(scheduleItem => scheduleItem.id === activeTimer.item_id);
          const dependentIds = new Set<number>();
          if (currentIndex !== -1) {
            for (let i = currentIndex + 1; i < schedule.length; i++) {
              if (schedule[i].isIndented) {
                dependentIds.add(schedule[i].id);
              } else {
                break;
              }
            }
          }
          setLoadedCueDependents(dependentIds);
        }
        
        console.log('✅ Active timer loaded from API with accurate timing');
      } else {
        console.log('ℹ️ No active timer found in API - checking for recently completed cues');
        
        // When no active timer, check if there were recently completed cues
        // This helps Editor and Viewer roles see completed cues that were finished by other users
        let shouldClearState = true; // Default to clearing state
        
        try {
          // getRecentTimerActions removed - focusing on local functionality first
          const recentActions: any[] = [];
          if (recentActions && recentActions.length > 0) {
            console.log('🔄 Found recent timer actions:', recentActions);
            
            // Check if there was a recent LOAD_CUE action before clearing
            // This prevents clearing a cue that was just loaded locally but not yet synced to database
            const recentLoadActions = recentActions.filter(action => 
              action.action_type === 'LOAD_CUE' && 
              new Date(action.action_timestamp).getTime() > (Date.now() - 5000) // Last 5 seconds
            );
            
            console.log('🔄 Recent LOAD_CUE actions found:', recentLoadActions.length, recentLoadActions);
            
            if (recentLoadActions.length > 0) {
              console.log('ℹ️ Recent LOAD_CUE action found, keeping local state');
              shouldClearState = false;
            }
            
            // Look for STOP_TIMER actions in the last 30 seconds
            const recentStopActions = recentActions.filter(action => 
              action.action_type === 'STOP_TIMER' && 
              new Date(action.action_timestamp).getTime() > (Date.now() - 30000) // Last 30 seconds
            );
            
            if (recentStopActions.length > 0) {
              console.log('🔄 Found recent stop actions, updating completed cues:', recentStopActions);
              
              // Mark the stopped items as completed
              recentStopActions.forEach(action => {
                if (action.item_id) {
                  setCompletedCues(prev => ({ ...prev, [action.item_id]: true }));
                  setStoppedItems(prev => new Set([...prev, action.item_id]));
                  
                  // Also complete any indented items that are part of this CUE group
                  const currentIndex = schedule.findIndex(item => item.id === action.item_id);
                  if (currentIndex !== -1) {
                    // Find all indented items that follow this CUE until the next non-indented item
                    for (let i = currentIndex + 1; i < schedule.length; i++) {
                      if (schedule[i].isIndented) {
                        setCompletedCues(prev => ({ ...prev, [schedule[i].id]: true }));
                        setStoppedItems(prev => new Set([...prev, schedule[i].id]));
                      } else {
                        // Stop when we hit a non-indented item (next CUE group)
                        break;
                      }
                    }
                  }
                }
              });
            }
          }
        } catch (error) {
          console.warn('⚠️ Failed to check for recent timer actions:', error);
        }
        
        // Only clear if there was no recent LOAD_CUE action AND no active loaded item
        if (shouldClearState && !activeItemId) {
          console.log('ℹ️ No recent LOAD_CUE actions and no active item, clearing local timer state');
          setActiveItemId(null);
          setLoadedItems({});
          setTimerProgress({});
          // Don't clear dependent cues in periodic sync - they should persist until a new CUE is loaded
          // Clear any running timers
          Object.keys(activeTimers).forEach(timerId => {
            if (activeTimers[parseInt(timerId)]) {
              clearInterval(activeTimerIntervals[parseInt(timerId)]);
            }
          });
          setActiveTimers({});
        } else if (shouldClearState && activeItemId) {
          console.log('ℹ️ No recent LOAD_CUE actions but active item exists, keeping loaded state - activeItemId:', activeItemId);
        } else {
          console.log('ℹ️ Recent LOAD_CUE action found, keeping local state - activeItemId:', activeItemId);
        }
      }
    } catch (error) {
      console.error('❌ Error loading active timer from API:', error);
    }
  };

  // Load active sub-cue timer from API
  const loadActiveSubCueTimerFromAPI = async () => {
    if (!event?.id) return;

    // DISABLED: Polling causes excessive API calls
    // console.log('🟠 Polling for sub-cue timer...');
    return;

    try {
      // First check if there's any active timer
      const { data: hasActive } = await DatabaseService.hasActiveSubCueTimer(event.id);
      
      if (!hasActive) {
        console.log('🟠 No active sub-cue timer found, clearing local state');
        // Clear sub-cue timer state
        Object.keys(subCueTimers).forEach(timerId => {
          if (subCueTimers[parseInt(timerId)]) {
            clearInterval(subCueTimers[parseInt(timerId)]);
          }
        });
        setSubCueTimers({});
        setSubCueTimerProgress({});
        setSecondaryTimer(null);
        return;
      }

      // If there is an active timer, get the details
      const { data: subCueTimerData, error } = await DatabaseService.getActiveSubCueTimer(event.id);
      
      console.log('🟠 Sub-cue timer data from API:', subCueTimerData);
      
      if (error) {
        console.error('❌ Error loading sub-cue timer:', error);
        return;
      }

      if (subCueTimerData && subCueTimerData.is_active && subCueTimerData.is_running) {
        console.log('🟠 Sub-cue timer loaded:', subCueTimerData.item_id, 'Duration:', subCueTimerData.duration_seconds, 's', 'Active:', subCueTimerData.is_active, 'Running:', subCueTimerData.is_running);
        
        // Skip if this is the current user's sub-cue timer
        if (user && subCueTimerData.user_id === user.id) {
          console.log('⏭️ Skipping sub-cue sync - change made by current user');
          return;
        }
        
        // Set sync flag to prevent local timer updates during sync
        setIsSyncingSubCue(true);
        
        // Clear any existing sub-cue timers
        Object.keys(subCueTimers).forEach(timerId => {
          if (subCueTimers[parseInt(timerId)]) {
            clearInterval(subCueTimers[parseInt(timerId)]);
          }
        });
        
        // Set up sub-cue timer state
        const itemId = parseInt(subCueTimerData.item_id);
        const startedAt = new Date(subCueTimerData.started_at);
        const now = getCurrentTimeUTC();
        const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000) + 2; // Add 2 second offset for Browser B (1 second more elapsed)
        
        setSubCueTimerProgress(prev => ({
          ...prev,
          [itemId]: {
            elapsed: Math.max(0, elapsed),
            total: subCueTimerData.duration_seconds,
            startedAt: startedAt
          }
        }));
        
        // Don't start local timer for Browser B - just display the data from Supabase
        // The timer will be updated every 2 seconds via the sync interval
        console.log('🟠 Browser B: Not starting local timer, will update via 2-second sync');
        console.log('🟠 Set sub-cue timer state');
        
        // Also set secondaryTimer state for UI compatibility (top countdown)
        // For Browser B, use the elapsed time from the database, not local calculation
        const remaining = Math.max(0, subCueTimerData.duration_seconds - elapsed);
        
        console.log('🟠 Browser B timing debug:', {
          startedAt: startedAt.toISOString(),
          elapsed: elapsed,
          duration: subCueTimerData.duration_seconds,
          remaining: remaining,
          fix: 'Browser B uses database elapsed time, no local timer'
        });
        
        setSecondaryTimer({
          itemId: itemId,
          remaining: remaining,
          duration: subCueTimerData.duration_seconds,
          isActive: true,
          startedAt: startedAt,
          timerState: 'running'
        });
        console.log('🟠 Set secondaryTimer state for top UI');
        
        // Clear sync flag after sync is complete
        setTimeout(() => {
          setIsSyncingSubCue(false);
        }, 100);
      } else if (subCueTimerData && (!subCueTimerData.is_active || !subCueTimerData.is_running)) {
        console.log('🟠 Sub-cue timer found but not active or not running, clearing local state');
        // Clear sub-cue timer state
        Object.keys(subCueTimers).forEach(timerId => {
          if (subCueTimers[parseInt(timerId)]) {
            clearInterval(subCueTimers[parseInt(timerId)]);
          }
        });
        setSubCueTimers({});
        setSubCueTimerProgress({});
        setSecondaryTimer(null);
      } else {
        // No sub-cue timer found at all - clear local state
        console.log('🟠 No sub-cue timer found, clearing local state');
        Object.keys(subCueTimers).forEach(timerId => {
          if (subCueTimers[parseInt(timerId)]) {
            clearInterval(subCueTimers[parseInt(timerId)]);
          }
        });
        setSubCueTimers({});
        setSubCueTimerProgress({});
        setSecondaryTimer(null);
      }
    } catch (error) {
      console.error('❌ Error loading sub-cue timer:', error);
      // Clear sub-cue timer state on error
      Object.keys(subCueTimers).forEach(timerId => {
        if (subCueTimers[parseInt(timerId)]) {
          clearInterval(subCueTimers[parseInt(timerId)]);
        }
      });
      setSubCueTimers({});
      setSubCueTimerProgress({});
    }
  };

  // Load active sub-cue timers from API
  const loadActiveSubCueTimersFromAPI = async () => {
    if (!event?.id) return;

    try {
      const { data: subCueTimers, error } = await DatabaseService.getActiveSubCueTimers(event.id);
      
      if (error) {
        console.error('❌ Error loading sub-cue timers:', error);
        return;
      }

      if (subCueTimers && subCueTimers.length > 0) {
        console.log('🔄 Loaded sub-cue timers from API:', subCueTimers);
        console.log('🔄 Setting up sub-cue timer states...');
        
        subCueTimers.forEach(timer => {
          const itemId = timer.item_id;
          const totalSeconds = timer.duration_seconds || 0;
          
          // Set up sub-cue timer progress
          console.log(`🔄 Setting up sub-cue timer for item ${itemId}:`, {
            elapsed: timer.elapsed_seconds || 0,
            total: totalSeconds,
            startedAt: timer.started_at ? new Date(timer.started_at) : null,
            timer_state: timer.timer_state
          });
          
          setSubCueTimerProgress(prev => ({
            ...prev,
            [itemId]: {
              elapsed: timer.elapsed_seconds || 0,
              total: totalSeconds,
              startedAt: timer.started_at ? new Date(timer.started_at) : null
            }
          }));

          // If timer is running, start the local timer
          if (timer.timer_state === 'running') {
            console.log(`🔄 Starting local timer interval for sub-cue item ${itemId}`);
            // Start local timer for UI updates
            const timerInterval = setInterval(() => {
              setSubCueTimerProgress(prev => {
                if (prev[itemId] && prev[itemId].startedAt) {
                  const startedAtValue = prev[itemId].startedAt;
                  const startTime = startedAtValue instanceof Date ? startedAtValue.getTime() : new Date(startedAtValue).getTime();
                  const elapsed = Math.floor((Date.now() - startTime) / 1000);
                  return {
                    ...prev,
                    [itemId]: {
                      ...prev[itemId],
                      elapsed: elapsed
                    }
                  };
                }
                return prev;
              });
            }, 100);

            setSubCueTimers(prev => {
              console.log(`🔄 Setting sub-cue timer state for item ${itemId}`);
              return { ...prev, [itemId]: timerInterval };
            });
          } else {
            console.log(`🔄 Sub-cue timer for item ${itemId} is not running, state: ${timer.timer_state}`);
          }
        });
      }
    } catch (error) {
      console.error('❌ Error loading sub-cue timers:', error);
    }
  };


  // Test database connection and functions
  const testDatabaseConnection = async () => {
    if (!event?.id) return;

    console.log('🧪 Testing database connection...');
    
    try {
      // Test basic database connection
      const { data: testData, error: testError } = await DatabaseService.getLastLoadedCue(event.id);
      
      if (testError) {
        console.error('❌ Database test failed:', testError);
        console.log('💡 This means the SQL migration needs to be run first');
        console.log('📋 Please check your Neon database setup');
      } else {
        console.log('✅ Database connection test passed');
        console.log('📊 Test data received:', testData);
      }
    } catch (error) {
      console.error('❌ Database connection test error:', error);
    }
  };

  // Check for running timers without restoring CUE state
  const checkForRunningTimers = async () => {
    if (!event?.id) {
      console.log('⚠️ No event ID for checking running timers');
      return;
    }

    console.log('🔄 Checking for running timers for event:', event.id);

    // Since getActiveTimer is not working, let's use a simple approach
    // Check if there's any timer data in the real-time subscription
    // We'll look for any timer that has started_at (indicating it's active)
    try {
      // For now, let's just show a popup if we detect any timer activity
      // This is a temporary solution until we fix the database function
      console.log('🔄 Using fallback timer detection...');
      
      // Check if there are any active timers by looking at the real-time data
      // Since we can see timer data in the console, let's create a simple popup
      setRunningTimerInfo({
        cueName: 'Timer Detected',
        remainingTime: 'Check Console'
      });
      setShowRunningTimerPopup(true);
      
      console.log('✅ Fallback timer popup shown');
    } catch (error) {
      console.error('❌ Error checking running timers:', error);
    }
  };

  // Master sync CUE time - syncs countdown for the last loaded CUE
  const masterSyncCueTime = async () => {
    console.log('🔄 Master sync: Getting active timer from database...');
    
    if (!event?.id) {
      console.warn('⚠️ No event selected for sync');
      return;
    }

    try {
      // Get the active timer from the database
      const activeTimer = await DatabaseService.getActiveTimer(event.id);
      
      if (!activeTimer) {
        console.log('ℹ️ No active timer found in database');
        return;
      }
      
      console.log('🔄 Found active timer in database:', activeTimer);
      
      // Get current global time
      const now = getCurrentTimeUTC();
      const currentTime = Math.floor(now.getTime() / 1000); // Current time in seconds
      
      // Get start time from database (convert to seconds)
      const startTime = new Date(activeTimer.started_at);
      const startTimeSeconds = Math.floor(startTime.getTime() / 1000);
      
      // Get duration from database
      const durationSeconds = activeTimer.duration_seconds || 0;
      
      // Check if timer is actually running
      const isRunning = activeTimer.is_running;
      
      console.log('📊 Timer calculation:', {
        currentTime,
        startTimeSeconds,
        durationSeconds,
        isRunning,
        currentTimeFormatted: now.toISOString(),
        startTimeFormatted: startTime.toISOString()
      });
      
      // Set the active item and timer progress
      setActiveItemId(activeTimer.item_id);
      
      if (isRunning) {
        // Timer is running - calculate elapsed time and start countdown
        const elapsedSeconds = currentTime - startTimeSeconds;
        const remainingSeconds = durationSeconds - elapsedSeconds;
        
        console.log('🔄 Time calculation for running timer:', {
          elapsedSeconds,
          remainingSeconds,
          isOverdue: remainingSeconds < 0
        });
        
        // Set timer progress with calculated values
        setTimerProgress(prev => ({
          ...prev,
          [activeTimer.item_id]: {
            elapsed: elapsedSeconds,
            total: durationSeconds,
            startedAt: startTime
          }
        }));
        
        // Start the timer to continue counting down or up
        if (remainingSeconds !== 0) {
          if (remainingSeconds > 0) {
            console.log(`✅ Timer synced: ${remainingSeconds} seconds remaining - starting countdown`);
          } else {
            console.log(`⚠️ Timer synced: ${Math.abs(remainingSeconds)} seconds overdue - starting count up`);
          }
          
          // Clear any existing timer for this item
          if (activeTimers[activeTimer.item_id]) {
            clearInterval(activeTimerIntervals[activeTimer.item_id]);
          }
          
          // Start new timer that updates every second
          const timerInterval = setInterval(() => {
            setTimerProgress(prev => {
              const currentProgress = prev[activeTimer.item_id];
              if (!currentProgress) return prev;
              
              const newElapsed = currentProgress.elapsed + 1;
              const newRemaining = currentProgress.total - newElapsed;
              
              if (newRemaining > 0) {
                console.log(`🔄 Timer countdown: ${newRemaining} seconds remaining`);
              } else if (newRemaining === 0) {
                console.log('⏰ Timer just expired');
              } else {
                console.log(`🔄 Timer count up: ${Math.abs(newRemaining)} seconds overdue`);
              }
              
              return {
                ...prev,
                [activeTimer.item_id]: {
                  ...currentProgress,
                  elapsed: newElapsed
                }
              };
            });
          }, 1000);
          
          // Store the timer interval
          setActiveTimerIntervals(prev => ({
            ...prev,
            [activeTimer.item_id]: timerInterval
          }));
          
        } else {
          console.log('⏰ Timer just expired');
        }
      } else {
        // Timer is loaded but not running - just set the duration
        console.log('⏸️ Timer is loaded but not running - setting duration only');
        
        setTimerProgress(prev => ({
          ...prev,
          [activeTimer.item_id]: {
            elapsed: 0,
            total: durationSeconds,
            startedAt: null
          }
        }));
        
        console.log(`✅ Timer synced: Set loaded duration to ${durationSeconds} seconds`);
      }
      
    } catch (error) {
      console.error('❌ Error during master sync:', error);
    }
  };


  // Load CUE state from API (for when CUE is loaded but timer not started)
  const loadCueStateFromAPI = async (itemId: number, totalSeconds: number) => {
    if (!event?.id) return;

    try {
      console.log('🔄 Loading CUE state from API:', { itemId, totalSeconds });
      
      // Set the active item
      setActiveItemId(itemId);
      setLoadedItems(prev => ({ ...prev, [itemId]: true }));
      
      // Set timer progress without starting
      setTimerProgress(prev => ({
        ...prev,
        [itemId]: {
          elapsed: 0,
          total: totalSeconds,
          startedAt: null
        }
      }));
      
      // Clear any running timers
      Object.keys(activeTimers).forEach(timerId => {
        if (activeTimers[parseInt(timerId)]) {
          clearInterval(activeTimerIntervals[parseInt(timerId)]);
        }
      });
      setActiveTimers({});
      
      console.log('✅ CUE state loaded from API');
    } catch (error) {
      console.error('❌ Error loading CUE state from API:', error);
    }
  };

  // Backup schedule data to prevent data loss
  const backupScheduleData = async () => {
    if (!event?.id || !user?.id) return;
    
    try {
      console.log('🔄 Backing up schedule data...');
      
      // Include current settings to prevent data loss
      await DatabaseService.saveRunOfShowData({
        event_id: event.id,
        event_name: event.name,
        event_date: event.date,
        schedule_items: schedule,
        custom_columns: customColumns,
        settings: {
          eventName,
          masterStartTime,
          dayStartTimes
        }
      });
      console.log('✅ Schedule data backed up with settings');
    } catch (error) {
      console.error('❌ Error backing up schedule data:', error);
    }
  };

  // Load master change log from API
  const loadMasterChangeLog = async () => {
    if (!event?.id) {
      console.log('⚠️ No event ID for loading master change log');
      return;
    }
    
    try {
      console.log('🔄 Loading master change log for event:', event.id);
      const masterChanges = await changeLogService.getMasterChangeLog(event.id, 100);
      setMasterChangeLog(masterChanges);
      console.log('📊 Loaded master change log:', masterChanges.length, 'changes');
      
      if (masterChanges.length === 0) {
        console.log('ℹ️ No master changes found - this might be normal for new events');
      }
    } catch (error) {
      console.error('❌ Error loading master change log:', error);
      // Set empty array on error to prevent undefined state
      setMasterChangeLog([]);
    }
  };

  // Manual sync function - save schedule data to database
  const syncChanges = async () => {
    if (!event?.id || !user) {
      console.log('❌ Cannot sync - missing event ID or user');
      return;
    }

    // Skip sync if page is not visible
    if (!isPageVisible) {
      console.log('👁️ Skipping sync - page not visible');
      return;
    }

    // Skip sync if any modal is open
    if (showSpeakersModal || showNotesModal || showAssetsModal || showParticipantsModal || showBackupModal) {
      console.log('🚫 Skipping sync - modal is open');
      return;
    }

    // Skip sync if user is actively editing
    if (isUserEditing) {
      console.log('✏️ Skipping sync - user is actively editing');
      return;
    }

    try {
      console.log('🔄 Syncing schedule data to database...');
      const dataToSave = {
        event_id: event.id,
        event_name: event.name,
        event_date: event.date,
        schedule_items: schedule,
        custom_columns: customColumns,
        settings: {
          eventName: eventName,
          masterStartTime: masterStartTime,
          dayStartTimes: dayStartTimes
        }
      };

      const result = await DatabaseService.saveRunOfShowData(dataToSave, {
        userId: user.id,
        userName: user.full_name || user.email || 'Unknown User',
        userRole: currentUserRole || 'VIEWER'
      });

      if (result) {
        console.log('✅ Schedule data synced to database successfully');
        // Refresh master log using existing function
        await loadMasterChangeLog();
        console.log('🔄 Master change log refreshed after sync');
      } else {
        console.log('❌ Failed to sync schedule data to database');
      }
    } catch (error) {
      console.error('❌ Error syncing schedule data to database:', error);
    }
  };

  // Password-protected clear function
  const clearAllChangeLogs = async () => {
    const password = prompt('Enter password to clear all change logs:');
    if (password !== '1615') {
      alert('Incorrect password. Change logs not cleared.');
      return;
    }

    const confirmClear = confirm('⚠️ WARNING: This will permanently delete ALL change logs (local and master) for this event. This action cannot be undone.\n\nAre you sure you want to continue?');
    if (!confirmClear) {
      return;
    }

    try {
      // Clear local changes
      changeLogService.clearLocalChanges();
      setChangeLog([]);
      console.log('✅ Local changes cleared');
      
      // Clear master changes with detailed error handling
      if (event?.id) {
        console.log('🔄 Attempting to clear master change log for event:', event.id);
        
        // Get current user info for debugging
        console.log('🔄 Current user:', user?.id, user?.email);
        
        if (!user) {
          console.error('❌ No user found');
          alert('❌ Authentication error. Please refresh and try again.');
          return;
        }
        
        const result = await changeLogService.clearMasterChangeLog(event.id);
        console.log('🔄 Clear master result:', result);
        
        if (result.success) {
          setMasterChangeLog([]);
          console.log('✅ Master change log cleared successfully');
          alert(`✅ Successfully cleared ${result.deletedCount} master change log entries`);
          
          // Force reload to verify
          console.log('🔄 Verifying master change log is cleared...');
          const reloadedMasterLog = await changeLogService.getMasterChangeLog(event.id);
          console.log('🔄 Master change log after clearing:', reloadedMasterLog.length, 'records');
          setMasterChangeLog(reloadedMasterLog);
          
          if (reloadedMasterLog.length === 0) {
            alert(`✅ All change logs cleared successfully!\n\n- Local changes: ✅ Cleared\n- Master changes: ✅ Cleared (${result.deletedCount} records deleted)`);
          } else {
            alert(`⚠️ Partial success:\n\n- Local changes: ✅ Cleared\n- Master changes: ⚠️ ${result.deletedCount} deleted, but ${reloadedMasterLog.length} remain\n\nSome records may be protected by RLS policies.`);
          }
        } else {
          console.log('❌ Failed to clear master change log:', result.error);
          alert(`⚠️ Partial success:\n\n- Local changes: ✅ Cleared\n- Master changes: ❌ Failed\n\nError: ${result.error}\n\nThis might be due to database permissions. Check the console for details.`);
        }
      } else {
        alert('❌ Error: No event ID found. Cannot clear master change log.');
      }
    } catch (error) {
      console.error('Error clearing change logs:', error);
      alert('❌ Error clearing change logs. Check the console for details.');
    }
  };

  // Note: User activity tracking simplified - using user session tracking instead
  
  // Show toast when a timer starts and auto-close after 20 seconds
  useEffect(() => {
    console.log('🍞 Toast useEffect triggered:', {
      activeTimersCount: Object.keys(activeTimers).length,
      activeTimers,
      timeToastEnabled,
      scheduleLength: schedule.length
    });
    
    if (Object.keys(activeTimers).length === 0) {
      console.log('🍞 Toast: No active timers, hiding toast');
      setShowTimeToast(false);
      return;
    }
    
    // Only show toast if it's enabled
    if (!timeToastEnabled) {
      console.log('🍞 Toast: Toast disabled by user');
      return;
    }
    
    const activeTimerId = parseInt(Object.keys(activeTimers)[0]);
    console.log('🍞 Toast: Active timer ID:', activeTimerId);
    const activeItem = schedule.find(item => item.id === activeTimerId);
    console.log('🍞 Toast: Found active item:', activeItem ? activeItem.segmentName : 'NOT FOUND');
    
    if (activeItem) {
      try {
        const now = getCurrentTimeUTC();
        const itemIndex = schedule.findIndex(item => item.id === activeItem.id);
        const itemStartTimeStr = calculateStartTime(itemIndex);
        
        if (itemStartTimeStr) {
          // Parse the start time string (format: "1:30 PM")
          const [timePart, period] = itemStartTimeStr.split(' ');
          const [hours, minutes] = timePart.split(':').map(Number);
          let hour24 = hours;
          if (period === 'PM' && hours !== 12) hour24 += 12;
          if (period === 'AM' && hours === 12) hour24 = 0;
          
          // Create a date object for today with the calculated time in event timezone
          const today = getCurrentTimeUTC();
          const itemStartTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour24, minutes);
          
          const differenceMs = now.getTime() - itemStartTime.getTime();
          const differenceMinutes = Math.round(differenceMs / (1000 * 60));

          setTimeDifference(Math.abs(differenceMinutes));
          
          // Show toast for all timers when enabled
          if (differenceMinutes < -1) {
            console.log('🍞 Toast: Setting status to EARLY, difference:', differenceMinutes);
            setTimeStatus('early');
            setShowTimeToast(true);
          } else if (differenceMinutes > 1) {
            console.log('🍞 Toast: Setting status to LATE, difference:', differenceMinutes);
            setTimeStatus('late');
            setShowTimeToast(true);
          } else {
            console.log('🍞 Toast: Setting status to ON-TIME, difference:', differenceMinutes);
            setTimeStatus('on-time');
            setShowTimeToast(true); // Show even if on-time when timer starts
          }
          
          console.log('🍞 Toast: Should be visible now - showTimeToast set to true');
          
          // Auto-close toast after 10 seconds
          const toastTimeout = setTimeout(() => {
            console.log('🍞 Toast: Auto-closing after 10 seconds');
            setShowTimeToast(false);
          }, 10000);
          
          return () => clearTimeout(toastTimeout);
        }
      } catch (error) {
        console.error('🍞 Toast: Error calculating time status:', error);
        setShowTimeToast(false);
      }
    }
  }, [activeTimers, schedule, timeToastEnabled]);
  
  // Auto-scroll to active row function
  const scrollToActiveRow = () => {
    if (!isFollowEnabled) return;
    
    const activeRow = document.querySelector(`[data-item-id="${activeItemId}"]`);
    if (activeRow) {
      // Use a more consistent calculation method
      // Calculate the row's position relative to the document, not the viewport
      const rowRect = activeRow.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const rowTop = rowRect.top + scrollTop;
      
      // Find the column headers to calculate offset
      const columnHeaders = document.querySelector('#main-scroll-container .h-24');
      let headerHeight = 100; // Default fallback
      
      if (columnHeaders) {
        const headerRect = columnHeaders.getBoundingClientRect();
        headerHeight = headerRect.height + 20; // Add small gap
      }
      
      // Calculate consistent scroll position - bring it up more
      // Add extra offset to position the row higher on screen
      const extraOffset = 230; // Bring the end point down significantly (250 - 20)
      const targetScrollPosition = rowTop - headerHeight - extraOffset;
      
      // Scroll to the calculated position
      window.scrollTo({
        top: Math.max(0, targetScrollPosition), // Don't scroll above the top
        behavior: 'smooth'
      });
      
      // Note: Follow feature now handles its own scrolling via useEffect
    }
  };
  
  const [modalForm, setModalForm] = useState({
    cue: '',
    day: 1,
    programType: 'PreShow/End',
    shotType: '',
    segmentName: '',
    durationHours: 0,
    durationMinutes: 0,
    durationSeconds: 0,
    notes: '',
    assets: '',
    speakers: '',
    speakersText: '',
    hasPPT: false,
    hasQA: false,
    timerId: '',
    isPublic: false,
    isIndented: false,
    customFields: {}
  });

  // Update modal form day when selectedDay changes
  useEffect(() => {
    setModalForm(prev => ({ ...prev, day: selectedDay }));
  }, [selectedDay]);

  const programTypes = [
    'PreShow/End', 'Podium Transition', 'Panel Transition', 'Sub Cue',
    'No Transition', 'Video', 'Panel+Remote', 'Remote Only', 'Break', 'TBD', 'KILLED'
  ];

  // Program Type color mapping
  const programTypeColors: { [key: string]: string } = {
    'PreShow/End': '#8B5CF6',        // Bright Purple
    'Podium Transition': '#8B4513',  // Dark Brown
    'Panel Transition': '#404040',   // Darker Grey
    'Sub Cue': '#F3F4F6',           // White with border
    'No Transition': '#059669',      // Bright Teal
    'Video': '#F59E0B',              // Bright Yellow/Orange
    'Panel+Remote': '#1E40AF',       // Darker Blue
    'Remote Only': '#60A5FA',        // Light Blue
    'Break': '#EC4899',              // Bright Pink
    'TBD': '#6B7280',                // Medium Gray
    'KILLED': '#DC2626'              // Bright Red
  };

  // Function to get subtle row background color based on Program Type
  const getRowBackgroundColor = (programType: string, index: number) => {
    const baseColor = programTypeColors[programType];
    if (!baseColor) {
      // Default alternating colors if no program type color
      return index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
    }

    // Convert hex to RGB and add opacity
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Create brighter, more defined background with 30% opacity
    return `rgba(${r}, ${g}, ${b}, 0.3)`;
  };

  // Enhanced function to calculate dynamic row height based on ALL content
  const getRowHeight = (notes: string, speakersText?: string, participants?: string, customFields?: any, customColumns?: any[]) => {
    let maxHeight = 6.5; // Default minimum height in rem
    
    // Calculate height based on notes content
    if (notes && notes.trim() !== '') {
      const tempDiv = document.createElement('div');
      tempDiv.style.position = 'absolute';
      tempDiv.style.visibility = 'hidden';
      // Use actual column width minus padding and borders
      const columnWidthPx = columnWidths.notes;
      const paddingPx = 32; // 0.75rem * 2 (left + right) = 1.5rem = 24px, but using 32px for safety
      const borderPx = 1; // border-r border-slate-600
      const availableWidthPx = columnWidthPx - paddingPx - borderPx;
      const availableWidthRem = availableWidthPx / 16; // Convert px to rem
      tempDiv.style.width = `${availableWidthRem}rem`;
      tempDiv.style.padding = '0.75rem';
      tempDiv.style.fontSize = '1rem';
      tempDiv.style.lineHeight = '1.5';
      tempDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif';
      tempDiv.style.whiteSpace = 'pre-wrap';
      tempDiv.style.wordWrap = 'break-word';
      tempDiv.innerHTML = notes;
      
      document.body.appendChild(tempDiv);
      const contentHeight = tempDiv.scrollHeight;
      document.body.removeChild(tempDiv);
      
      const contentHeightRem = contentHeight / 16;
      const paddingRem = 3; // Increased from 2 to add more bottom gap
      const notesHeight = contentHeightRem + paddingRem;
      maxHeight = Math.max(maxHeight, notesHeight);
    }
    
    // Calculate height based on participants (JSON data)
    if (participants && participants.trim() !== '') {
      try {
        const parsedSpeakers = JSON.parse(participants);
        if (Array.isArray(parsedSpeakers) && parsedSpeakers.length > 0) {
          const validSpeakers = parsedSpeakers.filter(speaker => 
            speaker.fullName && speaker.fullName.trim() !== ''
          );
          
          if (validSpeakers.length > 0) {
          const baseParticipantsHeight = 4; // Increased from 3.5
          const heightPerSpeaker = 1.5; // Increased from 1.4
          const participantsHeight = baseParticipantsHeight + (validSpeakers.length * heightPerSpeaker);
          
          maxHeight = Math.max(maxHeight, participantsHeight);
          }
        }
      } catch (e) {
        // If JSON parsing fails, try to parse as simple text (fallback)
        if (participants.includes('\n')) {
          const lines = participants.split('\n').filter(line => line.trim() !== '');
          const textParticipantsHeight = 4 + (lines.length * 1.5); // Updated values
          maxHeight = Math.max(maxHeight, textParticipantsHeight);
        }
      }
    }
    
    // Calculate height based on speakers (JSON data)
    if (speakersText && speakersText.trim() !== '') {
      try {
        const parsedSpeakers = JSON.parse(speakersText);
        if (Array.isArray(parsedSpeakers) && parsedSpeakers.length > 0) {
          const validSpeakers = parsedSpeakers.filter(speaker => 
            speaker.fullName && speaker.fullName.trim() !== ''
          );
          
        if (validSpeakers.length > 0) {
            const baseSpeakersHeight = 4; // Same as participants
            const heightPerSpeaker = 1.5; // Same as participants
            const speakersHeight = baseSpeakersHeight + (validSpeakers.length * heightPerSpeaker);
            
            maxHeight = Math.max(maxHeight, speakersHeight);
        }
        }
      } catch (e) {
        // If JSON parsing fails, try to parse as simple text (fallback)
        if (speakersText.includes('\n')) {
          const lines = speakersText.split('\n').filter(line => line.trim() !== '');
          const textSpeakersHeight = 4 + (lines.length * 1.5); // Same as participants
          maxHeight = Math.max(maxHeight, textSpeakersHeight);
        }
      }
    }
    
    // Calculate height based on custom columns
    if (customFields && customColumns && customColumns.length > 0) {
      customColumns.forEach(column => {
        const customValue = customFields[column.name];
        if (customValue && customValue.trim() !== '') {
          const lines = customValue.split('\n');
          const lineCount = Math.max(2, lines.length);
          
          const baseCustomHeight = 3; // Increased from 2.5
          const heightPerLine = 1.6; // Increased from 1.5 for better line spacing
          const bottomPadding = 1; // Additional bottom padding
          const customHeight = baseCustomHeight + (lineCount * heightPerLine) + bottomPadding;
          
          maxHeight = Math.max(maxHeight, customHeight);
        }
      });
    }
    
    return `${maxHeight}rem`;
  };

  // Function to measure actual rendered notes content and position container 15px below last line
  const getCompactNotesHeight = (notes: string) => {
    if (!notes || notes.trim() === '') return '4.5rem';
    
    // Create a temporary element that matches the exact rendering conditions
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    // Use actual column width minus padding and borders for the notes field
    const columnWidthPx = columnWidths.notes;
    const fieldPaddingPx = 24; // 0.5rem * 2 (left + right) = 1rem = 16px, but using 24px for safety
    const fieldBorderPx = 2; // border border-slate-600 (1px on each side)
    const availableWidthPx = columnWidthPx - fieldPaddingPx - fieldBorderPx;
    const availableWidthRem = availableWidthPx / 16; // Convert px to rem
    tempDiv.style.width = `${availableWidthRem}rem`;
    tempDiv.style.padding = '0.5rem';
    tempDiv.style.fontSize = '1rem';
    tempDiv.style.lineHeight = '1.4';
    tempDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    tempDiv.style.whiteSpace = 'pre-wrap';
    tempDiv.style.wordWrap = 'break-word';
    tempDiv.style.overflow = 'hidden';
    tempDiv.innerHTML = notes;
    
    document.body.appendChild(tempDiv);
    
    // Get the actual rendered height
    const contentHeight = tempDiv.scrollHeight;
    document.body.removeChild(tempDiv);
    
    // Convert to rem and add 5px (0.3125rem) below the last line
    const contentHeightRem = contentHeight / 16;
    const extraPaddingRem = 0.3125; // 5px in rem
    const basePaddingRem = 1; // Base padding for the container
    
    const totalHeight = contentHeightRem + basePaddingRem + extraPaddingRem;
    const minHeightRem = 4.5;
    
    return `${Math.max(minHeightRem, totalHeight)}rem`;
  };

  // Function to calculate participants field height with better spacing
  const getParticipantsHeight = (speakers: string, displayFunction?: Function) => {
    if (!speakers || speakers.trim() === '') return '3.5rem'; // Increased from 3rem
    
    let lineCount = 1;
    
    try {
      const parsedSpeakers = JSON.parse(speakers);
      if (Array.isArray(parsedSpeakers)) {
        const validSpeakers = parsedSpeakers.filter(speaker => 
          speaker.fullName && speaker.fullName.trim() !== ''
        );
        lineCount = Math.max(1, validSpeakers.length);
      }
    } catch (e) {
      lineCount = Math.max(1, speakers.split('\n').filter(line => line.trim() !== '').length);
    }
    
    const baseHeight = 3; // Increased from 2.5
    const heightPerLine = 1.5; // Increased from 1.4
    const totalHeight = baseHeight + ((lineCount - 1) * heightPerLine);
    
    return `${Math.max(3.5, totalHeight)}rem`; // Increased minimum
  };

  // Function to calculate speakers field height with better spacing
  const getSpeakersHeight = (speakersText: string) => {
    if (!speakersText || speakersText.trim() === '') return '3.5rem';
    
    let lineCount = 1;
    
    try {
      const parsedSpeakers = JSON.parse(speakersText);
      if (Array.isArray(parsedSpeakers)) {
        const validSpeakers = parsedSpeakers.filter(speaker => 
          speaker.fullName && speaker.fullName.trim() !== ''
        );
        lineCount = Math.max(1, validSpeakers.length);
      }
    } catch (e) {
      lineCount = Math.max(1, speakersText.split('\n').filter(line => line.trim() !== '').length);
    }
    
    const baseHeight = 3; // Same as participants
    const heightPerLine = 1.5; // Same as participants
    const totalHeight = baseHeight + ((lineCount - 1) * heightPerLine);
    
    return `${Math.max(3.5, totalHeight)}rem`; // Same minimum as participants
  };

  // Enhanced function to calculate custom field height with no scrollbars and full expansion
  const getCustomFieldHeight = (value: string) => {
    if (!value || value.trim() === '') return '4.5rem'; // Increased from 4rem
    
    const lines = value.split('\n');
    const lineCount = Math.max(2, lines.length);
    
    // Calculate height more accurately to prevent scrollbars
    const baseHeight = 3; // Increased from 2.5
    const heightPerLine = 1.6; // Increased for better line spacing
    const bottomPadding = 1; // Extra bottom padding
    const totalHeight = baseHeight + (lineCount * heightPerLine) + bottomPadding;
    
    return `${Math.max(4.5, totalHeight)}rem`; // Increased minimum
  };

  // Function to calculate compact height for main Notes field
  const getCompactNotesHeightOld = (notes: string) => {
    if (!notes || notes.trim() === '') return '4.5rem';
    
    // Create a temporary element to measure the actual rendered height
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.width = '20rem'; // Slightly smaller for compact view
    tempDiv.style.padding = '0.5rem'; // Match py-2 px-3
    tempDiv.style.fontSize = '1rem'; // Match text-base
    tempDiv.style.lineHeight = '1.4'; // Slightly tighter line height
    tempDiv.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    tempDiv.style.whiteSpace = 'pre-wrap';
    tempDiv.style.wordWrap = 'break-word';
    tempDiv.innerHTML = notes;
    
    document.body.appendChild(tempDiv);
    const contentHeight = tempDiv.scrollHeight;
    document.body.removeChild(tempDiv);
    
    // Convert px to rem (assuming 16px = 1rem)
    const contentHeightRem = contentHeight / 16;
    
    // Add padding and minimum height
    const paddingRem = 1.5; // Top and bottom padding
    const minHeightRem = 4.5;
    const totalHeight = contentHeightRem + paddingRem;
    
    return `${Math.max(minHeightRem, totalHeight)}rem`;
  };

  // Function to clean HTML content and handle line breaks
  const cleanHtmlContent = (html: string) => {
    return html
      .replace(/<div>/g, '<br>')
      .replace(/<\/div>/g, '')
      .replace(/<br><br>/g, '<br>')
      .replace(/^<br>/, '')
      .replace(/<br>$/, '');
  };

  // Function to calculate total run time (TRT) from schedule items for the selected day
  const calculateTotalRunTime = (): { hours: number; minutes: number; seconds: number; totalSeconds: number } => {
    let totalSeconds = 0;
    
    schedule.forEach(item => {
      // Only count non-indented items (main items, not sub-items) for the selected day
      if (!indentedCues[item.id] && (item.day || 1) === selectedDay) {
        totalSeconds += (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0);
      }
    });
    
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return { hours, minutes, seconds, totalSeconds };
  };

  // Function to strip HTML tags and get plain text
  const stripHtml = (html: string) => {
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.textContent || temp.innerText || '';
  };

  // Insert list function using modern methods
  const insertList = (listType: 'ul' | 'ol') => {
    const editor = document.getElementById('notes-editor');
    if (!editor) return;
    
    editor.focus();
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    // Create list element
    const list = document.createElement(listType);
    const listItem = document.createElement('li');
    listItem.textContent = selectedText || 'List item';
    list.appendChild(listItem);
    
    // Insert the list
    range.deleteContents();
    range.insertNode(list);
    
    // Position cursor after the list item
    const newRange = document.createRange();
    newRange.setStartAfter(listItem);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
  };

  // Enhanced formatting function that works with contentEditable
  const applyFormatting = (format: string, value?: string) => {
    const editor = document.getElementById('notes-editor');
    if (!editor) return;
    
    editor.focus();
    
    try {
      switch (format) {
        case 'bold':
          document.execCommand('bold', false);
          break;
        case 'italic':
          document.execCommand('italic', false);
          break;
        case 'underline':
          document.execCommand('underline', false);
          break;
        case 'color':
          if (value) {
            document.execCommand('foreColor', false, value);
          }
          break;
        case 'highlight':
          if (value && value !== 'none') {
            document.execCommand('backColor', false, value);
          } else {
            document.execCommand('removeFormat', false);
          }
          break;
        case 'fontSize':
          if (value) {
            document.execCommand('fontSize', false, value);
          }
          break;
        case 'bullet':
          insertList('ul');
          break;
        case 'list':
          insertList('ol');
          break;
        case 'left':
          document.execCommand('justifyLeft', false);
          break;
        case 'center':
          document.execCommand('justifyCenter', false);
          break;
        case 'right':
          document.execCommand('justifyRight', false);
          break;
        case 'undo':
          document.execCommand('undo', false);
          break;
        case 'redo':
          document.execCommand('redo', false);
          break;
      }
    } catch (error) {
      console.warn('Formatting command not supported:', format);
    }
  };

  // Save function
  const saveNotes = () => {
    const editor = document.getElementById('notes-editor');
    if (editor && editingNotesItem !== null) {
      const content = editor.innerHTML;
      
      if (editingNotesItem === -1) {
        // Save to modal form
        setModalForm(prev => ({ ...prev, notes: content }));
      } else {
        // Save to existing schedule item
        const oldValue = schedule.find(item => item.id === editingNotesItem)?.notes || '';
        const item = schedule.find(item => item.id === editingNotesItem);
        setSchedule(prev => prev.map(scheduleItem => 
          scheduleItem.id === editingNotesItem 
            ? { ...scheduleItem, notes: content }
            : scheduleItem
        ));
        
        // Log the change
        if (item) {
          logChange('FIELD_UPDATE', `Updated notes for "${item.segmentName}"`, {
            changeType: 'FIELD_CHANGE',
            itemId: item.id,
            itemName: item.segmentName,
            fieldName: 'notes',
            oldValue: oldValue,
            newValue: content,
            details: {
              fieldType: 'text',
              characterChange: content.length - oldValue.length
            }
          });
        }
        
      }
      
      setShowNotesModal(false);
      setEditingNotesItem(null);
      handleModalClosed();
    }
  };

  // Save speakers function
  const saveSpeakers = () => {
    if (editingSpeakersItem !== null) {
      const speakersJson = JSON.stringify(tempSpeakersText);
      
      if (editingSpeakersItem === -1) {
        // Save to modal form
        setModalForm(prev => ({ ...prev, speakersText: speakersJson }));
      } else {
        // Save to existing schedule item
        const oldValue = schedule.find(item => item.id === editingSpeakersItem)?.speakersText || '';
        const item = schedule.find(item => item.id === editingSpeakersItem);
        setSchedule(prev => prev.map(scheduleItem => 
          scheduleItem.id === editingSpeakersItem 
            ? { ...scheduleItem, speakersText: speakersJson }
            : scheduleItem
        ));
        
        // Log the change
        if (item) {
          logChange('FIELD_UPDATE', `Updated speakers for "${item.segmentName}"`, {
            changeType: 'FIELD_CHANGE',
            itemId: item.id,
            itemName: item.segmentName,
            fieldName: 'speakers',
            oldValue: oldValue,
            newValue: speakersJson,
            details: {
              fieldType: 'speakers',
              speakerCount: tempSpeakersText.length,
              characterChange: speakersJson.length - oldValue.length
            }
          });
        }
      }
      
      setShowSpeakersModal(false);
      setEditingSpeakersItem(null);
      handleModalClosed();
    }
  };

  // Save assets function
  const saveAssets = () => {
    if (editingAssetsItem !== null) {
      const assetsContainer = document.getElementById('assets-list');
      if (assetsContainer) {
        const assetItems = assetsContainer.querySelectorAll('.asset-item');
        const assetsArray: string[] = [];
        
        assetItems.forEach(item => {
          const nameInput = item.querySelector('.asset-name') as HTMLInputElement;
          const linkInput = item.querySelector('.asset-link') as HTMLInputElement;
          
          if (nameInput && linkInput) {
            const name = nameInput.value.trim();
            const link = linkInput.value.trim();
            
            if (name) {
              // Store as "Name" or "Name|Link" if link exists
              assetsArray.push(link ? `${name}|${link}` : name);
            }
          }
        });
        
        const assetsString = assetsArray.join('||');
        
        if (editingAssetsItem === -1) {
          // Save to modal form
          setModalForm(prev => ({ ...prev, assets: assetsString }));
        } else {
          // Save to existing schedule item
          const oldValue = schedule.find(item => item.id === editingAssetsItem)?.assets || '';
          const item = schedule.find(item => item.id === editingAssetsItem);
          setSchedule(prev => prev.map(scheduleItem => 
            scheduleItem.id === editingAssetsItem 
              ? { 
                  ...scheduleItem, 
                  assets: assetsString
                }
              : scheduleItem
          ));
          
          // Log the change
          if (item) {
            logChange('FIELD_UPDATE', `Updated assets for "${item.segmentName}"`, {
              changeType: 'FIELD_CHANGE',
              itemId: item.id,
              itemName: item.segmentName,
              fieldName: 'assets',
              oldValue: oldValue,
              newValue: assetsString,
              details: {
                fieldType: 'assets',
                assetCount: assetsArray.length,
                characterChange: assetsString.length - oldValue.length
              }
            });
          }
        }
        
        setShowAssetsModal(false);
        setEditingAssetsItem(null);
        handleModalClosed();
      }
    }
  };

  // Add new asset row
  const addAssetRow = () => {
    const assetsContainer = document.getElementById('assets-list');
    if (assetsContainer) {
      const assetItem = document.createElement('div');
      assetItem.className = 'asset-item p-3 bg-slate-700 rounded-lg space-y-3';
      assetItem.innerHTML = `
        <div class="flex gap-3 items-center">
          <input type="text" class="asset-name flex-1 px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500" placeholder="Asset name..." />
          <button type="button" class="toggle-link px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors text-sm">
            + Link
          </button>
          <button type="button" class="remove-asset px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition-colors">Remove</button>
        </div>
        <div class="asset-link-container hidden">
          <input type="url" class="asset-link w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500" placeholder="Enter asset URL..." />
        </div>
      `;
      
      // Add toggle link functionality
      const toggleBtn = assetItem.querySelector('.toggle-link');
      const linkContainer = assetItem.querySelector('.asset-link-container');
      const linkInput = assetItem.querySelector('.asset-link') as HTMLInputElement;
      
      toggleBtn?.addEventListener('click', () => {
        if (linkContainer?.classList.contains('hidden')) {
          linkContainer.classList.remove('hidden');
          toggleBtn.textContent = '− Link';
          toggleBtn.classList.remove('bg-blue-600', 'hover:bg-blue-500');
          toggleBtn.classList.add('bg-slate-600', 'hover:bg-slate-500');
          linkInput?.focus();
        } else {
          linkContainer?.classList.add('hidden');
          toggleBtn.textContent = '+ Link';
          toggleBtn.classList.remove('bg-slate-600', 'hover:bg-slate-500');
          toggleBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
          if (linkInput) linkInput.value = '';
        }
      });
      
      // Add remove functionality
      const removeBtn = assetItem.querySelector('.remove-asset');
      removeBtn?.addEventListener('click', () => {
        assetItem.remove();
      });
      
      assetsContainer.appendChild(assetItem);
    }
  };

  // Add new speaker
  const addSpeaker = () => {
    if (tempSpeakers.length >= 7) return;
    
    const usedSlots = tempSpeakers.map(s => s.slot);
    const nextSlot = [1, 2, 3, 4, 5, 6, 7].find(slot => !usedSlots.includes(slot)) || 1;
    
    const newSpeaker: Speaker = {
      id: `speaker_${Date.now()}`,
      slot: nextSlot,
      location: 'Podium',
      fullName: '',
      title: '',
      org: '',
      photoLink: ''
    };
    
    setTempSpeakers(prev => [...prev, newSpeaker].sort((a, b) => a.slot - b.slot));
  };

  // Remove speaker
  const removeSpeaker = (speakerId: string) => {
    setTempSpeakers(prev => prev.filter(s => s.id !== speakerId));
  };

  // Update speaker field
  const updateSpeaker = (speakerId: string, field: keyof Speaker, value: any) => {
    setTempSpeakers(prev => 
      prev.map(speaker => 
        speaker.id === speakerId 
          ? { ...speaker, [field]: value }
          : speaker
      ).sort((a, b) => a.slot - b.slot)
    );
  };

  // Save participants
  const saveParticipants = () => {
    if (editingParticipantsItem !== null) {
      const speakersJson = JSON.stringify(tempSpeakers);
      
      if (editingParticipantsItem === -1) {
        // Save to modal form
        setModalForm(prev => ({ ...prev, speakers: speakersJson }));
      } else {
        // Save to existing schedule item
        setSchedule(prev => prev.map(scheduleItem => 
          scheduleItem.id === editingParticipantsItem 
            ? { ...scheduleItem, speakers: speakersJson }
            : scheduleItem
        ));
      }
      
      setShowParticipantsModal(false);
      setEditingParticipantsItem(null);
    }
  };

  // Get available slots for dropdown
  const getAvailableSlots = (currentSpeakerId: string) => {
    const usedSlots = tempSpeakers
      .filter(s => s.id !== currentSpeakerId)
      .map(s => s.slot);
    return [1, 2, 3, 4, 5, 6, 7].filter(slot => !usedSlots.includes(slot));
  };

  // Helper functions for speakers text management
  const addSpeakerText = () => {
    if (tempSpeakersText.length >= 7) return;
    
    const usedSlots = tempSpeakersText.map(s => s.slot);
    const nextSlot = [1, 2, 3, 4, 5, 6, 7].find(slot => !usedSlots.includes(slot)) || 1;
    
    const newSpeaker: Speaker = {
      id: Date.now().toString(),
      fullName: '',
      location: 'Podium',
      slot: nextSlot,
      title: '',
      org: '',
      photoLink: ''
    };
    setTempSpeakersText(prev => [...prev, newSpeaker]);
  };

  const removeSpeakerText = (speakerId: string) => {
    setTempSpeakersText(prev => prev.filter(speaker => speaker.id !== speakerId));
  };

  const updateSpeakerText = (speakerId: string, field: keyof Speaker, value: any) => {
    setTempSpeakersText(prev => prev.map(speaker => 
      speaker.id === speakerId 
        ? { ...speaker, [field]: value }
        : speaker
    ));
  };

  const updateSpeakerTextSlot = (speakerId: string, newSlot: number) => {
    // Check if slot is already taken
    const isSlotTaken = tempSpeakersText.some(s => s.id !== speakerId && s.slot === newSlot);
    
    if (isSlotTaken) {
      // Swap slots with the speaker who has that slot
      const speakerWithSlot = tempSpeakersText.find(s => s.id !== speakerId && s.slot === newSlot);
      if (speakerWithSlot) {
        const currentSpeaker = tempSpeakersText.find(s => s.id === speakerId);
        if (currentSpeaker) {
          updateSpeakerText(speakerWithSlot.id, 'slot', currentSpeaker.slot);
        }
      }
    }
    
    // Just update the current speaker's slot
    updateSpeakerText(speakerId, 'slot', newSlot);
  };

  // Get available slots for speakers text dropdown
  const getAvailableSlotsText = (currentSpeakerId: string) => {
    const usedSlots = tempSpeakersText
      .filter(s => s.id !== currentSpeakerId)
      .map(s => s.slot);
    return [1, 2, 3, 4, 5, 6, 7].filter(slot => !usedSlots.includes(slot));
  };

  // Handle slot number change with swapping logic
  const handleSlotChange = (speakerId: string, newSlot: number) => {
    const currentSpeaker = tempSpeakers.find(s => s.id === speakerId);
    if (!currentSpeaker) return;

    // Check if the new slot is already taken
    const existingSpeaker = tempSpeakers.find(s => s.id !== speakerId && s.slot === newSlot);
    
    if (existingSpeaker) {
      // Swap the slot numbers
      const newSpeakers = tempSpeakers.map(speaker => {
        if (speaker.id === speakerId) {
          return { ...speaker, slot: newSlot };
        } else if (speaker.id === existingSpeaker.id) {
          return { ...speaker, slot: currentSpeaker.slot };
        }
        return speaker;
      });
      setTempSpeakers(newSpeakers);
    } else {
      // Just update the current speaker's slot
      updateSpeaker(speakerId, 'slot', newSlot);
    }
  };

  // Helper function to display speakers in your main schedule view
  const displaySpeakers = (speakersJson: string) => {
    if (!speakersJson) return 'Click to add participants...';
    
    try {
      const speakers = JSON.parse(speakersJson);
      if (!Array.isArray(speakers) || speakers.length === 0) {
        return 'Click to add participants...';
      }
      
      return speakers
        .sort((a, b) => a.slot - b.slot)
        .map(speaker => {
          const location = speaker.location === 'Podium' ? 'P' : 
                          speaker.location === 'Seat' ? 'S' : 
                          speaker.location === 'Virtual' ? 'V' : 'M';
          return `${location}${speaker.slot} - ${speaker.fullName || 'Unnamed'}`;
        })
        .join('\n');
    } catch {
      return 'Click to add participants...';
    }
  };

  // Helper function to display speakers text in your main schedule view
  const displaySpeakersText = (speakersTextJson: string) => {
    if (!speakersTextJson) return 'Click to add speakers...';
    
    try {
      const speakers = JSON.parse(speakersTextJson);
      if (!Array.isArray(speakers) || speakers.length === 0) {
        return 'Click to add speakers...';
      }
      
      return speakers
        .sort((a, b) => a.slot - b.slot)
        .filter(speaker => speaker.fullName && speaker.fullName.trim() !== '')
        .map(speaker => {
          const location = speaker.location === 'Podium' ? 'P' : 
                          speaker.location === 'Seat' ? 'S' : 
                          speaker.location === 'Virtual' ? 'V' : 'M';
          return `${location}${speaker.slot} - ${speaker.fullName || 'Unnamed'}`;
        })
        .join('\n');
    } catch (e) {
      return 'Click to add speakers...';
    }
  };

  // Function to limit and display participants (max 7 items)
  const limitDisplaySpeakers = (speakers: string, displayFunction: Function) => {
    if (!speakers || speakers.trim() === '') return '';
    
    const displayText = displayFunction(speakers);
    
    // If it's a multi-line format, limit to 7 lines
    if (displayText.includes('\n')) {
      const lines = displayText.split('\n').filter(line => line.trim() !== '');
      if (lines.length > 7) {
        return lines.slice(0, 7).join('\n') + '\n... and ' + (lines.length - 7) + ' more';
      }
    }
    
    return displayText;
  };


  const shotTypes = [
    'Podium', '2-Shot', '3-Shot', '4-Shot', '5-Shot', '6-Shot', '7-Shot', 'Ted-Talk'
  ];

  // Helper function to format time - handles negative values
  const formatTime = (seconds: number) => {
    // Handle NaN, undefined, or invalid values
    if (isNaN(seconds) || seconds === undefined || seconds === null) {
      console.warn('⚠️ formatTime received invalid value:', seconds);
      return '00:00:00';
    }
    
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const secs = Math.floor(absSeconds % 60);
    const sign = isNegative ? '-' : '';
    return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper function to format time for sub-cue timers - HH:MM:SS format or MM:SS if hours are 00
  const formatSubCueTime = (seconds: number) => {
    // Handle NaN, undefined, or invalid values
    if (isNaN(seconds) || seconds === undefined || seconds === null) {
      console.warn('⚠️ formatSubCueTime received invalid value:', seconds);
      return '00:00';
    }
    
    const isNegative = seconds < 0;
    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const secs = Math.floor(absSeconds % 60);
    const sign = isNegative ? '-' : '';
    
    // If hours are 0, show MM:SS format
    if (hours === 0) {
      return `${sign}${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    // If hours > 0, show HH:MM:SS format
    return `${sign}${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Helper function to check if the parent CUE (row above) is running
  const isParentCueRunning = (itemId: number) => {
    // Check if this item is indented using the new database state
    if (!indentedCues[itemId]) return false;
    
    // Get the parent ID from the indented cues state
    const parentId = indentedCues[itemId].parentId;
    if (!parentId) return false;
    
    // Check if the parent is running
    return activeTimers[parentId] !== undefined;
  };

  // Get remaining time for active timer, sub-cue timer, or loaded CUE - allow negative values
  const getRemainingTime = () => {
    // Use hybrid timer data (ClockPage style) for real-time updates
    if (hybridTimerData?.activeTimer) {
      const progress = hybridTimerProgress;
      const remaining = progress.total - progress.elapsed;
      return remaining;
    }
    
    // Fallback to old logic for compatibility
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remaining = progress.total - progress.elapsed;
        return remaining;
      }
    }
    
    // Check for sub-cue timers
    const subCueTimerIds = Object.keys(subCueTimers);
    if (subCueTimerIds.length > 0) {
      const subCueTimerId = parseInt(subCueTimerIds[0]);
      if (subCueTimerProgress[subCueTimerId]) {
        const progress = subCueTimerProgress[subCueTimerId];
        const remaining = progress.total - progress.elapsed;
        return remaining;
      }
    }
    
    // If no active timer, check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remaining = progress.total - progress.elapsed;
      return remaining;
    }
    
    return 0;
  };

  // Get progress percentage for active timer or sub-cue timer
  const getProgressPercentage = () => {
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        return progress.total > 0 ? (progress.elapsed / progress.total) * 100 : 0;
      }
    }
    
    // Check for sub-cue timers
    const subCueTimerIds = Object.keys(subCueTimers);
    if (subCueTimerIds.length > 0) {
      const subCueTimerId = parseInt(subCueTimerIds[0]);
      if (subCueTimerProgress[subCueTimerId]) {
        const progress = subCueTimerProgress[subCueTimerId];
        return progress.total > 0 ? (progress.elapsed / progress.total) * 100 : 0;
      }
    }
    
    return 0;
  };

  // Get remaining percentage for progress bar
  const getRemainingPercentage = () => {
    // Use hybrid timer data (ClockPage style) for real-time updates
    if (hybridTimerData?.activeTimer) {
      const progress = hybridTimerProgress;
      const remainingSeconds = progress.total - progress.elapsed;
      // Handle negative values (overrun) - show 0% when overrun
      if (remainingSeconds < 0) return 0;
      return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
    }
    
    // Fallback to old logic for compatibility
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        // Handle negative values (overrun) - show 0% when overrun
        if (remainingSeconds < 0) return 0;
        return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
      }
    }
    
    // Check for sub-cue timers
    const subCueTimerIds = Object.keys(subCueTimers);
    if (subCueTimerIds.length > 0) {
      const subCueTimerId = parseInt(subCueTimerIds[0]);
      if (subCueTimerProgress[subCueTimerId]) {
        const progress = subCueTimerProgress[subCueTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
      }
    }
    
    // If no active timer, check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remainingSeconds = progress.total - progress.elapsed;
      return progress.total > 0 ? (remainingSeconds / progress.total) * 100 : 0;
    }
    
    return 0;
  };

  // Get progress bar color based on remaining time
  const getProgressBarColor = () => {
    // Use hybrid timer data (ClockPage style) for real-time updates
    if (hybridTimerData?.activeTimer) {
      const progress = hybridTimerProgress;
      const remainingSeconds = progress.total - progress.elapsed;
      
      // Color based on remaining time
      if (remainingSeconds < 0) { // Overrun - red
        return 'bg-red-500';
      } else if (remainingSeconds > 120) { // More than 2 minutes
        return '#10b981'; // Green
      } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
        return '#f59e0b'; // Yellow
      } else { // Less than 30 seconds
        return '#ef4444'; // Red
      }
    }
    
    // Fallback to old logic for compatibility
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        
        // Color based on remaining time
        if (remainingSeconds < 0) { // Overrun - red
          return 'bg-red-500';
        } else if (remainingSeconds > 120) { // More than 2 minutes
          return '#10b981'; // Green
        } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
          return '#f59e0b'; // Yellow
        } else { // Less than 30 seconds
          return '#ef4444'; // Red
        }
      }
    }
    
    // Check for sub-cue timers
    const subCueTimerIds = Object.keys(subCueTimers);
    if (subCueTimerIds.length > 0) {
      const subCueTimerId = parseInt(subCueTimerIds[0]);
      if (subCueTimerProgress[subCueTimerId]) {
        const progress = subCueTimerProgress[subCueTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        
        // Color based on remaining time
        if (remainingSeconds > 120) { // More than 2 minutes
          return '#10b981'; // Green
        } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
          return '#f59e0b'; // Yellow
        } else { // Less than 30 seconds
          return '#ef4444'; // Red
        }
      }
    }
    
    // If no active timer, check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remainingSeconds = progress.total - progress.elapsed;
      
      // Color based on remaining time
      if (remainingSeconds > 120) { // More than 2 minutes
        return '#10b981'; // Green
      } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
        return '#f59e0b'; // Yellow
      } else { // Less than 30 seconds
        return '#ef4444'; // Red
      }
    }
    
    return 'transparent';
  };

  // Get countdown color based on remaining time
  const getCountdownColor = () => {
    // Use hybrid timer data (ClockPage style) for real-time updates
    if (hybridTimerData?.activeTimer) {
      const progress = hybridTimerProgress;
      const remainingSeconds = progress.total - progress.elapsed;
      
      // Color based on remaining time
      if (remainingSeconds > 120) { // More than 2 minutes
        return '#10b981'; // Green
      } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
        return '#f59e0b'; // Yellow
      } else { // Less than 30 seconds
        return '#ef4444'; // Red
      }
    }
    
    // Fallback to old logic for compatibility
    const activeTimerIds = Object.keys(activeTimers);
    if (activeTimerIds.length > 0) {
      const activeTimerId = parseInt(activeTimerIds[0]);
      if (timerProgress[activeTimerId]) {
        const progress = timerProgress[activeTimerId];
        const remainingSeconds = progress.total - progress.elapsed;
        
        // Color based on remaining time
        if (remainingSeconds > 120) { // More than 2 minutes
          return '#10b981'; // Green
        } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
          return '#f59e0b'; // Yellow
        } else { // Less than 30 seconds
          return '#ef4444'; // Red
        }
      }
    }
    
    // If no active timer, check for loaded CUE
    if (activeItemId && timerProgress[activeItemId]) {
      const progress = timerProgress[activeItemId];
      const remainingSeconds = progress.total - progress.elapsed;
      
      // Color based on remaining time
      if (remainingSeconds > 120) { // More than 2 minutes
        return '#10b981'; // Green
      } else if (remainingSeconds > 30) { // Less than 2 minutes but more than 30 seconds
        return '#f59e0b'; // Yellow
      } else { // Less than 30 seconds
        return '#ef4444'; // Red
      }
    }
    
    return '#ffffff';
  };

  // Adjust timer duration and update start times
  const adjustTimerDuration = async (seconds: number) => {
    console.log('⏱️⏱️⏱️ ADJUST TIMER CLICKED:', seconds, 'seconds');
    console.log('⏱️⏱️⏱️ activeItemId:', activeItemId);
    console.log('⏱️⏱️⏱️ user:', user);
    console.log('⏱️⏱️⏱️ event:', event);
    
    if (!activeItemId || !user || !event?.id) {
      console.log('❌ Cannot adjust timer - missing data:', { activeItemId, user: !!user, eventId: event?.id });
      return;
    }
    
    if (schedule.length === 0) {
      console.log('❌ Schedule is empty - waiting for data to load');
      alert('Schedule is still loading. Please wait a moment and try again.');
      return;
    }
    
    // Convert activeItemId to number if it's a string to match schedule item IDs
    const numericActiveItemId = typeof activeItemId === 'string' ? parseInt(activeItemId) : activeItemId;
    const item = schedule.find(s => s.id === numericActiveItemId);
    if (!item) {
      console.log('❌ Cannot find active item in schedule');
      console.log('❌ Active item ID type:', typeof activeItemId, activeItemId);
      console.log('❌ Schedule item IDs:', schedule.map(s => ({ id: s.id, type: typeof s.id })));
      return;
    }
    
    console.log('⏱️⏱️⏱️ Found item:', item.segmentName);
    
    // Update the item's duration
    const newDurationSeconds = Math.max(0, (item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds) + seconds);
    const newHours = Math.floor(newDurationSeconds / 3600);
    const newMinutes = Math.floor((newDurationSeconds % 3600) / 60);
    const newSecs = newDurationSeconds % 60;
    
    // Update schedule with new duration - this will trigger the auto-save mechanism
    const updatedSchedule = schedule.map(scheduleItem => 
      scheduleItem.id === numericActiveItemId 
        ? { 
            ...scheduleItem, 
            durationHours: newHours,
            durationMinutes: newMinutes,
            durationSeconds: newSecs
          }
        : scheduleItem
    );
    
    setSchedule(updatedSchedule);
    
    // Update the timer progress if it exists
    if (timerProgress[numericActiveItemId]) {
      console.log('🔄 Updating timer duration for item:', numericActiveItemId, 'new duration:', newDurationSeconds);
      
      // Always update the timer progress total duration
      setTimerProgress(prev => ({
        ...prev,
        [numericActiveItemId]: {
          ...prev[numericActiveItemId],
          total: newDurationSeconds
        }
      }));
      
      // If timer is currently running, update it in the database immediately for real-time sync
      if (activeTimers[numericActiveItemId]) {
        console.log('🔄 Updating running timer duration in database for real-time sync');
        await DatabaseService.updateTimerDuration(event.id, numericActiveItemId, newDurationSeconds);
      }
    }
    
    // Mark user as editing - this will pause sync and trigger auto-save after pause
    console.log('✏️ Marking user as editing (timer duration change)');
    handleUserEditing();
    
    console.log('✅ Timer duration updated - running timer synced immediately, schedule will sync after pause');
  };

  // Load a CUE (stop any active timer and select the CUE)
  const loadCue = async (itemId: number) => {
    console.log('🚀🚀🚀 loadCue function STARTED with itemId:', itemId);
    console.log('🚀🚀🚀 user:', user);
    console.log('🚀🚀🚀 event:', event);
    console.log('🚀🚀🚀 currentUserRole:', currentUserRole);
    
    if (!user || !event?.id) {
      console.log('❌ Missing user or event ID:', { user: !!user, eventId: event?.id });
      return;
    }
    // Mark any currently running CUE as completed (purple)
    Object.keys(activeTimers).forEach(async (timerId) => {
      if (activeTimers[parseInt(timerId)]) {
        clearInterval(activeTimerIntervals[parseInt(timerId)]);
        setCompletedCues(prev => ({ ...prev, [parseInt(timerId)]: true }));
        // Mark as completed in database
        const item = schedule.find(s => s.id === parseInt(timerId));
        console.log('🟣 About to mark cue as completed:', {
          eventId: event.id,
          itemId: parseInt(timerId),
          userId: user.id,
          cueId: item?.customFields?.cue || 'CUE'
        });
        try {
          const result = await DatabaseService.markCueCompleted(
          event.id, 
          parseInt(timerId), 
          item?.customFields?.cue || 'CUE', 
          user.id, 
          user.full_name || user.email || 'Unknown User',
          currentUserRole || 'VIEWER'
        );
          console.log('🟣 Mark completed result:', result);
        } catch (error) {
          console.error('❌ Error marking cue as completed:', error);
        }
      }
    });
    setActiveTimers({});
    
    // Stop all timers via API
    console.log('🔄 Stopping all timers in API for event:', event.id, 'user:', user.id);
    const stopResult = await DatabaseService.stopAllTimersForEvent(
      event.id, 
      user.id, 
      user.full_name || user.email || 'Unknown User',
      currentUserRole || 'VIEWER'
    );
    console.log('🔄 Stop all timers result:', stopResult);
    
    // Stop any running sub-cue timer when loading a new cue
    if (secondaryTimer) {
      console.log('🛑 Stopping sub-cue timer because new cue is being loaded');
      await stopSecondaryTimer();
    }
    
    // Mark the previously active CUE as stopped (if there was one)
    if (activeItemId && activeItemId !== itemId) {
      setStoppedItems(prev => new Set([...prev, activeItemId]));
      setCompletedCues(prev => ({ ...prev, [activeItemId]: true }));
      
      // Mark as completed in database
      const activeItem = schedule.find(s => s.id === activeItemId);
      console.log('🟣 About to mark active cue as completed:', {
        eventId: event.id,
        itemId: activeItemId,
        userId: user.id,
        cueId: activeItem?.customFields?.cue || 'CUE'
      });
      try {
        const result = await DatabaseService.markCueCompleted(
        event.id, 
        activeItemId, 
        activeItem?.customFields?.cue || 'CUE', 
        user.id, 
        user.full_name || user.email || 'Unknown User',
        currentUserRole || 'VIEWER'
      );
        console.log('🟣 Mark active completed result:', result);
      } catch (error) {
        console.error('❌ Error marking active cue as completed:', error);
      }
      
      // Also complete any indented items that are part of the interrupted CUE group
      const interruptedIndex = schedule.findIndex(item => item.id === activeItemId);
      if (interruptedIndex !== -1) {
        // Find all indented items that follow the interrupted CUE until the next non-indented item
        for (let i = interruptedIndex + 1; i < schedule.length; i++) {
          if (schedule[i].isIndented) {
            setCompletedCues(prev => ({ ...prev, [schedule[i].id]: true }));
            setStoppedItems(prev => new Set([...prev, schedule[i].id]));
            // Mark indented items as completed in database too
            await DatabaseService.markCueCompleted(
              event.id, 
              schedule[i].id, 
              schedule[i].customFields?.cue || 'CUE', 
              user.id, 
              user.full_name || user.email || 'Unknown User',
              currentUserRole || 'VIEWER'
            );
          } else {
            // Stop when we hit a non-indented item (next CUE group)
            break;
          }
        }
      }
    }
    
    // Clear completed status for this CUE and its indented items
    setCompletedCues(prev => {
      const newCompleted = { ...prev };
      delete newCompleted[itemId];
      
      // Also clear completed status for any indented items that belong to this CUE group
      const currentIndex = schedule.findIndex(item => item.id === itemId);
      if (currentIndex !== -1) {
        for (let i = currentIndex + 1; i < schedule.length; i++) {
          if (schedule[i].isIndented) {
            delete newCompleted[schedule[i].id];
          } else {
            // Stop when we hit a non-indented item (next CUE group)
            break;
          }
        }
      }
      
      return newCompleted;
    });
    
    // Clear stopped status for the newly loaded CUE and its indented items
    setStoppedItems(prev => {
      const newStopped = new Set(prev);
      newStopped.delete(itemId);
      
      // Also remove any indented items that belong to this CUE group
      const currentIndex = schedule.findIndex(item => item.id === itemId);
      if (currentIndex !== -1) {
        for (let i = currentIndex + 1; i < schedule.length; i++) {
          if (schedule[i].isIndented) {
            newStopped.delete(schedule[i].id);
          } else {
            // Stop when we hit a non-indented item (next CUE group)
            break;
          }
        }
      }
      
      return newStopped;
    });
    
    // Initialize timer progress for the loaded CUE
    const item = schedule.find(s => s.id === itemId);
    if (item) {
      console.log('🔄 Item found:', item);
      console.log('🔄 Item ID type:', typeof item.id, 'Value:', item.id);
      console.log('🔄 Item duration values:', {
        durationHours: item.durationHours,
        durationMinutes: item.durationMinutes,
        durationSeconds: item.durationSeconds
      });
      
      const totalSeconds = item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds;
      console.log('🔄 Calculated total seconds:', totalSeconds);
      console.log('🔄 Item duration breakdown:', {
        durationHours: item.durationHours,
        durationMinutes: item.durationMinutes,
        durationSeconds: item.durationSeconds,
        totalSeconds: totalSeconds
      });
      
      // Convert itemId to integer if it's a string
      const numericItemId = typeof itemId === 'string' ? parseInt(itemId) : itemId;
      console.log('🔄 Numeric item ID:', numericItemId);
      
      // OPTIMISTIC UI UPDATE - Show loaded state immediately
      console.log('⚡ Optimistic UI update - showing loaded state immediately');
      setTimerProgress(prev => ({
        ...prev,
        [itemId]: {
          elapsed: 0,
          total: totalSeconds,
          startedAt: null
        }
      }));
      setActiveItemId(itemId);
      setLoadedItems(prev => ({ ...prev, [itemId]: true }));
      
      // Calculate row number and cue display for database
      const currentIndex = schedule.findIndex(scheduleItem => scheduleItem.id === itemId);
      const rowNumber = currentIndex + 1; // 1-based row number
      const cueDisplay = formatCueDisplay(item.customFields.cue);
      
      // Use the existing 5-character timer ID from the schedule item
      const timerId = item.timerId;
      
      // Update active_timers table in API
      console.log('🔄 Loading CUE in API:', { eventId: event.id, itemId: numericItemId, userId: user.id, totalSeconds, rowNumber, cueDisplay, timerId });
      console.log('🔄 About to call DatabaseService.loadCue...');
      console.log('🔄 DatabaseService object:', typeof DatabaseService);
      console.log('🔄 DatabaseService.loadCue function:', typeof DatabaseService.loadCue);
      
      // Test API configuration
      console.log('🔄 Testing API configuration...');
      try {
        await apiClient.healthCheck();
        console.log('🔄 API server is running');
      } catch (error) {
        console.error('❌ Error connecting to API server:', error);
      }
      
      try {
        console.log('🔄 Calling DatabaseService.loadCue now...');
        const loadResult = await DatabaseService.loadCue(event.id, numericItemId, user.id, totalSeconds, rowNumber, cueDisplay, timerId);
        console.log('🔄 Load CUE result:', loadResult);
        if (!loadResult) {
          console.error('❌ Load CUE failed - check database connection and functions');
        } else {
          console.log('✅ Load CUE succeeded!');
        }
      } catch (error) {
        console.error('❌ Load CUE error:', error);
        console.error('❌ Error stack:', error.stack);
      }
      
      console.log('🔄 Finished loadCue database call');
      
    // Set visual indicator
    setLastLoadedCueId(numericItemId);
    
    // Try to save last loaded CUE (will fail gracefully if migration not run)
    try {
      await DatabaseService.updateLastLoadedCue(event.id, numericItemId, 'loaded');
      console.log('✅ Last loaded CUE saved');
    } catch (error) {
      console.log('⚠️ Could not save last loaded CUE (migration may not be run):', error);
    }
      
      // Backup schedule data before broadcasting
      await backupScheduleData();
      
      // Broadcast disabled - focusing on local functionality first
      console.log('✅ Load CUE action completed locally');
    }
    
    // Set dependent rows for orange highlighting
    const currentIndex = schedule.findIndex(item => item.id === itemId);
    const dependentIds = new Set<number>();
    if (currentIndex !== -1) {
      // Find all indented items that follow this CUE until the next non-indented item
      for (let i = currentIndex + 1; i < schedule.length; i++) {
        if (schedule[i].isIndented) {
          dependentIds.add(schedule[i].id);
        } else {
          // Stop when we hit a non-indented item (next CUE group)
          break;
        }
      }
    }
    setLoadedCueDependents(dependentIds);
  };

  // Reset all row states to cleared
  // Toggle sub-cue timer (for indented items)
  const toggleSubCueTimer = async (itemId: number) => {
    if (!user || !event?.id) return;

    const item = schedule.find(s => s.id === itemId);
    if (!item || !item.isIndented) return;

    if (subCueTimers[itemId]) {
      // Stop sub-cue timer
      clearInterval(subCueTimers[itemId]);
      setSubCueTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[itemId];
        return newTimers;
      });
      setSubCueTimerProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[itemId];
        return newProgress;
      });

      // Sync with database
      try {
        console.log('🔄 Stopping sub-cue timer in database:', { eventId: event.id, itemId });
        const result = await DatabaseService.stopSubCueTimer(event.id, itemId);
        console.log('✅ Sub-cue timer stopped in database:', result);
      } catch (error) {
        console.error('❌ Error stopping sub-cue timer in database:', error);
      }
    } else {
      // Start sub-cue timer
      const totalSeconds = item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds;
      
      // OPTIMISTIC UI UPDATE - Show running state immediately
      console.log('⚡ Starting sub-cue timer immediately');
      const now = new Date();
      setSubCueTimerProgress(prev => ({
        ...prev,
        [itemId]: {
          elapsed: 0,
          total: totalSeconds,
          startedAt: now
        }
      }));
      
      // Start local timer immediately for UI updates
      const timer = setInterval(() => {
        setSubCueTimerProgress(prev => {
          if (prev[itemId]) {
            const startedAtValue = prev[itemId].startedAt;
            const startTime = startedAtValue instanceof Date ? startedAtValue.getTime() : 
                             (typeof startedAtValue === 'string' ? new Date(startedAtValue).getTime() : Date.now());
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            return {
              ...prev,
              [itemId]: {
                ...prev[itemId],
                elapsed: elapsed
              }
            };
          }
          return prev;
        });
      }, 200); // Update every 200ms for smooth UI
      
      setSubCueTimers(prev => ({ ...prev, [itemId]: timer }));

      // Sync with database
      try {
        // Get the item details for row number, cue display, and timer ID
        const item = schedule.find(s => s.id === itemId);
        const rowNumber = schedule.findIndex(s => s.id === itemId) + 1; // 1-based index
        const cueDisplay = item ? formatCueDisplay(item.customFields.cue) : `CUE ${itemId}`;
        const timerId = item?.timerId || `SUB${itemId}`;
        
        console.log('🔄 Starting sub-cue timer in database:', { eventId: event.id, itemId, userId: user.id, durationSeconds: totalSeconds, rowNumber, cueDisplay, timerId });
        try {
          const result = await DatabaseService.startSubCueTimer(event.id, itemId, user.id, totalSeconds, rowNumber, cueDisplay, timerId, user.full_name || user.email || 'Unknown User', currentUserRole || 'VIEWER');
          console.log('✅ Sub-cue timer synced to database:', result);
          if (result?.error) {
            console.error('❌ Sub-cue timer database error:', result.error);
          }
        } catch (error) {
          console.error('❌ Sub-cue timer call failed:', error);
        }
      } catch (error) {
        console.error('❌ Error syncing sub-cue timer to database:', error);
      }
    }
  };

  const resetAllStates = async () => {
    // Stop any active timers
    Object.keys(activeTimers).forEach(timerId => {
      if (activeTimers[parseInt(timerId)]) {
        clearInterval(activeTimerIntervals[parseInt(timerId)]);
      }
    });
    
    // Stop any sub-cue timers
    Object.keys(subCueTimers).forEach(timerId => {
      if (subCueTimers[parseInt(timerId)]) {
        clearInterval(subCueTimers[parseInt(timerId)]);
      }
    });
    
    // Clear completed cues from database
    if (event?.id) {
      try {
        await DatabaseService.clearCompletedCues(event.id);
        console.log('✅ Cleared completed cues from database');
        
        // Clear active_timers table
        await DatabaseService.clearAllActiveTimersForEvent(event.id);
        console.log('✅ Cleared all active timers from API');
        
        // Clear overtime_minutes table
        await DatabaseService.clearOvertimeMinutes(event.id);
        console.log('✅ Cleared overtime minutes from database');
      } catch (error) {
        console.warn('⚠️ Failed to clear database:', error);
      }
    }
    
    // Clear all states
    setActiveTimers({});
    setSubCueTimers({});
    setTimerProgress({});
    setSubCueTimerProgress({});
    setCompletedCues({});
    setActiveItemId(null);
    setStoppedItems(new Set());
    setLoadedCueDependents(new Set()); // Clear dependent row highlighting
    setLastLoadedCueId(null); // Clear purple highlight from last loaded cue
    setOvertimeMinutes({}); // Clear all overtime indicators
    setShowStartOvertime(0); // Clear show start overtime
    // Note: Do NOT clear startCueId - the star is just a marker, not overtime data
    
    // Clear show start overtime from database
    if (event?.id) {
      try {
        await DatabaseService.clearShowStartOvertime(event.id);
        console.log('✅ Show start overtime cleared from database');
      } catch (error) {
        console.error('❌ Failed to clear show start overtime from database:', error);
      }
    }
    
    // NOTE: Do NOT clear isIndented property - this is part of the schedule structure
    // The reset should only clear completed cues and timer states, not modify schedule structure
    
    // Emit reset event to other connected pages (like PhotoViewPage)
    console.log('📡 RunOfShow: Emitting reset all states event to other pages');
    socketClient.emitResetAllStates();
    console.log('✅ RunOfShow: Reset all states event emitted');
  };


  // Open full-screen timer in new window
  const openFullScreenTimer = () => {
    setShowMenuDropdown(false);
    
    // Close existing timer window if open
    if (fullScreenTimerWindow && !fullScreenTimerWindow.closed) {
      fullScreenTimerWindow.close();
    }

    // Get current timer data
    const activeTimerIds = Object.keys(activeTimers);
    const currentItem = activeTimerIds.length > 0 
      ? schedule.find(item => activeTimers[item.id])
      : schedule.find(item => item.id === activeItemId);

    const timerData = {
      isRunning: activeTimerIds.length > 0,
      elapsedTime: currentItem && timerProgress[currentItem.id] 
        ? timerProgress[currentItem.id].elapsed 
        : 0,
      totalDuration: currentItem 
        ? currentItem.durationHours * 3600 + currentItem.durationMinutes * 60 + currentItem.durationSeconds
        : 0,
      eventId: event?.id,
      mainTimer: currentItem ? {
        cue: currentItem.customFields.cue || 'CUE',
        segmentName: currentItem.segmentName || ''
      } : null,
      secondaryTimer: secondaryTimer ? {
        itemId: secondaryTimer.itemId,
        remaining: secondaryTimer.remaining,
        duration: secondaryTimer.duration,
        cue: schedule.find(item => item.id === secondaryTimer.itemId)?.customFields.cue || 'CUE',
        segmentName: schedule.find(item => item.id === secondaryTimer.itemId)?.segmentName || ''
      } : null
    };

    // Open new window
    const timerWindow = window.open(
      '/fullscreen-timer',
      'fullScreenTimer',
      'width=1920,height=1080,fullscreen=yes,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes'
    );

    if (timerWindow) {
      setFullScreenTimerWindow(timerWindow);
      
      // Send initial data to the timer window
      timerWindow.addEventListener('load', () => {
        timerWindow.postMessage({
          type: 'TIMER_UPDATE',
          ...timerData
        }, '*');
      });
    }
  };

  // Open Clock in new window
  const openClock = () => {
    setShowMenuDropdown(false);
    
    // Close existing clock window if open
    if (clockWindow && !clockWindow.closed) {
      clockWindow.close();
    }

    // Get current timer data
    const activeTimerIds = Object.keys(activeTimers);
    const currentItem = activeTimerIds.length > 0 
      ? schedule.find(item => activeTimers[item.id])
      : schedule.find(item => item.id === activeItemId);

    const timerData = {
      isRunning: activeTimerIds.length > 0,
      elapsedTime: currentItem && timerProgress[currentItem.id] 
        ? timerProgress[currentItem.id].elapsed 
        : 0,
      totalDuration: currentItem 
        ? currentItem.durationHours * 3600 + currentItem.durationMinutes * 60 + currentItem.durationSeconds
        : 0,
      eventId: event?.id,
      mainTimer: currentItem ? {
        cue: currentItem.customFields.cue || 'CUE',
        segmentName: currentItem.segmentName || ''
      } : null,
      secondaryTimer: secondaryTimer ? {
        itemId: secondaryTimer.itemId,
        remaining: secondaryTimer.remaining,
        duration: secondaryTimer.duration,
        cue: schedule.find(item => item.id === secondaryTimer.itemId)?.customFields.cue || 'CUE',
        segmentName: schedule.find(item => item.id === secondaryTimer.itemId)?.segmentName || ''
      } : null
    };

    // Open new window with event ID parameter
    const clockUrl = event?.id ? `/clock?eventId=${event.id}` : '/clock';
    const newClockWindow = window.open(
      clockUrl,
      'clock',
      'width=1920,height=1080,fullscreen=yes,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes'
    );

    if (newClockWindow) {
      setClockWindow(newClockWindow);
      
      // Send initial data to the clock window
      newClockWindow.addEventListener('load', () => {
        newClockWindow.postMessage({
          type: 'TIMER_UPDATE',
          ...timerData
        }, '*');
      });
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setActiveItemMenu(null);
      setActiveRowMenu(null);
      setShowMenuDropdown(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Initialize temp content when modal opens
  useEffect(() => {
    if (showNotesModal && editingNotesItem !== null) {
      const editor = document.getElementById('notes-editor');
      if (editor) {
        if (editingNotesItem === -1) {
          // Editing modal form notes
          editor.innerHTML = modalForm.notes || '';
        } else {
          // Editing existing schedule item notes
          const item = schedule.find(item => item.id === editingNotesItem);
          editor.innerHTML = item?.notes || '';
        }
      }
    }
  }, [showNotesModal, editingNotesItem, schedule, modalForm.notes]);

  // Initialize speakers content when modal opens
  useEffect(() => {
    if (showSpeakersModal && editingSpeakersItem !== null) {
      if (editingSpeakersItem === -1) {
        // Editing modal form speakers
        if (modalForm.speakersText) {
          try {
            const speakers = JSON.parse(modalForm.speakersText);
            setTempSpeakersText(Array.isArray(speakers) ? speakers : []);
          } catch {
            setTempSpeakersText([]);
          }
        } else {
          setTempSpeakersText([]);
        }
      } else {
        // Editing existing schedule item speakers
        const item = schedule.find(item => item.id === editingSpeakersItem);
        if (item?.speakersText) {
          try {
            // Try to parse existing speakers data
            const speakers = JSON.parse(item.speakersText);
            setTempSpeakersText(Array.isArray(speakers) ? speakers : []);
          } catch {
            // If parsing fails, start with empty array
            setTempSpeakersText([]);
          }
        } else {
          setTempSpeakersText([]);
        }
      }
    }
  }, [showSpeakersModal, editingSpeakersItem, schedule, modalForm.speakersText]);

  // Initialize assets modal content when modal opens
  useEffect(() => {
    if (showAssetsModal && editingAssetsItem !== null) {
      const assetsContainer = document.getElementById('assets-list');
      
      if (assetsContainer) {
        // Clear existing assets
        assetsContainer.innerHTML = '';
        
        let assetsData = '';
        if (editingAssetsItem === -1) {
          // Editing modal form assets
          assetsData = modalForm.assets || '';
        } else {
          // Editing existing schedule item assets
          const item = schedule.find(item => item.id === editingAssetsItem);
          assetsData = item?.assets || '';
        }
        
        if (assetsData) {
          // Parse multiple assets (format: "Name1||Name2|Link2||Name3")
          const assetsArray = assetsData.split('||');
          
          assetsArray.forEach(assetString => {
            if (assetString.trim()) {
              const [name, link] = assetString.split('|');
              const hasLink = link && link.trim() !== '';
              
              const assetItem = document.createElement('div');
              assetItem.className = 'asset-item p-3 bg-slate-700 rounded-lg space-y-3';
              assetItem.innerHTML = `
                <div class="flex gap-3 items-center">
                  <input type="text" class="asset-name flex-1 px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500" placeholder="Asset name..." value="${name || ''}" />
                  <button type="button" class="toggle-link px-3 py-2 text-white rounded transition-colors text-sm ${hasLink ? 'bg-slate-600 hover:bg-slate-500' : 'bg-blue-600 hover:bg-blue-500'}">
                    ${hasLink ? '− Link' : '+ Link'}
                  </button>
                  <button type="button" class="remove-asset px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded transition-colors">Remove</button>
                </div>
                <div class="asset-link-container ${hasLink ? '' : 'hidden'}">
                  <input type="url" class="asset-link w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500" placeholder="Enter asset URL..." value="${link || ''}" />
                </div>
              `;
              
              // Add toggle link functionality
              const toggleBtn = assetItem.querySelector('.toggle-link');
              const linkContainer = assetItem.querySelector('.asset-link-container');
              const linkInput = assetItem.querySelector('.asset-link') as HTMLInputElement;
              
              toggleBtn?.addEventListener('click', () => {
                if (linkContainer?.classList.contains('hidden')) {
                  linkContainer.classList.remove('hidden');
                  toggleBtn.textContent = '− Link';
                  toggleBtn.classList.remove('bg-blue-600', 'hover:bg-blue-500');
                  toggleBtn.classList.add('bg-slate-600', 'hover:bg-slate-500');
                  linkInput?.focus();
                } else {
                  linkContainer?.classList.add('hidden');
                  toggleBtn.textContent = '+ Link';
                  toggleBtn.classList.remove('bg-slate-600', 'hover:bg-slate-500');
                  toggleBtn.classList.add('bg-blue-600', 'hover:bg-blue-500');
                  if (linkInput) linkInput.value = '';
                }
              });
              
              // Add remove functionality
              const removeBtn = assetItem.querySelector('.remove-asset');
              removeBtn?.addEventListener('click', () => {
                assetItem.remove();
              });
              
              assetsContainer.appendChild(assetItem);
            }
          });
        }
        
        // Always add at least one empty row
        if (assetsContainer.children.length === 0) {
          addAssetRow();
        }
      }
    }
  }, [showAssetsModal, editingAssetsItem, schedule, modalForm.assets]);

  // Initialize modal when opened
  useEffect(() => {
    if (showParticipantsModal && editingParticipantsItem !== null) {
      if (editingParticipantsItem === -1) {
        // Editing modal form speakers
        if (modalForm.speakers) {
          try {
            const speakers = JSON.parse(modalForm.speakers);
            setTempSpeakers(Array.isArray(speakers) ? speakers : []);
          } catch {
            setTempSpeakers([]);
          }
        } else {
          setTempSpeakers([]);
        }
      } else {
        // Editing existing schedule item speakers
        const item = schedule.find(item => item.id === editingParticipantsItem);
        if (item?.speakers) {
          try {
            // Try to parse existing speakers data
            const speakers = JSON.parse(item.speakers);
            setTempSpeakers(Array.isArray(speakers) ? speakers : []);
          } catch {
            // If parsing fails, start with empty array
            setTempSpeakers([]);
          }
        } else {
          setTempSpeakers([]);
        }
      }
    }
  }, [showParticipantsModal, editingParticipantsItem, schedule, modalForm.speakers]);

  // API functions with debouncing
  const saveToAPI = React.useCallback(
    debounce(async () => {
      if (!event?.id) return;
      
      try {
        // Convert duration fields to duration_seconds for database storage
        // Also set isIndented property based on indentedCues state
        const scheduleWithDurationSeconds = schedule.map(item => ({
          ...item,
          duration_seconds: (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0),
          isIndented: indentedCues[item.id] ? true : false
        }));

        // Debug logging for duration conversion
        if (schedule.length > 0) {
          console.log('🔄 RunOfShow: Converting duration fields to duration_seconds:', {
            firstItem: {
              durationHours: schedule[0].durationHours,
              durationMinutes: schedule[0].durationMinutes,
              durationSeconds: schedule[0].durationSeconds,
              calculatedDurationSeconds: scheduleWithDurationSeconds[0].duration_seconds
            }
          });
        }

        const dataToSave = {
          event_id: event.id,
          event_name: event.name,
          event_date: event.date,
          schedule_items: scheduleWithDurationSeconds,
          custom_columns: customColumns,
          settings: {
            eventName,
            masterStartTime,
            dayStartTimes,
            timezone: eventTimezone,
            lastSaved: new Date().toISOString()
          }
        };
        
        
        // Reduce logging frequency
        if (Math.random() < 0.05) { // Only log 5% of the time
          console.log('🔄 Auto-saving to API:', {
            eventId: event.id,
            scheduleItemsCount: schedule.length,
            customColumnsCount: customColumns.length,
            eventName,
            masterStartTime,
            sampleScheduleItem: schedule[0] ? {
              id: schedule[0].id,
              segmentName: schedule[0].segmentName,
              speakersText: schedule[0].speakersText ? 'Has speakers data' : 'No speakers data',
              speakers: schedule[0].speakers ? 'Has speakers data' : 'No speakers data'
            } : 'No schedule items'
          });
        }
        
        const result = await DatabaseService.saveRunOfShowData(dataToSave, {
          userId: user?.id || 'unknown',
          userName: user?.full_name || user?.email || 'Unknown User',
          userRole: currentUserRole || 'VIEWER'
        });
        
        // Auto-save logging reduced - only log occasionally
        if (Math.random() < 0.1) { // Only log 10% of the time
          console.log('✅ Auto-saved to API successfully');
        }
      } catch (error) {
        console.error('❌ Error auto-saving to API:', error);
      }
    }, 2000), // Debounce for 2 seconds
    [event?.id, event?.name, event?.date, schedule, customColumns, eventName, masterStartTime, dayStartTimes, indentedCues]
  );

  // Debounce utility function
  function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
    let timeout: NodeJS.Timeout;
    return ((...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    }) as T;
  }

  const loadFromAPI = useCallback(async () => {
    if (!event?.id) return;
    
    try {
      console.log('🔄 Loading from API for event:', event.id);
      
      // Add timeout to prevent hanging
      const dataPromise = DatabaseService.getRunOfShowData(event.id);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout after 10 seconds')), 10000)
      );
      
      const data = await Promise.race([dataPromise, timeoutPromise]) as any;
      
      console.log('🔍 Debug - Raw data from API:', data);
      console.log('🔍 Debug - schedule_items:', data?.schedule_items);
      console.log('🔍 Debug - custom_columns:', data?.custom_columns);
      console.log('🔍 Debug - settings:', data?.settings);
      
      
      if (data) {
        console.log('📥 Data loaded from API:', {
          scheduleItemsCount: data.schedule_items?.length || 0,
          customColumnsCount: data.custom_columns?.length || 0,
          eventName: data.settings?.eventName,
          masterStartTime: data.settings?.masterStartTime,
          sampleScheduleItem: data.schedule_items?.[0] ? {
            id: data.schedule_items[0].id,
            segmentName: data.schedule_items[0].segmentName,
            speakersText: data.schedule_items[0].speakersText ? 'Has speakers data' : 'No speakers data',
            speakers: data.schedule_items[0].speakers ? 'Has speakers data' : 'No speakers data'
          } : 'No schedule items'
        });
        
        // Force a new array reference to ensure React detects the change
        const newSchedule = data.schedule_items ? [...data.schedule_items] : [];
        setSchedule(newSchedule);
        setCustomColumns(data.custom_columns || []);
        
        if (data.settings?.eventName) setEventName(data.settings.eventName);
        if (data.settings?.masterStartTime) setMasterStartTime(data.settings.masterStartTime);
        if (data.settings?.dayStartTimes) setDayStartTimes(data.settings.dayStartTimes);
        if (data.settings?.timezone) {
          setEventTimezone(data.settings.timezone);
        }
        console.log('🔍 Full settings object:', data.settings);
        
        // FIRST: Always load star selection from main schedule (this is the source of truth)
        const startCueItem = newSchedule.find(item => item.isStartCue === true);
        if (startCueItem) {
          setStartCueId(startCueItem.id);
          console.log('⭐ START cue marker restored from schedule:', startCueItem.id);
        } else {
          setStartCueId(null);
          console.log('⭐ No START cue marker found in schedule');
        }
        
        // Load overtime minutes from dedicated table (like completed_cues)
        const overtimeData = await DatabaseService.getOvertimeMinutes(event.id);
        setOvertimeMinutes(overtimeData);
        console.log('✅ Loaded overtime minutes from dedicated table:', overtimeData);
        
        // SECOND: Load show start overtime from separate table (if it exists)
        const showStartOvertimeData = await DatabaseService.getShowStartOvertime(event.id);
        if (showStartOvertimeData) {
          // Parse the data structure correctly
          const overtimeMinutes = showStartOvertimeData.show_start_overtime || showStartOvertimeData.overtimeMinutes;
          const itemId = showStartOvertimeData.item_id || showStartOvertimeData.itemId;
          
          setShowStartOvertime(overtimeMinutes);
          console.log('✅ Loaded show start overtime:', showStartOvertimeData);
          console.log('⭐ Show start overtime restored:', {
            itemId: itemId,
            showStartOvertime: overtimeMinutes
          });
        } else {
          console.log('⭐ No show start overtime found in database');
          setShowStartOvertime(0); // Reset to 0 if no data
        }
        
        // CRITICAL: Combine show start overtime with duration overtime for total calculation
        console.log('🔄 Combining overtime calculations:');
        console.log('  - Show start overtime:', showStartOvertime);
        console.log('  - Duration overtime:', overtimeMinutes);
        console.log('  - START cue ID:', startCueId);
        
        // Debug: Show which items have overtime
        const itemsWithOvertime = schedule.filter(item => overtimeMinutes[item.id]);
        console.log('📊 Items with duration overtime:', itemsWithOvertime.map(item => ({
          id: item.id,
          segmentName: item.segmentName,
          overtime: overtimeMinutes[item.id]
        })));
        
        if (startCueId && showStartOvertime !== 0) {
          console.log('⭐ START cue overtime will apply to all rows after:', startCueId, 'with offset:', showStartOvertime);
        }
        
        // Update change tracking - store updated_at for comparison
        setLastChangeAt(data.updated_at || null);
        setHasChanges(false);
        setChangeNotification({ show: false });
        
        console.log('✅ Run of Show data loaded from API successfully');
        
        // CRITICAL: Load active timer AFTER schedule is loaded to ensure cue display works
        // Use setTimeout to ensure state updates are processed
        setTimeout(() => {
          loadActiveTimerFromAPI();
        }, 100);
      } else {
        console.log('ℹ️ No data found in API, falling back to localStorage for event:', event.id);
        // Fallback to localStorage if API has no data
        const savedSchedule = localStorage.getItem(`runOfShowSchedule_${event.id}`);
        const savedCustomColumns = localStorage.getItem(`customColumns_${event.id}`);
        const savedEventName = localStorage.getItem(`eventName_${event.id}`);
        const savedMasterTime = localStorage.getItem(`masterStartTime_${event.id}`);
        const savedDayStartTimes = localStorage.getItem(`dayStartTimes_${event.id}`);

        if (savedSchedule) {
          try {
          const parsedSchedule = JSON.parse(savedSchedule);
            console.log('🔍 Parsed schedule from localStorage:', parsedSchedule);
          // Migrate existing items to include day property
          const migratedSchedule = parsedSchedule.map((item: any) => ({
            ...item,
            day: item.day || 1
          }));
          setSchedule(migratedSchedule);
          console.log('📥 Loaded schedule from localStorage:', migratedSchedule.length, 'items');
            console.log('🔍 First few items:', migratedSchedule.slice(0, 3));
          } catch (error) {
            console.error('❌ Error parsing schedule from localStorage:', error);
            console.log('🔍 Raw localStorage data:', savedSchedule);
          }
        } else {
          console.log('❌ No schedule found in localStorage for event:', event.id);
        }
        if (savedCustomColumns) {
          setCustomColumns(JSON.parse(savedCustomColumns));
          console.log('📥 Loaded custom columns from localStorage');
        }
        if (savedEventName) {
          setEventName(savedEventName);
          console.log('📥 Loaded event name from localStorage');
        }
        if (savedMasterTime) {
          setMasterStartTime(savedMasterTime);
          console.log('📥 Loaded master start time from localStorage');
        }
        if (savedDayStartTimes) {
          setDayStartTimes(JSON.parse(savedDayStartTimes));
          console.log('📥 Loaded day start times from localStorage');
        }
      }
    } catch (error) {
      console.error('❌ Error loading run of show data from API:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        eventId: event?.id
      });
      // Fallback to localStorage on error
      console.log('🔄 Falling back to localStorage due to error');
      const savedSchedule = localStorage.getItem(`runOfShowSchedule_${event.id}`);
      if (savedSchedule) {
        try {
        const parsedSchedule = JSON.parse(savedSchedule);
        const migratedSchedule = parsedSchedule.map((item: any) => ({
          ...item,
          day: item.day || 1
        }));
        setSchedule(migratedSchedule);
        console.log('📥 Loaded schedule from localStorage after error:', migratedSchedule.length, 'items');
          console.log('🔍 First few items after error:', migratedSchedule.slice(0, 3));
        } catch (parseError) {
          console.error('❌ Error parsing schedule from localStorage after error:', parseError);
          console.log('🔍 Raw localStorage data after error:', savedSchedule);
        }
      } else {
        console.log('❌ No schedule found in localStorage after error for event:', event.id);
      }
    }
  }, [event?.id]);

  // Dynamic loading function that preserves timers and state
  const loadChangesDynamically = useCallback(async () => {
    if (!event?.id) return;

    try {
      console.log('🔄 Loading changes dynamically for event:', event.id);
      const data = await DatabaseService.loadChangesDynamically(event.id);
      
      if (data) {
        console.log('📥 Dynamic changes loaded:', {
          scheduleItemsCount: data.schedule_items?.length || 0,
          customColumnsCount: data.custom_columns?.length || 0,
          lastModifiedBy: data.last_modified_by_name
        });
        
        // Update data without affecting timers
        // Force a new array reference to ensure React detects the change
        const newSchedule = data.schedule_items ? [...data.schedule_items] : [];
        setSchedule(newSchedule);
        setCustomColumns(data.custom_columns || []);
        if (data.settings?.eventName) setEventName(data.settings.eventName);
        if (data.settings?.masterStartTime) setMasterStartTime(data.settings.masterStartTime);
        if (data.settings?.dayStartTimes) setDayStartTimes(data.settings.dayStartTimes);
        
        // Update change tracking - store updated_at for comparison
        setLastChangeAt(data.updated_at || null);
        setHasChanges(false);
        setChangeNotification({ show: false });
        
        console.log('✅ Changes loaded dynamically - timers preserved');
      }
    } catch (error) {
      console.error('❌ Error loading changes dynamically:', error);
    }
  }, [event?.id]);

  // Load data from API when component mounts
  useEffect(() => {
    console.log('🔄 useEffect triggered for event ID:', event?.id);
    if (event?.id) {
      console.log('🔄 Calling loadFromAPI for event:', event.id);
      loadFromAPI();
    } else {
      console.log('❌ No event ID available for loading data');
    }
  }, [event?.id]);

  // Show debug popup automatically on page load
  useEffect(() => {
    if (event?.id) {
      // Show debug popup after a short delay to ensure all data is loaded
      const timer = setTimeout(() => {
        showEventDebugPopup();
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [event?.id, eventTimezone]);

  // Setup WebSocket-only real-time connections (no SSE, no polling)
  useEffect(() => {
    if (!event?.id) return;

    console.log('🔌 Setting up WebSocket-only real-time connections for event:', event.id);
    
    const callbacks = {
      onRunOfShowDataUpdated: (data: any) => {
        
        // Skip if this update was made by the current user (prevent save loops)
        if (data && data.last_modified_by === user?.id) {
          console.log('⏭️ Skipping WebSocket update - change made by current user');
          return;
        }
        
        // Skip if user is actively editing (prevent conflicts)
        if (isUserEditing) {
          console.log('⏭️ Skipping WebSocket update - user is actively editing');
          return;
        }
        
        console.log('🔄 Real-time: Updating local data with remote changes');
        
        // Add small delay to ensure WebSocket updates are processed consistently
        setTimeout(() => {
          // Update schedule items
          if (data.schedule_items && Array.isArray(data.schedule_items)) {
            console.log('🔍 Raw schedule data from API:', data.schedule_items.map(item => ({
              id: item.id,
              cue: item.customFields?.cue,
              isIndented: item.isIndented
            })));
            setSchedule(data.schedule_items);
            console.log('✅ Real-time: Schedule items updated');
          }
        
          // Update custom columns
          if (data.custom_columns && Array.isArray(data.custom_columns)) {
            setCustomColumns(data.custom_columns);
            console.log('✅ Real-time: Custom columns updated');
          }
          
          // Update settings
          if (data.settings) {
            if (data.settings.eventName !== undefined) {
              setEventName(data.settings.eventName);
              console.log('✅ Real-time: Event name updated');
            }
            if (data.settings.masterStartTime !== undefined) {
              setMasterStartTime(data.settings.masterStartTime);
              console.log('✅ Real-time: Master start time updated');
            }
            if (data.settings.dayStartTimes !== undefined) {
              setDayStartTimes(data.settings.dayStartTimes);
              console.log('✅ Real-time: Day start times updated');
            }
          }
          
          
          // Skip change detection to prevent delays
          setSkipNextSync(true);
          console.log('⏭️ Real-time: Skipping change detection to prevent delays');
          
          // Update last change timestamp
          if (data.updated_at) {
            setLastChangeAt(data.updated_at);
          }
          
          console.log('✅ Real-time: All schedule data updated via WebSocket');
        }, 100); // 100ms delay for consistency
      },
      onCompletedCuesUpdated: (data: any) => {
        // Update completed cues state directly from WebSocket data - no API polling needed!
        if (data && data.cleared) {
          // All completed cues cleared (from reset button)
          setCompletedCues({});
        } else if (data && data.removed && data.item_id) {
          // Remove completed cue
          setCompletedCues(prev => {
            const newCompleted = { ...prev };
            delete newCompleted[data.item_id];
            return newCompleted;
          });
        } else if (data && Array.isArray(data)) {
          // Full array of completed cues (from GET request) - convert to object format
          const completedObject = data.reduce((acc, cue) => {
            acc[cue.item_id] = true;
            return acc;
          }, {});
          setCompletedCues(completedObject);
        } else if (data && data.item_id) {
          // Add or update single completed cue
          setCompletedCues(prev => ({
            ...prev,
            [data.item_id]: true
          }));
        }
      },
      onResetAllStates: (data: any) => {
        // Clear all states when reset is triggered from another browser
        setActiveTimers({});
        setSubCueTimers({});
        setTimerProgress({});
        setSubCueTimerProgress({});
        setCompletedCues({});
        setOvertimeMinutes({}); // Clear overtime data
        setShowStartOvertime(0); // Clear show start overtime (FIXED!)
        setActiveItemId(null);
        setStoppedItems(new Set());
        setLoadedCueDependents(new Set());
        setLastLoadedCueId(null);
        setHybridTimerData({ activeTimer: null });
        
        // NOTE: Do NOT clear isIndented property - this is part of the schedule structure
        // The reset should only clear completed cues and timer states, not modify schedule structure
        
        console.log('✅ RunOfShow: All states reset via WebSocket (including show start overtime)');
      },
      onOvertimeReset: (data: any) => {
        if (data && data.event_id === event?.id) {
          setOvertimeMinutes({});
          console.log('✅ Overtime data cleared from WebSocket reset');
        }
      },
      onTimerUpdated: (data: any) => {
        console.log('📡 RunOfShow: Event ID check:', { received: data?.event_id, expected: event?.id, match: data?.event_id === event?.id });
        if (data && data.event_id === event?.id) {
          // Update hybrid timer data directly from WebSocket (ClockPage style)
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: data
          }));
          
          // Update timer progress for smooth UI updates
          if (data.item_id) {
            setTimerProgress(prev => ({
              ...prev,
              [data.item_id]: {
                elapsed: data.elapsed_seconds || 0,
                total: data.duration_seconds || 300,
                startedAt: data.started_at ? new Date(data.started_at) : null
              }
            }));
            
            // Update button states based on timer_state (like PhotoViewPage and GreenRoomPage)
            // Convert item_id to number to ensure proper comparison with schedule item IDs
            const numericItemId = typeof data.item_id === 'string' ? parseInt(data.item_id) : data.item_id;
            
            if (data.timer_state === 'running') {
              setActiveTimers(prev => ({ ...prev, [numericItemId]: true }));
              setActiveItemId(numericItemId);
              setLoadedItems(prev => ({ ...prev, [numericItemId]: true }));
              console.log('✅ RunOfShow: Timer RUNNING - button states updated:', numericItemId);
            } else if (data.timer_state === 'loaded') {
              setActiveTimers(prev => {
                const newTimers = { ...prev };
                delete newTimers[numericItemId]; // Remove from running timers
                return newTimers;
              });
              setActiveItemId(numericItemId);
              setLoadedItems(prev => ({ ...prev, [numericItemId]: true }));
              console.log('✅ RunOfShow: Timer LOADED - button states updated:', numericItemId);
            } else if (data.timer_state === 'stopped') {
              setActiveTimers(prev => {
                const newTimers = { ...prev };
                delete newTimers[numericItemId];
                return newTimers;
              });
              setLoadedItems(prev => {
                const newLoaded = { ...prev };
                delete newLoaded[numericItemId];
                return newLoaded;
              });
              if (activeItemId === numericItemId) {
                setActiveItemId(null);
              }
              console.log('✅ RunOfShow: Timer STOPPED - button states updated:', numericItemId);
            }
          }
          
          console.log('✅ RunOfShow: Timer updated via WebSocket:', data);
        } else {
          console.log('⚠️ RunOfShow: Timer update ignored - event ID mismatch or no data');
        }
      },
      onTimerStopped: (data: any) => {
        if (data && data.event_id === event?.id) {
          // Clear hybrid timer data when stopped (ClockPage style)
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          console.log('✅ RunOfShow: Timer cleared via WebSocket');
        }
      },
      onTimersStopped: (data: any) => {
        if (data && data.event_id === event?.id) {
          // Clear hybrid timer data when all stopped (ClockPage style)
          setHybridTimerData(prev => ({
            ...prev,
            activeTimer: null
          }));
          // Also clear old state to prevent hanging blue highlighting
          setActiveItemId(null);
          setActiveTimers({});
          console.log('✅ RunOfShow: All timers cleared via WebSocket');
        }
      },
      onTimerStarted: (data: any) => {
        // Update timer state when started
        if (data && data.item_id) {
          setActiveTimers(prev => ({
            ...prev,
            [data.item_id]: true
          }));
        }
      },
      onSubCueTimerStarted: (data: any) => {
        if (data && data.event_id === event?.id) {
          // Update hybrid timer data with sub-cue timer (ClockPage style)
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: data
          }));
          console.log('✅ RunOfShow: Sub-cue timer started via WebSocket:', data);
        }
      },
      onSubCueTimerStopped: (data: any) => {
        if (data && data.event_id === event?.id) {
          // Clear hybrid timer data sub-cue timer (ClockPage style)
          setHybridTimerData(prev => ({
            ...prev,
            secondaryTimer: null
          }));
          console.log('✅ RunOfShow: Sub-cue timer stopped via WebSocket');
        }
      },
      onServerTime: (data: any) => {
        // Sync client clock with server clock
        const serverTime = new Date(data.serverTime).getTime();
        const clientTime = new Date().getTime();
        const offset = serverTime - clientTime;
        setClockOffset(offset);
        console.log('🕐 Clock sync:', {
          serverTime: data.serverTime,
          clientTime: new Date().toISOString(),
          offsetMs: offset,
          offsetSeconds: Math.floor(offset / 1000)
        });
      },
      onActiveTimersUpdated: (data: any) => {
        
        // Handle array format (from server broadcast) - ClockPage style
        let timerData = data;
        if (Array.isArray(data) && data.length > 0) {
          timerData = data[0]; // Take first timer from array
          console.log('📡 RunOfShow: Processing first timer from array:', timerData);
        }
        
        console.log('📡 RunOfShow: Event ID check:', { received: timerData?.event_id, expected: event?.id, match: timerData?.event_id === event?.id });
        if (timerData && timerData.event_id === event?.id) {
          // Debounce: Only update if timer data has actually changed
          const currentTimer = hybridTimerData?.activeTimer;
          if (currentTimer && currentTimer.id === timerData.id && 
              currentTimer.timer_state === timerData.timer_state &&
              currentTimer.is_active === timerData.is_active &&
              currentTimer.is_running === timerData.is_running) {
            console.log('⏭️ RunOfShow: Ignoring duplicate timer update:', timerData.id);
            return;
          }
          
          // Check if timer is stopped or inactive
          if (timerData.timer_state === 'stopped' || !timerData.is_active || timerData.is_running === false && timerData.is_active === false) {
            // Clear timer data when stopped
            setHybridTimerData(prev => ({
              ...prev,
              activeTimer: null
            }));
            // Also clear old state to prevent hanging blue highlighting
            setActiveItemId(null);
            setActiveTimers({});
            console.log('✅ RunOfShow: Timer stopped via WebSocket - cleared timer data and old state');
          } else {
            // Additional check: if this is the same timer that was previously stopped, ignore it
            const currentHybridTimer = hybridTimerData?.activeTimer;
            if (currentHybridTimer && currentHybridTimer.id === timerData.id && 
                (currentHybridTimer.timer_state === 'stopped' || !currentHybridTimer.is_active)) {
              console.log('⏭️ RunOfShow: Ignoring stale timer data for stopped timer:', timerData.id);
              return;
            }
            
            // Update timer data directly from WebSocket
            setHybridTimerData(prev => ({
              ...prev,
              activeTimer: timerData
            }));
            console.log('✅ RunOfShow: Active timer updated via WebSocket:', timerData);
          }
        } else {
          console.log('⚠️ RunOfShow: Active timers update ignored - event ID mismatch or no data');
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log(`🔌 WebSocket connection ${connected ? 'established' : 'lost'} for event: ${event.id}`);
      },
      onInitialSync: async () => {
        console.log('🔄 WebSocket initial sync triggered - loading current state');
        
        // NOTE: loadActiveTimerFromAPI() is now called AFTER schedule is loaded
        // in loadFromAPI() to prevent race condition where cue display text is missing
        
        // Load current completed cues
        try {
          const completedCuesResponse = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/completed-cues/${event?.id}`);
          if (completedCuesResponse.ok) {
            const completedCuesArray = await completedCuesResponse.json();
            console.log('🔄 Initial sync: Loaded completed cues:', completedCuesArray);
            
            // Convert array to object format for consistency
            const completedCuesObject = completedCuesArray.reduce((acc, cue) => {
              acc[cue.item_id] = true;
              return acc;
            }, {});
            
            setCompletedCues(completedCuesObject);
            console.log('✅ Initial sync: Converted completed cues to object format:', completedCuesObject);
          }
        } catch (error) {
          console.error('❌ Initial sync failed to load completed cues:', error);
        }
        
        // NEW: Reload overtime data when WebSocket reconnects (e.g., returning to page)
        // This matches the same loading order as initial page load
        if (event?.id) {
          try {
            console.log('🔄 Initial sync: Reloading overtime data on page return...');
            
            // Load regular overtime minutes from dedicated table (same as initial load)
            const overtimeData = await DatabaseService.getOvertimeMinutes(event.id);
            setOvertimeMinutes(overtimeData);
            console.log('✅ Initial sync: Overtime minutes reloaded on page return:', overtimeData);
            
            // Load START cue overtime from separate table (same as initial load)
            const showStartOvertimeData = await DatabaseService.getShowStartOvertime(event.id);
            if (showStartOvertimeData) {
              const overtimeMinutes = showStartOvertimeData.show_start_overtime || showStartOvertimeData.overtimeMinutes;
              setShowStartOvertime(overtimeMinutes);
              console.log('✅ Initial sync: Show start overtime reloaded on page return:', overtimeMinutes);
            } else {
              setShowStartOvertime(0);
              console.log('✅ Initial sync: No show start overtime found on page return');
            }
          } catch (overtimeError) {
            console.error('❌ Initial sync: Error reloading overtime data on page return:', overtimeError);
          }
        }
        
      },
      onOvertimeUpdate: (data: any) => {
        
        if (data && data.event_id === event?.id && data.item_id && typeof data.overtimeMinutes === 'number') {
          console.log(`✅ Overtime update validation passed - updating item ${data.item_id} to ${data.overtimeMinutes} minutes`);
          
          // Update local overtime state
          setOvertimeMinutes(prev => {
            const updated = {
              ...prev,
              [data.item_id]: data.overtimeMinutes
            };
            console.log('📊 Overtime state after update:', updated);
            return updated;
          });
          
          // If this is the START cue, also update showStartOvertime
          if (data.item_id === startCueId) {
            setShowStartOvertime(data.overtimeMinutes);
            console.log(`✅ Show start overtime also updated: ${data.overtimeMinutes} minutes`);
          }
          
          console.log(`✅ Overtime state updated from WebSocket: item ${data.item_id} = ${data.overtimeMinutes} minutes`);
        } else {
          console.log('⚠️ Overtime update ignored - validation failed:', {
            has_data: !!data,
            event_match: data?.event_id === event?.id,
            has_item: !!data?.item_id,
            valid_overtime: typeof data?.overtimeMinutes === 'number',
            received: data
          });
        }
      },
      onShowStartOvertimeUpdate: (data: { event_id: string; item_id: number; showStartOvertime: number }) => {
        console.log('📡 Received show start overtime update:', data);
        if (data.event_id === event?.id) {
          setShowStartOvertime(data.showStartOvertime);
          setStartCueId(data.item_id); // Also update which cue is marked as START
          console.log(`✅ Show start overtime updated: ${data.showStartOvertime} minutes`);
        }
      },
      onShowStartOvertimeReset: (data: { event_id: string }) => {
        console.log('📡 Received show start overtime reset:', data);
        if (data.event_id === event?.id) {
          setShowStartOvertime(0);
          console.log('✅ Show start overtime reset to 0');
        }
      },
      onStartCueSelectionUpdate: (data: { event_id: string; item_id: number }) => {
        console.log('📡 Received start cue selection update:', data);
        if (data.event_id === event?.id) {
          setStartCueId(data.item_id);
          console.log(`✅ Start cue selection updated: item ${data.item_id}`);
        }
      }
    };

    // Connect to WebSocket only (no SSE, no polling)
    // sseClient.connect(event.id, callbacks); // DISABLED: SSE causes excessive API calls
    socketClient.connect(event.id, callbacks);

    // Handle tab visibility changes - resync when user returns to tab
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - disconnect WebSocket to allow server to sleep
        console.log('👁️ Tab hidden - disconnecting WebSocket to save costs');
        socketClient.disconnect(event.id);
      } else if (!socketClient.isConnected()) {
        // Tab visible - reconnect and resync
        console.log('👁️ Tab visible - reconnecting WebSocket');
        socketClient.connect(event.id, callbacks);
        callbacks.onInitialSync?.();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup on unmount
    return () => {
      console.log('🔌 Disconnecting WebSocket connections for event:', event.id);
      // sseClient.disconnect(event.id); // DISABLED: SSE causes excessive API calls
      socketClient.disconnect(event.id);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [event?.id]);

  // Real-time countdown timer for running timers (ClockPage style)
  // Uses clock offset to sync with server time
  useEffect(() => {
    if (hybridTimerData?.activeTimer?.is_running && hybridTimerData?.activeTimer?.is_active) {
      const activeTimer = hybridTimerData.activeTimer;
      const startedAt = new Date(activeTimer.started_at);
      const total = activeTimer.duration_seconds || 0;
      
      console.log('⏰ Hybrid timer - Setup with clock offset:', {
        started_at: activeTimer.started_at,
        total,
        clockOffsetMs: clockOffset,
        clockOffsetSeconds: Math.floor(clockOffset / 1000)
      });
      
      const updateCountdown = () => {
        // Use client time + clock offset to sync with server
        const syncedNow = new Date(Date.now() + clockOffset);
        const elapsed = Math.floor((syncedNow.getTime() - startedAt.getTime()) / 1000);
        
        setHybridTimerProgress({
          elapsed: elapsed,
          total: total
        });
      };
      
      // Update immediately
      updateCountdown();
      
      // Set up interval for real-time updates
      const interval = setInterval(updateCountdown, 1000);
      
      return () => clearInterval(interval);
    } else if (hybridTimerData?.activeTimer && !hybridTimerData?.activeTimer?.is_running) {
      // Timer is loaded but not running - show 0 elapsed
      const activeTimer = hybridTimerData.activeTimer;
      setHybridTimerProgress({
        elapsed: 0,
        total: activeTimer.duration_seconds || 0
      });
    } else if (!hybridTimerData?.activeTimer) {
      // No active timer - clear display
      setHybridTimerProgress({
        elapsed: 0,
        total: 0
      });
    }
  }, [hybridTimerData?.activeTimer?.is_running, hybridTimerData?.activeTimer?.is_active, hybridTimerData?.activeTimer?.started_at, hybridTimerData?.activeTimer?.duration_seconds, hybridTimerData?.activeTimer, clockOffset]);

  // Debug: Monitor schedule changes
  useEffect(() => {
    console.log('📊 Schedule state changed:', {
      scheduleLength: schedule.length,
      firstItem: schedule[0] ? {
        id: schedule[0].id,
        segmentName: schedule[0].segmentName,
        programType: schedule[0].programType
      } : 'No items',
      eventId: event?.id
    });
  }, [schedule, event?.id]);

  // Debug function to manually reload data
  const debugReloadData = () => {
    console.log('🔄 Manual data reload triggered');
    if (event?.id) {
      loadFromAPI();
    } else {
      console.log('❌ No event ID available for reload');
    }
  };

  // Debug function to check data source
  const debugCheckDataSource = async () => {
    if (!event?.id) {
      console.log('❌ No event ID available');
      return;
    }

    console.log('🔍 CHECKING DATA SOURCE:');
    console.log('📊 Current schedule length:', schedule.length);
    
    try {
      // Check API directly
      console.log('🔍 Checking API...');
      const apiData = await DatabaseService.getRunOfShowData(event.id);
      console.log('📥 API data:', {
        found: !!apiData,
        scheduleItems: apiData?.schedule_items?.length || 0,
        customColumns: apiData?.custom_columns?.length || 0
      });

      // Check localStorage
      console.log('🔍 Checking localStorage...');
      const localSchedule = localStorage.getItem(`runOfShowSchedule_${event.id}`);
      const localCustomColumns = localStorage.getItem(`customColumns_${event.id}`);
      console.log('💾 localStorage data:', {
        hasSchedule: !!localSchedule,
        scheduleItems: localSchedule ? JSON.parse(localSchedule).length : 0,
        hasCustomColumns: !!localCustomColumns,
        customColumns: localCustomColumns ? JSON.parse(localCustomColumns).length : 0
      });

      // Check if real-time sync is working
      console.log('🔍 Checking real-time sync status...');
      const changeInfo = await DatabaseService.checkForChanges(event.id, lastChangeAt ?? undefined);
      console.log('🔄 Change detection result:', changeInfo);

    } catch (error) {
      console.error('❌ Error checking data source:', error);
    }
  };

  // Backup functions

  const loadBackups = async () => {
    if (!event?.id) {
      console.log('❌ No event ID available for loading backups');
      return;
    }
    
    try {
      console.log('🔄 Loading backups for event:', event.id);
      console.log('🔄 Event details:', { id: event.id, name: event.name });
      
      // Test if backup table is accessible
      const tableAccessible = await NeonBackupService.testBackupTable();
      // if (!tableAccessible) {
      //   throw new Error('Backup table is not accessible');
      // }
      
      const backupsData = await NeonBackupService.getBackupsForEvent(event.id);
      console.log('📊 Raw backup data received:', backupsData);
      
      setBackups(backupsData);
      
      // Load backup stats
      console.log('🔄 Loading backup stats...');
      const stats = await NeonBackupService.getBackupStats(event.id);
      console.log('📊 Backup stats:', stats);
      setBackupStats(stats);
      
      console.log(`✅ Loaded ${backupsData.length} backups successfully`);
    } catch (error) {
      console.error('❌ Error loading backups:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        eventId: event?.id
      });
      
      // Set empty state on error
      setBackups([]);
      setBackupStats({
        totalBackups: 0,
        lastBackup: null,
        autoBackups: 0,
        manualBackups: 0
      });
    }
  };

  const createManualBackup = async () => {
    if (!event?.id) return;
    
    try {
      console.log('🔄 Creating manual backup for event:', event.id);
      
      const timestamp = new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      const backupName = `${event.name} • ${timestamp}`;
      
      await NeonBackupService.createBackup(
        event.id,
        schedule,
        customColumns,
        event,
        'manual',
        backupName,
        user?.id,
        user?.full_name || user?.email,
        user?.role
      );
      
      console.log('✅ Manual backup created:', backupName);
      
      // Refresh backup stats
      const stats = await NeonBackupService.getBackupStats(event.id);
      setBackupStats(stats);
      
      // Show success message
      alert(`✅ Manual backup created successfully!\n\nBackup: ${backupName}\nSchedule Items: ${schedule.length}\nCustom Columns: ${customColumns.length}`);
      
    } catch (error) {
      console.error('❌ Error creating manual backup:', error);
      alert(`❌ Error creating manual backup: ${error.message}`);
    }
  };

  const openRestorePreview = (backup: BackupData) => {
    setSelectedBackup(backup);
    setShowRestorePreview(true);
  };

  const confirmRestoreFromBackup = async () => {
    if (!event?.id || !selectedBackup) return;
    
    try {
      console.log('🔄 Restoring from backup:', selectedBackup.id);
      
      const restoredData = await NeonBackupService.restoreFromBackup(selectedBackup.id);
      
      // Update the schedule and custom columns
      setSchedule(restoredData.scheduleData);
      setCustomColumns(restoredData.customColumnsData);
      
      // Save to localStorage
      localStorage.setItem(`runOfShowSchedule_${event.id}`, JSON.stringify(restoredData.scheduleData));
      localStorage.setItem(`customColumns_${event.id}`, JSON.stringify(restoredData.customColumnsData));
      
      // Log the restore
      logChange('RESTORE_BACKUP', `Restored from backup: ${restoredData.backupName}`, {
        changeType: 'RESTORE',
        backupName: restoredData.backupName,
        backupId: selectedBackup.id,
        itemCount: restoredData.scheduleData.length,
        customColumnsCount: restoredData.customColumnsData.length
      });
      
      // Save to API
      await DatabaseService.saveRunOfShowData({
        event_id: event.id,
        schedule_items: restoredData.scheduleData,
        custom_columns: restoredData.customColumnsData,
        event_data: restoredData.eventData
      }, {
        userId: user?.id || 'unknown',
        userName: user?.full_name || user?.email || 'Unknown User',
        userRole: user?.role || 'VIEWER'
      });
      
      // Trigger auto-save mechanism to ensure all users see the update
      console.log('💾 Triggering auto-save after backup restore...');
      handleUserEditing();
      
      console.log('✅ Restored from backup:', restoredData.backupName);
      
      // Close both modals
      setShowRestorePreview(false);
      setShowBackupModal(false);
      setSelectedBackup(null);
      
      // Show success message
      alert(`✅ Data restored from backup!\n\nBackup: ${restoredData.backupName}\nDate: ${new Date(restoredData.backupTimestamp).toLocaleString()}\n\nSchedule Items: ${restoredData.scheduleData.length}\nCustom Columns: ${restoredData.customColumnsData.length}`);
      
    } catch (error) {
      console.error('❌ Error restoring from backup:', error);
      alert(`❌ Error restoring from backup: ${error.message}`);
    }
  };

  const deleteBackup = async (backupId: string) => {
    if (!confirm('Are you sure you want to delete this backup?')) return;
    
    try {
      console.log('🔄 Deleting backup:', backupId);
      
      await NeonBackupService.deleteBackup(backupId);
      
      console.log('✅ Backup deleted successfully');
      alert('Backup deleted successfully');
      
      // Refresh backups list
      await loadBackups();
      
    } catch (error) {
      console.error('❌ Error deleting backup:', error);
      alert(`Error deleting backup: ${error.message}`);
    }
  };


  // Check for changes periodically (every 10 seconds) - only when page is visible
  useEffect(() => {
    if (!event?.id) {
      console.log('❌ No event ID, skipping change detection');
      return;
    }

    console.log('🔄 Starting change detection for event:', event.id);
    
    // Start the countdown timer
    startCountdownTimer();

    const checkForChanges = async () => {
      try {
        // Skip this check if user just made a change
        if (skipNextSync) {
          console.log('⏭️ Skipping sync check - user just made a change');
          setSkipNextSync(false); // Reset the skip flag
          // Restart countdown after user made a change
          startCountdownTimer();
          return;
        }
        
        // Skip this check if user is actively editing
        if (isUserEditing) {
          console.log('✏️ Skipping sync check - user is actively editing');
          return;
        }
        
        console.log('🔄 Running change check...');
        const changeInfo = await DatabaseService.checkForChanges(event.id, lastChangeAt ?? undefined);
        
        if (changeInfo.hasChanges) {
          console.log('🔄 Changes detected:', changeInfo);
          setHasChanges(true);
          setChangeNotification({
            show: true,
            lastModifiedBy: changeInfo.lastModifiedBy,
            lastModifiedByName: changeInfo.lastModifiedByName
          });
          
          // Only load changes if page is visible (don't apply changes when page is hidden)
          if (isPageVisible) {
            console.log('🔄 Loading changes automatically...');
            await loadChangesDynamically();
          } else {
            console.log('👁️ Changes detected but page not visible - will load when page becomes visible');
          }
        } else {
          console.log('✅ No changes detected');
        }
      } catch (error) {
        console.error('❌ Error checking for changes:', error);
      }
    };

    // Check immediately
    checkForChanges();
    
    // Smart change detection - only poll as fallback every 5 minutes
    // SSE will handle real-time updates, this is just a safety net
    const interval = setInterval(checkForChanges, 5 * 60 * 1000);
    
    return () => {
      clearInterval(interval);
      stopCountdownTimer();
    };
  }, [event?.id, lastChangeAt, isPageVisible, stopCountdownTimer]);

  // Load pending changes when page becomes visible
  useEffect(() => {
    if (isPageVisible && hasChanges) {
      console.log('👁️ Page became visible with pending changes - loading changes...');
      loadChangesDynamically();
    }
  }, [isPageVisible, hasChanges]);

  // DISABLED: Automatic backup every 5 minutes
  // This was causing interference with the main run of show
  // Manual backup only to prevent accidental data loss
  /*
  useEffect(() => {
    if (!event?.id) return;

    console.log('🔄 Starting automatic backup for event:', event.id);

    const createAutoBackup = async () => {
      try {
        // Skip if user is actively editing
        if (isUserEditing) {
          console.log('✏️ Skipping auto backup - user is actively editing');
          return;
        }

        console.log('🔄 Creating automatic backup...');
        
        await NeonBackupService.createBackup(
          event.id,
          schedule,
          customColumns,
          event,
          'auto',
          undefined,
          user?.id,
          user?.full_name || user?.email,
          user?.role
        );
        
        console.log('✅ Automatic backup created');
        
        // Refresh backup stats
        const stats = await NeonBackupService.getBackupStats(event.id);
        setBackupStats(stats);
        
      } catch (error) {
        console.error('❌ Error creating automatic backup:', error);
      }
    };

    // Create backup immediately
    createAutoBackup();
    
    // Then create backup every 5 minutes (300,000 ms)
    const backupInterval = setInterval(createAutoBackup, 300000);
    
    return () => clearInterval(backupInterval);
  }, [event?.id, schedule, customColumns, isUserEditing]);
  */

  // Load backups when backup modal opens
  useEffect(() => {
    if (showBackupModal && event?.id) {
      loadBackups();
    }
  }, [showBackupModal, event?.id]);

  // Page Visibility API - Pause syncing when tab is not active
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      console.log(`🔄 Page visibility changed: ${isVisible ? 'visible' : 'hidden'}`);
      setIsPageVisible(isVisible);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    if (event?.id) {
      localStorage.setItem(`runOfShowSchedule_${event.id}`, JSON.stringify(schedule));
      
      // Dispatch custom event to notify other tabs/windows of schedule update
      window.dispatchEvent(new CustomEvent('scheduleUpdated', {
        detail: { eventId: event.id, schedule }
      }));
      
      console.log('📝 Schedule saved and event dispatched for event:', event.id);
      
      // Auto-save to API only if this is a user-initiated change
      if (isUserEditing) {
        console.log('💾 User-initiated schedule change detected - auto-saving');
        saveToAPI();
      } else {
        console.log('📥 Schedule change from API/sync - skipping auto-save');
      }
    }
  }, [schedule, event?.id, saveToAPI, isUserEditing]);

  // Separate interval to ensure live JSON files get updated data every 10 seconds
  // This runs independently of sync state to keep graphics links fresh
  useEffect(() => {
    if (!event?.id) return;

    const updateGraphicsData = () => {
      console.log('🔄 Updating graphics data for live JSON files...');
      // Force update localStorage with current data
      localStorage.setItem(`runOfShowSchedule_${event.id}`, JSON.stringify(schedule));
      localStorage.setItem(`customColumns_${event.id}`, JSON.stringify(customColumns));
      localStorage.setItem(`eventName_${event.id}`, eventName);
      localStorage.setItem(`masterStartTime_${event.id}`, masterStartTime);
      localStorage.setItem(`dayStartTimes_${event.id}`, JSON.stringify(dayStartTimes));
      
      // Dispatch event to notify live JSON files
      window.dispatchEvent(new CustomEvent('scheduleUpdated', {
        detail: { eventId: event.id, schedule }
      }));
    };

    // Update immediately
    updateGraphicsData();
    
    // Then update every 30 seconds - Graphics updates less frequent, SSE will handle real-time updates
    const graphicsInterval = setInterval(updateGraphicsData, 30 * 1000);
    
    return () => clearInterval(graphicsInterval);
  }, [event?.id, schedule, customColumns, eventName, masterStartTime, dayStartTimes]);

  useEffect(() => {
    if (event?.id) {
      localStorage.setItem(`customColumns_${event.id}`, JSON.stringify(customColumns));
      // Auto-save to API only if this is a user-initiated change
      if (isUserEditing) {
        console.log('💾 User-initiated custom columns change detected - auto-saving');
        saveToAPI();
      } else {
        console.log('📥 Custom columns change from API/sync - skipping auto-save');
      }
    }
  }, [customColumns, event?.id, saveToAPI, isUserEditing]);

  useEffect(() => {
    if (event?.id) {
      localStorage.setItem(`eventName_${event.id}`, eventName);
      // Auto-save to API when event name changes (only if user-initiated)
      if (isUserEditing) {
        console.log('💾 User-initiated event name change detected - auto-saving');
        saveToAPI();
      } else {
        console.log('📥 Event name change from API/sync - skipping auto-save');
      }
    }
  }, [eventName, event?.id, saveToAPI, isUserEditing]);

  useEffect(() => {
    if (event?.id) {
      console.log('⏰ Master start time useEffect triggered:', {
        masterStartTime,
        isUserEditing,
        eventId: event.id,
        willSave: isUserEditing
      });
      localStorage.setItem(`masterStartTime_${event.id}`, masterStartTime);
      // Auto-save to API when master start time changes (only if user-initiated)
      if (isUserEditing) {
        console.log('💾 User-initiated master start time change detected - auto-saving to API with value:', masterStartTime);
        saveToAPI();
      } else {
        console.log('📥 Master start time change from API/sync - skipping auto-save (value:', masterStartTime, ')');
      }
    }
  }, [masterStartTime, event?.id, saveToAPI, isUserEditing]);

  useEffect(() => {
    if (event?.id) {
      console.log('⏰ Day start times useEffect triggered:', {
        dayStartTimes,
        isUserEditing,
        eventId: event.id
      });
      localStorage.setItem(`dayStartTimes_${event.id}`, JSON.stringify(dayStartTimes));
      // Auto-save to API when day start times change (only if user-initiated)
      if (isUserEditing) {
        console.log('💾 User-initiated day start times change detected - auto-saving to API');
        saveToAPI();
      } else {
        console.log('📥 Day start times change from API/sync - skipping auto-save');
      }
    }
  }, [dayStartTimes, event?.id, saveToAPI, isUserEditing]);


  // Sync timer data with full-screen timer window
  useEffect(() => {
    if (fullScreenTimerWindow && !fullScreenTimerWindow.closed) {
      const activeTimerIds = Object.keys(activeTimers);
      const currentItem = activeTimerIds.length > 0 
        ? schedule.find(item => activeTimers[item.id])
        : schedule.find(item => item.id === activeItemId);

      const timerData = {
        type: 'TIMER_UPDATE',
        isRunning: activeTimerIds.length > 0,
        elapsedTime: currentItem && timerProgress[currentItem.id] 
          ? timerProgress[currentItem.id].elapsed 
          : 0,
        totalDuration: currentItem && timerProgress[currentItem.id]
          ? timerProgress[currentItem.id].total  // Use server-synced total duration
          : currentItem 
            ? currentItem.durationHours * 3600 + currentItem.durationMinutes * 60 + currentItem.durationSeconds
            : 0,
        eventId: event?.id, // Include eventId for API messages
        itemId: currentItem?.id, // Include itemId for drift detection
        mainTimer: currentItem ? {
          cue: currentItem.customFields.cue || 'CUE',
          segmentName: currentItem.segmentName || ''
        } : null,
        secondaryTimer: secondaryTimer ? {
          itemId: secondaryTimer.itemId,
          remaining: secondaryTimer.remaining,
          duration: secondaryTimer.duration,
          cue: schedule.find(item => item.id === secondaryTimer.itemId)?.customFields.cue || 'CUE',
          segmentName: schedule.find(item => item.id === secondaryTimer.itemId)?.segmentName || ''
        } : null
      };

      fullScreenTimerWindow.postMessage(timerData, '*');
    }
  }, [activeTimers, timerProgress, activeItemId, schedule, masterStartTime, eventName, fullScreenTimerWindow, secondaryTimer]);




  const addScheduleItem = (newItem: Omit<ScheduleItem, 'id'> & { cue?: string }) => {
    // Generate random Timer ID
    const generateRandomTimerId = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };
    
    const item: ScheduleItem = {
      ...newItem,
      id: Date.now(),
      timerId: generateRandomTimerId(),
      isIndented: newItem.isIndented || false,
      customFields: {
        cue: newItem.cue || ''
      }
    };
    if (insertRowPosition !== null) {
      // Insert at specific position (below the current row)
      setSchedule(prev => {
        const newSchedule = [...prev];
        newSchedule.splice(insertRowPosition + 1, 0, item);
        return newSchedule;
      });
      setInsertRowPosition(null);
    } else {
      // Add to end (normal behavior)
      setSchedule(prev => [...prev, item]);
    }
    
    // Calculate the actual row number where the item was added
    const actualRowNumber = insertRowPosition !== null ? insertRowPosition + 2 : schedule.length + 1;
    
    // Log the change with comprehensive information
    logChange('ADD_ITEM', `Added new schedule item: "${item.segmentName}"`, {
      changeType: 'ADD',
      itemId: item.id,
      itemName: item.segmentName,
      rowNumber: actualRowNumber,
      cueNumber: item.customFields.cue ? parseInt(item.customFields.cue, 10) : null,
      details: {
        // Basic Info
        day: item.day,
        programType: item.programType,
        shotType: item.shotType,
        position: `Row ${actualRowNumber}`,
        
        // Duration
        durationHours: item.durationHours,
        durationMinutes: item.durationMinutes,
        totalDurationMinutes: (item.durationHours * 60) + item.durationMinutes,
        
        // Content Details
        speakers: item.speakers || 'None',
        speakersText: item.speakersText || 'None',
        notes: item.notes || '',
        
        // Technical Details
        assets: item.assets || 'None',
        hasPPT: item.hasPPT,
        hasQA: item.hasQA,
        
        // Timer Info
        timerId: item.timerId,
        isPublic: item.isPublic,
        isIndented: item.isIndented
      }
    });
    
    setShowAddModal(false);
    handleModalClosed();
    // Reset form
    setModalForm({
      cue: '',
      day: selectedDay,
      programType: 'PreShow/End',
      shotType: '',
      segmentName: '',
      durationHours: 0,
      durationMinutes: 0,
      durationSeconds: 0,
      notes: '',
      assets: '',
      speakers: '',
      speakersText: '',
      hasPPT: false,
      hasQA: false,
      timerId: '',
      isPublic: false,
      isIndented: false,
      customFields: {}
    });
  };

  const addCustomColumn = (name: string) => {
    const newColumn: CustomColumn = { name, id: Date.now().toString() };
    setCustomColumns(prev => [...prev, newColumn]);
    
    // Add the field to existing schedule items
    setSchedule(prev => prev.map(item => ({
      ...item,
      customFields: { ...item.customFields, [name]: '' }
    })));
    
    // Log the change
    logChange('COLUMN_ADD', `Added custom column "${name}"`, {
      changeType: 'COLUMN_ADD',
      columnName: name,
      details: {
        columnType: 'text',
        affectedItems: schedule.length,
        defaultValue: ''
      }
    });
    
    setShowCustomColumnModal(false);
    handleModalClosed();
  };

  const removeCustomColumn = (columnId: string) => {
    const column = customColumns.find(col => col.id === columnId);
    if (!column) return;

    setCustomColumns(prev => prev.filter(col => col.id !== columnId));
    
    // Remove the field from existing schedule items
    setSchedule(prev => prev.map(item => {
      const { [column.name]: removed, ...rest } = item.customFields;
      return { ...item, customFields: rest };
    }));
    
    // Log the change
    logChange('COLUMN_REMOVE', `Removed custom column "${column.name}"`, {
      changeType: 'COLUMN_REMOVE',
      columnName: column.name,
      details: {
        affectedItems: schedule.length,
        columnId: column.id
      }
    });
  };

  // Column resize handlers
  const handleResizeStart = (e: React.MouseEvent, columnName: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = columnWidths[columnName as keyof typeof columnWidths] || 256;
    
    // Add dragging class to body for visual feedback
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(100, startWidth + deltaX); // Minimum width of 100px
      
      setColumnWidths(prev => ({
        ...prev,
        [columnName]: newWidth
      }));
    };
    
    const handleMouseUp = () => {
      // Remove dragging styles
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleCustomColumnResizeStart = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const startWidth = customColumnWidths[columnId] || 256;
    
    // Add dragging class to body for visual feedback
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(100, startWidth + deltaX); // Minimum width of 100px
      
      setCustomColumnWidths(prev => ({
        ...prev,
        [columnId]: newWidth
      }));
    };
    
    const handleMouseUp = () => {
      // Remove dragging styles
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const toggleTimer = async (itemId: number) => {
    if (!user || !event?.id) return;

    if (activeTimers[itemId]) {
      // Stop timer and mark as completed
      clearInterval(activeTimerIntervals[itemId]);
      
      // Stop drift sync interval
      const driftSyncKey = `${itemId}_drift`;
      if (activeTimers[driftSyncKey]) {
        clearInterval(activeTimerIntervals[driftSyncKey]);
      }
      
      setActiveTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[itemId];
        delete newTimers[driftSyncKey];
        return newTimers;
      });
      
      setActiveTimerIntervals(prev => {
        const newIntervals = { ...prev };
        delete newIntervals[itemId];
        delete newIntervals[driftSyncKey];
        return newIntervals;
      });
      
      // Drift detection removed - using WebSocket-only approach
      
      // Remove from server-synced timers
      setServerSyncedTimers(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
      
      setCompletedCues(prev => {
        const newCompleted = { ...prev, [itemId]: true };
        console.log('🔄 ToggleTimer: Updated completedCues for main item:', itemId, 'new state:', newCompleted);
        return newCompleted;
      });
      // Add to stopped items for inactive styling
      setStoppedItems(prev => new Set([...prev, itemId]));
      
      // Calculate automatic overtime from hybrid timer (positive or negative) - only when timer stops
      const currentProgress = timerProgress[itemId];
      if (currentProgress && currentProgress.elapsed > 0) {
        const scheduledDuration = (currentProgress.total || 0) / 60; // Convert to minutes
        const actualDuration = (currentProgress.elapsed || 0) / 60; // Convert to minutes
        const overtimeMinutes = Math.floor(actualDuration - scheduledDuration);
        
        // Only calculate overtime if there's a meaningful difference (at least 1 minute)
        if (Math.abs(overtimeMinutes) >= 1) {
          const overtimeType = overtimeMinutes > 0 ? 'over' : 'under';
          console.log(`⏰ Automatic overtime detected: ${Math.abs(overtimeMinutes)} minutes ${overtimeType} for cue ${itemId}`);
          
          // Update local state
          setOvertimeMinutes(prev => ({
            ...prev,
            [itemId]: overtimeMinutes
          }));
          
          // Save to database
          if (event?.id) {
            try {
              await DatabaseService.saveOvertimeMinutes(event.id, itemId, overtimeMinutes);
              console.log(`✅ Overtime minutes saved to database: ${overtimeMinutes} minutes for item ${itemId}`);
            } catch (error) {
              console.error('❌ Failed to save overtime minutes to database:', error);
            }
          }
          
          // Broadcast via WebSocket to other users
          if (event?.id) {
            const socket = socketClient.getSocket();
            if (socket) {
              const overtimePayload = {
                event_id: event.id,
                item_id: itemId,
                overtimeMinutes: overtimeMinutes
              };
              console.log('📡 Broadcasting overtime update via WebSocket:', overtimePayload);
              socket.emit('overtimeUpdate', overtimePayload);
              console.log(`✅ Overtime update broadcasted: ${overtimeMinutes} minutes for item ${itemId}`);
            } else {
              console.warn('⚠️ Cannot broadcast overtime - socket not available');
            }
          } else {
            console.warn('⚠️ Cannot broadcast overtime - no event ID');
          }
          
          // Log the overtime change
          logChange('OVERTIME_DETECTED', `${Math.abs(overtimeMinutes)} minutes ${overtimeType} for cue ${itemId}`, {
            cueId: itemId,
            scheduledDuration: Math.floor(scheduledDuration),
            actualDuration: Math.floor(actualDuration),
            overtimeMinutes: overtimeMinutes,
            overtimeType: overtimeType
          });
        }
      }
      
      // Mark cue as completed in database
      try {
        const item = schedule.find(s => s.id === itemId);
        await DatabaseService.markCueCompleted(
          event.id, 
          itemId, 
          item?.customFields?.cue || 'CUE', 
          user.id, 
          user.full_name || user.email || 'Unknown User',
          currentUserRole || 'VIEWER'
        );
      } catch (error) {
        console.warn('⚠️ Failed to mark cue as completed in database:', error);
        console.log('💡 This means the completed_cues table needs to be created first');
      }
      
      // Also complete any indented items that are part of this CUE group
      const currentIndex = schedule.findIndex(item => item.id === itemId);
      console.log('🔄 ToggleTimer: Current index for item', itemId, ':', currentIndex);
      
      if (currentIndex !== -1) {
        console.log('🔄 ToggleTimer: Looking for indented items after index', currentIndex);
        // Find all indented items that follow this CUE until the next non-indented item
        for (let i = currentIndex + 1; i < schedule.length; i++) {
          console.log('🔄 ToggleTimer: Checking item at index', i, ':', schedule[i].segmentName, 'isIndented:', schedule[i].isIndented);
          if (schedule[i].isIndented) {
            console.log('🔄 ToggleTimer: Marking indented item as completed:', schedule[i].id, schedule[i].segmentName);
            setCompletedCues(prev => {
              const newCompleted = { ...prev, [schedule[i].id]: true };
              console.log('🔄 ToggleTimer: Updated completedCues for indented item:', schedule[i].id, 'new state:', newCompleted);
              return newCompleted;
            });
            setStoppedItems(prev => new Set([...prev, schedule[i].id]));
            // Mark indented items as completed in database too
            try {
              await DatabaseService.markCueCompleted(
                event.id, 
                schedule[i].id, 
                schedule[i].customFields?.cue || 'CUE', 
                user.id, 
                user.full_name || user.email || 'Unknown User',
                currentUserRole || 'VIEWER'
              );
              console.log('✅ ToggleTimer: Successfully marked indented item as completed in database:', schedule[i].id);
            } catch (error) {
              console.error('❌ ToggleTimer: Failed to mark indented item as completed in database:', schedule[i].id, error);
            }
          } else {
            // Stop when we hit a non-indented item (next CUE group)
            console.log('🔄 ToggleTimer: Hit non-indented item, stopping search at index', i);
            break;
          }
        }
      } else {
        console.log('⚠️ ToggleTimer: Could not find current item in schedule:', itemId);
      }
      
      // Don't clear dependent row highlighting when timer is stopped - they should stay highlighted
      
      // Clear loaded state - set cue timer buttons back to non-loaded state
      setLoadedItems(prev => {
        const newLoadedItems = { ...prev };
        delete newLoadedItems[itemId];
        return newLoadedItems;
      });
      
      // Clear active item if this was the active item
      if (activeItemId === itemId) {
        setActiveItemId(null);
      }
      
      setTimerProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[itemId];
        return newProgress;
      });

      // Stop any running sub-cue timer when main timer is stopped
      if (secondaryTimer) {
        console.log('🛑 Stopping sub-cue timer because main timer was stopped');
        await stopSecondaryTimer();
      }

      // Update active_timers table in API
      console.log('🔄 Stopping timer in API for item:', itemId);
      await DatabaseService.stopTimer(
        event.id, 
        itemId, 
        user.id, 
        user.full_name || user.email || 'Unknown User',
        currentUserRole || 'VIEWER'
      );
      console.log('✅ Timer stopped in API');
      
      // Try to save last loaded CUE as stopped (will fail gracefully if migration not run)
      try {
        await DatabaseService.updateLastLoadedCue(event.id, itemId, 'stopped');
        console.log('✅ Last loaded CUE saved as stopped');
      } catch (error) {
        console.log('⚠️ Could not save last loaded CUE as stopped (migration may not be run):', error);
      }
      
      // Backup schedule data before broadcasting
      await backupScheduleData();
      
      // Timer stopped - no broadcast needed, real-time sync will handle it
    } else {
      // Don't allow starting a new timer if any timer is already running
      if (Object.keys(activeTimers).length > 0) {
        return; // Exit early if any timer is running
      }

      // Start new timer
      const item = schedule.find(s => s.id === itemId);
      if (item) {
        const totalSeconds = item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds;
        
        // Calculate show start overtime if this is the START cue
        if (startCueId === itemId) {
          console.log('⭐ This is the START cue - calculating show start overtime');
          
          // Get scheduled start time from Start column (calculated)
          const currentIndex = schedule.findIndex(s => s.id === itemId);
          const scheduledStartStr = calculateStartTime(currentIndex);
          
          console.log('🔍 START cue index:', currentIndex, 'Calculated start time:', scheduledStartStr);
          
          if (scheduledStartStr && scheduledStartStr !== '') {
            const scheduledStart = parseTimeString(scheduledStartStr);
            const actualStart = getCurrentTimeUTC(); // Use current UTC time
            
            if (scheduledStart) {
              // Convert the scheduled start time from event timezone to UTC
              const scheduledStartUTC = convertLocalTimeToUTC(scheduledStart, eventTimezone);
              
              // Calculate difference in minutes
              const diffMs = actualStart.getTime() - scheduledStartUTC.getTime();
              const diffMinutes = Math.round(diffMs / (60 * 1000));
              
              console.log(`⏰ Show Start Overtime: Scheduled=${scheduledStart.toLocaleTimeString()} (${eventTimezone}), ScheduledUTC=${scheduledStartUTC.toISOString()}, Actual=${actualStart.toISOString()}, Diff=${diffMinutes}m`);
              
              // Update local state (keep separate from duration overtime)
              setShowStartOvertime(diffMinutes);
              
              // Save show start overtime to separate table
              if (event?.id) {
                try {
                  await DatabaseService.saveShowStartOvertime(event.id, itemId, diffMinutes, scheduledStartStr, actualStart.toISOString());
                  console.log(`✅ Show start overtime saved to database: ${diffMinutes} minutes for item ${itemId}`);
                } catch (error) {
                  console.error('❌ Failed to save show start overtime:', error);
                }
              }
              
              // Broadcast via WebSocket (custom event for show start)
              if (event?.id) {
                const socket = socketClient.getSocket();
                if (socket) {
                  socket.emit('showStartOvertimeUpdate', {
                    event_id: event.id,
                    item_id: itemId,
                    showStartOvertime: diffMinutes,
                    scheduledTime: scheduledStartStr,
                    actualTime: actualStart.toISOString()
                  });
                  console.log(`✅ Show start overtime broadcasted: ${diffMinutes} minutes`);
                }
              }
              
              // Log the change
              logChange('SHOW_START_OVERTIME', `Show started ${diffMinutes > 0 ? 'late' : 'early'} by ${Math.abs(diffMinutes)} minutes`, {
                itemId: itemId,
                scheduledTime: scheduledStartStr,
                actualTime: actualStart.toISOString(),
                overtimeMinutes: diffMinutes
              });
            } else {
              console.warn('⚠️ Could not parse scheduled start time:', scheduledStartStr);
            }
          } else {
            console.warn('⚠️ No scheduled start time found for START cue. Make sure Master Start Time or Day Start Time is set.');
          }
        }
        
        // OPTIMISTIC UI UPDATE - Show running state immediately
        console.log('⚡ Optimistic UI update - showing running state immediately');
        const now = getCurrentTimeUTC();
        setTimerProgress(prev => ({
          ...prev,
          [itemId]: {
            elapsed: 0,
            total: totalSeconds,
            startedAt: now
          }
        }));
        
        // Start local timer immediately for UI updates (1 second intervals)
        const timer = setInterval(() => {
          setTimerProgress(prev => {
            if (prev[itemId]) {
              // WebSocket-only approach - no drift detection needed
              // Local timer updates are for smooth UI only, WebSocket provides authoritative time
              
              const currentTime = Date.now();
              const startedAtValue = prev[itemId].startedAt;
              
              // Safety check: ensure startedAt is a Date object
              let startTime;
              if (startedAtValue instanceof Date) {
                startTime = startedAtValue.getTime();
              } else if (typeof startedAtValue === 'string') {
                startTime = new Date(startedAtValue).getTime();
              } else {
                console.warn('⚠️ startedAt is not a Date or string:', startedAtValue);
                startTime = currentTime;
              }
              
              const elapsed = Math.floor((currentTime - startTime) / 1000);
              const remaining = totalSeconds - elapsed; // Allow negative values for overrun
              
              // Drift detector removed - WebSocket handles all sync
              
              // Debug logging for first few seconds
              if (elapsed <= 10) {
                console.log(`🕐 Timer ${itemId}: Elapsed=${elapsed}s, Remaining=${remaining}s, Start=${new Date(startTime).toISOString()}, Now=${new Date(currentTime).toISOString()}`);
              }
              
              return {
                ...prev,
                [itemId]: {
                  ...prev[itemId],
                  elapsed: elapsed
                }
              };
            }
            return prev;
          });
        }, 1000); // Update every 1 second for smooth UI
        
        setActiveTimerIntervals(prev => ({ ...prev, [itemId]: timer }));
        setActiveTimers(prev => ({ ...prev, [itemId]: true }));
        // Don't clear completed state when starting a timer - let it persist
        
        // Start drift detection for long-running timers
        // Drift detection removed - WebSocket handles all timer synchronization
        console.log(`🔄 Timer ${itemId} started - WebSocket will handle all synchronization`);
        
        // WebSocket-only approach - no drift detection needed
        console.log(`🔄 Timer ${itemId} will receive updates via WebSocket`);
        
        // Calculate row number and cue display for database
        const currentIndex = schedule.findIndex(scheduleItem => scheduleItem.id === itemId);
        const rowNumber = currentIndex + 1; // 1-based row number
        const cueDisplay = formatCueDisplay(item.customFields.cue);
        
        // Use the existing 5-character timer ID from the schedule item
        const timerId = item.timerId;
        
        // Update active_timers table in API
        console.log('🔄 Starting timer in API for item:', itemId, 'at:', now.toISOString(), 'row:', rowNumber, 'cue:', cueDisplay, 'timerId:', timerId);
        try {
          const startResult = await DatabaseService.startTimer(event.id, itemId, user.id, totalSeconds, now, rowNumber, cueDisplay, timerId);
          console.log('✅ Timer started in API:', startResult);
          if (!startResult) {
            console.error('❌ Start timer failed - check database connection and functions');
          }
        } catch (error) {
          console.error('❌ Start timer error:', error);
        }
        
        // Try to save last loaded CUE as running (will fail gracefully if migration not run)
        try {
          await DatabaseService.updateLastLoadedCue(event.id, itemId, 'running');
          console.log('✅ Last loaded CUE saved as running');
        } catch (error) {
          console.log('⚠️ Could not save last loaded CUE as running (migration may not be run):', error);
        }
        
        // WebSocket-only approach - no periodic drift sync needed
        
        // Keep using local timer for now (database sync disabled)
        console.log('✅ Timer started locally with drift detection enabled');
        
        // Backup schedule data before broadcasting
        await backupScheduleData();
        
        // Timer started - no broadcast needed, real-time sync will handle it
        // Remove from stopped items when starting
        setStoppedItems(prev => {
          const newStopped = new Set(prev);
          newStopped.delete(itemId);
          
          // Also remove any indented items that belong to this CUE group
          const currentIndex = schedule.findIndex(item => item.id === itemId);
          if (currentIndex !== -1) {
            for (let i = currentIndex + 1; i < schedule.length; i++) {
              if (schedule[i].isIndented) {
                newStopped.delete(schedule[i].id);
              } else {
                // Stop when we hit a non-indented item (next CUE group)
                break;
              }
            }
          }
          
          return newStopped;
        });
      }
    }
  };

  // Reset timer - stop and clear currently running timer
  const resetTimer = async (itemId: number) => {
    if (!user || !event?.id) return;

    console.log('🔄 Reset timer for item:', itemId);

    // Stop the timer if it's running
    if (activeTimers[itemId]) {
      // Clear the timer interval
      clearInterval(activeTimerIntervals[itemId]);
      
      // Stop drift sync interval
      const driftSyncKey = `${itemId}_drift`;
      if (activeTimerIntervals[driftSyncKey]) {
        clearInterval(activeTimerIntervals[driftSyncKey]);
      }
      
      // Remove from active timers
      setActiveTimers(prev => {
        const newTimers = { ...prev };
        delete newTimers[itemId];
        delete newTimers[driftSyncKey];
        return newTimers;
      });
      
      setActiveTimerIntervals(prev => {
        const newIntervals = { ...prev };
        delete newIntervals[itemId];
        delete newIntervals[driftSyncKey];
        return newIntervals;
      });
      
      // Drift detection removed - WebSocket-only approach
      
      // Remove from server-synced timers
      setServerSyncedTimers(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
      
      // Clear timer progress
      setTimerProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[itemId];
        return newProgress;
      });

      // Update database
      try {
        await DatabaseService.stopTimer(
          event.id, 
          itemId, 
          user.id, 
          user.full_name || user.email || 'Unknown User',
          currentUserRole || 'VIEWER'
        );
        console.log('✅ Timer reset in API');
      } catch (error) {
        console.error('❌ Error resetting timer in database:', error);
      }
    }

    // Clear loaded state
    setLoadedItems(prev => {
      const newLoadedItems = { ...prev };
      delete newLoadedItems[itemId];
      return newLoadedItems;
    });
    
    // Clear active item if this was the active item
    if (activeItemId === itemId) {
      setActiveItemId(null);
    }

    console.log('✅ Timer reset completed for item:', itemId);
  };

  // Start secondary timer for indented CUEs
  const startSecondaryTimer = async (itemId: number) => {
    if (!user || !event?.id) return;
    
    const item = schedule.find(s => s.id === itemId);
    if (item && indentedCues[itemId]) {
      const totalSeconds = item.durationHours * 3600 + item.durationMinutes * 60 + item.durationSeconds;
      
      console.log('🟠 Starting secondary timer for item:', itemId, 'Duration:', totalSeconds, 's');
      
      // Immediately update local state for instant UI feedback
      setSubCueTimerProgress(prev => ({
        ...prev,
        [itemId]: {
          elapsed: 0,
          total: totalSeconds,
          startedAt: getCurrentTimeUTC()
        }
      }));
      
      // Start local timer interval
      const timer = setInterval(() => {
        setSubCueTimerProgress(prev => {
          const progress = prev[itemId];
          if (!progress) return prev;
          
          const elapsed = Math.floor((Date.now() - (progress.startedAt?.getTime() || Date.now())) / 1000);
          const remaining = Math.max(0, progress.total - elapsed);
          
          return {
            ...prev,
            [itemId]: {
              ...progress,
              elapsed
            }
          };
        });
        
        // Update secondaryTimer state with remaining time
        setSecondaryTimer(prev => {
          if (!prev) return null;
          
          // Skip update if we're currently syncing to prevent flickering
          if (isSyncingSubCue) {
            return prev;
          }
          
          // Calculate remaining time directly from start time
          const startTime = prev.startedAt?.getTime() || Date.now();
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const remaining = Math.max(0, prev.duration - elapsed);
          
          // Auto-stop when timer reaches 0, but hold for a beat
          if (remaining === 0) {
            console.log('⏰ Sub-cue timer reached 0 - holding for a beat');
            // Capture current event ID to avoid stale closure
            const currentEventId = event?.id;
            console.log('⏰ Current event ID for database call:', currentEventId);
            
            // Hold at 0 for 1 second before clearing local state
            setTimeout(() => {
              console.log('⏰ Sub-cue timer auto-stopping after hold - clearing local state');
              // Clear the interval
              if (secondaryTimerInterval) {
                clearInterval(secondaryTimerInterval);
                setSecondaryTimerInterval(null);
              }
              // Clear sub-cue timer state
              Object.keys(subCueTimers).forEach(timerId => {
                if (subCueTimers[parseInt(timerId)]) {
                  clearInterval(subCueTimers[parseInt(timerId)]);
                }
              });
              setSubCueTimers({});
              setSubCueTimerProgress({});
              setSecondaryTimer(null);
              
              // Wait 3 more seconds before clearing from Supabase database
              setTimeout(async () => {
                try {
                  if (currentEventId) {
                    console.log('⏰ Clearing sub-cue timer from database after 3s delay with event ID:', currentEventId);
                    const result = await DatabaseService.stopSubCueTimer(currentEventId);
                    console.log('⏰ Database stop result:', result);
                    console.log('⏰ Sub-cue timer stopped in database (is_active = false)');
                  } else {
                    console.error('❌ No event ID available for database call');
                  }
                } catch (error) {
                  console.error('❌ Error stopping sub-cue timer in database:', error);
                  console.error('❌ Error details:', error);
                }
              }, 3000); // 3 second delay before database clear
            }, 1000); // 1 second hold at 0
          }
          
          return {
            ...prev,
            remaining: remaining
          };
        });
      }, 1000);
      
      setSubCueTimers(prev => ({ ...prev, [itemId]: timer }));
      
      // Also set secondaryTimer state for UI compatibility
      setSecondaryTimer({
        itemId: itemId,
        remaining: totalSeconds,
        duration: totalSeconds,
        isActive: true,
        startedAt: getCurrentTimeUTC(),
        timerState: 'running'
      });
      
      try {
        console.log('🟠 User ID:', user.id, 'Event ID:', event.id);
        
        // Get the item details for row number, cue display, and timer ID
        const item = schedule.find(s => s.id === itemId);
        const rowNumber = schedule.findIndex(s => s.id === itemId) + 1; // 1-based index
        const cueDisplay = item ? formatCueDisplay(item.customFields.cue) : `CUE ${itemId}`;
        const timerId = item?.timerId || `SUB${itemId}`;
        
        // Start sub-cue timer (SQL function will handle stopping existing ones)
        try {
          console.log('🔄 Starting sub-cue timer for item:', itemId, '(will auto-stop any existing timers)');
          const result = await DatabaseService.startSubCueTimer(event.id, itemId, user.id, totalSeconds, rowNumber, cueDisplay, timerId, user.full_name || user.email || 'Unknown User', currentUserRole || 'VIEWER');
          console.log('✅ Secondary timer started in Supabase for item:', itemId, 'Result:', result);
          if (result?.error) {
            console.error('❌ Secondary timer database error:', result.error);
          }
        } catch (error) {
          console.error('❌ Secondary timer call failed:', error);
        }
        
        // Broadcast timer action for real-time sync (fallback)
        try {
          // Broadcast disabled - focusing on local functionality first
          console.log('✅ Sub-cue timer started locally');
          console.log('✅ Secondary timer action broadcasted');
        } catch (error) {
          console.error('❌ Error broadcasting secondary timer action:', error);
        }
        
        // Load the timer from Supabase to sync with other clients
        await loadActiveSubCueTimerFromAPI();
      } catch (error) {
        console.error('❌ Error starting secondary timer:', error);
        // If database call fails, clean up local state
        clearInterval(timer);
        setSubCueTimers(prev => {
          const newTimers = { ...prev };
          delete newTimers[itemId];
          return newTimers;
        });
        setSubCueTimerProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[itemId];
          return newProgress;
        });
      }
    }
  };

  // Stop secondary timer
  const stopSecondaryTimer = async () => {
    if (!event?.id) return;
    
    console.log('🛑 Stopping secondary timer...');
    
    // Clear local state immediately (optimistic update)
    setSecondaryTimer(null);
    if (secondaryTimerInterval) {
      clearInterval(secondaryTimerInterval);
      setSecondaryTimerInterval(null);
    }
    
    // Clear sub-cue timer state
    Object.keys(subCueTimers).forEach(timerId => {
      if (subCueTimers[parseInt(timerId)]) {
        clearInterval(subCueTimers[parseInt(timerId)]);
      }
    });
    setSubCueTimers({});
    setSubCueTimerProgress({});
    
    console.log('✅ Local secondary timer state cleared');
    
    try {
      // Stop sub-cue timer in Supabase
      console.log('🛑 Stopping sub-cue timer in database with event ID:', event.id);
      const result = await DatabaseService.stopSubCueTimer(event.id);
      console.log('🛑 Database stop result:', result);
      console.log('🛑 Secondary timer stopped in database (is_active = false)');
      
      // Broadcast timer action for real-time sync (fallback)
      try {
        console.log('🛑 Broadcasting STOP_SECONDARY_TIMER action...');
        // Broadcast disabled - focusing on local functionality first
        console.log('✅ Sub-cue timer stopped locally');
        console.log('✅ Secondary timer stop action broadcasted successfully');
      } catch (error) {
        console.error('❌ Error broadcasting secondary timer stop action:', error);
      }
    } catch (error) {
      console.error('❌ Error stopping sub-cue timer in database:', error);
      console.error('❌ Error details:', error);
      }
      
      // Load updated timer from Supabase (should be null now)
    try {
      await loadActiveSubCueTimerFromAPI();
    } catch (error) {
      console.error('❌ Error loading updated timer from Supabase:', error);
    }
  };

  // Function to extract just the number from CUE field (e.g., "CUE 1" -> "1", "CUE 1.1" -> "1.1", "CUE 1A" -> "1A")
  const extractCueNumber = (cueValue: string): string => {
    if (!cueValue) return '';
    
    // Remove "CUE" prefix and any leading/trailing spaces
    let cleaned = cueValue.toString().trim();
    
    // Remove "CUE" prefix (case insensitive)
    cleaned = cleaned.replace(/^CUE\s*/i, '');
    
    // Remove any leading spaces that might remain
    cleaned = cleaned.trim();
    
    return cleaned;
  };

  // Handle Excel import
  const handleExcelImport = async (importedData: any[]) => {
    try {
      console.log('📊 Processing Excel import:', importedData);
      
      // Confirm with user before adding data
      const confirmMessage = `This will add ${importedData.length} new items to your schedule. Continue?`;
      if (!window.confirm(confirmMessage)) {
        console.log('❌ Excel import cancelled by user');
        return;
      }
      
      // Convert imported data to schedule items
      const newScheduleItems: ScheduleItem[] = importedData.map((row, index) => {
        // Parse duration (format: "HH:MM:SS")
        const durationParts = row.duration ? row.duration.split(':') : ['0', '0', '0'];
        const durationHours = parseInt(durationParts[0]) || 0;
        const durationMinutes = parseInt(durationParts[1]) || 0;
        const durationSeconds = parseInt(durationParts[2]) || 0;
        
        // Generate unique ID
        const newId = Math.max(...schedule.map(s => s.id), 0) + index + 1;
        
        // Transform speaker data from Excel format to Speaker interface format
        let transformedSpeakersData = row.speakers || '';
        if (row.speakers) {
          try {
            const parsedSpeakers = JSON.parse(row.speakers);
            if (Array.isArray(parsedSpeakers)) {
              const transformedSpeakers = parsedSpeakers.map(speaker => ({
                ...speaker,
                photoLink: speaker.photoUrl || speaker.photoLink || '', // Map photoUrl to photoLink
                photoUrl: undefined // Remove the old field
              }));
              transformedSpeakersData = JSON.stringify(transformedSpeakers);
            }
          } catch (e) {
            console.warn('Failed to transform speaker data:', e);
          }
        }
        
        return {
          id: newId,
          segmentName: row.segmentName || `Imported Item ${index + 1}`,
          programType: row.programType || '',
          shotType: row.shotType || '',
          durationHours: durationHours,
          durationMinutes: durationMinutes,
          durationSeconds: durationSeconds,
          notes: row.notes || '',
          assets: row.assets || '',
          speakers: transformedSpeakersData,
          speakersText: transformedSpeakersData,
          hasPPT: row.hasPPT || false,
          hasQA: row.hasQA || false,
          timerId: row.timerId || '',
          isPublic: row.isPublic || false,
          isIndented: row.isIndented || false,
          day: row.day || selectedDay,
          customFields: {
            cue: extractCueNumber(row.cue) || `CUE ${index + 1}`,
            ...row.customFields
          }
        };
      });
      
      // Add new items to schedule (append, don't replace)
      setSchedule(prev => [...prev, ...newScheduleItems]);
      
      // Debug: Check if assets are being imported
      console.log('📊 Imported items with assets:', newScheduleItems.filter(item => item.assets).map(item => ({
        id: item.id,
        segmentName: item.segmentName,
        assets: item.assets
      })));
      
      // Log the import
      logChange('IMPORT_EXCEL', `Imported ${newScheduleItems.length} items from Excel`, {
        changeType: 'IMPORT',
        itemCount: newScheduleItems.length,
        source: 'Excel'
      });
      
      // Trigger auto-save mechanism
      console.log('💾 Triggering auto-save after Excel import...');
      handleUserEditing();
      
      console.log('✅ Excel import completed successfully');
      
    } catch (error) {
      console.error('❌ Error importing Excel data:', error);
      alert('Error importing Excel data. Please check the file format and try again.');
    }
  };

  // Handle delete all schedule items
  const handleDeleteAllScheduleItems = () => {
    try {
      const itemCount = schedule.length;
      
      // Clear all schedule items
      setSchedule([]);
      
      // Log the change
      logChange('DELETE_ALL', `Deleted all ${itemCount} schedule items`, {
        changeType: 'DELETE_ALL',
        itemCount: itemCount,
        source: 'Excel Import Modal'
      });
      
      console.log(`✅ Deleted all ${itemCount} schedule items`);
      
    } catch (error) {
      console.error('❌ Error deleting all schedule items:', error);
      alert('Error deleting schedule items. Please try again.');
    }
  };

  const deleteScheduleItem = (itemId: number) => {
    if (window.confirm('Delete this schedule item?')) {
      const itemToDelete = schedule.find(item => item.id === itemId);
      setSchedule(prev => prev.filter(item => item.id !== itemId));
      setActiveRowMenu(null); // Close menu after deletion
      
      // Log the change with comprehensive information
      if (itemToDelete) {
        const rowNumber = schedule.findIndex(item => item.id === itemId) + 1;
        logChange('REMOVE_ITEM', `Deleted schedule item: "${itemToDelete.segmentName}"`, {
          changeType: 'DELETE',
          itemId: itemToDelete.id,
          itemName: itemToDelete.segmentName,
          rowNumber: rowNumber,
          cueNumber: itemToDelete.customFields.cue ? parseInt(itemToDelete.customFields.cue, 10) : null,
          details: {
            // Basic Info
            day: itemToDelete.day,
            programType: itemToDelete.programType,
            shotType: itemToDelete.shotType,
            position: `Row ${rowNumber}`,
            
            // Duration
            durationHours: itemToDelete.durationHours,
            durationMinutes: itemToDelete.durationMinutes,
            totalDurationMinutes: (itemToDelete.durationHours * 60) + itemToDelete.durationMinutes,
            
            // Content Details
            speakers: itemToDelete.speakers || 'None',
            speakersText: itemToDelete.speakersText || 'None',
            notes: itemToDelete.notes || '',
            
            // Technical Details
            assets: itemToDelete.assets || 'None',
            hasPPT: itemToDelete.hasPPT,
            hasQA: itemToDelete.hasQA,
            
            // Timer Info
            timerId: itemToDelete.timerId,
            isPublic: itemToDelete.isPublic,
            isIndented: itemToDelete.isIndented
          }
        });
      }
    }
  };

  const duplicateScheduleItem = (itemId: number) => {
    const itemToDuplicate = schedule.find(item => item.id === itemId);
    if (itemToDuplicate) {
      const newItem = {
        ...itemToDuplicate,
        id: Date.now(),
        segmentName: `${itemToDuplicate.segmentName} (Copy)`
      };
      setSchedule(prev => [...prev, newItem]);
      setActiveItemMenu(null);
    }
  };

  const moveScheduleItem = (itemId: number, direction: 'up' | 'down') => {
    const currentIndex = schedule.findIndex(item => item.id === itemId);
    if (currentIndex === -1) return;

    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= schedule.length) return;

    const item = schedule[currentIndex];
    const fromRow = currentIndex + 1;
    const toRow = newIndex + 1;

    setSchedule(prev => {
      const newSchedule = [...prev];
      [newSchedule[currentIndex], newSchedule[newIndex]] = [newSchedule[newIndex], newSchedule[currentIndex]];
      return newSchedule;
    });
    
    // Log the change
    if (item) {
      logChange('MOVE_ITEM', `Moved "${item.segmentName}" from row ${fromRow} to row ${toRow}`, {
        changeType: 'MOVE',
        itemId: item.id,
        itemName: item.segmentName,
        details: {
          fromRow: fromRow,
          toRow: toRow,
          direction: direction
        }
      });
    }
    
    setActiveRowMenu(null);
  };

  const moveToSpecificRow = (itemId: number, targetRowNumber: number) => {
    const currentIndex = schedule.findIndex(item => item.id === itemId);
    if (currentIndex === -1) return;

    const targetIndex = targetRowNumber - 1; // Convert to 0-based index
    if (targetIndex < 0 || targetIndex >= schedule.length || targetIndex === currentIndex) return;

    const item = schedule[currentIndex];
    const fromRow = currentIndex + 1;
    const toRow = targetRowNumber;

    setSchedule(prev => {
      const newSchedule = [...prev];
      const item = newSchedule[currentIndex];
      newSchedule.splice(currentIndex, 1);
      newSchedule.splice(targetIndex, 0, item);
      return newSchedule;
    });
    
    // Log the change
    if (item) {
      logChange('MOVE_ITEM', `Moved "${item.segmentName}" from row ${fromRow} to row ${toRow}`, {
        changeType: 'MOVE',
        itemId: item.id,
        itemName: item.segmentName,
        details: {
          fromRow: fromRow,
          toRow: toRow,
          direction: 'specific'
        }
      });
    }
    
    setActiveRowMenu(null);
  };

  const calculateStartTime = (index: number) => {
    const currentItem = schedule[index];
    if (!currentItem) return '';
    
    // If this item is indented, return empty string (no start time)
    if (indentedCues[currentItem.id]) {
      return '';
    }
    
    // Get the appropriate start time for this day
    const itemDay = currentItem.day || 1;
    const startTime = dayStartTimes[itemDay] || masterStartTime;
    
    // If no start time is set for this day, return blank
    if (!startTime) return '';
    
    // Calculate total seconds from the beginning of this day up to this item
    let totalSeconds = 0;
    for (let i = 0; i < index; i++) {
      const item = schedule[i];
      // Only count items from the same day and non-indented items
      if ((item.day || 1) === itemDay && !indentedCues[item.id]) {
        totalSeconds += (item.durationHours || 0) * 3600 + (item.durationMinutes || 0) * 60 + (item.durationSeconds || 0);
      }
    }
    
    const [hours, minutes] = startTime.split(':').map(Number);
    const startSeconds = hours * 3600 + minutes * 60;
    const totalStartSeconds = startSeconds + totalSeconds;
    
    const finalHours = Math.floor(totalStartSeconds / 3600) % 24;
    const finalMinutes = Math.floor((totalStartSeconds % 3600) / 60);
    
    // Convert to 12-hour format
    const date = new Date();
    date.setHours(finalHours, finalMinutes, 0, 0);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  // Calculate start time with automatic overtime adjustments
  const calculateStartTimeWithOvertime = (index: number) => {
    const currentItem = schedule[index];
    if (!currentItem) return '';
    
    // If this item is indented, return empty string (no start time)
    if (indentedCues[currentItem.id]) {
      return '';
    }
    
    // Get the base start time
    const baseStartTime = calculateStartTime(index);
    if (!baseStartTime) return '';
    
    // Calculate total overtime from previous cues, but ignore rows ABOVE the STAR
    let totalOvertimeMinutes = 0;
    
    // Find the START cue index to know where to start counting overtime
    const startCueIndex = startCueId ? schedule.findIndex(s => s.id === startCueId) : -1;
    const startCountingFrom = startCueIndex !== -1 ? startCueIndex : 0;
    
    // Only count overtime from START cue onwards (ignore rows above STAR)
    for (let i = startCountingFrom; i < index; i++) {
      const item = schedule[i];
      const itemDay = item.day || 1;
      const currentItemDay = currentItem.day || 1;
      
      // Only count overtime from the same day and non-indented items
      if (itemDay === currentItemDay && !indentedCues[item.id]) {
        totalOvertimeMinutes += overtimeMinutes[item.id] || 0;
      }
    }
    
    // Add show start overtime for START cue and all rows after it
    if (showStartOvertime !== 0 && startCueId !== null && startCueIndex !== -1 && index >= startCueIndex) {
      totalOvertimeMinutes += showStartOvertime;
    }
    
    // If no overtime, return the base start time
    if (totalOvertimeMinutes === 0) {
      return baseStartTime;
    }
    
    // Parse the base start time and add overtime
    const [timePart, period] = baseStartTime.split(' ');
    const [hours, minutes] = timePart.split(':').map(Number);
    
    let hour24 = hours;
    if (period === 'PM' && hours !== 12) hour24 += 12;
    if (period === 'AM' && hours === 12) hour24 = 0;
    
    // Add overtime minutes
    const totalMinutes = hour24 * 60 + minutes + totalOvertimeMinutes;
    const finalHours = Math.floor(totalMinutes / 60) % 24;
    const finalMinutes = totalMinutes % 60;
    
    // Convert back to 12-hour format
    const date = new Date();
    date.setHours(finalHours, finalMinutes, 0, 0);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  // Get available days based on event duration
  const getAvailableDays = () => {
    const days = event?.numberOfDays || 5; // Default to 5 days if not specified
    console.log('Event data:', event, 'Number of days:', days); // Debug log
    return Array.from({ length: days }, (_, i) => i + 1);
  };

  // Filter schedule by selected day
  const getFilteredSchedule = () => {
    const filtered = schedule.filter(item => (item.day || 1) === selectedDay);
    
    const indentedItems = schedule.filter(item => item.isIndented);
    const filteredIndentedItems = filtered.filter(item => item.isIndented);
    
    // Debug logging removed to prevent console spam
    
    return filtered;
  };

  // Handle scroll for grid headers visibility
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      setShowGridHeaders(scrollTop > 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Scroll synchronization between header and main grid
  useEffect(() => {
    const mainScrollContainer = document.getElementById('main-scroll-container');
    if (!mainScrollContainer) return;

    let isSyncing = false;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (isSyncing) return;
      isSyncing = true;
      target.scrollLeft = source.scrollLeft;
      // Use requestAnimationFrame to reset the flag after the scroll event has been processed
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    const handleMainScroll = () => {
      // Sync with sticky header if it exists
      const stickyHeaderContainer = document.querySelector('.sticky-header-scroll-container');
      if (stickyHeaderContainer) {
        syncScroll(mainScrollContainer, stickyHeaderContainer as HTMLElement);
      }
    };

    const handleStickyHeaderScroll = () => {
      const stickyHeaderContainer = document.querySelector('.sticky-header-scroll-container');
      if (stickyHeaderContainer) {
        syncScroll(stickyHeaderContainer as HTMLElement, mainScrollContainer);
      }
    };

    mainScrollContainer.addEventListener('scroll', handleMainScroll);

    // Add listener for sticky header when it appears
    const observer = new MutationObserver(() => {
      const stickyHeaderContainer = document.querySelector('.sticky-header-scroll-container');
      if (stickyHeaderContainer) {
        stickyHeaderContainer.addEventListener('scroll', handleStickyHeaderScroll);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      mainScrollContainer.removeEventListener('scroll', handleMainScroll);
      observer.disconnect();
    };
  }, []);

  // Drag-to-scroll functionality for horizontal scrolling
  useEffect(() => {
    const setupDragToScroll = (container: HTMLDivElement) => {
      const handleMouseDown = (e: MouseEvent) => {
        // Only enable drag on left mouse button
        if (e.button !== 0) return;
        
        // Don't start drag if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' || 
          target.tagName === 'TEXTAREA' || 
          target.tagName === 'BUTTON' ||
          target.tagName === 'SELECT' ||
          target.closest('button') ||
          target.closest('input') ||
          target.closest('textarea') ||
          target.closest('select') ||
          target.classList.contains('cursor-col-resize')
        ) {
          return;
        }

        dragStateRef.current = {
          isDragging: true,
          startX: e.pageX - container.offsetLeft,
          scrollLeft: container.scrollLeft,
          container
        };
        
        container.style.cursor = 'grabbing';
        container.style.userSelect = 'none';
        e.preventDefault();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!dragStateRef.current.isDragging) return;
        e.preventDefault();
        
        const x = e.pageX - (dragStateRef.current.container?.offsetLeft || 0);
        const walk = (x - dragStateRef.current.startX) * 1.5; // Multiply for faster scroll
        if (dragStateRef.current.container) {
          dragStateRef.current.container.scrollLeft = dragStateRef.current.scrollLeft - walk;
        }
      };

      const handleMouseUp = () => {
        if (dragStateRef.current.isDragging && dragStateRef.current.container) {
          dragStateRef.current.container.style.cursor = 'grab';
          dragStateRef.current.container.style.userSelect = '';
        }
        dragStateRef.current.isDragging = false;
      };

      const handleMouseLeave = () => {
        if (dragStateRef.current.isDragging && dragStateRef.current.container) {
          dragStateRef.current.container.style.cursor = 'grab';
          dragStateRef.current.container.style.userSelect = '';
        }
        dragStateRef.current.isDragging = false;
      };

      container.style.cursor = 'grab';
      container.addEventListener('mousedown', handleMouseDown);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      container.addEventListener('mouseleave', handleMouseLeave);

      return () => {
        container.style.cursor = '';
        container.removeEventListener('mousedown', handleMouseDown);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        container.removeEventListener('mouseleave', handleMouseLeave);
      };
    };

    // Set up drag-to-scroll for main container
    const mainScrollContainer = document.getElementById('main-scroll-container') as HTMLDivElement;
    let cleanupMain: (() => void) | undefined;
    if (mainScrollContainer) {
      mainScrollRef.current = mainScrollContainer;
      cleanupMain = setupDragToScroll(mainScrollContainer);
    }

    // Set up drag-to-scroll for sticky header container
    const stickyHeaderContainer = document.querySelector('.sticky-header-scroll-container') as HTMLDivElement;
    let cleanupSticky: (() => void) | undefined;
    if (stickyHeaderContainer) {
      stickyHeaderScrollRef.current = stickyHeaderContainer;
      cleanupSticky = setupDragToScroll(stickyHeaderContainer);
    }

    // Use MutationObserver to watch for sticky header appearing
    const observer = new MutationObserver(() => {
      const stickyHeaderContainer = document.querySelector('.sticky-header-scroll-container') as HTMLDivElement;
      if (stickyHeaderContainer && !stickyHeaderScrollRef.current) {
        stickyHeaderScrollRef.current = stickyHeaderContainer;
        cleanupSticky = setupDragToScroll(stickyHeaderContainer);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return () => {
      if (cleanupMain) cleanupMain();
      if (cleanupSticky) cleanupSticky();
      observer.disconnect();
    };
  }, []);

  // Auto-scroll to active row when activeItemId changes
  useEffect(() => {
    if (activeItemId !== null) {
      // Small delay to ensure DOM is updated
      setTimeout(() => {
        scrollToActiveRow();
      }, 100);
    }
  }, [activeItemId, isFollowEnabled]);

        // Auto-scroll to active timer row when timers start/stop
        useEffect(() => {
          if (isFollowEnabled && Object.keys(activeTimers).length > 0) {
            const activeTimerId = parseInt(Object.keys(activeTimers)[0]);
            const activeRow = document.querySelector(`[data-item-id="${activeTimerId}"]`);
            if (activeRow) {
              setTimeout(() => {
                // Find the column headers (main grid headers) to ensure row doesn't scroll past them
                const columnHeaders = document.querySelector('#main-scroll-container .h-24');
                let headerOffset = 100; // Default fallback
                
                if (columnHeaders) {
                  const headerRect = columnHeaders.getBoundingClientRect();
                  const containerRect = document.querySelector('#main-scroll-container')?.getBoundingClientRect();
                  if (containerRect) {
                    // Calculate the offset from the top of the viewport to the bottom of column headers
                    // Use getBoundingClientRect for consistent positioning regardless of horizontal scroll
                    headerOffset = headerRect.bottom - containerRect.top - 120; // -120px gap - split the difference
                  }
                }
                
                // Calculate position: ensure row doesn't go above column headers
                // Use getBoundingClientRect for consistent positioning regardless of horizontal scroll
                const elementRect = (activeRow as HTMLElement).getBoundingClientRect();
                const containerRect = document.querySelector('#main-scroll-container')?.getBoundingClientRect();
                if (containerRect) {
                  const scrollPosition = elementRect.top - containerRect.top - headerOffset;
                  
                  // Scroll to position the row below the column headers
                  window.scrollTo({
                    top: scrollPosition,
                    behavior: 'smooth'
                  });
                }
              }, 100);
            }
          }
        }, [activeTimers, isFollowEnabled]);
  if (!event) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">No Event Selected</h1>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
          >
            Back to Event List
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200">
      {/* Page Visibility Indicator */}
      {!isPageVisible && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <div className="w-2 h-2 bg-yellow-300 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium">Tab Hidden - Syncing Paused</span>
        </div>
      )}
      
      {/* Role Change Modal */}
      <RoleSelectionModal
        isOpen={showRoleChangeModal}
        onClose={() => setShowRoleChangeModal(false)}
        onRoleSelected={(role) => {
          setCurrentUserRole(role as 'VIEWER' | 'EDITOR' | 'OPERATOR');
          
          // Save role to both API and localStorage
          if (event?.id && user?.id) {
            try {
              const username = user.full_name || user.email || 'Unknown';
              DatabaseService.saveUserSession(event.id, user.id, username, role).then(success => {
                if (success) {
                  console.log('✅ Role saved to API from RunOfShowPage:', role);
                } else {
                  console.log('⚠️ Failed to save role to API, using localStorage only');
                }
              });
              
              // Also save to localStorage for immediate access
              localStorage.setItem(`userRole_${event.id}`, role);
              console.log('💾 Saved role to localStorage from RunOfShowPage:', role);
            } catch (error) {
              console.error('❌ Failed to save role to API from RunOfShowPage:', error);
              // Still save to localStorage as fallback
              localStorage.setItem(`userRole_${event.id}`, role);
              console.log('💾 Saved role to localStorage as fallback:', role);
            }
          }
          setShowRoleChangeModal(false);
        }}
        eventId={event?.id || ''}
      />

      {/* Running Timer Popup */}
      {showRunningTimerPopup && runningTimerInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4 border-2 border-orange-500">
            <div className="text-center">
              <div className="text-orange-400 text-2xl font-bold mb-4">
                ⏰ Timer Running
              </div>
              <div className="text-white text-lg mb-2">
                <strong>{runningTimerInfo.cueName}</strong>
              </div>
              <div className="text-orange-300 text-xl font-mono mb-6">
                {runningTimerInfo.remainingTime} remaining
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowRunningTimerPopup(false)}
                  className="px-6 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => {
                    setShowRunningTimerPopup(false);
                    masterSyncCueTime();
                  }}
                  className="px-6 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded transition-colors"
                >
                  Sync Timer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Simple Change Log Modal */}
      {showChangeLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold text-white">Change Log</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowMasterChangeLog(false)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      !showMasterChangeLog 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                    }`}
                  >
                    Local ({changeLog.length})
                  </button>
                  <button
                    onClick={() => setShowMasterChangeLog(true)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      showMasterChangeLog 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-slate-600 text-slate-300 hover:bg-slate-500'
                    }`}
                  >
                    Master ({masterChangeLog.length})
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!showMasterChangeLog && (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        console.log('🔄 Sync button clicked - starting sync...');
                        await syncChanges();
                        // Force refresh of local change log display
                        const localChanges = changeLogService.getLocalChanges();
                        console.log('🔄 Local changes after sync:', localChanges.length);
                        setChangeLog(localChanges);
                        console.log('🔄 Local change log refreshed after sync');
                      }}
                      className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                      title="Sync changes to Supabase"
                    >
                      🔄 Sync
                    </button>
                    <button
                      onClick={() => {
                        changeLogService.reloadLocalChanges();
                        const localChanges = changeLogService.getLocalChanges();
                        setChangeLog(localChanges.slice(0, 100));
                        console.log('🔄 Manually reloaded local changes:', localChanges.length);
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                      title="Reload local changes"
                    >
                      🔄 Reload
                    </button>
                  </div>
                )}
                {showMasterChangeLog && (
                  <button
                    onClick={async () => {
                      console.log('🔄 Manual reload button clicked...');
                      const beforeCount = masterChangeLog.length;
                      console.log('📊 Master log entries before reload:', beforeCount);
                      await loadMasterChangeLog();
                      console.log('🔄 Master change log reloaded');
                      console.log('📊 Master log entries after reload:', masterChangeLog.length);
                    }}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                    title="Reload master change log"
                  >
                    🔄 Reload
                  </button>
                )}
              <button
                onClick={() => setShowChangeLog(false)}
                className="text-gray-400 hover:text-white text-2xl"
              >
                ×
              </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {showMasterChangeLog ? (
                // Master Change Log (from Supabase) - Clean Format
                masterChangeLog.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No master changes found</p>
                ) : (
                  <div className="space-y-3">
                    {masterChangeLog.map((change) => {
                      // Parse data from new_values_json if new columns are null (before migration)
                      const details = change.new_values_json || {};
                      const metadata = change.metadata || {};
                      const rowNumber = change.row_number || metadata.rowNumber || details.rowNumber;
                      const cueNumber = change.cue_number || metadata.cueNumber || details.cueNumber;
                      const userRole = change.user_role || metadata.userRole || 'EDITOR';
                      const fieldName = change.field_name || details.fieldName || details.changeType;
                      const oldValue = change.old_value || details.oldValue;
                      const newValue = change.new_value || details.newValue;
                      const description = change.description || details.itemName;
                      
                      return (
                      <div key={change.id} className="bg-slate-700 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-white text-xs px-2 py-1 rounded ${
                              change.action === 'ADD_ITEM' ? 'bg-green-600' :
                              change.action === 'REMOVE_ITEM' ? 'bg-red-600' :
                              change.action === 'FIELD_UPDATE' ? 'bg-blue-600' :
                              change.action === 'MOVE_ITEM' ? 'bg-yellow-600' :
                              change.action === 'COLUMN_ADD' ? 'bg-purple-600' :
                              change.action === 'COLUMN_REMOVE' ? 'bg-orange-600' :
                              'bg-blue-600'
                            }`}>
                              {change.action}
                            </span>
                            <span className="text-gray-300 text-sm">
                              by {change.user_name}
                            </span>
                            {userRole && (
                            <span className="text-gray-500 text-xs">
                                ({userRole})
                            </span>
                            )}
                            {rowNumber && (
                              <span className="text-gray-400 text-xs bg-slate-600 px-2 py-1 rounded">
                                ROW {rowNumber}
                              </span>
                            )}
                            {cueNumber && cueNumber !== 'CUE' && (
                              <span className="text-gray-400 text-xs bg-slate-600 px-2 py-1 rounded">
                                {formatCueDisplay(cueNumber)}
                              </span>
                            )}
                          </div>
                          <div className="text-gray-400 text-xs">
                            {new Date(change.created_at || change.timestamp || change.change_timestamp).toLocaleString()}
                          </div>
                        </div>
                        
                        {/* Show field changes only (ROW/CUE already shown at top) */}
                          <div className="space-y-1 text-sm">
                          {/* Show field changes for FIELD_UPDATE - handle both new columns and existing JSON */}
                          {change.action === 'FIELD_UPDATE' && (fieldName || details.fieldName) && (
                              <div className="text-gray-300">
                              <strong>Field:</strong> {fieldName || details.fieldName}
                              </div>
                            )}
                            
                          {/* Show value changes - handle both new columns and existing JSON */}
                          {change.action === 'FIELD_UPDATE' && (oldValue !== undefined || details.oldValue !== undefined) && (
                              <div className="text-gray-300">
                                <strong>Changed from:</strong> 
                              <span className="text-red-300 ml-1">"{oldValue || details.oldValue}"</span>
                              <span className="text-gray-400 mx-1">→</span>
                              <span className="text-green-300">"{newValue || details.newValue}"</span>
                            </div>
                          )}
                          
                          {/* Fallback: if no field info, show the description but formatted nicely */}
                          {change.action === 'FIELD_UPDATE' && !fieldName && !details.fieldName && description && (
                            <div className="text-gray-300">
                              <strong>Change:</strong> {description}
                              </div>
                            )}
                            
                            {/* Show batch information */}
                            {change.batch_id && (
                              <div className="text-gray-500 text-xs mt-2 pt-2 border-t border-slate-600">
                                Batch: {change.batch_id.slice(0, 8)}... | 
                                Synced: {new Date(change.batch_created_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                      </div>
                    )})}
                  </div>
                )
              ) : (
                // Local Change Log (from buffer)
                changeLog.length === 0 && pendingChanges.size === 0 ? (
                  <p className="text-gray-400 text-center py-8">No local changes recorded yet</p>
              ) : (
                <div className="space-y-3">
                  {changeLog.map((change) => (
                    <div key={change.id} className="bg-slate-700 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-white text-xs px-2 py-1 rounded ${
                            change.action === 'ADD_ITEM' ? 'bg-green-600' :
                            change.action === 'REMOVE_ITEM' ? 'bg-red-600' :
                            change.action === 'FIELD_UPDATE' ? 'bg-blue-600' :
                            change.action === 'MOVE_ITEM' ? 'bg-yellow-600' :
                            change.action === 'COLUMN_ADD' ? 'bg-purple-600' :
                            change.action === 'COLUMN_REMOVE' ? 'bg-orange-600' :
                            change.action === 'AUTO_SAVE' ? 'bg-gray-600' :
                            'bg-blue-600'
                          }`}>
                            {change.action}
                          </span>
                          {change.details?.processedBy && (
                            <span className={`text-white text-xs px-2 py-1 rounded ${
                              change.details.processedBy === 'TIMEOUT' ? 'bg-orange-600' :
                              change.details.processedBy === 'SAVE_BUTTON' ? 'bg-purple-600' :
                              'bg-gray-600'
                            }`}>
                              {change.details.processedBy}
                            </span>
                          )}
                          <span className="text-gray-300 text-sm">
                            by {change.userName}
                          </span>
                          {change.details?.itemId && (
                            <span className="text-gray-400 text-xs">
                              Item #{change.details.itemId}
                            </span>
                          )}
                        </div>
                        <div className="text-gray-400 text-xs">
                          {change.timestamp.toLocaleString()}
                        </div>
                      </div>
                      
                      {/* Clean field information */}
                      {change.details && (
                        <div className="space-y-1 text-sm">
                          {((change.details as any)?.rowNumber || (change.details as any)?.cueNumber) && (
                            <div className="text-gray-300">
                              <strong>Row {(change.details as any)?.rowNumber || '?'} | {formatCueDisplay((change.details as any)?.cueNumber)}</strong>
                            </div>
                          )}
                          
                          {/* Show all values for ADD_ITEM */}
                          {change.action === 'ADD_ITEM' && change.details.details && (
                            <div className="space-y-1">
                              <div className="text-gray-300">
                                <strong>Program Type:</strong> {change.details.details.programType}
                              </div>
                              <div className="text-gray-300">
                                <strong>Shot Type:</strong> {change.details.details.shotType}
                              </div>
                              <div className="text-gray-300">
                                <strong>Duration:</strong> {change.details.details.durationHours}h {change.details.details.durationMinutes}m
                              </div>
                              <div className="text-gray-300">
                                <strong>Speakers:</strong> {change.details.details.speakers}
                              </div>
                              {change.details.details.notes && (
                                <div className="text-gray-300">
                                  <strong>Notes:</strong> {change.details.details.notes}
                                </div>
                              )}
                              <div className="text-gray-300">
                                <strong>Position:</strong> {change.details.details.position}
                              </div>
                            </div>
                          )}
                          
                          {/* Show all values for REMOVE_ITEM */}
                          {change.action === 'REMOVE_ITEM' && change.details.details && (
                            <div className="space-y-1">
                              <div className="text-gray-300">
                                <strong>Program Type:</strong> {change.details.details.programType}
                              </div>
                              <div className="text-gray-300">
                                <strong>Shot Type:</strong> {change.details.details.shotType}
                              </div>
                              <div className="text-gray-300">
                                <strong>Duration:</strong> {change.details.details.durationHours}h {change.details.details.durationMinutes}m
                              </div>
                              <div className="text-gray-300">
                                <strong>Speakers:</strong> {change.details.details.speakers}
                              </div>
                              {change.details.details.notes && (
                                <div className="text-gray-300">
                                  <strong>Notes:</strong> {change.details.details.notes}
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Show field changes for other actions */}
                          {change.action !== 'ADD_ITEM' && change.action !== 'REMOVE_ITEM' && change.details.fieldName && (
                            <div className="text-gray-300">
                              <strong>Field:</strong> {change.details.fieldName}
                            </div>
                          )}
                          
                          {/* Show speakers in readable format */}
                          {change.action !== 'ADD_ITEM' && change.action !== 'REMOVE_ITEM' && change.details.fieldName === 'speakers' && change.details.details && (
                            <div className="space-y-2">
                              <div className="text-gray-300">
                                <strong>Speaker Count:</strong> {change.details.details.speakerCount || 0}
                              </div>
                              {change.details.newValue && (
                                <div className="text-gray-300">
                                  <strong>Speakers:</strong>
                                  <div className="mt-1 text-sm text-blue-300">
                                    {(() => {
                                      try {
                                        const speakers = JSON.parse(change.details.newValue);
                                        if (Array.isArray(speakers)) {
                                          return speakers
                                            .sort((a, b) => a.slot - b.slot)
                                            .map(speaker => `${speaker.slot}. ${speaker.fullName || speaker.name || 'Unknown'} (${speaker.location || 'Unknown'})`)
                                            .join(', ');
                                        }
                                      } catch {
                                        return 'Unable to parse speakers';
                                      }
                                      return 'No speakers';
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Show assets in readable format */}
                          {change.action !== 'ADD_ITEM' && change.action !== 'REMOVE_ITEM' && change.details.fieldName === 'assets' && change.details.details && (
                            <div className="space-y-2">
                              <div className="text-gray-300">
                                <strong>Asset Count:</strong> {change.details.details.assetCount || 0}
                              </div>
                              {change.details.newValue && (
                                <div className="text-gray-300">
                                  <strong>Assets:</strong>
                                  <div className="mt-1 text-sm text-blue-300">
                                    {(() => {
                                      const assets = change.details.newValue.split('||').filter(s => s.trim());
                                      return assets.map(asset => {
                                        if (asset.includes('|')) {
                                          const [name, url] = asset.split('|');
                                          return `${name}${url ? ` (${url})` : ''}`;
                                        }
                                        return asset;
                                      }).join(', ');
                                    })()}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* Show row movement */}
                          {change.action === 'MOVE_ITEM' && change.details.details && (
                            <div className="space-y-1">
                              <div className="text-gray-300">
                                <strong>Moved from Row:</strong> {change.details.details.fromRow || 'Unknown'}
                              </div>
                              <div className="text-gray-300">
                                <strong>Moved to Row:</strong> {change.details.details.toRow || 'Unknown'}
                              </div>
                            </div>
                          )}
                          
                          {/* Show other field changes */}
                          {change.action !== 'ADD_ITEM' && change.action !== 'REMOVE_ITEM' && change.action !== 'MOVE_ITEM' && 
                           change.details.fieldName !== 'speakers' && change.details.fieldName !== 'assets' && 
                           change.details.oldValue !== undefined && change.details.newValue !== undefined && (
                            <div className="text-gray-300">
                              {/* Show just the changed value for duration fields */}
                              {(change.details.fieldName === 'durationHours' || change.details.fieldName === 'durationMinutes' || change.details.fieldName === 'durationSeconds') ? (
                                <span className="text-green-300">{change.details.newValue}</span>
                              ) : (
                                <>
                                  <strong>Changed from:</strong> 
                                  <span className="text-red-300 ml-1">"{change.details.oldValue}"</span>
                                  <span className="text-gray-400 mx-1">→</span>
                                  <span className="text-green-300">"{change.details.newValue}"</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  
                  {/* Pending changes */}
                  {Array.from(pendingChanges.entries()).map(([changeKey, pendingChange]) => {
                    const timeElapsed = Date.now() - pendingChange.timestamp.getTime();
                    const timeRemaining = Math.max(0, 10000 - timeElapsed);
                    const secondsRemaining = Math.ceil(timeRemaining / 1000);
                    
                    return (
                      <div key={changeKey} className="bg-slate-600 rounded-lg p-4 border-2 border-yellow-500 animate-pulse">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="bg-yellow-600 text-white text-xs px-2 py-1 rounded">
                              PENDING [{pendingChange.originalKey || 'NO_KEY'}]
                            </span>
                            <span className="text-slate-300 text-sm">
                              by {pendingChange.user}
                            </span>
                            <span className="text-yellow-300 text-xs">
                              ⏳ Will confirm in {secondsRemaining}s
                            </span>
                          </div>
                          <div className="text-slate-400 text-xs">
                            {pendingChange.timestamp.toLocaleString()}
                          </div>
                        </div>
                        
                        {/* Clean pending change details */}
                        {pendingChange.details && (
                          <div className="space-y-1 text-sm">
                            {((pendingChange.details as any)?.rowNumber || (pendingChange.details as any)?.cueNumber) && (
                              <div className="text-slate-300">
                                <strong>Row {(pendingChange.details as any)?.rowNumber || '?'} | {formatCueDisplay((pendingChange.details as any)?.cueNumber)}</strong>
                              </div>
                            )}
                            {pendingChange.details.fieldName && (
                              <div className="text-slate-300">
                                <strong>Field:</strong> {pendingChange.details.fieldName}
                              </div>
                            )}
                            {pendingChange.details.oldValue !== undefined && pendingChange.details.newValue !== undefined && (
                              <div className="text-slate-300">
                                <strong>Will change from:</strong> 
                                <span className="text-red-300 ml-1">"{pendingChange.details.oldValue}"</span>
                                <span className="text-slate-400 mx-1">→</span>
                                <span className="text-green-300">"{pendingChange.details.newValue}"</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                )
              )}
            </div>
            
            <div className="mt-4 pt-4 border-t border-slate-600">
              <div className="flex justify-between items-center text-sm text-gray-400">
                <div>
                  <span>Total changes: {changeLog.length} ({pendingChanges.size} pending)</span>
                  {pendingChanges.size > 0 && (
                    <span className="ml-2 text-yellow-400">
                      • Changes will be confirmed after 10s of inactivity
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {pendingChanges.size > 0 && (
                <button
                      className="px-3 py-1 bg-yellow-600 text-white rounded transition-colors animate-pulse cursor-not-allowed"
                      disabled
                      title="Changes are pending and will auto-save after 5 seconds"
                    >
                      ⏳ Changes Pending ({pendingChanges.size})
                    </button>
                  )}
                  <button
                    onClick={clearAllChangeLogs}
                  className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded transition-colors"
                    title="Clear all change logs (password protected)"
                >
                    🗑️ Clear All Logs
                </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <style>
        {`
          select {
            border: 2px solid #64748b !important;
            border-radius: 6px !important;
          }
          select:focus {
            border-color: #3b82f6 !important;
            outline: none !important;
          }
          select option {
            background-color: #1e293b !important;
            color: #ffffff !important;
            border-bottom: 1px solid #475569 !important;
            padding: 8px 12px !important;
            margin: 0 !important;
          }
          select option:hover {
            background-color: #334155 !important;
          }
          select option:checked {
            background-color: #3b82f6 !important;
          }
        `}
      </style>
      {/* Fixed Header - Always Visible */}
      <div className="fixed top-16 left-0 right-0 z-40 bg-slate-900 shadow-lg border-b border-slate-600" style={{ height: showGridHeaders ? '240px' : '150px' }}>
        <div className="py-2 pt-4">
          <div className="flex justify-between items-center mb-2 px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/')}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
              >
                ← Back to Events
              </button>
              
              
              
              {/* Menu Dropdown */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenuDropdown(!showMenuDropdown);
                  }}
                  className="px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
                  title="Menu"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                
                {showMenuDropdown && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-slate-800 border border-slate-600 rounded-lg shadow-lg z-50">
                    <div className="py-1">
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          setShowDisplayModal(true);
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        Display Timer
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          // Navigate to Reports page
                          const reportsUrl = `/reports?eventId=${event?.id}&eventName=${encodeURIComponent(event?.name || '')}`;
                          window.open(reportsUrl, '_blank');
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Reports and Printing
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          // Pass event data to Graphics Links page
                          const graphicsLinksUrl = `/graphics-links?eventId=${event?.id}&eventName=${encodeURIComponent(event?.name || '')}`;
                          window.open(graphicsLinksUrl, '_blank');
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Graphic Links
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          // Navigate to PhotoView page
                          const photoViewUrl = `/photo-view?eventId=${event?.id}&eventName=${encodeURIComponent(event?.name || '')}&eventDate=${encodeURIComponent(event?.date || '')}&eventLocation=${encodeURIComponent(event?.location || '')}`;
                          window.open(photoViewUrl, '_blank');
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        PhotoView
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          console.log('=== CSV EXPORT ===');
                          console.log('Event:', event);
                          console.log('Schedule length:', schedule.length);
                          console.log('Full schedule:', schedule);
                          console.log('Master start time:', masterStartTime);
                          
                          // Generate CSV data - include all important columns
                          const csvHeaders = [
                            'ROW',
                            'CUE',
                            'Program Type',
                            'Shot Type',
                            'Segment Name',
                            'Duration',
                            'Start Time',
                            'End Time',
                            'Notes',
                            'Assets',
                            'Speakers',
                            'Has PPT',
                            'Has QA',
                            'Timer ID',
                            'Is Public',
                            'Is Indented',
                            'Day'
                          ];
                          
                          // Add custom columns to headers
                          const customColumnHeaders = customColumns.map(col => col.name);
                          const allHeaders = [...csvHeaders, ...customColumnHeaders];
                          
                          // Filter schedule to only include items for the currently selected day
                          const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
                          
                          // Debug: Log the filtered schedule data
                          console.log('🔍 Filtered schedule for CSV:', filteredSchedule.map(item => ({
                            id: item.id,
                            cue: item.customFields?.cue,
                            isIndented: item.isIndented
                          })));
                          
                          const csvRows = filteredSchedule.map((item, index) => {
                            // Find the original index in the full schedule for accurate start time calculation
                            const originalIndex = schedule.findIndex(s => s.id === item.id);
                            const calculatedStartTime = calculateStartTime(originalIndex);
                            const duration = `${item.durationHours}:${item.durationMinutes.toString().padStart(2, '0')}:${item.durationSeconds.toString().padStart(2, '0')}`;
                            
                            // Handle indented items - blank start and end times
                            let startTime = '';
                            let endTime = '';
                            
                            // Debug logging
                            console.log(`CSV Export - Item ${item.customFields?.cue || index + 1}: isIndented=${item.isIndented}, calculatedStartTime=${calculatedStartTime}`);
                            
                            if (!item.isIndented) {
                              // For non-indented items, use calculated start time
                              startTime = calculatedStartTime || '';
                              
                              // Calculate end time from next non-indented row's start time
                              endTime = (() => {
                                // Find the next non-indented item in the filtered schedule
                                let nextNonIndentedItem: ScheduleItem | null = null;
                                let nextIndex = index + 1;
                                
                                while (nextIndex < filteredSchedule.length) {
                                  const nextItem = filteredSchedule[nextIndex];
                                  console.log(`  Checking next item ${nextIndex}: ${nextItem.customFields?.cue || nextIndex + 1}, isIndented=${nextItem.isIndented}`);
                                  if (!nextItem.isIndented) {
                                    nextNonIndentedItem = nextItem;
                                    break;
                                  }
                                  nextIndex++;
                                }
                                
                                if (nextNonIndentedItem) {
                                  // Get the next non-indented item's start time
                                  const nextOriginalIndex = schedule.findIndex(s => s.id === nextNonIndentedItem!.id);
                                  const nextStartTime = calculateStartTime(nextOriginalIndex);
                                  console.log(`  Found next non-indented item: ${nextNonIndentedItem.customFields?.cue}, startTime=${nextStartTime}`);
                                  return nextStartTime || '';
                                } else {
                                  // For the last non-indented row, calculate end time from duration as fallback
                                  if (!calculatedStartTime) return '';
                                  
                                  const [hours, minutes, seconds] = calculatedStartTime.split(':').map(Number);
                                  const [durHours, durMinutes, durSeconds] = duration.split(':').map(Number);
                                  
                                  let totalSeconds = (hours * 3600 + minutes * 60 + seconds) + 
                                                   (durHours * 3600 + durMinutes * 60 + durSeconds);
                                  
                                  const endHours = Math.floor(totalSeconds / 3600);
                                  const endMinutes = Math.floor((totalSeconds % 3600) / 60);
                                  const endSecs = totalSeconds % 60;
                                  
                                  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}:${endSecs.toString().padStart(2, '0')}`;
                                }
                              })();
                            } else {
                              console.log(`  Indented item - keeping startTime and endTime blank`);
                            }
                            // For indented items, startTime and endTime remain empty strings

                            const baseRow = [
                              index + 1, // ROW number
                              item.customFields?.cue || `CUE ${index + 1}`, // CUE
                              item.programType || '',
                              item.shotType || '',
                              item.segmentName || '',
                              duration,
                              startTime,
                              endTime,
                              cleanNotesForCSV(item.notes) || '',
                              item.assets || '',
                              item.speakersText || '',
                              item.hasPPT ? 'Yes' : 'No',
                              item.hasQA ? 'Yes' : 'No',
                              item.timerId || '',
                              item.isPublic ? 'Yes' : 'No',
                              item.isIndented ? 'Yes' : 'No',
                              item.day || 1
                            ];
                            
                            // Add custom column values
                            const customValues = customColumns.map(col => item.customFields[col.id] || '');
                            
                            return [...baseRow, ...customValues];
                          });
                          
                          // Create CSV content
                          const csvContent = [
                            allHeaders.join(','),
                            ...csvRows.map(row => 
                              row.map(cell => 
                                // Escape commas and quotes in CSV
                                typeof cell === 'string' && (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
                                  ? `"${cell.replace(/"/g, '""')}"`
                                  : cell
                              ).join(',')
                            )
                          ].join('\n');
                          
                          console.log('CSV Content:', csvContent);
                          
                          // Create and download CSV file
                          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = `${event?.name || 'RunOfShow'}_Day${selectedDay}_${new Date().toISOString().split('T')[0]}.csv`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          URL.revokeObjectURL(url);
                          
                          console.log('=== END CSV EXPORT ===');
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export CSV
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          setShowExcelImportModal(true);
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Import Excel
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          setShowBackupModal(true);
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                        </svg>
                        Backups
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          // Pass event data to Green Room page
                          const greenRoomUrl = `/green-room?eventId=${event?.id}&eventName=${encodeURIComponent(event?.name || '')}&eventDate=${event?.date || ''}&eventLocation=${encodeURIComponent(event?.location || '')}`;
                          window.open(greenRoomUrl, '_blank');
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        Green Room
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          // Pass event data to Scripts Follow page
                          const scriptsFollowUrl = `/scripts-follow?eventId=${event?.id}&eventName=${encodeURIComponent(event?.name || '')}`;
                          window.open(scriptsFollowUrl, '_blank');
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Scripts Follow
                      </button>
                      <button
                        onClick={() => {
                          setShowMenuDropdown(false);
                          setShowOSCModal(true);
                        }}
                        className="w-full px-4 py-2 text-left text-white hover:bg-slate-700 transition-colors flex items-center gap-3"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        OSC Control
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Event Controls - Moved to center */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <label className="text-white font-semibold">Event Name:</label>
                <div className="px-4 py-2 bg-slate-700 border-2 border-slate-600 rounded-lg text-white w-80 truncate">
                  {eventName || 'No Event Name'}
                </div>
                
              </div>
              <div className="flex items-center gap-2">
                <label className="text-white font-semibold">Start Time:</label>
                <input
                  type="time"
                  value={(event?.numberOfDays && event.numberOfDays > 1) ? (dayStartTimes[selectedDay] || '') : masterStartTime}
                  onChange={(e) => {
                    console.log('⏰ Start time changed:', e.target.value);
                    // Detect user editing
                    handleUserEditing();
                    
                    if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                      alert('Only EDITORs can change start time. Please change your role to EDITOR.');
                      return;
                    }
                    if (event?.numberOfDays && event.numberOfDays > 1) {
                      // Update day-specific start time
                      console.log('⏰ Updating day start time for day', selectedDay, 'to', e.target.value);
                      setDayStartTimes(prev => ({
                        ...prev,
                        [selectedDay]: e.target.value
                      }));
                    } else {
                      // Update master start time for single day events
                      console.log('⏰ Updating master start time to', e.target.value);
                      setMasterStartTime(e.target.value);
                    }
                  }}
                  disabled={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
                  className="px-4 py-2 border-2 rounded-lg focus:outline-none w-36 transition-colors bg-slate-700 border-slate-600 text-white focus:border-blue-500"
                  style={{
                    colorScheme: 'dark'
                  }}
                  title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can change start time' : `Set ${(event?.numberOfDays && event.numberOfDays > 1) ? `Day ${selectedDay}` : 'master'} start time`}
                />
              </div>
            </div>
            
            {/* Countdown Timer and Action Buttons - Top Right */}
            <div className="flex items-center gap-6">
              <div className="text-center">
                {hybridTimerData?.activeTimer ? (
                  <div className={`text-lg font-bold ${
                    hybridTimerData.activeTimer.is_running && hybridTimerData.activeTimer.is_active
                      ? 'text-green-400'
                      : 'text-yellow-400'
                  }`}>
                    {hybridTimerData.activeTimer.is_running && hybridTimerData.activeTimer.is_active
                      ? 'RUNNING'
                      : 'LOADED'
                    } -                     {(() => {
                      // Try to find the schedule item with proper type conversion
                      const itemId = hybridTimerData.activeTimer.item_id;
                      const scheduleItem = schedule.find(item => 
                        item.id === itemId || 
                        item.id === parseInt(itemId) || 
                        parseInt(item.id) === parseInt(itemId)
                      );
                      
                      // Debug: Log only occasionally to reduce spam
                      if (Math.random() < 0.01) {
                        console.log('🔍 RunOfShow: Hybrid timer data:', hybridTimerData.activeTimer);
                        console.log('🔍 RunOfShow: Looking for item_id:', hybridTimerData.activeTimer.item_id, typeof hybridTimerData.activeTimer.item_id);
                        console.log('🔍 RunOfShow: Found schedule item:', scheduleItem);
                      }
                      
                      if (scheduleItem?.customFields?.cue) {
                        return formatCueDisplay(scheduleItem.customFields.cue);
                      } else {
                        // Fallback: show item_id or try to get cue from timer data
                        console.log('🔍 RunOfShow: No schedule item found, using fallback');
                        return `CUE ${itemId}`;
                      }
                    })()}
                    {(hybridTimerData?.secondaryTimer || secondaryTimer) && (
                      <div className="text-lg text-orange-400 mt-0.5 font-bold">
                        {(() => {
                          // Debug: Log sub-cue timer data
                          console.log('🔍 RunOfShow: Sub-cue timer check:', {
                            hasHybridSecondary: !!hybridTimerData?.secondaryTimer,
                            hasOldSecondary: !!secondaryTimer,
                            hybridData: hybridTimerData?.secondaryTimer
                          });
                          
                          // Use hybrid timer data first, fallback to old secondaryTimer
                          const subCueTimer = hybridTimerData?.secondaryTimer || secondaryTimer;
                          if (hybridTimerData?.secondaryTimer) {
                            // Use hybrid timer data (ClockPage style)
                            const scheduleItem = schedule.find(item => 
                              item.id === hybridTimerData.secondaryTimer.item_id || 
                              item.id === parseInt(hybridTimerData.secondaryTimer.item_id)
                            );
                            const cueDisplay = scheduleItem?.customFields?.cue || 
                                              hybridTimerData.secondaryTimer.cue_display || 
                                              hybridTimerData.secondaryTimer.cue || 
                                              `CUE ${hybridTimerData.secondaryTimer.item_id}`;
                            
                            // Calculate remaining time for sub-cue
                            const now = getCurrentTimeUTC();
                            const startedAt = new Date(hybridTimerData.secondaryTimer.started_at || hybridTimerData.secondaryTimer.created_at);
                            const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
                            const total = hybridTimerData.secondaryTimer.duration_seconds || hybridTimerData.secondaryTimer.duration || 60;
                            const remaining = Math.max(0, total - elapsed);
                            
                            return `${formatCueDisplay(cueDisplay)} - ${formatSubCueTime(remaining)}`;
                          } else {
                            // Fallback to old secondaryTimer logic
                            return `${formatCueDisplay(schedule.find(item => item.id === secondaryTimer.itemId)?.customFields.cue)} - ${formatSubCueTime(secondaryTimer.remaining)}`;
                          }
                        })()}
                      </div>
                    )}
                  </div>
                ) : Object.keys(activeTimers).length > 0 ? (
                  <div className="text-lg text-green-400 font-bold">
                    RUNNING - {formatCueDisplay(schedule.find(item => activeTimers[item.id])?.customFields.cue)}
                    {secondaryTimer && (
                      <div className="text-lg text-orange-400 mt-0.5 font-bold">
                        {formatCueDisplay(schedule.find(item => item.id === secondaryTimer.itemId)?.customFields.cue)} - {formatSubCueTime(secondaryTimer.remaining)}
                      </div>
                    )}
                  </div>
                ) : activeItemId && timerProgress[activeItemId] ? (
                  <div className="text-lg text-yellow-400 font-bold">
                    LOADED - {formatCueDisplay(schedule.find(item => item.id === activeItemId)?.customFields.cue)}
                  </div>
                ) : (
                  <div className="text-lg text-slate-300 font-bold">
                    No CUE Selected
                  </div>
                )}
              </div>
              
              {/* Timer Display with Color */}
              <div className="relative">
                <div className="text-3xl font-mono bg-slate-800 px-6 py-3 rounded-lg border border-slate-600" style={{ color: getCountdownColor() }}>
                  {formatTime(getRemainingTime())}
                </div>
                {/* Drift Status Indicator - positioned in bottom-right corner */}
              </div>
            </div>
          </div>

          {/* Progress Bar - Full Width */}
          <div className="px-8 mb-2">
            <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden border border-slate-600 relative">
              <div 
                className="h-full transition-all duration-1000 absolute top-0 right-0"
                style={{ 
                  width: `${getRemainingPercentage()}%`,
                  background: getProgressBarColor()
                }}
              />
            </div>
          </div>

          {/* Timer Control Panel */}
          <div className="px-8 pb-2">
            <div className="flex items-center justify-between">
              {/* Role Display - Left Side */}
              <div className="flex items-center gap-3">
                <div className="text-sm text-slate-300">
                  Role: <span className="font-semibold text-white">{currentUserRole}</span>
                </div>
                <button
                  onClick={() => setShowRoleChangeModal(true)}
                  className="px-3 py-1 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded transition-colors"
                  title="Change your role"
                >
                  Change Role
                </button>
                <button
                  onClick={createManualBackup}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded transition-colors"
                  title="Create a manual backup of current data"
                >
                  💾 Create Backup
                </button>
                {isUserEditing && (
                  <div className="flex items-center space-x-2 px-3 py-1 bg-yellow-600 rounded text-sm">
                    <div className="w-2 h-2 bg-yellow-200 rounded-full animate-pulse"></div>
                    <span className="text-yellow-100 font-medium">Editing - Sync Paused</span>
                  </div>
                )}
                
                {/* Countdown timer button */}
                {!isUserEditing && isPageVisible && (
                  <div className="flex items-center space-x-2 px-3 py-1 bg-blue-600 rounded text-sm">
                    <div className="w-2 h-2 bg-blue-200 rounded-full animate-pulse"></div>
                    <span className="text-blue-100 font-medium">
                      {isSyncing ? 'Syncing...' : `Next sync in ${countdown}s`}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Right Side Controls */}
              <div className="flex items-center gap-4">


              {/* Filter View Button */}
              <button
                onClick={() => setShowFilterModal(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded transition-colors"
                title="Open Filter View"
              >
                Filter View
              </button>

              
              {/* Time Toast Toggle Button */}
              <button
                onClick={() => setTimeToastEnabled(!timeToastEnabled)}
                className={`px-4 py-2 text-white text-sm font-medium rounded transition-colors ${
                  timeToastEnabled 
                    ? 'bg-green-600 hover:bg-green-500' 
                    : 'bg-slate-600 hover:bg-slate-500'
                }`}
                title={timeToastEnabled ? "Disable Time Toast" : "Enable Time Toast"}
              >
                ⏰ Time Toast
              </button>
              
              
              {/* Follow Button */}
              <button
                onClick={() => setIsFollowEnabled(!isFollowEnabled)}
                className={`px-4 py-2 text-white text-sm font-medium rounded transition-colors ${
                  isFollowEnabled 
                    ? 'bg-purple-600 hover:bg-purple-500 ring-4 ring-inset ring-green-400' 
                    : 'bg-purple-600 hover:bg-purple-500'
                }`}
                title={isFollowEnabled ? "Disable auto-scroll to active row" : "Enable auto-scroll to active row"}
              >
                🎯 Follow
              </button>
              
              {/* Duration Controls */}
              <div className="flex items-center gap-2">
                <span className="text-white text-sm font-medium">Duration:</span>
                <button
                  onClick={async () => {
                    if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                      alert('Only OPERATORs can adjust timer duration. Please change your role to OPERATOR.');
                      return;
                    }
                    await adjustTimerDuration(-300);
                  }}
                  className={`w-8 h-8 text-white text-sm font-bold rounded transition-colors ${
                    currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                      ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                      : 'bg-red-700 hover:bg-red-600'
                  }`}
                  disabled={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                  title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can adjust timer duration' : 'Subtract 5 minutes'}
                >
                  -5
                </button>
                <button
                  onClick={async () => {
                    if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                      alert('Only OPERATORs can adjust timer duration. Please change your role to OPERATOR.');
                      return;
                    }
                    await adjustTimerDuration(-60);
                  }}
                  className={`w-8 h-8 text-white text-sm font-bold rounded transition-colors ${
                    currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                      ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                      : 'bg-red-600 hover:bg-red-500'
                  }`}
                  disabled={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                  title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can adjust timer duration' : 'Subtract 1 minute'}
                >
                  -1
                </button>
                <button
                  onClick={async () => {
                    if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                      alert('Only OPERATORs can adjust timer duration. Please change your role to OPERATOR.');
                      return;
                    }
                    await adjustTimerDuration(60);
                  }}
                  className={`w-8 h-8 text-white text-sm font-bold rounded transition-colors ${
                    currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                      ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                      : 'bg-blue-600 hover:bg-blue-500'
                  }`}
                  disabled={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                  title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can adjust timer duration' : 'Add 1 minute'}
                >
                  +1
                </button>
                <button
                  onClick={async () => {
                    if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                      alert('Only OPERATORs can adjust timer duration. Please change your role to OPERATOR.');
                      return;
                    }
                    await adjustTimerDuration(300);
                  }}
                  className={`w-8 h-8 text-white text-sm font-bold rounded transition-colors ${
                    currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                      ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                      : 'bg-blue-700 hover:bg-blue-600'
                  }`}
                  disabled={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                  title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can adjust timer duration' : 'Add 5 minutes'}
                >
                  +5
                </button>
              </div>
              
              {/* Messages Button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                      alert('Only OPERATORs can send messages. Please change your role to OPERATOR.');
                      return;
                    }
                    setShowMessagesModal(true);
                  }}
                  className={`px-4 py-2 text-white text-sm font-medium rounded transition-colors ${
                    currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                      ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                      : messageEnabled 
                        ? 'bg-purple-600 hover:bg-purple-500 ring-4 ring-inset ring-green-500' 
                        : 'bg-purple-600 hover:bg-purple-500'
                  }`}
                  disabled={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                  title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can send messages' : 'Send Messages to Full Screen Timer'}
                >
                  Messages
                </button>
                
                {/* Toggle Off Button - Only show when message is active */}
                {messageEnabled && (
                  <button
                    onClick={async () => {
                      if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                        alert('Only OPERATORs can control messages. Please change your role to OPERATOR.');
                        return;
                      }
                      
                      try {
                        // Disable message in Supabase
                        if (event?.id) {
                          const messages = await DatabaseService.getTimerMessagesForEvent(event.id);
                          const activeMessage = messages.find(msg => msg.enabled);
                          if (activeMessage) {
                            await DatabaseService.disableTimerMessage(activeMessage.id!);
                            console.log('✅ Message disabled in Supabase via Turn Off button');
                          }
                        }
                      } catch (error) {
                        console.error('❌ Error disabling message in Supabase:', error);
                      }
                      
                      // Turn off local message
                      setMessageEnabled(false);
                      setMessageText('');
                      if (fullScreenTimerWindow && !fullScreenTimerWindow.closed) {
                        fullScreenTimerWindow.postMessage({
                          type: 'MESSAGE_UPDATE',
                          message: '',
                          enabled: false
                        }, '*');
                      }
                    }}
                    className={`px-4 py-2 text-white text-sm font-medium rounded transition-colors ${
                      currentUserRole === 'VIEWER'
                        ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                        : 'bg-slate-600 hover:bg-slate-500 animate-pulse'
                    }`}
                    disabled={currentUserRole === 'VIEWER'}
                    title={currentUserRole === 'VIEWER' ? 'Viewers cannot control messages' : 'Turn Off Message'}
                  >
                    Click to Turn Off
                  </button>
                )}
              </div>
              </div>
            </div>
          </div>

          {/* Duplicate Grid Headers - Fixed at Top */}
          <div className={`px-8 transition-all duration-500 ease-in-out overflow-hidden ${showGridHeaders ? 'max-h-80 opacity-100 -mb-6' : 'max-h-0 opacity-0 mb-0'}`}>
            <div className="bg-slate-800 rounded-xl p-4 shadow-2xl" style={{ transform: 'scale(0.75)', transformOrigin: 'top center', width: '127.67%', marginLeft: '-13.83%' }}>
              <div className="flex border-2 border-slate-600 rounded-lg overflow-hidden bg-slate-900">
                {/* Row Number Column Header */}
                <div className="w-12 flex-shrink-0 bg-slate-900 border-r-2 border-slate-600">
                  <div className="h-16 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center">
                    <span className="text-white font-bold text-xs">#</span>
                  </div>
                </div>
                
                {/* CUE Column Header */}
                <div className="w-40 flex-shrink-0 bg-slate-900" style={{ borderRight: '6px solid #475569' }}>
                  <div className="h-16 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center">
                    <span className="text-white font-bold text-lg flex items-center gap-1">
                      CUE
                      {currentUserRole === 'VIEWER' && (
                        <span className="text-yellow-400" title="Viewers cannot edit CUE">🔒</span>
                      )}
                    </span>
                  </div>
                </div>


                {/* Center Scrollable Section Headers */}
                <div className="flex-1 overflow-x-auto sticky-header-scroll-container" style={{ scrollbarWidth: 'thin' }}>
                  <div className="min-w-max">
                    <div className="h-16 bg-slate-700 border-b-3 border-slate-600 flex">
                      {visibleColumns.start && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.start }}
                        >
                          <span className="text-white font-bold">Start</span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'start')}
                          />
                        </div>
                      )}
                      {visibleColumns.programType && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.programType }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Program Type
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'programType')}
                          />
                        </div>
                      )}
                      {visibleColumns.duration && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.duration }}
                        >
                          <div className="text-center">
                            <div className="text-white font-bold flex items-center justify-center gap-1">
                              Duration
                              {currentUserRole === 'VIEWER' && (
                                <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400">HH MM SS</div>
                          </div>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'duration')}
                          />
                        </div>
                      )}
                      {visibleColumns.segmentName && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.segmentName }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Segment Name
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'segmentName')}
                          />
                        </div>
                      )}
                      {visibleColumns.shotType && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.shotType }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Shot Type
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'shotType')}
                          />
                        </div>
                      )}
                      {visibleColumns.pptQA && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.pptQA }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            PPT/Q&A
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'pptQA')}
                          />
                        </div>
                      )}
                      {visibleColumns.notes && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.notes }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Notes
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'notes')}
                          />
                        </div>
                      )}
                      {visibleColumns.assets && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.assets }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Assets
                            {currentUserRole === 'VIEWER' && (
                              <span className="text-yellow-400" title="Read-only for VIEWERs">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'assets')}
                          />
                        </div>
                      )}
                      {visibleColumns.participants && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.participants }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Participants
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'participants')}
                          />
                        </div>
                      )}
                      {visibleColumns.speakers && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.speakers }}
                        >
                          <span className="text-white font-bold">Speakers</span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'speakers')}
                          />
                        </div>
                      )}
                      {visibleColumns.public && (
                        <div 
                          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                          style={{ width: columnWidths.public }}
                        >
                          <span className="text-white font-bold flex items-center gap-1">
                            Public
                            {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                              <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                            )}
                          </span>
                          <div 
                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                            onMouseDown={(e) => handleResizeStart(e, 'public')}
                          />
                        </div>
                      )}
                      {customColumns.map(column => 
                        visibleCustomColumns[column.id] !== false && (
                          <div 
                            key={column.id} 
                            className="px-4 py-2 border-r border-slate-600 flex items-center justify-center relative flex-shrink-0"
                            style={{ width: customColumnWidths[column.id] || 256 }}
                          >
                            <span className="text-white font-bold">{column.name}</span>
                            <div 
                              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                              onMouseDown={(e) => handleCustomColumnResizeStart(e, column.id)}
                            />
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Timer Column Header */}
                <div className="w-32 flex-shrink-0 bg-slate-900" style={{ borderLeft: '6px solid #475569' }}>
                  <div className="h-16 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center">
                    <span className="text-white font-bold text-base flex items-center gap-1">
                      Timer
                      {(currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') && (
                        <span className="text-yellow-400" title="Only OPERATORs can control timers">🔒</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* Schedule Container */}
      <div className="max-w-[95%] mx-auto px-6" style={{ paddingTop: '250px' }}>
        <div className="bg-slate-800 rounded-xl p-4 shadow-2xl" style={{ transform: 'scale(0.75)', transformOrigin: 'top center', width: '133.33%', marginLeft: '-16.67%' }}>
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-white">
                Schedule{(event?.numberOfDays && event.numberOfDays > 1) ? ` - Day ${selectedDay}` : ''} - TRT {(() => {
                  const trt = calculateTotalRunTime();
                  return `${trt.hours}h ${trt.minutes}m ${trt.seconds}s`;
                })()}
              </h2>
              {user && (
                <div className="flex items-center gap-3 mt-1">
                  <button
                    onClick={() => setShowChangeLog(true)}
                    className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 rounded transition-colors"
                    title="View change history"
                  >
                    📝 Change Log ({changeLog.length + pendingChanges.size})
                    {changeLogService.getChangesCount().unsynced > 0 && (
                      <span className="ml-1 text-yellow-400">({changeLogService.getChangesCount().unsynced} unsynced)</span>
                    )}
                  </button>
                  {unsyncedCount > 0 && (
                    <button
                      onClick={async () => {
                        await finalizeAllPendingChanges();
                      }}
                      className="text-xs bg-yellow-600 hover:bg-yellow-500 text-white px-2 py-1 rounded transition-colors animate-pulse"
                      title={`${unsyncedCount} unsynced change${unsyncedCount !== 1 ? 's' : ''} - Click to sync`}
                    >
                      {unsyncedCount}
                    </button>
                  )}
                  {pendingChanges.size > 0 && (
                    <button
                      className="text-xs bg-yellow-600 text-white px-2 py-1 rounded transition-colors animate-pulse cursor-not-allowed"
                      title="Changes are pending and will auto-save after 5 seconds"
                      disabled
                    >
                      ⏳ Changes Pending ({pendingChanges.size})
                    </button>
                  )}
                </div>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-3">
              {/* Working Day Selector for Multi-Day Events */}
              {(event?.numberOfDays && event.numberOfDays > 1) && (
                <div className="flex items-center gap-3 mr-4">
                  <label className="text-white font-bold text-base">Day:</label>
                  <select
                    value={selectedDay}
                    onChange={(e) => {
                      handleUserEditing();
                      setSelectedDay(parseInt(e.target.value));
                    }}
                    className="px-4 py-2 bg-slate-700 border-2 border-slate-600 rounded-lg text-white focus:border-blue-500 focus:outline-none text-base font-semibold w-20"
                  >
                    {Array.from({ length: event.numberOfDays }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <button
                onClick={() => {
                  if (currentUserRole === 'VIEWER') {
                    alert('Viewers cannot add items. Please change your role to EDITOR or OPERATOR.');
                    return;
                  }
                  // Pause syncing when adding new item
                  handleModalEditing();
                  setShowAddModal(true);
                  // Reset form to defaults
                  setModalForm({
                    cue: '',
                    day: selectedDay,
                    programType: 'PreShow/End',
                    shotType: '',
                    segmentName: '',
                    durationHours: 0,
                    durationMinutes: 0,
                    durationSeconds: 0,
                    notes: '',
                    assets: '',
                    speakers: '',
                    speakersText: '',
                    hasPPT: false,
                    hasQA: false,
                    timerId: '',
                    isPublic: false,
                    isIndented: false,
                    customFields: {}
                  });
                }}
                className={`px-4 py-2 font-medium rounded text-sm transition-colors ${
                  currentUserRole === 'VIEWER'
                    ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
                disabled={currentUserRole === 'VIEWER'}
                title={currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can add items' : 'Add new item'}
              >
                + Item
              </button>
              <button
                onClick={() => {
                  if (currentUserRole === 'VIEWER') {
                    alert('Viewers cannot add columns. Please change your role to EDITOR or OPERATOR.');
                    return;
                  }
                  // Pause syncing when adding new column
                  handleModalEditing();
                  setShowCustomColumnModal(true);
                }}
                className={`px-4 py-2 font-medium rounded text-sm transition-colors ${
                  currentUserRole === 'VIEWER'
                    ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
                disabled={currentUserRole === 'VIEWER'}
                title={currentUserRole === 'VIEWER' ? 'Viewers cannot add columns' : 'Add custom column'}
              >
                + Column
              </button>
              <button
                onClick={async () => {
                  if (currentUserRole === 'VIEWER') {
                    alert('Viewers cannot reset the schedule. Please change your role to EDITOR or OPERATOR.');
                    return;
                  }
                  await resetAllStates();
                }}
                className={`px-4 py-2 font-medium rounded text-sm transition-colors ${
                  currentUserRole === 'VIEWER'
                    ? 'bg-gray-500 text-gray-300 cursor-not-allowed' 
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
                disabled={currentUserRole === 'VIEWER'}
                title={currentUserRole === 'VIEWER' ? 'Viewers cannot reset the schedule' : 'Reset all states'}
              >
                Reset
              </button>
            </div>
          </div>
          
          {/* Schedule Layout */}
          <div className="flex border-2 border-slate-600 rounded-lg overflow-hidden bg-slate-900">
            {/* Row Number Column */}
            <div className="w-12 flex-shrink-0 bg-slate-900 border-r-2 border-slate-600">
              {/* Header */}
              <div className="h-24 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center">
                <span className="text-white font-bold text-xs">#</span>
              </div>
              
              
              {/* Row Numbers */}
              {getFilteredSchedule().length === 0 ? (
                <div className="h-24 flex items-center justify-center text-slate-500">
                  -
                </div>
              ) : (
                                 getFilteredSchedule().map((item, index) => (
                   <div 
                     key={`${item.id}-${item.notes?.length || 0}-${item.speakers?.length || 0}`}
                     className={`border-b-2 border-slate-600 flex items-center justify-center gap-1 ${
                       // Use hybrid timer data for real-time highlighting (ClockPage style)
                       (() => {
                         // Match item_id with both string and number comparison
                         const hybridItemId = hybridTimerData?.activeTimer?.item_id;
                         const isMatch = hybridItemId && (parseInt(String(hybridItemId)) === item.id || hybridItemId === item.id || String(hybridItemId) === String(item.id));
                         const isHybridRunning = isMatch && hybridTimerData?.activeTimer?.is_running && hybridTimerData?.activeTimer?.is_active;
                         const isHybridLoaded = isMatch && hybridTimerData?.activeTimer?.is_active && !hybridTimerData?.activeTimer?.is_running;
                         
                         // Debug logging removed to prevent console spam
                         
                         // Use ONLY hybrid timer data for highlighting (no fallback to old logic)
                         if (isHybridRunning) return 'bg-green-900 border-green-500';
                         if (isHybridLoaded) return 'bg-blue-900 border-blue-500';
                         
                         // Only use old logic for completed/stopped states (not active states)
                         if (completedCues[item.id]) return 'bg-gray-900 border-gray-700 opacity-40';
                         if (stoppedItems.has(item.id)) return 'bg-gray-900 border-gray-700 opacity-40';
                         if (loadedCueDependents.has(item.id)) return 'bg-amber-800 border-amber-600';
                         
                         // Debug logging removed to prevent console spam
                         
                         // INDENTED CUES: Highlight when parent is loaded OR running
                         if (indentedCues[item.id]) {
                           const parentId = indentedCues[item.id].parentId;
                           const currentlyLoadedItemId = hybridTimerData?.activeTimer?.item_id || activeItemId;
                           
                           // Check if parent is currently loaded
                           const parentIsLoaded = currentlyLoadedItemId && (
                             parseInt(String(currentlyLoadedItemId)) === parentId || 
                             currentlyLoadedItemId === parentId || 
                             String(currentlyLoadedItemId) === String(parentId)
                           );
                           
                           // Check if parent is running
                           const parentIsRunning = activeTimers[parentId] !== undefined;
                           
                           if (parentIsLoaded || parentIsRunning) return 'bg-amber-950 border-amber-600';
                         }
                         return index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
                       })()
                     }`}
                     style={{ height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) }}
                   >
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => {
                          if (currentUserRole === 'VIEWER') {
                            alert('Viewers cannot jump to rows. Please change your role to EDITOR or OPERATOR.');
                            return;
                          }
                          
                          // Pause syncing immediately BEFORE the prompt
                          console.log('✏️ Row jump button clicked - pausing sync');
                          setIsUserEditing(true);
                          
                          // Clear any existing timeout
                          if (editingTimeout) {
                            clearTimeout(editingTimeout);
                          }
                          
                          // Use setTimeout to ensure the state update happens before the prompt
                          setTimeout(() => {
                          const targetRow = prompt(`Move to row (1-${getFilteredSchedule().length}):`, (index + 1).toString());
                            
                            // Resume syncing after prompt closes
                            console.log('⏸️ Row jump prompt closed - resuming sync in 5 seconds');
                            const timeout = setTimeout(() => {
                              console.log('⏸️ User stopped editing - resuming sync');
                              setIsUserEditing(false);
                            }, 5000);
                            setEditingTimeout(timeout);
                            
                          if (targetRow && !isNaN(Number(targetRow))) {
                            moveToSpecificRow(item.id, Number(targetRow));
                          }
                          }, 0);
                        }}
                        className={`w-5 h-5 text-white rounded flex items-center justify-center text-xs font-bold transition-colors ${
                          currentUserRole === 'VIEWER'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : 'bg-purple-600 hover:bg-purple-500'
                        }`}
                        disabled={currentUserRole === 'VIEWER'}
                        title={currentUserRole === 'VIEWER' ? 'Viewers cannot jump to rows' : 'Jump to Row'}
                      >
                        #
                      </button>
                      <span className="text-white font-bold text-lg">
                        {index + 1}
                      </span>
                      <button
                        onClick={() => {
                          if (currentUserRole === 'VIEWER') {
                            alert('Viewers cannot add rows. Please change your role to EDITOR or OPERATOR.');
                            return;
                          }
                          // Pause syncing when inserting new row
                          handleModalEditing();
                          setInsertRowPosition(index);
                          setShowAddModal(true);
                        }}
                        className={`w-5 h-5 text-white rounded flex items-center justify-center text-xs font-bold transition-colors ${
                          currentUserRole === 'VIEWER'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-500'
                        }`}
                        disabled={currentUserRole === 'VIEWER'}
                        title={currentUserRole === 'VIEWER' ? 'Viewers cannot add rows' : `Insert row after row ${index + 1}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            {/* CUE Column with Controls */}
            <div className="w-40 flex-shrink-0 bg-slate-900" style={{ borderRight: '6px solid #475569' }}>
              {/* Header */}
              <div className="h-24 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center">
                <span className="text-white font-bold text-lg flex items-center gap-1">
                  CUE
                  {currentUserRole === 'VIEWER' && (
                    <span className="text-yellow-400" title="Viewers cannot edit CUE">🔒</span>
                  )}
                </span>
              </div>
              
              
                             {/* CUEs with Controls */}
               {getFilteredSchedule().length === 0 ? (
                 <div className="h-24 flex items-center justify-center text-slate-500">
                   No items
                 </div>
               ) : (
                 getFilteredSchedule().map((item, index) => (
                   <div 
                     key={`${item.id}-${item.notes?.length || 0}-${item.speakers?.length || 0}`}
                     className={`border-b-2 border-slate-600 flex flex-col items-center justify-center gap-1 ${
                       index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'
                     }`}
                     style={{ height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) }}
                   >
                   <div className="flex items-center gap-1">
                     {/* Star button for marking START cue */}
                     <button
                       onClick={async () => {
                         // Toggle: if this cue is already the START cue, unset it; otherwise set it
                         const newStartCueId = startCueId === item.id ? null : item.id;
                         setStartCueId(newStartCueId);
                         
                         // Save START cue selection to main schedule table
                         if (event?.id) {
                           try {
                             // Create updated schedule items with isStartCue field
                             const updatedSchedule = schedule.map(scheduleItem => ({
                               ...scheduleItem,
                               isStartCue: scheduleItem.id === newStartCueId
                             }));
                             
                             // Update local schedule state
                             setSchedule(updatedSchedule);
                             
                             // Save to database using the existing saveRunOfShowData method
                             const runOfShowData = {
                               event_id: event.id,
                               event_name: eventName,
                               event_date: event?.date || new Date().toISOString(),
                               schedule_items: updatedSchedule,
                               custom_columns: customColumns,
                               settings: {
                                 eventName: eventName,
                                 masterStartTime: masterStartTime,
                                 dayStartTimes: dayStartTimes
                               }
                             };
                             
                             await DatabaseService.saveRunOfShowData(runOfShowData, {
                               userId: user?.id || 'unknown',
                               userName: user?.name || 'Unknown User',
                               userRole: user?.role || 'VIEWER'
                             });
                             
                             console.log(`✅ START cue selection saved to schedule: item ${newStartCueId || 'none'}`);
                           } catch (error) {
                             console.error('❌ Failed to save START cue selection:', error);
                           }
                         }
                       }}
                       className={`w-7 h-7 flex items-center justify-center text-xl rounded transition-colors bg-slate-700 hover:bg-slate-600 ${
                         startCueId === item.id 
                           ? 'text-yellow-400' // Gold star when selected
                           : 'text-slate-400 hover:text-yellow-400'
                       }`}
                       title={startCueId === item.id ? "Unmark as SHOW START" : "Mark as SHOW START"}
                     >
                       {startCueId === item.id ? '⭐' : '☆'}
                     </button>
                     
                    <div className="flex">
                      <div className={`flex items-center px-1 py-1 border border-slate-600 border-r-0 rounded-l text-white text-lg font-medium min-w-[40px] ${
                        lastLoadedCueId === item.id ? 'bg-purple-600' : 'bg-slate-600'
                      }`}>
                        CUE
                      </div>
                    <input
                      type="text"
                        value={item.customFields.cue ? item.customFields.cue.replace(/^CUE\s*/, '') : ''}
                      onChange={(e) => {
                        // Detect user editing
                        handleUserEditing();
                        
                        if (currentUserRole === 'VIEWER') {
                          alert('Viewers cannot edit cue names. Please change your role to EDITOR or OPERATOR.');
                          return;
                        }
                        const oldValue = item.customFields.cue || 'CUE ';
                          const newValue = e.target.value ? `CUE ${e.target.value}` : 'CUE ';
                        setSchedule(prev => prev.map(scheduleItem => 
                          scheduleItem.id === item.id 
                            ? { 
                                ...scheduleItem, 
                                customFields: { 
                                  ...scheduleItem.customFields, 
                                    cue: newValue 
                                }
                              }
                            : scheduleItem
                        ));
                        
                        // Log the change (debounced)
                        logChangeDebounced(
                          `cue_${item.id}`,
                          'FIELD_UPDATE', 
                          `Updated cue for "${item.segmentName}" from "${oldValue}" to "${newValue}"`, 
                          {
                            changeType: 'FIELD_CHANGE',
                            itemId: item.id,
                            itemName: item.segmentName,
                            fieldName: 'cue',
                            oldValue: oldValue,
                            newValue: newValue,
                            details: {
                              fieldType: 'text',
                              characterChange: newValue.length - oldValue.length
                            }
                          }
                        );
                      }}
                      disabled={currentUserRole === 'VIEWER'}
                      className="w-14 px-1 py-1 border border-slate-600 rounded-r text-center text-lg transition-colors bg-slate-700 text-white focus:outline-none focus:border-blue-500"
                      title={currentUserRole === 'VIEWER' ? 'Viewers cannot edit cue names' : 'Edit cue number'}
                      maxLength={4}
                    />
                     </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          // Detect user editing
                          handleUserEditing();
                          
                          if (currentUserRole === 'VIEWER') {
                            alert('Viewers cannot indent/unindent items. Please change your role to EDITOR or OPERATOR.');
                            return;
                          }
                          
                          // Use new database-backed indent logic
                          toggleIndentedCue(item.id);
                          
                        }}
                        className={`w-7 h-7 text-white flex items-center justify-center text-lg rounded font-bold transition-colors ${
                          currentUserRole === 'VIEWER'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : indentedCues[item.id] 
                              ? 'bg-orange-600 hover:bg-orange-500' 
                              : 'bg-slate-600 hover:bg-slate-500'
                        }`}
                        disabled={currentUserRole === 'VIEWER'}
                        title={currentUserRole === 'VIEWER' ? 'Viewers cannot indent/unindent items' : (indentedCues[item.id] ? "Unindent (group with row above)" : "Indent (group with row above)")}
                      >
                        {indentedCues[item.id] ? '↗' : '↘'}
                      </button>
                      <button
                        onClick={() => {
                          // Detect user editing
                          handleUserEditing();
                          
                          if (currentUserRole === 'VIEWER') {
                            alert('Viewers cannot move items. Please change your role to EDITOR or OPERATOR.');
                            return;
                          }
                          moveScheduleItem(item.id, 'up');
                        }}
                        disabled={index === 0 || currentUserRole === 'VIEWER'}
                        className={`w-7 h-7 text-white flex items-center justify-center text-lg rounded font-bold transition-colors ${
                          currentUserRole === 'VIEWER'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : 'bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed'
                        }`}
                        title={currentUserRole === 'VIEWER' ? 'Viewers cannot move items' : 'Move Up'}
                      >
                        ↑
                      </button>
                      <button
                        onClick={() => {
                          // Detect user editing
                          handleUserEditing();
                          
                          if (currentUserRole === 'VIEWER') {
                            alert('Viewers cannot move items. Please change your role to EDITOR or OPERATOR.');
                            return;
                          }
                          moveScheduleItem(item.id, 'down');
                        }}
                        disabled={index === getFilteredSchedule().length - 1 || currentUserRole === 'VIEWER'}
                        className={`w-7 h-7 text-white flex items-center justify-center text-lg rounded font-bold transition-colors ${
                          currentUserRole === 'VIEWER'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : 'bg-slate-600 hover:bg-slate-500 disabled:opacity-30 disabled:cursor-not-allowed'
                        }`}
                        title={currentUserRole === 'VIEWER' ? 'Viewers cannot move items' : 'Move Down'}
                      >
                        ↓
                      </button>
                      <button
                        onClick={() => {
                          // Detect user editing
                          handleUserEditing();
                          
                          if (currentUserRole === 'VIEWER') {
                            alert('Viewers cannot delete items. Please change your role to EDITOR or OPERATOR.');
                            return;
                          }
                          deleteScheduleItem(item.id);
                        }}
                        className={`w-7 h-7 text-white flex items-center justify-center text-lg rounded font-bold transition-colors ${
                          currentUserRole === 'VIEWER'
                            ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                            : 'bg-red-600 hover:bg-red-500'
                        }`}
                        disabled={currentUserRole === 'VIEWER'}
                        title={currentUserRole === 'VIEWER' ? 'Viewers cannot delete items' : 'Delete'}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Center Scrollable Section - Main Schedule Data */}
            <div id="main-scroll-container" className="flex-1 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              <div className="min-w-max">
                {/* Header Row */}
                <div className="h-24 bg-slate-700 border-b-3 border-slate-600 flex">
                  {visibleColumns.start && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.start }}
                    >
                      <span className="text-white font-bold">Start</span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'start')}
                      />
                    </div>
                  )}
                  {visibleColumns.programType && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.programType }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Program Type
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'programType')}
                      />
                    </div>
                  )}
                  {visibleColumns.duration && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.duration }}
                    >
                      <div className="text-center">
                        <div className="text-white font-bold flex items-center justify-center gap-1">
                          Duration
                          {currentUserRole === 'VIEWER' && (
                            <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">HH MM SS</div>
                      </div>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'duration')}
                      />
                    </div>
                  )}
                  {visibleColumns.segmentName && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.segmentName }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Segment Name
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'segmentName')}
                      />
                    </div>
                  )}
                  {visibleColumns.shotType && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.shotType }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Shot Type
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'shotType')}
                      />
                    </div>
                  )}
                  {visibleColumns.pptQA && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.pptQA }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        PPT/Q&A
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'pptQA')}
                      />
                    </div>
                  )}
                  {visibleColumns.notes && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.notes }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Notes
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'notes')}
                      />
                    </div>
                  )}
                  {visibleColumns.assets && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.assets }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Assets
                        {currentUserRole === 'VIEWER' && (
                          <span className="text-yellow-400" title="Read-only for VIEWERs">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'assets')}
                      />
                    </div>
                  )}
                  {visibleColumns.participants && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.participants }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Participants
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'participants')}
                      />
                    </div>
                  )}
                  {visibleColumns.speakers && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.speakers }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Speakers
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'speakers')}
                      />
                    </div>
                  )}
                  {visibleColumns.public && (
                    <div 
                      className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 relative"
                      style={{ width: columnWidths.public }}
                    >
                      <span className="text-white font-bold flex items-center gap-1">
                        Public
                        {(currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') && (
                          <span className="text-yellow-400" title="Read-only for your role">🔒</span>
                        )}
                      </span>
                      <div 
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                        onMouseDown={(e) => handleResizeStart(e, 'public')}
                      />
                    </div>
                  )}
                  {customColumns.map(column => 
                    visibleCustomColumns[column.id] !== false && (
                      <div 
                        key={column.id} 
                        className="px-4 py-2 border-r border-slate-600 flex items-center justify-center relative flex-shrink-0"
                        style={{ width: customColumnWidths[column.id] || 256 }}
                      >
                        <span className="text-white font-bold">{column.name}</span>
                        <button
                          onClick={() => {
                            if (window.confirm(`Are you sure you want to remove the "${column.name}" column? This will delete all data in this column.`)) {
                              removeCustomColumn(column.id);
                            }
                          }}
                          className="absolute top-1 right-1 w-6 h-6 bg-red-600 hover:bg-red-700 text-white rounded-md text-base font-bold flex items-center justify-center transition-colors shadow-md hover:shadow-lg"
                          title={`Remove "${column.name}" column`}
                        >
                          ×
                        </button>
                        <div 
                          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 opacity-0 hover:opacity-100 transition-opacity"
                          onMouseDown={(e) => handleCustomColumnResizeStart(e, column.id)}
                        />
                      </div>
                    )
                  )}
                </div>


                {/* Schedule Rows */}
                {getFilteredSchedule().length === 0 ? (
                  <div className="h-24 flex items-center justify-center text-slate-500 text-xl">
                    No schedule items for Day {selectedDay}. Click "Add Schedule Item" to start!
                  </div>
                ) : (
                                     getFilteredSchedule().map((item, index) => (
                     <div 
                       key={`${item.id}-${item.notes?.length || 0}-${item.speakers?.length || 0}`}
                       data-item-id={item.id}
                       className={`border-b-2 border-slate-600 flex ${
                         // Use hybrid timer data for real-time highlighting (ClockPage style)
                         (() => {
                         // Match item_id with both string and number comparison
                         const hybridItemId = hybridTimerData?.activeTimer?.item_id;
                         const isMatch = hybridItemId && (parseInt(String(hybridItemId)) === item.id || hybridItemId === item.id || String(hybridItemId) === String(item.id));
                         const isHybridRunning = isMatch && hybridTimerData?.activeTimer?.is_running && hybridTimerData?.activeTimer?.is_active;
                         const isHybridLoaded = isMatch && hybridTimerData?.activeTimer?.is_active && !hybridTimerData?.activeTimer?.is_running;
                         
                         // Debug logging removed to prevent console spam
                         
                         // Use ONLY hybrid timer data for highlighting (no fallback to old logic)
                         if (isHybridRunning) return 'bg-green-950';
                         if (isHybridLoaded) return 'bg-blue-950';
                         
                         // Only use old logic for completed/stopped states (not active states)
                         if (completedCues[item.id]) return 'bg-gray-900 opacity-40';
                         if (stoppedItems.has(item.id)) return 'bg-gray-900 opacity-40';
                         if (loadedCueDependents.has(item.id)) return 'bg-amber-950 border-amber-600';
                         
                         // Debug logging removed to prevent console spam
                         
                         // INDENTED CUES: Highlight when parent is loaded OR running
                         if (indentedCues[item.id]) {
                           const parentId = indentedCues[item.id].parentId;
                           const currentlyLoadedItemId = hybridTimerData?.activeTimer?.item_id || activeItemId;
                           
                           // Check if parent is currently loaded
                           const parentIsLoaded = currentlyLoadedItemId && (
                             parseInt(String(currentlyLoadedItemId)) === parentId || 
                             currentlyLoadedItemId === parentId || 
                             String(currentlyLoadedItemId) === String(parentId)
                           );
                           
                           // Check if parent is running
                           const parentIsRunning = activeTimers[parentId] !== undefined;
                           
                           if (parentIsLoaded || parentIsRunning) return 'bg-amber-950 border-amber-600';
                         }
                         if (lastLoadedCueId === item.id) return 'bg-purple-950 border-purple-400';
                         return index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900';
                         })()
                       }`}
                       style={{ height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) }}
                     >
                       {visibleColumns.start && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.start }}
                         >
                           <div className="flex flex-col items-center gap-1">
                           <span className="text-white font-mono text-base font-bold">
                               {indentedCues[item.id] ? '↘' : calculateStartTimeWithOvertime(index)}
                           </span>
                             {!indentedCues[item.id] && (overtimeMinutes[item.id] || (item.id === startCueId && showStartOvertime !== 0) || calculateStartTime(index) !== calculateStartTimeWithOvertime(index)) && (
                               <span className={`text-sm font-bold px-2 py-1 rounded text-center leading-tight ${
                                 (() => {
                                  // For START cue: use show start overtime only for color
                                  if (item.id === startCueId) {
                                    return showStartOvertime > 0 ? 'text-red-400 bg-red-900/30' : 'text-green-400 bg-green-900/30';
                                  }
                                  
                                  // For other rows: calculate total cumulative overtime for color
                                   let totalOvertime = 0;
                                   for (let i = 0; i < schedule.findIndex(s => s.id === item.id); i++) {
                                     const prevItem = schedule[i];
                                     const prevItemDay = prevItem.day || 1;
                                     const currentItemDay = item.day || 1;
                                     if (prevItemDay === currentItemDay && !indentedCues[prevItem.id]) {
                                       totalOvertime += overtimeMinutes[prevItem.id] || 0;
                                     }
                                   }
                                  // Add show start overtime for rows after START
                                  if (showStartOvertime !== 0 && startCueId !== null) {
                                    const startCueIndex = schedule.findIndex(s => s.id === startCueId);
                                    const currentIndex = schedule.findIndex(s => s.id === item.id);
                                    if (startCueIndex !== -1 && currentIndex > startCueIndex) {
                                      totalOvertime += showStartOvertime;
                                    }
                                  }
                                  return totalOvertime > 0 ? 'text-red-400 bg-red-900/30' : 'text-green-400 bg-green-900/30';
                                })()
                               }`} title="Time adjusted due to overtime">
                                 {(() => {
                                  // For START cue row: show ONLY show start overtime (not duration)
                                  if (item.id === startCueId) {
                                    const showStartOT = showStartOvertime || 0;
                                    
                                    if (showStartOT > 0) {
                                      const hours = Math.floor(showStartOT / 60);
                                      const minutes = showStartOT % 60;
                                      const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                                      return `+${timeDisplay} late`;
                                    } else if (showStartOT < 0) {
                                      const hours = Math.floor(Math.abs(showStartOT) / 60);
                                      const minutes = Math.abs(showStartOT) % 60;
                                      const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                                      return `-${timeDisplay} early`;
                                    }
                                    return 'On time';
                                  }
                                  
                                  // For other rows: calculate total cumulative overtime (includes show start + all duration)
                                   let totalOvertime = 0;
                                   for (let i = 0; i < schedule.findIndex(s => s.id === item.id); i++) {
                                     const prevItem = schedule[i];
                                     const prevItemDay = prevItem.day || 1;
                                     const currentItemDay = item.day || 1;
                                     if (prevItemDay === currentItemDay && !indentedCues[prevItem.id]) {
                                       totalOvertime += overtimeMinutes[prevItem.id] || 0;
                                     }
                                   }
                                  // Add show start overtime for rows after START cue
                                  if (showStartOvertime !== 0 && startCueId !== null) {
                                    const startCueIndex = schedule.findIndex(s => s.id === startCueId);
                                    const currentIndex = schedule.findIndex(s => s.id === item.id);
                                    if (startCueIndex !== -1 && currentIndex > startCueIndex) {
                                      totalOvertime += showStartOvertime;
                                     }
                                   }
                                   if (totalOvertime > 0) {
                                     const hours = Math.floor(totalOvertime / 60);
                                     const minutes = totalOvertime % 60;
                                     const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                                     return `+${timeDisplay}`;
                                   } else if (totalOvertime < 0) {
                                     const hours = Math.floor(Math.abs(totalOvertime) / 60);
                                     const minutes = Math.abs(totalOvertime) % 60;
                                     const timeDisplay = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                                     return `-${timeDisplay}`;
                                   }
                                   return '0m';
                                 })()}
                               </span>
                             )}
                           </div>
                         </div>
                       )}
                       {visibleColumns.programType && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.programType }}
                         >
                        <select 
                          value={item.programType}
                            onFocus={() => {
                              // Pause syncing when dropdown is clicked/focused
                              console.log('✏️ Program Type dropdown focused - pausing sync');
                              handleModalEditing();
                            }}
          onChange={(e) => {
            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
              alert('Only EDITORs can edit program type. Please change your role to EDITOR.');
              return;
            }
            const oldValue = item.programType;
            setSchedule(prev => prev.map(scheduleItem => 
              scheduleItem.id === item.id 
                ? { ...scheduleItem, programType: e.target.value }
                : scheduleItem
            ));
            
            // Log the change (debounced)
            logChangeDebounced(
              `programType_${item.id}`,
              'FIELD_UPDATE', 
              `Updated program type for "${item.segmentName}" from "${oldValue}" to "${e.target.value}"`, 
              {
                changeType: 'FIELD_CHANGE',
                itemId: item.id,
                itemName: item.segmentName,
                fieldName: 'programType',
                oldValue: oldValue,
                newValue: e.target.value,
                details: {
                  fieldType: 'select',
                  optionChange: true
                }
              }
            );
                              // Resume syncing when dropdown selection is made
                              handleModalClosed();
          }}
          disabled={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
          className="w-full px-3 py-2 border-2 rounded text-base transition-colors bg-slate-700 border-slate-500 text-white focus:border-blue-500"
          style={{ 
            backgroundColor: programTypeColors[item.programType] || '#374151',
            color: item.programType === 'Sub Cue' ? '#000000' : '#ffffff',
            opacity: 1
          }}
          title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit program type' : 'Select program type'}
                        >
                          {programTypes.map(type => (
                            <option 
                              key={type} 
                              value={type}
                              style={{ 
                                backgroundColor: programTypeColors[type] || '#374151',
                                color: type === 'Sub Cue' ? '#000000' : '#ffffff'
                              }}
                            >
                              {type}
                            </option>
                          ))}
                        </select>
                       </div>
                       )}
                       {visibleColumns.duration && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.duration }}
                         >
                        <div className="flex items-center gap-2">
                          <input 
                            type="number" 
                            min="0" 
                            max="23" 
                            value={item.durationHours}
                          onChange={(e) => {
                            // Detect user editing
                            handleUserEditing();
                            
                            if (currentUserRole === 'VIEWER') {
                              alert('Only EDITORs and OPERATORs can edit duration. Please change your role to EDITOR or OPERATOR.');
                              return;
                            }
                            const oldValue = item.durationHours;
                            const newValue = parseInt(e.target.value) || 0;
                            setSchedule(prev => prev.map(scheduleItem => 
                              scheduleItem.id === item.id 
                                ? { ...scheduleItem, durationHours: newValue }
                                : scheduleItem
                            ));
                            
                            // Log the change (debounced)
                            logChangeDebounced(
                              `durationHours_${item.id}`,
                              'FIELD_UPDATE', 
                              `Updated duration hours for "${item.segmentName}" from ${oldValue} to ${newValue}`, 
                              {
                                changeType: 'FIELD_CHANGE',
                                itemId: item.id,
                                itemName: item.segmentName,
                                fieldName: 'durationHours',
                                oldValue: oldValue,
                                newValue: newValue,
                                details: {
                                  fieldType: 'number',
                                  timeChange: newValue - oldValue
                                }
                              }
                            );
                          }}
                          disabled={currentUserRole === 'VIEWER'}
                          className="w-14 px-2 py-2 border border-slate-600 rounded text-center text-lg font-mono font-bold transition-colors bg-slate-700 text-white"
                          style={{ opacity: 1 }}
                          title={currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can edit duration' : 'Edit hours'}
                          />
                          <span className="text-slate-400 text-xl font-bold">:</span>
                          <input 
                            type="number" 
                            min="0" 
                            max="59" 
                            value={item.durationMinutes}
                          onChange={(e) => {
                            // Detect user editing
                            handleUserEditing();
                            
                            if (currentUserRole === 'VIEWER') {
                              alert('Only EDITORs and OPERATORs can edit duration. Please change your role to EDITOR or OPERATOR.');
                              return;
                            }
                            const oldValue = item.durationMinutes;
                            const newValue = parseInt(e.target.value) || 0;
                            setSchedule(prev => prev.map(scheduleItem => 
                              scheduleItem.id === item.id 
                                ? { ...scheduleItem, durationMinutes: newValue }
                                : scheduleItem
                            ));
                            
                            // Log the change (debounced)
                            logChangeDebounced(
                              `durationMinutes_${item.id}`,
                              'FIELD_UPDATE', 
                              `Updated duration minutes for "${item.segmentName}" from ${oldValue} to ${newValue}`, 
                              {
                                changeType: 'FIELD_CHANGE',
                                itemId: item.id,
                                itemName: item.segmentName,
                                fieldName: 'durationMinutes',
                                oldValue: oldValue,
                                newValue: newValue,
                                details: {
                                  fieldType: 'number',
                                  timeChange: newValue - oldValue
                                }
                              }
                            );
                          }}
                          disabled={currentUserRole === 'VIEWER'}
                          className="w-14 px-2 py-2 border border-slate-600 rounded text-center text-lg font-mono font-bold transition-colors bg-slate-700 text-white"
                          style={{ opacity: 1 }}
                          title={currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can edit duration' : 'Edit minutes'}
                          />
                          <span className="text-slate-400 text-xl font-bold">:</span>
                          <input 
                            type="number" 
                            min="0" 
                            max="59" 
                            value={item.durationSeconds}
                          onChange={(e) => {
                            // Detect user editing
                            handleUserEditing();
                            
                            if (currentUserRole === 'VIEWER') {
                              alert('Only EDITORs and OPERATORs can edit duration. Please change your role to EDITOR or OPERATOR.');
                              return;
                            }
                            const oldValue = item.durationSeconds;
                            const newValue = parseInt(e.target.value) || 0;
                            setSchedule(prev => prev.map(scheduleItem => 
                              scheduleItem.id === item.id 
                                ? { ...scheduleItem, durationSeconds: newValue }
                                : scheduleItem
                            ));
                            
                            // Log the change (debounced)
                            logChangeDebounced(
                              `durationSeconds_${item.id}`,
                              'FIELD_UPDATE', 
                              `Updated duration seconds for "${item.segmentName}" from ${oldValue} to ${newValue}`, 
                              {
                                changeType: 'FIELD_CHANGE',
                                itemId: item.id,
                                itemName: item.segmentName,
                                fieldName: 'durationSeconds',
                                oldValue: oldValue,
                                newValue: newValue,
                                details: {
                                  fieldType: 'number',
                                  timeChange: newValue - oldValue
                                }
                              }
                            );
                          }}
                          disabled={currentUserRole === 'VIEWER'}
                          className="w-14 px-2 py-2 border border-slate-600 rounded text-center text-lg font-mono font-bold transition-colors bg-slate-700 text-white"
                          style={{ opacity: 1 }}
                          title={currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can edit duration' : 'Edit seconds'}
                          />
                        </div>
                       </div>
                       )}
                       {visibleColumns.segmentName && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.segmentName }}
                         >
                        <input
                          type="text"
                          value={item.segmentName}
                          onChange={(e) => {
                            // Detect user editing
                            handleUserEditing();
                            
                            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                              alert('Only EDITORs can edit segment names. Please change your role to EDITOR.');
                              return;
                            }
                            const oldValue = item.segmentName;
                            setSchedule(prev => prev.map(scheduleItem => 
                              scheduleItem.id === item.id 
                                ? { ...scheduleItem, segmentName: e.target.value }
                                : scheduleItem
                            ));
                            
                            // Log the change (debounced)
                            logChangeDebounced(
                              `segmentName_${item.id}`,
                              'FIELD_UPDATE', 
                              `Updated segment name for "${oldValue}" to "${e.target.value}"`, 
                              {
                                changeType: 'FIELD_CHANGE',
                                itemId: item.id,
                                itemName: e.target.value,
                                fieldName: 'segmentName',
                                oldValue: oldValue,
                                newValue: e.target.value,
                                details: {
                                  fieldType: 'text',
                                  characterChange: e.target.value.length - oldValue.length
                                }
                              }
                            );
                          }}
                          disabled={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
                          className={`w-full px-3 py-2 border border-slate-600 rounded text-base transition-colors ${
                            currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'
                              ? 'bg-slate-700 text-white'
                              : 'bg-slate-700 text-white'
                          }`}
                          placeholder={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit' : 'Enter segment name'}
                          title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit segment names' : 'Edit segment name'}
                        />
                       </div>
                       )}
                       {visibleColumns.shotType && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.shotType }}
                         >
                        <select 
                          value={item.shotType}
                          onFocus={() => {
                            // Pause syncing when dropdown is clicked/focused
                            console.log('✏️ Shot Type dropdown focused - pausing sync');
                            handleModalEditing();
                          }}
          onChange={(e) => {
            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
              alert('Only EDITORs can edit shot type. Please change your role to EDITOR.');
              return;
            }
            const oldValue = item.shotType;
            setSchedule(prev => prev.map(scheduleItem => 
              scheduleItem.id === item.id 
                ? { ...scheduleItem, shotType: e.target.value }
                : scheduleItem
            ));
            
            // Log the change (debounced)
            logChangeDebounced(
              `shotType_${item.id}`,
              'FIELD_UPDATE', 
              `Updated shot type for "${item.segmentName}" from "${oldValue}" to "${e.target.value}"`, 
              {
                changeType: 'FIELD_CHANGE',
                itemId: item.id,
                itemName: item.segmentName,
                fieldName: 'shotType',
                oldValue: oldValue,
                newValue: e.target.value,
                details: {
                  fieldType: 'select',
                  optionChange: true
                }
              }
            );
            // Resume syncing when dropdown selection is made
            handleModalClosed();
          }}
          disabled={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
          className="w-full px-3 py-2 border border-slate-600 rounded text-base transition-colors bg-slate-700 text-white"
          style={{ opacity: 1 }}
          title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit shot type' : 'Select shot type'}
                        >
                          <option value="">Select Shot Type</option>
                          {shotTypes.map(type => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                       </div>
                       )}
                       {visibleColumns.pptQA && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.pptQA }}
                         >
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={item.hasPPT}
                              onChange={(e) => {
                                // Detect user editing
                                handleUserEditing();
                                
                                if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                                  alert('Only EDITORs can edit PPT settings. Please change your role to EDITOR.');
                                  return;
                                }
                                const oldValue = item.hasPPT;
                                setSchedule(prev => prev.map(scheduleItem => 
                                  scheduleItem.id === item.id 
                                    ? { ...scheduleItem, hasPPT: e.target.checked }
                                    : scheduleItem
                                ));
                                
                                // Log the change (debounced)
                                logChangeDebounced(
                                  `hasPPT_${item.id}`,
                                  'FIELD_UPDATE', 
                                  `Updated PPT status for "${item.segmentName}" from ${oldValue ? 'TRUE' : 'FALSE'} to ${e.target.checked ? 'TRUE' : 'FALSE'}`, 
                                  {
                                    changeType: 'FIELD_CHANGE',
                                    itemId: item.id,
                                    itemName: item.segmentName,
                                    fieldName: 'hasPPT',
                                    oldValue: oldValue ? 'TRUE' : 'FALSE',
                                    newValue: e.target.checked ? 'TRUE' : 'FALSE',
                                    details: {
                                      fieldType: 'checkbox',
                                      booleanChange: true
                                    }
                                  }
                                );
                              }}
                              className={`w-6 h-6 rounded border-2 transition-colors ${
                                currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'
                                  ? 'border-slate-400 bg-slate-700 cursor-not-allowed'
                                  : 'border-slate-400 bg-slate-700 hover:border-blue-400 focus:ring-2 focus:ring-blue-500'
                              }`}
                              style={{ 
                                opacity: 1,
                                filter: 'none',
                                WebkitFilter: 'none'
                              }}
                              title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit PPT settings' : 'Toggle PPT'}
                            />
                            <span className="text-base font-medium text-white">PPT</span>
                          </label>
                          <label className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={item.hasQA}
                              onChange={(e) => {
                                // Detect user editing
                                handleUserEditing();
                                
                                if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                                  alert('Only EDITORs can edit Q&A settings. Please change your role to EDITOR.');
                                  return;
                                }
                                const oldValue = item.hasQA;
                                setSchedule(prev => prev.map(scheduleItem => 
                                  scheduleItem.id === item.id 
                                    ? { ...scheduleItem, hasQA: e.target.checked }
                                    : scheduleItem
                                ));
                                
                                // Log the change (debounced)
                                logChangeDebounced(
                                  `hasQA_${item.id}`,
                                  'FIELD_UPDATE', 
                                  `Updated Q&A status for "${item.segmentName}" from ${oldValue ? 'TRUE' : 'FALSE'} to ${e.target.checked ? 'TRUE' : 'FALSE'}`, 
                                  {
                                    changeType: 'FIELD_CHANGE',
                                    itemId: item.id,
                                    itemName: item.segmentName,
                                    fieldName: 'hasQA',
                                    oldValue: oldValue ? 'TRUE' : 'FALSE',
                                    newValue: e.target.checked ? 'TRUE' : 'FALSE',
                                    details: {
                                      fieldType: 'checkbox',
                                      booleanChange: true
                                    }
                                  }
                                );
                              }}
                              className={`w-6 h-6 rounded border-2 transition-colors ${
                                currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'
                                  ? 'border-slate-400 bg-slate-700 cursor-not-allowed'
                                  : 'border-slate-400 bg-slate-700 hover:border-blue-400 focus:ring-2 focus:ring-blue-500'
                              }`}
                              style={{ 
                                opacity: 1,
                                filter: 'none',
                                WebkitFilter: 'none'
                              }}
                              title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit Q&A settings' : 'Toggle Q&A'}
                            />
                            <span className="text-base font-medium text-white">Q&A</span>
                          </label>
                        </div>
                       </div>
                       )}
                       {visibleColumns.notes && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
                           style={{ width: columnWidths.notes, height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) }}
                      >
                        <div
                          onClick={() => {
                            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                              if (currentUserRole === 'OPERATOR' && item.notes) {
                                alert(`Notes (View Only):\n\n${item.notes.replace(/<[^>]*>/g, '')}`);
                                return;
                              }
                              alert('Only EDITORs can edit notes. Please change your role to EDITOR.');
                              return;
                            }
                            handleModalEditing();
                            setEditingNotesItem(item.id);
                            setShowNotesModal(true);
                          }}
                          className="w-full px-3 py-2 border border-slate-600 rounded text-white text-base transition-colors bg-slate-700 cursor-pointer hover:bg-slate-600"
                          style={{ 
                            minHeight: '4rem', // Minimum height for empty state
                            maxHeight: 'none', // Allow content to expand
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word',
                            display: 'flex',
                            alignItems: 'flex-start', // Align content to top
                            justifyContent: 'flex-start' // Align content to left
                          }}
                          title={currentUserRole === 'VIEWER' ? 'Viewers cannot edit notes' : currentUserRole === 'OPERATOR' ? 'Click to view notes (read-only)' : 'Click to edit notes'}
                        >
                          {item.notes ? (
                            <div 
                              className="text-left w-full notes-display"
                              style={{
                                lineHeight: '1.4',
                                overflow: 'visible'
                              }}
                              dangerouslySetInnerHTML={{ __html: item.notes }}
                            />
                          ) : (
                            <span className="text-slate-400">Click to edit notes...</span>
                          )}
                        </div>
                       </div>
                       )}
                       {visibleColumns.assets && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.assets }}
                         >
                        <div
                          onClick={() => {
                            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                              // For OPERATOR, show view-only modal instead of edit
                              if (currentUserRole === 'OPERATOR' && item.assets) {
                                setViewingAssetsItem(item.id);
                                setShowViewAssetsModal(true);
                                return;
                              }
                              alert('Only EDITORs can edit assets. Please change your role to EDITOR.');
                              return;
                            }
                            // Pause syncing when assets modal opens
                            handleModalEditing();
                            setEditingAssetsItem(item.id);
                            setShowAssetsModal(true);
                          }}
                          className="w-full px-3 py-2 border border-slate-600 rounded text-white text-base transition-colors flex items-center justify-center bg-slate-700 cursor-pointer hover:bg-slate-600"
                          title={currentUserRole === 'VIEWER' ? 'Viewers cannot edit assets' : currentUserRole === 'OPERATOR' ? 'Click to view assets (read-only)' : 'Click to edit assets'}
                        >
                          {item.assets ? (
                            <div className="text-center">
                              <div className="text-sm font-medium">
                                {item.assets.split('||').length} Asset{item.assets.split('||').length !== 1 ? 's' : ''}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">Click to add assets...</span>
                          )}
                        </div>
                       </div>
                       )}
                       {visibleColumns.participants && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-start justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
                           style={{ 
                             width: columnWidths.participants, 
                             height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)
                           }}
                         >
                          <div
                            onClick={() => {
                              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                                if (currentUserRole === 'OPERATOR' && item.speakers) {
                                  alert(`Participants (View Only):\n\n${displaySpeakers(item.speakers)}`);
                                  return;
                                }
                                alert('Only EDITORs can edit participants. Please change your role to EDITOR.');
                                return;
                              }
                              setEditingParticipantsItem(item.id);
                              setShowParticipantsModal(true);
                            }}
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-base cursor-pointer hover:bg-slate-600"
                            style={{
                              height: `calc(${getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)} - 2rem)`,
                              maxHeight: `calc(${getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)} - 2rem)`,
                              overflow: 'hidden',
                              lineHeight: '1.6',
                              wordWrap: 'break-word',
                              overflowWrap: 'break-word',
                              whiteSpace: 'pre-wrap'
                            }}
                            title={currentUserRole === 'VIEWER' ? 'Viewers cannot edit participants' : currentUserRole === 'OPERATOR' ? 'Click to view participants (read-only)' : 'Click to edit participants'}
                          >
                            {displaySpeakers(item.speakers || '') || 'Click to add participants...'}
                          </div>
                       </div>
                       )}
                       {visibleColumns.speakers && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
                           style={{ width: columnWidths.speakers, height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) }}
                         >
                        <div
                          onClick={() => {
                            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                              if (currentUserRole === 'OPERATOR' && item.speakersText) {
                                alert(`Speakers (View Only):\n\n${displaySpeakersText(item.speakersText)}`);
                                return;
                              }
                              alert('Only EDITORs can edit speakers. Please change your role to EDITOR.');
                              return;
                            }
                            // Pause syncing when speakers modal opens
                            handleModalEditing();
                            setEditingSpeakersItem(item.id);
                            setShowSpeakersModal(true);
                          }}
                          className="w-full px-3 py-2 border border-slate-600 rounded text-white text-base transition-colors flex items-start justify-start bg-slate-700 cursor-pointer hover:bg-slate-600"
                          style={{ 
                            height: getSpeakersHeight(item.speakersText),
                            minHeight: getSpeakersHeight(item.speakersText), // Ensure full expansion
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word',
                            overflow: 'hidden', // Hide any potential scrollbars
                            paddingBottom: '1rem', // Extra bottom padding
                            lineHeight: '1.6',
                            whiteSpace: 'pre-wrap'
                          }}
                          title={currentUserRole === 'VIEWER' ? 'Viewers cannot edit speakers' : currentUserRole === 'OPERATOR' ? 'Click to view speakers (read-only)' : 'Click to edit speakers'}
                        >
                          <div className="text-left w-full">
                          {displaySpeakersText(item.speakersText || '') || 'Click to add speakers...'}
                          </div>
                        </div>
                       </div>
                       )}
                       {visibleColumns.public && (
                         <div 
                           className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
                           style={{ width: columnWidths.public }}
                         >
                          <input
                            type="checkbox"
                            checked={item.isPublic || false}
                          onChange={(e) => {
                            if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                              alert('Only EDITORs can change public status. Please change your role to EDITOR.');
                              return;
                            }
                            const oldValue = item.isPublic;
                            setSchedule(prev => prev.map(scheduleItem => 
                              scheduleItem.id === item.id 
                                ? { ...scheduleItem, isPublic: e.target.checked }
                                : scheduleItem
                            ));
                            
                            // Log the change
                            logChange('FIELD_UPDATE', `Updated Public status for "${item.segmentName}" from ${oldValue} to ${e.target.checked}`, {
                              changeType: 'FIELD_CHANGE',
                              itemId: item.id,
                              itemName: item.segmentName,
                              fieldName: 'isPublic',
                              oldValue: oldValue,
                              newValue: e.target.checked,
                              details: {
                                fieldType: 'checkbox',
                                booleanChange: true
                              }
                            });
                            
                            // Mark user as editing to trigger auto-save
                            handleUserEditing();
                            
                            
                            // Save to API
                            saveToAPI();
                          }}
                          className={`w-5 h-5 rounded border-2 focus:ring-2 transition-colors ${
                            currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'
                              ? 'border-slate-500 bg-slate-700 text-blue-600 cursor-not-allowed'
                              : 'border-slate-500 bg-slate-700 text-blue-600 focus:ring-blue-500'
                          }`}
                          style={{ 
                            opacity: 1,
                            filter: 'none',
                            WebkitFilter: 'none'
                          }}
                          title={currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can change public status' : 'Toggle public visibility'}
                        />
                       </div>
                       )}
                       {customColumns.map(column => 
                         visibleCustomColumns[column.id] !== false && (
                           <div 
                             key={column.id} 
                             className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
                             style={{ 
                               width: customColumnWidths[column.id] || 256, 
                               height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)
                             }}
                           >
                          <textarea
                            value={item.customFields[column.name] || ''}
                            onFocus={() => {
                              // Pause syncing when custom column is focused
                              console.log('✏️ Custom column focused - pausing sync');
                              handleUserEditing();
                            }}
                            onChange={(e) => {
                              // Pause syncing when custom column is being typed in
                              handleUserEditing();
                            const oldValue = item.customFields[column.name] || '';
                            setSchedule(prev => prev.map(scheduleItem => 
                              scheduleItem.id === item.id 
                                ? { 
                                    ...scheduleItem, 
                                    customFields: { 
                                      ...scheduleItem.customFields,
                                      [column.name]: e.target.value
                                    }
                                  }
                                : scheduleItem
                            ));
                            
                            // Log the change (debounced)
                            logChangeDebounced(
                              `custom_${column.name}_${item.id}`,
                              'FIELD_UPDATE', 
                              `Updated custom field "${column.name}" for "${item.segmentName}" from "${oldValue}" to "${e.target.value}"`, 
                              {
                                changeType: 'FIELD_CHANGE',
                                itemId: item.id,
                                itemName: item.segmentName,
                                fieldName: `custom_${column.name}`,
                                oldValue: oldValue,
                                newValue: e.target.value,
                                details: {
                                  fieldType: 'custom_field',
                                  columnName: column.name,
                                  characterChange: e.target.value.length - oldValue.length
                                }
                              }
                            );
                            }}
                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-base resize-none"
                            style={{
                              height: `calc(${getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)} - 2rem)`, // Stay within container
                              maxHeight: `calc(${getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)} - 2rem)`, // Strict constraint
                              overflow: 'hidden', // Remove scrollbars completely
                              lineHeight: '1.6', // Better line spacing
                              wordWrap: 'break-word',
                              overflowWrap: 'break-word'
                            }}
                            rows={Math.max(2, (item.customFields[column.name] || '').split('\n').length)}
                            placeholder={`${column.name}...`}
                          />
                        </div>
                       )
                       )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right Fixed Section - Timer Controls */}
            <div className="w-32 flex-shrink-0 bg-slate-900" style={{ borderLeft: '6px solid #475569' }}>
              {/* Header */}
              <div className="h-24 bg-slate-700 border-b-3 border-slate-600 flex items-center justify-center">
                <span className="text-white font-bold text-base flex items-center gap-1">
                  Timer
                  {(currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') && (
                    <span className="text-yellow-400" title="Only OPERATORs can control timers">🔒</span>
                  )}
                </span>
              </div>
              
              
              {/* Timer Controls for each row */}
              {getFilteredSchedule().length === 0 ? (
                <div className="h-24 flex items-center justify-center text-slate-500">
                  -
                </div>
              ) : (
                                 getFilteredSchedule().map((item, index) => (
                   <div 
                     key={`${item.id}-${item.notes?.length || 0}-${item.speakers?.length || 0}`}
                     className={`border-b-2 border-slate-600 flex flex-col items-center justify-center gap-1 ${
                       index % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'
                     }`}
                     style={{ height: getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) }}
                   >
                    <div className="flex flex-col items-center justify-center h-full gap-1">
                      <div className="text-sm font-mono text-slate-300">
                        {item.timerId || 'TIMER'}
                      </div>
                      <div className="flex flex-col gap-1">
                        {!indentedCues[item.id] ? (
                          <>
                            <button
                              onClick={async () => {
                                console.log('🔥🔥🔥 LOAD BUTTON CLICKED!');
                                console.log('🔥🔥🔥 currentUserRole:', currentUserRole);
                                console.log('🔥🔥🔥 item.id:', item.id);
                                console.log('🔥🔥🔥 user:', user);
                                console.log('🔥🔥🔥 event:', event);
                                
                                if (currentUserRole === 'VIEWER') {
                                  alert('Viewers cannot load cues. Please change your role to EDITOR or OPERATOR.');
                                  return;
                                }
                                
                                if (currentUserRole === 'EDITOR') {
                                  alert('Editors cannot load cues. Please change your role to OPERATOR.');
                                  return;
                                }
                                
                                console.log('🔥🔥🔥 Calling loadCue function...');
                                try {
                                  await loadCue(item.id);
                                  console.log('🔥🔥🔥 loadCue completed successfully');
                                } catch (error) {
                                  console.error('🔥🔥🔥 loadCue failed:', error);
                                }
                              }}
                              disabled={activeItemId === item.id || currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                              className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
                                currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                                  ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                                  : activeItemId === item.id
                                    ? 'bg-blue-600 text-white cursor-default'
                                    : 'bg-slate-600 hover:bg-slate-500 text-white'
                              }`}
                              title={currentUserRole === 'VIEWER' ? 'Viewers cannot load cues' : currentUserRole === 'EDITOR' ? 'Editors cannot load cues' : 'Load this cue'}
                            >
                              {activeItemId === item.id ? 'LOADED' : 'LOAD'}
                            </button>
                            <button
                              onClick={async () => {
                                if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                                  alert('Only OPERATORs can start/stop timers. Please change your role to OPERATOR.');
                                  return;
                                }
                                await toggleTimer(item.id);
                              }}
                              disabled={activeItemId !== item.id || (activeTimers[item.id] ? false : Object.keys(activeTimers).length > 0) || currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'}
                              className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
                                currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                                  ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                                  : activeTimers[item.id]
                                    ? 'bg-red-600 hover:bg-red-500 text-white'
                                    : activeItemId === item.id && Object.keys(activeTimers).length === 0
                                    ? 'bg-green-600 hover:bg-green-500 text-white'
                                    : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                              }`}
                              title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can start/stop timers' : (activeTimers[item.id] ? 'Stop timer' : 'Start timer')}
                            >
                              {activeTimers[item.id] ? 'STOP' : 'START'}
                            </button>
                          </>
                        ) : (
                          <>
                            {/* Secondary timer buttons for indented items */}
                            <button
                              onClick={() => {
                                if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                                  alert('Only OPERATORs can start secondary timers. Please change your role to OPERATOR.');
                                  return;
                                }
                                startSecondaryTimer(item.id);
                              }}
                              disabled={secondaryTimer?.itemId === item.id || currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' || !isParentCueRunning(item.id)}
                              className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
                                currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                                  ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                                  : !isParentCueRunning(item.id)
                                    ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                                    : secondaryTimer?.itemId === item.id
                                      ? 'bg-orange-600 text-white cursor-default'
                                      : 'bg-orange-500 hover:bg-orange-400 text-white'
                              }`}
                              title={
                                currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' 
                                  ? 'Only OPERATORs can start secondary timers' 
                                  : !isParentCueRunning(item.id)
                                    ? 'Start the CUE above first before starting secondary timer'
                                    : 'Start secondary timer'
                              }
                            >
                              {secondaryTimer?.itemId === item.id ? 'PLAYING' : 'PLAY'}
                            </button>
                            <button
                              onClick={() => {
                                if (currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR') {
                                  alert('Only OPERATORs can stop secondary timers. Please change your role to OPERATOR.');
                                  return;
                                }
                                stopSecondaryTimer();
                              }}
                              disabled={secondaryTimer?.itemId !== item.id || currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' || !isParentCueRunning(item.id)}
                              className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
                                currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR'
                                  ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                                  : !isParentCueRunning(item.id)
                                    ? 'bg-gray-500 text-gray-300 cursor-not-allowed'
                                    : secondaryTimer?.itemId === item.id
                                      ? 'bg-red-600 hover:bg-red-500 text-white'
                                      : 'bg-slate-600 text-slate-400 cursor-not-allowed'
                              }`}
                              title={currentUserRole === 'VIEWER' || currentUserRole === 'EDITOR' ? 'Only OPERATORs can stop secondary timers' : 'Stop secondary timer'}
                            >
                              STOP
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Item Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-600">
              <h2 className="text-lg font-bold text-white">Add Schedule Item</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={modalForm.isPublic}
                  onChange={(e) => setModalForm(prev => ({ ...prev, isPublic: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-slate-300 text-sm">Public</span>
              </label>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Cue</label>
                  <div className="flex">
                    <div className="flex items-center px-2 py-2 bg-slate-600 border border-slate-600 border-r-0 rounded-l text-white text-sm font-medium min-w-[40px]">
                      CUE
                    </div>
                  <input
                    type="text"
                    value={modalForm.cue}
                    onChange={(e) => {
                      handleUserEditing();
                      setModalForm(prev => ({ ...prev, cue: e.target.value }));
                    }}
                      className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-r text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm"
                      placeholder="1, 1.1, 1A, etc."
                  />
                  </div>
                </div>
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Program Type</label>
                  <select
                    value={modalForm.programType}
                    onFocus={() => {
                      // Pause syncing when dropdown is clicked/focused
                      console.log('✏️ Program Type modal dropdown focused - pausing sync');
                      handleModalEditing();
                    }}
                    onChange={(e) => {
                      setModalForm(prev => ({ ...prev, programType: e.target.value }));
                      // Resume syncing when dropdown selection is made
                      handleModalClosed();
                    }}
                    className="w-full px-3 py-2 bg-slate-700 border-2 border-slate-500 rounded text-white focus:outline-none focus:border-blue-500 text-sm"
                    style={{ 
                      backgroundColor: programTypeColors[modalForm.programType] || '#374151',
                      color: modalForm.programType === 'Sub Cue' ? '#000000' : '#ffffff'
                    }}
                  >
                    {programTypes.map(type => (
                      <option 
                        key={type} 
                        value={type}
                        style={{ 
                          backgroundColor: programTypeColors[type] || '#374151',
                          color: type === 'Sub Cue' ? '#000000' : '#ffffff'
                        }}
                      >
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              
              <div>
                <label className="block text-slate-300 text-sm font-medium mb-1">Segment Name</label>
                <input
                  type="text"
                  value={modalForm.segmentName}
                  onChange={(e) => {
                    handleUserEditing();
                    setModalForm(prev => ({ ...prev, segmentName: e.target.value }));
                  }}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm"
                  placeholder="Enter segment name"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Shot Type</label>
                  <select
                    value={modalForm.shotType}
                    onFocus={() => {
                      // Pause syncing when dropdown is clicked/focused
                      console.log('✏️ Shot Type modal dropdown focused - pausing sync');
                      handleModalEditing();
                    }}
                    onChange={(e) => {
                      setModalForm(prev => ({ ...prev, shotType: e.target.value }));
                      // Resume syncing when dropdown selection is made
                      handleModalClosed();
                    }}
                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500 text-sm"
                  >
                    <option value="">Select Shot Type</option>
                    {shotTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 text-sm font-medium mb-1">Duration</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      value={modalForm.durationHours}
                      onChange={(e) => {
                        handleUserEditing();
                        setModalForm(prev => ({ ...prev, durationHours: parseInt(e.target.value) || 0 }));
                      }}
                      className="w-12 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500 text-sm text-center"
                      min="0"
                      placeholder="H"
                    />
                    <span className="text-slate-400 self-center text-sm">:</span>
                    <input
                      type="number"
                      value={modalForm.durationMinutes}
                      onChange={(e) => {
                        handleUserEditing();
                        setModalForm(prev => ({ ...prev, durationMinutes: parseInt(e.target.value) || 0 }));
                      }}
                      className="w-12 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500 text-sm text-center"
                      min="0"
                      max="59"
                      placeholder="M"
                    />
                    <span className="text-slate-400 self-center text-sm">:</span>
                    <input
                      type="number"
                      value={modalForm.durationSeconds}
                      onChange={(e) => {
                        handleUserEditing();
                        setModalForm(prev => ({ ...prev, durationSeconds: parseInt(e.target.value) || 0 }));
                      }}
                      className="w-12 px-2 py-2 bg-slate-700 border border-slate-600 rounded text-white focus:outline-none focus:border-blue-500 text-sm text-center"
                      min="0"
                      max="59"
                      placeholder="S"
                    />
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={modalForm.hasPPT}
                    onChange={(e) => {
                      handleUserEditing();
                      setModalForm(prev => ({ ...prev, hasPPT: e.target.checked }));
                    }}
                    className="rounded"
                  />
                  <span className="text-slate-300 text-sm">Has PPT</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={modalForm.hasQA}
                    onChange={(e) => {
                      handleUserEditing();
                      setModalForm(prev => ({ ...prev, hasQA: e.target.checked }));
                    }}
                    className="rounded"
                  />
                  <span className="text-slate-300 text-sm">Has QA</span>
                </label>
              </div>
            </div>
            
            <div className="mt-3">
              <label className="block text-slate-300 text-sm font-medium mb-1">Notes</label>
              <div 
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm cursor-pointer hover:bg-slate-600 transition-colors min-h-[60px] flex items-center"
                onClick={() => {
                  // Pause syncing when notes modal opens
                  handleModalEditing();
                  setEditingNotesItem(-1); // Use -1 to indicate modal form editing
                  setShowNotesModal(true);
                }}
              >
                {modalForm.notes ? (
                  <div 
                    className="text-sm notes-display" 
                    style={{
                      lineHeight: '1.4',
                      overflow: 'visible'
                    }}
                    dangerouslySetInnerHTML={{ __html: modalForm.notes }} 
                  />
                ) : (
                  <span className="text-slate-400">Click to edit notes with rich formatting...</span>
                )}
              </div>
            </div>
            
            <div className="mt-3">
              <label className="block text-slate-300 text-sm font-medium mb-1">Assets</label>
              <div 
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm cursor-pointer hover:bg-slate-600 transition-colors min-h-[60px] flex items-center"
                onClick={() => {
                  // Pause syncing when assets modal opens
                  handleModalEditing();
                  setEditingAssetsItem(-1); // Use -1 to indicate modal form editing
                  setShowAssetsModal(true);
                }}
              >
                {modalForm.assets ? (
                  <div className="text-sm" dangerouslySetInnerHTML={{ __html: modalForm.assets.replace(/\|\|/g, '<br>') }} />
                ) : (
                  <span className="text-slate-400">Click to edit assets with advanced management...</span>
                )}
              </div>
            </div>
            
            <div className="mt-3">
              <label className="block text-slate-300 text-sm font-medium mb-1">Speakers</label>
              <div 
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm cursor-pointer hover:bg-slate-600 transition-colors min-h-[60px] flex items-start justify-start"
                onClick={() => {
                  // Pause syncing when speakers modal opens
                  handleModalEditing();
                  setEditingSpeakersItem(-1); // Use -1 to indicate modal form editing
                  setShowSpeakersModal(true);
                }}
                style={{
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {modalForm.speakersText ? (
                  <div className="text-sm text-left w-full">
                    {displaySpeakersText(modalForm.speakersText)}
                  </div>
                ) : (
                  <span className="text-slate-400">Click to add speakers...</span>
                )}
              </div>
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-600">
              <div className="flex gap-2">
                <button
                  onClick={() => addScheduleItem(modalForm)}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition-colors text-sm"
                >
                  Add Item
                </button>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    handleModalClosed();
                  }}
                  className="flex-1 px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

             {/* Add Custom Column Modal */}
       {showCustomColumnModal && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-800 rounded-xl p-8 max-w-md w-full">
             <h2 className="text-2xl font-bold text-white mb-6">Add Custom Column</h2>
             
             <div className="mb-4">
               <label className="block text-slate-300 font-semibold mb-2">Column Name</label>
               <input
                 type="text"
                 placeholder="Enter column name"
                 className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                 onFocus={() => {
                   // Pause syncing when custom column input is focused
                   console.log('✏️ Custom column input focused - pausing sync');
                   handleUserEditing();
                 }}
                 onKeyPress={(e) => {
                   if (e.key === 'Enter') {
                     const input = e.target as HTMLInputElement;
                     if (input.value.trim()) {
                       addCustomColumn(input.value.trim());
                       input.value = '';
                     }
                   }
                 }}
               />
             </div>
             
             <div className="flex gap-3">
               <button
                 onClick={() => {
                   const input = document.querySelector('input[placeholder="Enter column name"]') as HTMLInputElement;
                   if (input?.value.trim()) {
                     addCustomColumn(input.value.trim());
                     input.value = '';
                   }
                 }}
                 className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg transition-colors"
               >
                 Add Column
               </button>
               <button
                 onClick={() => {
                   setShowCustomColumnModal(false);
                   handleModalClosed();
                 }}
                 className="flex-1 px-4 py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
               >
                 Cancel
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Notes Editor Modal */}
       {showNotesModal && editingNotesItem !== null && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-800 rounded-xl p-6 max-w-5xl w-full max-h-[90vh] flex flex-col">
             <h2 className="text-2xl font-bold text-white mb-4">Edit Notes</h2>
             
             {/* Enhanced Formatting Toolbar */}
             <div className="mb-4 bg-slate-700 rounded-lg overflow-hidden">
               {/* Row 1: Basic Formatting */}
               <div className="flex items-center justify-between gap-4 p-3 border-b border-slate-600">
                 <div className="flex items-center gap-2">
                   <span className="text-white text-sm font-semibold">Format:</span>
                   <div className="flex gap-1">
                     <button
                       onClick={() => applyFormatting('undo')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded flex items-center justify-center"
                       title="Undo"
                     >
                       ↶
                     </button>
                     <button
                       onClick={() => applyFormatting('redo')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded flex items-center justify-center"
                       title="Redo"
                     >
                       ↷
                     </button>
                     <div className="w-px h-6 bg-slate-500 mx-1"></div>
                     <button
                       onClick={() => applyFormatting('bold')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded font-bold flex items-center justify-center"
                       title="Bold"
                     >
                       B
                     </button>
                     <button
                       onClick={() => applyFormatting('italic')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded italic flex items-center justify-center"
                       title="Italic"
                     >
                       I
                     </button>
                     <button
                       onClick={() => applyFormatting('underline')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded underline flex items-center justify-center"
                       title="Underline"
                     >
                       U
                     </button>
                   </div>
                 </div>
                 
                 <div className="flex items-center gap-2">
                   <span className="text-white text-sm font-semibold">Size:</span>
                   <div className="flex gap-1">
                     <button
                       onClick={() => applyFormatting('fontSize', '1')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded flex items-center justify-center"
                       title="Small"
                     >
                       S
                     </button>
                     <button
                       onClick={() => applyFormatting('fontSize', '3')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded flex items-center justify-center"
                       title="Normal"
                     >
                       N
                     </button>
                     <button
                       onClick={() => applyFormatting('fontSize', '5')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-base rounded flex items-center justify-center"
                       title="Large"
                     >
                       L
                     </button>
                     <button
                       onClick={() => applyFormatting('fontSize', '7')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-lg rounded flex items-center justify-center"
                       title="X-Large"
                     >
                       XL
                     </button>
                   </div>
                 </div>
                 
                 <div className="flex items-center gap-2">
                   <span className="text-white text-sm font-semibold">Align:</span>
                   <div className="flex gap-1">
                     <button
                       onClick={() => applyFormatting('left')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded flex items-center justify-center"
                       title="Left Align"
                     >
                       ≡
                     </button>
                     <button
                       onClick={() => applyFormatting('center')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded flex items-center justify-center"
                       title="Center Align"
                     >
                       ≣
                     </button>
                     <button
                       onClick={() => applyFormatting('right')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-xs rounded flex items-center justify-center"
                       title="Right Align"
                     >
                       ≡
                     </button>
                   </div>
                 </div>
                 
                 <div className="flex items-center gap-2">
                   <span className="text-white text-sm font-semibold">Lists:</span>
                   <div className="flex gap-1">
                     <button
                       onClick={() => applyFormatting('bullet')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded flex items-center justify-center"
                       title="Bullet List"
                     >
                       •
                     </button>
                     <button
                       onClick={() => applyFormatting('list')}
                       className="w-8 h-8 bg-slate-600 hover:bg-slate-500 text-white text-sm rounded flex items-center justify-center"
                       title="Numbered List"
                     >
                       1.
                     </button>
                   </div>
                 </div>
               </div>
               
               {/* Row 2: Colors and Highlighting */}
               <div className="flex items-center justify-center gap-6 p-3">
                 <div className="flex items-center gap-2">
                   <span className="text-white text-sm font-semibold">Text Color:</span>
                   <div className="flex gap-1">
                     <button
                       onClick={() => applyFormatting('color', '#ffffff')}
                       className="w-6 h-6 bg-white border border-slate-400 rounded"
                       title="White"
                     ></button>
                     <button
                       onClick={() => applyFormatting('color', '#ef4444')}
                       className="w-6 h-6 bg-red-500 rounded"
                       title="Red"
                     ></button>
                     <button
                       onClick={() => applyFormatting('color', '#3b82f6')}
                       className="w-6 h-6 bg-blue-500 rounded"
                       title="Blue"
                     ></button>
                     <button
                       onClick={() => applyFormatting('color', '#22c55e')}
                       className="w-6 h-6 bg-green-500 rounded"
                       title="Green"
                     ></button>
                     <button
                       onClick={() => applyFormatting('color', '#f97316')}
                       className="w-6 h-6 bg-orange-500 rounded"
                       title="Orange"
                     ></button>
                     <button
                       onClick={() => applyFormatting('color', '#a855f7')}
                       className="w-6 h-6 bg-purple-500 rounded"
                       title="Purple"
                     ></button>
                     <button
                       onClick={() => applyFormatting('color', '#000000')}
                       className="w-6 h-6 bg-black border border-slate-400 rounded"
                       title="Black"
                     ></button>
                   </div>
                 </div>
                 
                 <div className="flex items-center gap-2">
                   <span className="text-white text-sm font-semibold">Highlight:</span>
                   <div className="flex gap-1">
                     <button
                       onClick={() => applyFormatting('highlight', 'transparent')}
                       className="w-6 h-6 bg-slate-600 border border-slate-400 rounded flex items-center justify-center text-white text-xs"
                       title="No Highlight"
                     >
                       ×
                     </button>
                     <button
                       onClick={() => applyFormatting('highlight', '#fbbf24')}
                       className="w-6 h-6 bg-yellow-400 rounded"
                       title="Yellow"
                     ></button>
                     <button
                       onClick={() => applyFormatting('highlight', '#60a5fa')}
                       className="w-6 h-6 bg-blue-400 rounded"
                       title="Light Blue"
                     ></button>
                     <button
                       onClick={() => applyFormatting('highlight', '#4ade80')}
                       className="w-6 h-6 bg-green-400 rounded"
                       title="Light Green"
                     ></button>
                     <button
                       onClick={() => applyFormatting('highlight', '#f472b6')}
                       className="w-6 h-6 bg-pink-400 rounded"
                       title="Pink"
                     ></button>
                     <button
                       onClick={() => applyFormatting('highlight', '#fb923c')}
                       className="w-6 h-6 bg-orange-400 rounded"
                       title="Orange"
                     ></button>
                   </div>
                 </div>
               </div>
             </div>
             
             {/* Single Rich Text Editor */}
             <div className="flex-1 min-h-[400px] mb-6">
               <label className="block text-white text-sm mb-2">Notes:</label>
               <div
                 id="notes-editor"
                 contentEditable
                 className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white text-base focus:outline-none focus:border-blue-500 overflow-auto"
                 style={{ 
                   height: '400px',
                   lineHeight: '1.5',
                   fontFamily: 'system-ui, -apple-system, sans-serif'
                 }}
                 data-placeholder="Start typing your notes here..."
                 onInput={(e) => {
                   // Optional: Add any real-time processing here
                 }}
               />
             </div>
             
             {/* Action Buttons */}
             <div className="flex gap-3">
               <button
                 onClick={saveNotes}
                 className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
               >
                 Save & Close
               </button>
               <button
                 onClick={() => {
                   setShowNotesModal(false);
                   setEditingNotesItem(null);
                   handleModalClosed();
                 }}
                 className="flex-1 px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
               >
                 Cancel
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Speakers Modal */}
       {showSpeakersModal && editingSpeakersItem !== null && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-800 rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
             {/* Header */}
             <div className="flex justify-between items-center p-6 border-b border-slate-700">
               <h2 className="text-xl font-bold text-white">
                 Edit Speakers ({tempSpeakersText.length}/7)
               </h2>
               <button
                 onClick={() => {
                   setShowSpeakersModal(false);
                   setEditingSpeakersItem(null);
                   handleModalClosed();
                 }}
                 className="text-slate-400 hover:text-white text-xl"
               >
                 ✕
               </button>
             </div>
             
             {/* Content */}
             <div className="flex-1 p-6 overflow-y-auto">
               
               {/* Add Speaker Button */}
               <div className="mb-6">
                 <button
                   onClick={addSpeakerText}
                   disabled={tempSpeakersText.length >= 7}
                   className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                 >
                   + Add Speaker {tempSpeakersText.length < 7 && `(${7 - tempSpeakersText.length} slots remaining)`}
                 </button>
               </div>
               
               {/* Speakers List */}
               <div className="space-y-4 mb-6">
                 {tempSpeakersText.sort((a, b) => a.slot - b.slot).map((speaker) => (
                   <div key={speaker.id} className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                     <div className="flex items-center justify-between mb-4">
                       <h3 className="text-lg font-semibold text-white">
                         Speaker {speaker.slot}
                       </h3>
                       <button
                         onClick={() => removeSpeakerText(speaker.id)}
                         className="w-8 h-8 bg-red-600 hover:bg-red-500 text-white rounded flex items-center justify-center transition-colors"
                         title="Remove Speaker"
                       >
                         ✕
                       </button>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {/* Slot Number */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Slot Number
                         </label>
                         <select
                           value={speaker.slot}
                           onChange={(e) => updateSpeakerTextSlot(speaker.id, parseInt(e.target.value))}
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                         >
                           {[1, 2, 3, 4, 5, 6, 7].map(slot => {
                             const isUsed = tempSpeakersText.some(s => s.id !== speaker.id && s.slot === slot);
                             return (
                               <option key={slot} value={slot} className={isUsed ? "bg-yellow-600 text-white" : "bg-slate-600 text-white"}>
                                 {slot} {isUsed ? "(Used)" : ""}
                               </option>
                             );
                           })}
                         </select>
                       </div>
                       
                       {/* Location */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Location
                         </label>
                         <select
                           value={speaker.location}
                           onChange={(e) => updateSpeakerText(speaker.id, 'location', e.target.value)}
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                         >
                           <option value="Podium">Podium</option>
                           <option value="Seat">Seat</option>
                           <option value="Moderator">Moderator</option>
                           <option value="Virtual">Virtual</option>
                         </select>
                       </div>
                       
                       {/* Full Name */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Full Name
                         </label>
                         <input
                           type="text"
                           value={speaker.fullName}
                           onChange={(e) => updateSpeakerText(speaker.id, 'fullName', e.target.value)}
                           placeholder="Enter full name"
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                         />
                       </div>
                       
                       {/* Title */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Title (subtext line 1)
                         </label>
                         <input
                           type="text"
                           value={speaker.title}
                           onChange={(e) => updateSpeakerText(speaker.id, 'title', e.target.value)}
                           placeholder="Enter title"
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                         />
                       </div>
                       
                       {/* Organization */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Organization (subtext line 2)
                         </label>
                         <input
                           type="text"
                           value={speaker.org}
                           onChange={(e) => updateSpeakerText(speaker.id, 'org', e.target.value)}
                           placeholder="Enter organization"
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                         />
                       </div>
                       
                       {/* Photo Link */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Photo Link
                         </label>
                         <div className="flex gap-2">
                           <input
                             type="url"
                             value={speaker.photoLink}
                             onChange={(e) => updateSpeakerText(speaker.id, 'photoLink', e.target.value)}
                             placeholder="Enter photo URL"
                             className="flex-1 px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                           />
                           {speaker.photoLink && (
                             <div className="flex-shrink-0">
                               <img 
                                 src={speaker.photoLink} 
                                 alt={speaker.fullName}
                                 className="w-12 h-12 rounded object-cover border-2 border-slate-500 -mt-2.5"
                                 onError={(e) => {
                                   e.currentTarget.style.display = 'none';
                                 }}
                               />
                             </div>
                           )}
                         </div>
                       </div>
                     </div>
                   </div>
                 ))}
                 
                 {tempSpeakersText.length === 0 && (
                   <div className="text-center py-8 text-slate-400">
                     No speakers added yet. Click "Add Speaker" to get started.
                   </div>
                 )}
               </div>
             </div>
             
             {/* Footer */}
             <div className="border-t border-slate-700 p-6">
               <div className="flex gap-3">
                 <button
                   onClick={saveSpeakers}
                   className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                 >
                   Save & Close
                 </button>
                 <button
                   onClick={() => {
                     setShowSpeakersModal(false);
                     setEditingSpeakersItem(null);
                     handleModalClosed();
                   }}
                   className="flex-1 px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
                 >
                   Cancel
                 </button>
               </div>
             </div>
           </div>
         </div>
       )}

       {/* Assets Editor Modal */}
       {showAssetsModal && editingAssetsItem !== null && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-800 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
             <h2 className="text-2xl font-bold text-white mb-6">Edit Assets</h2>
             
             <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <h3 className="text-lg font-semibold text-white">Assets List</h3>
                 <button
                   onClick={addAssetRow}
                   className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                 >
                   + Add Asset
                 </button>
               </div>
               
               <div id="assets-list" className="space-y-3">
                 {/* Assets will be dynamically added here */}
               </div>
             </div>
             
             <div className="flex gap-3 mt-6">
               <button
                 onClick={saveAssets}
                 className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
               >
                 Save & Close
               </button>
               <button
                 onClick={() => {
                   setShowAssetsModal(false);
                   setEditingAssetsItem(null);
                   handleModalClosed();
                 }}
                 className="flex-1 px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
               >
                 Cancel
               </button>
             </div>
           </div>
         </div>
       )}

       {/* View-Only Assets Modal for OPERATORs */}
       {showViewAssetsModal && viewingAssetsItem !== null && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-800 rounded-xl p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
             <div className="flex justify-between items-center mb-6">
               <h2 className="text-2xl font-bold text-white">Assets List</h2>
               <button
                 onClick={() => {
                   setShowViewAssetsModal(false);
                   setViewingAssetsItem(null);
                 }}
                 className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg transition-colors"
               >
                 Close
               </button>
             </div>
             
             <div className="space-y-4">
               {(() => {
                 const item = schedule.find(s => s.id === viewingAssetsItem);
                 if (!item || !item.assets) {
                   return (
                     <div className="text-center py-8">
                       <p className="text-slate-400 text-lg">No assets available for this item.</p>
                     </div>
                   );
                 }
                 
                 // Parse assets - handle both JSON and pipe-separated formats
                 let assets: { name: string; url: string }[] = [];
                 
                 // First check if it's pipe-separated format (most common)
                 if (item.assets.includes('||')) {
                   // Multiple assets separated by ||
                   const assetStrings = item.assets.split('||').filter(s => s.trim());
                   assets = assetStrings.map(assetString => {
                     if (assetString.includes('|')) {
                       const [name, url] = assetString.split('|').map(s => s.trim());
                       return {
                         name: name || 'Unnamed Asset',
                         url: url || ''
                       };
                     } else {
                       return {
                         name: assetString.trim(),
                         url: ''
                       };
                     }
                   });
                 } else if (item.assets.includes('|')) {
                   // Single asset with pipe separator
                   const [name, url] = item.assets.split('|').map(s => s.trim());
                   assets = [{
                     name: name || 'Unnamed Asset',
                     url: url || ''
                   }];
                 } else {
                   // Try JSON format
                   try {
                     const parsedAssets = JSON.parse(item.assets);
                     if (Array.isArray(parsedAssets)) {
                       assets = parsedAssets.map(asset => ({
                         name: asset.name || 'Unnamed Asset',
                         url: asset.link || asset.url || ''
                       }));
                     } else {
                       // Single JSON object
                       assets = [{
                         name: parsedAssets.name || 'Unnamed Asset',
                         url: parsedAssets.link || parsedAssets.url || ''
                       }];
                     }
                   } catch {
                     // Plain text format
                     assets = [{
                       name: item.assets.trim(),
                       url: ''
                     }];
                   }
                 }
                 
                 if (assets.length === 0) {
                   return (
                     <div className="text-center py-8">
                       <p className="text-slate-400 text-lg">No assets available for this item.</p>
                     </div>
                   );
                 }
                 
                 return (
                   <div className="space-y-4">
                     <div className="max-h-96 overflow-y-auto space-y-3 pr-2">
                       {assets.map((asset, index) => (
                         <div key={index} className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                           <div className="space-y-2">
                             <div className="text-white font-semibold text-lg">
                               {asset.name}
                             </div>
                             {asset.url && (
                               <div>
                                 <a 
                                   href={asset.url} 
                                   target="_blank" 
                                   rel="noopener noreferrer"
                                   className="text-blue-400 hover:text-blue-300 underline break-all text-sm"
                                 >
                                   {asset.url}
                                 </a>
                               </div>
                             )}
                           </div>
                         </div>
                       ))}
                     </div>
                   </div>
                 );
               })()}
             </div>
           </div>
         </div>
       )}

       {/* Enhanced Participants Modal */}
       {showParticipantsModal && editingParticipantsItem !== null && (
         <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
           <div className="bg-slate-800 rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
             {/* Header */}
             <div className="flex justify-between items-center p-6 border-b border-slate-700">
               <h2 className="text-xl font-bold text-white">
                 Edit Participants ({tempSpeakers.length}/7)
               </h2>
               <button
                 onClick={() => {
                   setShowParticipantsModal(false);
                   setEditingParticipantsItem(null);
                 }}
                 className="text-slate-400 hover:text-white text-xl"
               >
                 ✕
               </button>
             </div>
             
             {/* Content */}
             <div className="flex-1 p-6 overflow-y-auto">
               {/* Add Speaker Button */}
               <div className="mb-6">
                 <button
                   onClick={addSpeaker}
                   disabled={tempSpeakers.length >= 7}
                   className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                 >
                   + Add Speaker {tempSpeakers.length < 7 && `(${7 - tempSpeakers.length} slots remaining)`}
                 </button>
               </div>
               
               {/* Speakers List */}
               <div className="space-y-4">
                 {tempSpeakers.sort((a, b) => a.slot - b.slot).map((speaker) => (
                   <div key={speaker.id} className="bg-slate-700 rounded-lg p-4 border border-slate-600">
                     <div className="flex items-center justify-between mb-4">
                       <h3 className="text-lg font-semibold text-white">
                         Speaker {speaker.slot}
                       </h3>
                       <button
                         onClick={() => removeSpeaker(speaker.id)}
                         className="w-8 h-8 bg-red-600 hover:bg-red-500 text-white rounded flex items-center justify-center transition-colors"
                         title="Remove Speaker"
                       >
                         ✕
                       </button>
                     </div>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                       {/* Slot Number */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Slot Number
                         </label>
                         <select
                           value={speaker.slot}
                           onChange={(e) => handleSlotChange(speaker.id, parseInt(e.target.value))}
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                         >
                           {[1, 2, 3, 4, 5, 6, 7].map(slot => {
                             const isUsed = tempSpeakers.some(s => s.id !== speaker.id && s.slot === slot);
                             return (
                               <option key={slot} value={slot} className={isUsed ? "bg-yellow-600 text-white" : "bg-slate-600 text-white"}>
                                 {slot} {isUsed ? "(Used)" : ""}
                               </option>
                             );
                           })}
                         </select>
                       </div>
                       
                       {/* Location */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Location
                         </label>
                         <select
                           value={speaker.location}
                           onChange={(e) => updateSpeaker(speaker.id, 'location', e.target.value)}
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                         >
                           <option value="Podium">Podium</option>
                           <option value="Seat">Seat</option>
                           <option value="Moderator">Moderator</option>
                           <option value="Virtual">Virtual</option>
                         </select>
                       </div>
                       
                       {/* Full Name */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Full Name
                         </label>
                         <input
                           type="text"
                           value={speaker.fullName}
                           onChange={(e) => updateSpeaker(speaker.id, 'fullName', e.target.value)}
                           placeholder="Enter full name"
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                         />
                       </div>
                       
                       {/* Title */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Title
                         </label>
                         <input
                           type="text"
                           value={speaker.title}
                           onChange={(e) => updateSpeaker(speaker.id, 'title', e.target.value)}
                           placeholder="Enter title/position"
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                         />
                       </div>
                       
                       {/* Organization */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Organization
                         </label>
                         <input
                           type="text"
                           value={speaker.org}
                           onChange={(e) => updateSpeaker(speaker.id, 'org', e.target.value)}
                           placeholder="Enter organization"
                           className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                         />
                       </div>
                       
                       {/* Speaker Photo Link */}
                       <div>
                         <label className="block text-white text-sm font-medium mb-2">
                           Speaker Photo Link
                         </label>
                         <div className="flex items-center gap-3">
                           <input
                             type="url"
                             value={speaker.photoLink}
                             onChange={(e) => updateSpeaker(speaker.id, 'photoLink', e.target.value)}
                             placeholder="Enter photo URL"
                             className="flex-1 px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
                           />
                           {speaker.photoLink && (
                             <div className="flex-shrink-0">
                               <img 
                                 src={speaker.photoLink} 
                                 alt={speaker.fullName}
                                 className="w-12 h-12 rounded object-cover border-2 border-slate-500 -mt-2.5"
                                 onError={(e) => {
                                   (e.target as HTMLImageElement).style.display = 'none';
                                 }}
                               />
                             </div>
                           )}
                         </div>
                       </div>
                     </div>
                   </div>
                 ))}
                 
                 {/* Empty State */}
                 {tempSpeakers.length === 0 && (
                   <div className="text-center py-8">
                     <div className="text-slate-400 text-lg mb-4">No speakers added yet</div>
                     <button
                       onClick={addSpeaker}
                       className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                     >
                       Add Your First Speaker
                     </button>
                   </div>
                 )}
               </div>
             </div>
             
             {/* Footer */}
             <div className="border-t border-slate-700 p-6">
               <div className="flex gap-3">
                 <button
                   onClick={saveParticipants}
                   className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
                 >
                   Save & Close
                 </button>
                 <button
                   onClick={() => {
                     setShowParticipantsModal(false);
                     setEditingParticipantsItem(null);
                   }}
                   className="flex-1 px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white font-semibold rounded-lg transition-colors"
                 >
                   Cancel
                 </button>
               </div>
             </div>
           </div>
         </div>
       )}

      {/* Messages Modal */}
      {showMessagesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Send Message to Full Screen Timer</h3>
              <button
                onClick={() => setShowMessagesModal(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Preset Messages */}
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  Quick Presets
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    "Break in 5 minutes",
                    "Technical difficulties",
                    "Starting soon",
                    "Please wait",
                    "Break time",
                    "Resuming shortly",
                    "Stall / Stretch Time",
                    "Wrap Up Please"
                  ].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setMessageText(preset)}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-white text-sm transition-colors text-left"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Text Input */}
              <div>
                <label className="block text-white text-sm font-medium mb-2">
                  Custom Message
                </label>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Enter custom message to display on full screen timer..."
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-sm h-24 resize-none"
                />
              </div>

              {/* Message Preview */}
              {messageText && (
                <div className="p-3 bg-slate-700 rounded-lg">
                  <div className="text-slate-300 text-sm">
                    <strong>Message Preview:</strong> {messageText}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={async () => {
                  if (!messageText.trim() || !event?.id) return;

                  try {
                    // First, disable ALL existing messages for this event
                    const existingMessages = await DatabaseService.getTimerMessagesForEvent(event.id);
                    const enabledMessages = existingMessages.filter(msg => msg.enabled);
                    
                    for (const message of enabledMessages) {
                      await DatabaseService.disableTimerMessage(message.id!);
                      console.log('✅ Disabled existing message:', message.id);
                    }

                    // Then create new message
                    const timerMessage: Omit<TimerMessage, 'id' | 'created_at' | 'updated_at'> = {
                      event_id: event.id,
                      message: messageText.trim(),
                      enabled: true,
                      sent_by: user?.id,
                      sent_by_name: user?.full_name || user?.email || 'Unknown User',
                      sent_by_role: currentUserRole || 'VIEWER',
                      message_type: 'general',
                      priority: 2
                    };

                    const savedMessage = await DatabaseService.saveTimerMessage(timerMessage);
                    
                    if (!savedMessage) {
                      console.error('❌ Failed to save message to Supabase');
                      alert('Failed to save message. Please try again.');
                      return;
                    }
                    console.log('✅ New message created in Supabase:', savedMessage);
                    
                  // Activate and send message to full screen timer
                  setMessageEnabled(true);
                  if (fullScreenTimerWindow && !fullScreenTimerWindow.closed) {
                    fullScreenTimerWindow.postMessage({
                      type: 'MESSAGE_UPDATE',
                      message: messageText,
                      enabled: true
                    }, '*');
                  }
                    
                    // Clear form
                    setMessageText('');
                  setShowMessagesModal(false);
                  } catch (error) {
                    console.error('❌ Error saving message:', error);
                    alert('Error saving message. Please try again.');
                  }
                }}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition-colors"
                disabled={!messageText.trim() || !event?.id}
              >
                Send & Activate Message
              </button>
              <button
                onClick={() => setShowMessagesModal(false)}
                className="flex-1 px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter View Modal */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg max-w-md w-full max-h-[80vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-600">
              <h2 className="text-lg font-bold text-white">Filter Columns</h2>
              <button
                onClick={() => setShowFilterModal(false)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                <p className="text-slate-300 text-sm mb-4">Select which columns to display in the schedule:</p>
                
                <div className="space-y-2">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.start}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, start: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Start Time</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.programType}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, programType: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Program Type</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.duration}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, duration: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Duration</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.segmentName}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, segmentName: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Segment Name</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.shotType}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, shotType: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Shot Type</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.pptQA}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, pptQA: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">PPT/Q&A</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.notes}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, notes: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Notes</span>
                  </label>
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.assets}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, assets: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Assets</span>
                  </label>
                  
                  {/* Participants section hidden */}
                  {/* <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.participants}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, participants: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Participants</span>
                  </label> */}
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.speakers}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, speakers: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Speakers</span>
                  </label>
                  
                  
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={visibleColumns.public}
                      onChange={(e) => setVisibleColumns(prev => ({ ...prev, public: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-white">Public</span>
                  </label>
                  
                  {customColumns.map((column, index) => (
                    <label key={column.id} className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={visibleCustomColumns[column.id] !== false}
                        onChange={(e) => setVisibleCustomColumns(prev => ({ ...prev, [column.id]: e.target.checked }))}
                        className="rounded"
                      />
                      <span className="text-white">
                        {column.name}
                        <span className="text-slate-400 text-xs ml-2">(Custom)</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-600">
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setVisibleColumns({
                      start: true,
                      programType: true,
                      duration: true,
                      segmentName: true,
                      shotType: true,
                      pptQA: true,
                      notes: true,
                      assets: true,
                      participants: false, // 👈 hidden now,
                      speakers: true,
                      public: true,
                      custom: true
                    });
                    // Show all custom columns
                    const allCustomVisible: Record<string, boolean> = {};
                    customColumns.forEach(column => {
                      allCustomVisible[column.id] = true;
                    });
                    setVisibleCustomColumns(allCustomVisible);
                  }}
                  className="px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded transition-colors text-sm"
                >
                  Show All
                </button>
                <button
                  onClick={() => {
                    setVisibleColumns({
                      start: false,
                      programType: false,
                      duration: false,
                      segmentName: false,
                      shotType: false,
                      pptQA: false,
                      notes: false,
                      assets: false,
                      participants: false,
                      speakers: false,
                      public: false,
                      custom: false
                    });
                    // Hide all custom columns
                    const allCustomHidden: Record<string, boolean> = {};
                    customColumns.forEach(column => {
                      allCustomHidden[column.id] = false;
                    });
                    setVisibleCustomColumns(allCustomHidden);
                  }}
                  className="px-3 py-2 bg-slate-600 hover:bg-slate-500 text-white font-medium rounded transition-colors text-sm"
                >
                  Hide All
                </button>
                <button
                  onClick={() => setShowFilterModal(false)}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition-colors text-sm"
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Time Status Toast */}
      {showTimeToast && timeToastEnabled && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
          <div className={`px-6 py-4 rounded-lg shadow-lg border-2 flex items-center gap-3 ${
            timeStatus === 'early' 
              ? 'bg-yellow-600 border-yellow-500 text-yellow-100' 
              : timeStatus === 'late'
              ? 'bg-red-600 border-red-500 text-red-100'
              : 'bg-green-600 border-green-500 text-green-100'
          }`}>
            <div className="text-3xl flex-shrink-0">
              {timeStatus === 'early' ? '⏰' : timeStatus === 'late' ? '⚠️' : '✅'}
            </div>
            <div className="flex-1">
              <div className="font-bold text-lg mb-1">
                {timeStatus === 'early' ? 'EARLY' : timeStatus === 'late' ? 'RUNNING LATE' : 'ON TIME'}
              </div>
              <div className="text-base font-medium">
                <span className="text-2xl font-bold">
                  {timeDifference >= 60 ? `${Math.floor(timeDifference / 60)}h ${timeDifference % 60}m` : `${timeDifference}m`}
                </span>
                {timeStatus === 'early' 
                  ? ` before CUE ${Object.keys(activeTimers).length > 0 ? (schedule.find(item => item.id === parseInt(Object.keys(activeTimers)[0]))?.customFields.cue || '0') : '0'} expected start`
                  : timeStatus === 'late'
                  ? ` after CUE ${Object.keys(activeTimers).length > 0 ? (schedule.find(item => item.id === parseInt(Object.keys(activeTimers)[0]))?.customFields.cue || '0') : '0'} expected start`
                  : ' - Timing is on track'
                }
              </div>
            </div>
            <button
              onClick={() => setShowTimeToast(false)}
              className="ml-4 text-xl hover:opacity-70 transition-opacity"
            >
              ×
            </button>
          </div>
        </div>
      )}


      {/* OSC Control Modal */}
      <OSCModalSimplified
        isOpen={showOSCModal}
        onClose={() => setShowOSCModal(false)}
        event={event}
      />

      {/* Display Selection Modal */}
      <DisplayModal
        isOpen={showDisplayModal}
        onClose={() => setShowDisplayModal(false)}
        onSelectFullscreenTimer={openFullScreenTimer}
        onSelectClock={openClock}
      />

      {/* Backup Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-8 w-full max-w-7xl max-h-[95vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">Backup Management</h2>
              <button
                onClick={() => setShowBackupModal(false)}
                className="text-slate-400 hover:text-white text-2xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-900 border border-blue-600 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <div className="text-blue-400 text-xl mr-3">ℹ️</div>
                <div>
                  <h4 className="text-blue-200 font-semibold mb-1">Neon Database Backups</h4>
                  <p className="text-blue-100 text-sm">
                    Create and manage backups of your run of show data stored in Neon database. 
                    Use the "💾 Create Backup" button to create manual backups when needed.
                  </p>
                </div>
              </div>
            </div>

            {/* Filters and Search */}
            <div className="bg-slate-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-white mb-4">Filter & Search</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-slate-300 text-base font-medium mb-3">Search by Event Name</label>
                  <input
                    type="text"
                    placeholder="Filter by event name..."
                    className="w-full px-4 py-3 bg-slate-600 border border-slate-500 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 text-base"
                    onChange={(e) => {
                      // TODO: Implement search filtering
                    }}
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-base font-medium mb-3">Filter by Date</label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:border-blue-500 text-base"
                    onChange={(e) => {
                      // TODO: Implement date filtering
                    }}
                  />
                </div>
                <div>
                  <label className="block text-slate-300 text-base font-medium mb-3">Sort by</label>
                  <select className="w-full px-4 py-3 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:border-blue-500 text-base">
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="event">Event Name</option>
                    <option value="type">Backup Type</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Backup List */}
            <div className="bg-slate-700 rounded-lg p-6 flex-1 overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-white">Available Backups</h3>
                <button
                  onClick={loadBackups}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-base font-medium rounded-lg transition-colors"
                >
                  🔄 Refresh
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {backups.length === 0 ? (
                  <div className="text-slate-400 text-center py-12 text-lg">
                    No backups available. Use the "💾 Create Backup" button in the main interface to create a manual backup.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {backups.map((backup) => (
                      <div key={backup.id} className="bg-slate-600 p-6 rounded-lg flex justify-between items-center hover:bg-slate-500 transition-colors">
                        <div className="flex-1">
                          <div className="text-white font-semibold text-xl mb-2 flex items-center gap-3">
                            {backup.backup_name}
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                              backup.backup_type === 'auto' 
                                ? 'bg-blue-600 text-blue-100' 
                                : 'bg-green-600 text-green-100'
                            }`}>
                              {backup.backup_type}
                            </span>
                          </div>
                          <div className="text-slate-400 text-sm">
                            <strong>Event Date:</strong> {backup.event_data?.date ? new Date(backup.event_data.date).toLocaleDateString() : 'N/A'} • 
                            <strong> Schedule Items:</strong> {backup.schedule_data?.length || 0} • 
                            <strong> Custom Columns:</strong> {backup.custom_columns_data?.length || 0}
                          </div>
                        </div>
                        <div className="flex space-x-3">
                          <button
                            onClick={() => openRestorePreview(backup)}
                            className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white text-base font-medium rounded-lg transition-colors"
                            title="Preview and load this backup"
                          >
                            🔄 Load/Overwrite
                          </button>
                          <button
                            onClick={() => deleteBackup(backup.id)}
                            className="px-5 py-3 bg-red-600 hover:bg-red-500 text-white text-base font-medium rounded-lg transition-colors"
                            title="Delete this backup"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restore Preview Confirmation Modal */}
      {showRestorePreview && selectedBackup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg p-8 w-full max-w-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-white">Confirm Backup Restore</h2>
              <button
                onClick={() => setShowRestorePreview(false)}
                className="text-slate-400 hover:text-white text-2xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-700 rounded-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-white mb-4">Backup Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-slate-300">Backup Name:</span>
                  <span className="text-white font-medium">{selectedBackup.backup_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Event:</span>
                  <span className="text-white font-medium">{selectedBackup.event_data?.name || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Date:</span>
                  <span className="text-white font-medium">{new Date(selectedBackup.backup_timestamp).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Type:</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    selectedBackup.backup_type === 'auto' 
                      ? 'bg-blue-600 text-blue-100' 
                      : 'bg-green-600 text-green-100'
                  }`}>
                    {selectedBackup.backup_type}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Schedule Items:</span>
                  <span className="text-white font-medium">{selectedBackup.schedule_data?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-300">Custom Columns:</span>
                  <span className="text-white font-medium">{selectedBackup.custom_columns_data?.length || 0}</span>
                </div>
              </div>
            </div>

            <div className="bg-yellow-900 border border-yellow-600 rounded-lg p-4 mb-6">
              <div className="flex items-start">
                <div className="text-yellow-400 text-xl mr-3">⚠️</div>
                <div>
                  <h4 className="text-yellow-200 font-semibold mb-2">Warning</h4>
                  <p className="text-yellow-100 text-sm">
                    This will completely overwrite your current run of show data with the backup data. 
                    This action cannot be undone. Make sure you want to proceed.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setShowRestorePreview(false)}
                className="px-6 py-3 bg-slate-600 hover:bg-slate-500 text-white text-base font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRestoreFromBackup}
                className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white text-base font-medium rounded-lg transition-colors"
              >
                🔄 Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel Import Modal */}
      <ExcelImportModal
        isOpen={showExcelImportModal}
        onClose={() => setShowExcelImportModal(false)}
        onImport={handleExcelImport}
        onDeleteAll={handleDeleteAllScheduleItems}
      />
    </div>
  );
};

export default RunOfShowPage;