// Add a ref to track processed changes to prevent duplicates
const processedChangesRef = useRef(new Set());

// Fixed timeout handler - Use a processed changes tracker
const timeout = setTimeout(async () => {
  setPendingChanges(prev => {
    // Find the pending change for this base key
    let pendingChange = null;
    let changeKey = null;
    for (const [key, value] of prev.entries()) {
      if (value.originalKey === baseKey) {
        pendingChange = value;
        changeKey = key;
        break;
      }
    }
    
    // ✅ KEY FIX: Check if this change was already processed
    const changeId = `${baseKey}-${pendingChange?.timestamp?.getTime()}`;
    
    if (pendingChange && changeKey && prev.has(changeKey) && user && event?.id && 
        !processedChangesRef.current.has(changeId)) {
      
      // ✅ Mark this change as processed IMMEDIATELY
      processedChangesRef.current.add(changeId);
      
      // Add to new change log service ✅
      changeLogService.addChange({
        eventId: event.id,
        userId: user.id,
        userName: user.user_metadata?.full_name || user.email || 'Unknown',
        userRole: currentUserRole,
        action: pendingChange.action,
        description: pendingChange.description,
        details: pendingChange.details,
        rowNumber: pendingChange.details?.rowNumber,
        cueNumber: pendingChange.details?.cueNumber,
        segmentName: pendingChange.details?.itemName || pendingChange.details?.segmentName
      });
      
      // Update local state for immediate UI feedback
      const localChanges = changeLogService.getLocalChanges();
      setChangeLog(localChanges.slice(0, 100));
      
      console.log('✅ Debounced change logged to change log service:', pendingChange.description);
      console.log('🔄 Removed pending change from queue:', changeKey);
      
      // Clean up timeout
      changeTimeoutsRef.current.delete(baseKey);
      
      // Return updated pending changes without this key ✅
      const newMap = new Map(prev);
      newMap.delete(changeKey);
      return newMap;
    } else {
      // ✅ Change was already processed or doesn't exist, just clean up timeout
      changeTimeoutsRef.current.delete(baseKey);
      if (processedChangesRef.current.has(changeId)) {
        console.log('⚠️ Prevented duplicate processing of change:', changeId);
      } else {
        console.log('ℹ️ Pending change already processed or removed:', baseKey);
      }
      return prev;
    }
  });
}, 10000); // 10 second delay

// Fixed finalizeAllPendingChanges function
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
        enhancedDescription = `Row ${rowNumber} - Cue ${cueNumber}: ${pendingChange.description}`;
      }
      
      // Process the pending change immediately
      changeLogService.addChange({
        eventId: event.id,
        userId: user.id,
        userName: user.user_metadata?.full_name || user.email || 'Unknown',
        userRole: currentUserRole,
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
  
  // ✅ Optional: Clean up old processed change IDs after some time to prevent memory leaks
  setTimeout(() => {
    processedIds.forEach(id => {
      processedChangesRef.current.delete(id);
    });
    console.log('🧹 Cleaned up processed change tracking for', processedIds.size, 'changes');
  }, 60000); // Clean up after 1 minute
};