import React from 'react';

export interface ScheduleRowProps {
  item: any;
  index: number;
  className?: string;
  style?: React.CSSProperties;
  rowHeight?: number;
  columnWidths: any;
  visibleColumns: any;
  indentedCues: any;
  overtimeMinutes: any;
  startCueId: any;
  showStartOvertime: number;
  cumulativeOvertime: number; // Precomputed cumulative overtime for this row
  programTypes: string[];
  programTypeColors: any;
  shotTypes: string[];
  currentUserRole: string;
  setSchedule: Function;
  handleUserEditing: Function;
  handleModalEditing: Function;
  handleModalClosed: Function;
  logChangeDebounced: Function;
  logChange?: Function;
  saveToAPI?: Function;
  calculateStartTimeWithOvertime?: (index: number) => string | number;
  calculateStartTime?: (index: number) => string | number;
  setEditingNotesItem?: Function;
  setShowNotesModal?: Function;
  setViewingAssetsItem?: Function;
  setShowViewAssetsModal?: Function;
  setViewingSpeakersItem?: Function;
  setShowViewSpeakersModal?: Function;
  setEditingAssetsItem?: Function;
  setShowAssetsModal?: Function;
  setEditingParticipantsItem?: Function;
  setShowParticipantsModal?: Function;
  displaySpeakers?: Function;
  setEditingSpeakersItem?: Function;
  setShowSpeakersModal?: Function;
  getSpeakersHeight?: Function;
  displaySpeakersText?: Function;
  customColumns?: any[];
  visibleCustomColumns?: Record<string, boolean>;
  customColumnWidths?: Record<string, number>;
  getRowHeight?: Function;
  asFragment?: boolean;
  showMode?: 'rehearsal' | 'in-show'; // Rehearsal: Start column shows scheduled only, no overtime badge. In-Show: show overtime.
  originalDuration?: { durationHours: number; durationMinutes: number; durationSeconds: number } | null;
  showWasUnderDuration?: boolean; // When true (Track was durations checked), show "was X min" under duration when current differs from original
  isRowDimmed?: boolean;
  /** Lock held by another editor — row is read-only for everyone else. */
  rowLock?: { userId: string; userName: string } | null;
  currentUserId?: string;
  onRowEditStart?: (rowId: number) => void;
  onRowEditEnd?: (rowId: number) => void;
}

const ScheduleRow: React.FC<ScheduleRowProps> = React.memo(({
  item,
  index,
  className,
  style,
  rowHeight,
  columnWidths,
  visibleColumns,
  indentedCues,
  overtimeMinutes,
  startCueId,
  showStartOvertime,
  cumulativeOvertime,
  programTypes,
  programTypeColors,
  shotTypes,
  currentUserRole,
  setSchedule,
  handleUserEditing,
  handleModalEditing,
  handleModalClosed,
  logChangeDebounced,
  logChange,
  saveToAPI,
  calculateStartTimeWithOvertime,
  calculateStartTime,
  setEditingNotesItem,
  setShowNotesModal,
  setViewingAssetsItem,
  setShowViewAssetsModal,
  setViewingSpeakersItem,
  setShowViewSpeakersModal,
  setEditingAssetsItem,
  setShowAssetsModal,
  setEditingParticipantsItem,
  setShowParticipantsModal,
  displaySpeakers,
  setEditingSpeakersItem,
  setShowSpeakersModal,
  getSpeakersHeight,
  displaySpeakersText,
  customColumns,
  visibleCustomColumns,
  customColumnWidths,
  getRowHeight,
  asFragment,
  showMode = 'in-show',
  originalDuration,
  showWasUnderDuration = false,
  isRowDimmed = false,
  rowLock = null,
  currentUserId,
  onRowEditStart,
  onRowEditEnd,
}) => {
  const isLockedByOther = Boolean(rowLock && currentUserId && rowLock.userId !== currentUserId);
  const lockLabel = rowLock?.userName ? `${rowLock.userName} is editing` : 'Someone is editing';
  const [lockBadgePos, setLockBadgePos] = React.useState({ scrollLeft: 0, viewWidth: 0 });

  // Keep the lock name badge centered in the visible horizontal viewport when columns are scrolled
  React.useEffect(() => {
    if (!isLockedByOther) {
      setLockBadgePos({ scrollLeft: 0, viewWidth: 0 });
      return;
    }
    const scroller = document.getElementById('main-scroll-container');
    if (!scroller) return;

    const sync = () => {
      setLockBadgePos({
        scrollLeft: scroller.scrollLeft || 0,
        viewWidth: scroller.clientWidth || 0,
      });
    };
    sync();
    scroller.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      scroller.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [isLockedByOther]);

  const cellFill = isRowDimmed
    ? 'bg-purple-950/55 border-purple-700/50 text-slate-500'
    : 'bg-slate-700 border-slate-600 text-white';
  const cellFillInteractive = isRowDimmed
    ? 'bg-purple-950/55 border-purple-700/50 text-slate-500 cursor-pointer hover:bg-purple-950/70'
    : 'bg-slate-700 border-slate-600 text-white cursor-pointer hover:bg-slate-600';
  const cellFocus = isRowDimmed
    ? 'bg-purple-950/55 border-purple-600/50 text-slate-500 focus:border-purple-500/55'
    : 'bg-slate-700 border-slate-500 text-white focus:border-blue-500';

  // Helper functions
  const handleSelectFocus = () => {
    if (isLockedByOther) return;
    onRowEditStart?.(item.id);
    handleModalEditing();
  };

  const handleSelectBlur = () => {
    // Same settle path as typing: wait briefly for native dropdown, then start the 5s idle unlock
    setTimeout(() => {
      handleModalClosed();
    }, 200);
  };

  const claimRowLock = () => {
    if (isLockedByOther) return;
    onRowEditStart?.(item.id);
  };

  const Content = (
    <>
      {isLockedByOther && (
        <>
          {/* Strong full-row lock overlay — schedule fields only; timer controls are outside this row */}
          <div
            className="absolute inset-0 z-20 pointer-events-none rounded-sm"
            style={{
              background:
                'repeating-linear-gradient(-45deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.22) 10px, rgba(251, 191, 36, 0.12) 10px, rgba(251, 191, 36, 0.12) 20px)',
              boxShadow: 'inset 0 0 0 3px rgba(245, 158, 11, 0.95)',
            }}
            aria-hidden
          />
          {/* Centered in the visible row viewport; follows horizontal scroll */}
          <div
            className="absolute z-30 pointer-events-none flex items-center justify-center max-w-[min(720px,90vw)]"
            style={{
              left: lockBadgePos.scrollLeft + lockBadgePos.viewWidth / 2,
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            title={lockLabel}
          >
            <span
              className="inline-flex items-center gap-4 px-6 py-3.5 rounded-xl text-2xl font-black shadow-2xl"
              style={{
                backgroundColor: '#fbbf24',
                color: '#000000',
                border: '3px solid #ffffff',
                boxShadow: '0 4px 14px rgba(0,0,0,0.55), 0 0 0 2px #b45309',
                minWidth: 280,
              }}
            >
              <span
                className="inline-flex items-center justify-center flex-shrink-0 rounded-lg"
                style={{
                  width: 48,
                  height: 48,
                  backgroundColor: '#000000',
                  color: '#fbbf24',
                  fontSize: 28,
                  lineHeight: 1,
                }}
                aria-hidden
              >
                🔒
              </span>
              <span className="leading-tight whitespace-nowrap">{lockLabel}</span>
            </span>
          </div>
        </>
      )}
      {/* Start time, program type, and row details, mirroring RunOfShowPage*/}
      {visibleColumns.start && (() => {
        const scheduledStart = calculateStartTime ? String(calculateStartTime(index)) : null;
        const displayedStart = calculateStartTimeWithOvertime ? String(calculateStartTimeWithOvertime(index)) : null;
        const isIndentedRow = Boolean(indentedCues[item.id] || item.isIndented);
        const startTimeRolled = !isIndentedRow && showMode === 'in-show' && scheduledStart && displayedStart && scheduledStart !== displayedStart;
        return (
        <div
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.start }}
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-white font-mono text-base font-bold">
              {calculateStartTime && calculateStartTimeWithOvertime
                ? String(showMode === 'rehearsal' ? calculateStartTime(index) : calculateStartTimeWithOvertime(index)) || (isIndentedRow ? '↘' : '')
                : isIndentedRow
                  ? '↘'
                  : (calculateStartTimeWithOvertime ? String(calculateStartTimeWithOvertime(index)) : String(index + 1))}
            </span>
            {startTimeRolled && scheduledStart && (
              <span className="text-xs text-slate-400">
                was {scheduledStart}
              </span>
            )}
            {!isIndentedRow && showMode !== 'rehearsal' && (
              (overtimeMinutes[item.id] || (item.id === startCueId && showStartOvertime !== 0) ||
               (calculateStartTime && calculateStartTimeWithOvertime &&
                String(calculateStartTime(index)) !== String(calculateStartTimeWithOvertime(index))))
            ) && (
              <span className={`text-sm font-bold px-2 py-1 rounded text-center leading-tight ${(() => {
                if (item.id === startCueId) {
                  return showStartOvertime > 0 ? 'text-red-400 bg-red-900/30' : 'text-green-400 bg-green-900/30';
                }
                // Use precomputed cumulative overtime instead of calculating inline
                const totalOvertime = cumulativeOvertime;
                return totalOvertime > 0 ? 'text-red-400 bg-red-900/30' : 'text-green-400 bg-green-900/30';
              })()}`}
                title="Time adjusted due to overtime"
              >
                {(() => {
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
                  // Use precomputed cumulative overtime instead of calculating inline
                  const totalOvertime = cumulativeOvertime;
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
        );
      })()}
      {/* Program type column (moved directly after Start) */}
      {visibleColumns.programType && (
        <div
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.programType }}
        >
          <select
            value={item.programType}
            onFocus={handleSelectFocus}
            onBlur={handleSelectBlur}
            onChange={(e) => {
              if (isLockedByOther) return;
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                alert('Only EDITORs can edit program type. Please change your role to EDITOR.');
                return;
              }
              const oldValue = item.programType;
              setSchedule((prev: any[]) => prev.map(scheduleItem =>
                scheduleItem.id === item.id
                  ? { ...scheduleItem, programType: e.target.value }
                  : scheduleItem
              ));
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
                  details: { fieldType: 'select', optionChange: true }
                }
              );
              // Same as typing: 5s idle via handleModalClosed → finishEditingSession (unlock + blur)
              handleModalClosed();
            }}
            disabled={isLockedByOther || currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
            className={`w-full px-3 py-2 border-2 rounded text-base transition-colors ${cellFocus}`}
            style={{ 
              backgroundColor: isRowDimmed
                ? 'rgba(59, 20, 96, 0.65)'
                : (programTypeColors[item.programType] || '#374151'),
              color: isRowDimmed
                ? '#ada3bf'
                : (item.programType === 'Sub Cue' || item.programType === 'KILLED' ? '#000000' : '#ffffff'),
              textDecoration: item.programType === 'KILLED' ? 'line-through' : 'none',
            }}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit program type' : 'Select program type'}
          >
            {programTypes.map(type => (
              <option key={type} value={type} style={{ 
                backgroundColor: programTypeColors[type] || '#374151', 
                color: type === 'Sub Cue' || type === 'KILLED' ? '#000000' : '#ffffff',
                textDecoration: type === 'KILLED' ? 'line-through' : 'none'
              }}>
                {type}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Duration column (after Program Type) */}
      {visibleColumns.duration && (() => {
        const durationChanged = showWasUnderDuration && originalDuration &&
          (item.durationHours !== originalDuration.durationHours ||
           item.durationMinutes !== originalDuration.durationMinutes ||
           item.durationSeconds !== originalDuration.durationSeconds);
        return (
        <div 
          className={`px-4 py-2 border-r border-slate-600 flex flex-col items-center justify-center flex-shrink-0 gap-0.5 ${durationChanged ? 'bg-amber-800/50 ring-2 ring-amber-400 rounded-md' : ''}`}
          style={{ width: columnWidths.duration, minHeight: durationChanged ? 'auto' : undefined }}
          title={durationChanged ? 'Duration changed from original' : undefined}
        >
          <div className="flex items-center gap-2">
            <input 
              type="number" 
              min="0" 
              max="23" 
              value={item.durationHours}
              onFocus={claimRowLock}
              onChange={(e) => {
                if (isLockedByOther) return;
                handleUserEditing();
                if (currentUserRole === 'VIEWER') {
                  alert('Only EDITORs and OPERATORs can edit duration. Please change your role to EDITOR or OPERATOR.');
                  return;
                }
                const oldValue = item.durationHours;
                const newValue = parseInt(e.target.value) || 0;
                setSchedule((prev: any[]) => prev.map(scheduleItem => 
                  scheduleItem.id === item.id 
                    ? { ...scheduleItem, durationHours: newValue }
                    : scheduleItem
                ));
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
                    details: { fieldType: 'number', timeChange: newValue - oldValue }
                  }
                );
              }}
              disabled={isLockedByOther || currentUserRole === 'VIEWER'}
              className={`w-14 px-2 py-2 border rounded text-center text-lg font-mono font-bold transition-colors ${cellFill}`}
              title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can edit duration' : 'Edit hours'}
            />
            <span className="text-slate-400 text-xl font-bold">:</span>
            <input 
              type="number" 
              min="0" 
              max="59" 
              value={item.durationMinutes}
              onFocus={claimRowLock}
              onChange={(e) => {
                if (isLockedByOther) return;
                handleUserEditing();
                if (currentUserRole === 'VIEWER') {
                  alert('Only EDITORs and OPERATORs can edit duration. Please change your role to EDITOR or OPERATOR.');
                  return;
                }
                const oldValue = item.durationMinutes;
                const newValue = parseInt(e.target.value) || 0;
                setSchedule((prev: any[]) => prev.map(scheduleItem => 
                  scheduleItem.id === item.id 
                    ? { ...scheduleItem, durationMinutes: newValue }
                    : scheduleItem
                ));
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
                    details: { fieldType: 'number', timeChange: newValue - oldValue }
                  }
                );
              }}
              disabled={isLockedByOther || currentUserRole === 'VIEWER'}
              className={`w-14 px-2 py-2 border rounded text-center text-lg font-mono font-bold transition-colors ${cellFill}`}
              title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can edit duration' : 'Edit minutes'}
            />
            <span className="text-slate-400 text-xl font-bold">:</span>
            <input 
              type="number" 
              min="0" 
              max="59" 
              value={item.durationSeconds}
              onFocus={claimRowLock}
              onChange={(e) => {
                if (isLockedByOther) return;
                handleUserEditing();
                if (currentUserRole === 'VIEWER') {
                  alert('Only EDITORs and OPERATORs can edit duration. Please change your role to EDITOR or OPERATOR.');
                  return;
                }
                const oldValue = item.durationSeconds;
                const newValue = parseInt(e.target.value) || 0;
                setSchedule((prev: any[]) => prev.map(scheduleItem => 
                  scheduleItem.id === item.id 
                    ? { ...scheduleItem, durationSeconds: newValue }
                    : scheduleItem
                ));
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
                    details: { fieldType: 'number', timeChange: newValue - oldValue }
                  }
                );
              }}
              disabled={isLockedByOther || currentUserRole === 'VIEWER'}
              className={`w-14 px-2 py-2 border rounded text-center text-lg font-mono font-bold transition-colors ${cellFill}`}
              title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can edit duration' : 'Edit seconds'}
            />
          </div>
          {durationChanged && (() => {
            const h = originalDuration!.durationHours ?? 0;
            const m = originalDuration!.durationMinutes ?? 0;
            const s = originalDuration!.durationSeconds ?? 0;
            const totalSec = h * 3600 + m * 60 + s;
            const wasText = totalSec >= 3600 ? `${h}h ${m}m` : totalSec >= 60 ? `${m} min` : `${s} sec`;
            return (
              <div className="text-amber-300 text-base font-semibold text-center w-full" style={{ lineHeight: 1.2 }}>
                was {wasText}
              </div>
            );
          })()}
        </div>
        );
      })()}
      {/* Segment name column (after Duration) */}
      {visibleColumns.segmentName && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.segmentName }}
        >
          <input
            type="text"
            value={item.segmentName}
            onFocus={claimRowLock}
            onChange={(e) => {
              if (isLockedByOther) return;
              handleUserEditing();
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                alert('Only EDITORs can edit segment names. Please change your role to EDITOR.');
                return;
              }
              const oldValue = item.segmentName;
              setSchedule((prev: any[]) => prev.map(scheduleItem => 
                scheduleItem.id === item.id 
                  ? { ...scheduleItem, segmentName: e.target.value }
                  : scheduleItem
              ));
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
                  details: { fieldType: 'text', characterChange: e.target.value.length - oldValue.length }
                }
              );
            }}
            disabled={isLockedByOther || currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
            className={`w-full px-3 py-2 border rounded text-base transition-colors ${cellFill}`}
            placeholder={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit' : 'Enter segment name'}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit segment names' : 'Edit segment name'}
          />
        </div>
      )}
      {/* Shot type column (after Segment Name) */}
      {visibleColumns.shotType && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.shotType, overflow: 'visible', zIndex: 1 }}
        >
          <select 
            value={item.shotType}
            onFocus={handleSelectFocus}
            onBlur={handleSelectBlur}
            onChange={(e) => {
              if (isLockedByOther) return;
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                alert('Only EDITORs can edit shot type. Please change your role to EDITOR.');
                return;
              }
              const oldValue = item.shotType;
              setSchedule((prev: any[]) => prev.map(scheduleItem => 
                scheduleItem.id === item.id 
                  ? { ...scheduleItem, shotType: e.target.value }
                  : scheduleItem
              ));
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
                  details: { fieldType: 'select', optionChange: true }
                }
              );
              handleModalClosed();
            }}
            disabled={isLockedByOther || currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
            className={`w-full px-3 py-2 border-2 rounded text-base transition-colors ${cellFocus}`}
            style={{ zIndex: 10, position: 'relative' }}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit shot type' : 'Select shot type'}
          >
            <option value="">Select Shot Type</option>
            {shotTypes?.map?.((type: string) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      )}
      {/* PPT/QA column (after Shot Type) */}
      {visibleColumns.pptQA && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.pptQA }}
        >
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!item.hasPPT}
                onChange={(e) => {
                  if (isLockedByOther) return;
                  claimRowLock();
                  handleUserEditing();
                  if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                    alert('Only EDITORs can edit PPT settings. Please change your role to EDITOR.');
                    return;
                  }
                  const oldValue = !!item.hasPPT;
                  setSchedule((prev: any[]) => prev.map(scheduleItem => 
                    scheduleItem.id === item.id 
                      ? { ...scheduleItem, hasPPT: e.target.checked }
                      : scheduleItem
                  ));
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
                      details: { fieldType: 'checkbox', booleanChange: true }
                    }
                  );
                }}
                disabled={isLockedByOther || currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
                className={`w-6 h-6 rounded border-2 ${isRowDimmed ? 'border-purple-600/50 bg-purple-950/70' : 'border-slate-400 bg-slate-700'}`}
                title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit PPT settings' : 'Toggle PPT'}
              />
              <span className="text-base font-medium text-white">PPT</span>
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!item.hasQA}
                onChange={(e) => {
                  if (isLockedByOther) return;
                  claimRowLock();
                  handleUserEditing();
                  if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                    alert('Only EDITORs can edit Q&A settings. Please change your role to EDITOR.');
                    return;
                  }
                  const oldValue = !!item.hasQA;
                  setSchedule((prev: any[]) => prev.map(scheduleItem => 
                    scheduleItem.id === item.id 
                      ? { ...scheduleItem, hasQA: e.target.checked }
                      : scheduleItem
                  ));
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
                      details: { fieldType: 'checkbox', booleanChange: true }
                    }
                  );
                }}
                disabled={isLockedByOther || currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR'}
                className={`w-6 h-6 rounded border-2 ${isRowDimmed ? 'border-purple-600/50 bg-purple-950/70' : 'border-slate-400 bg-slate-700'}`}
                title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Only EDITORs can edit Q&A settings' : 'Toggle Q&A'}
              />
              <span className="text-base font-medium text-white">Q&A</span>
            </label>
          </div>
        </div>
      )}
      {/* Notes column (after PPT/QA) */}
      {visibleColumns.notes && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
          style={{ width: columnWidths.notes }}
        >
          <div
            onClick={() => {
              if (isLockedByOther) {
                alert(lockLabel);
                return;
              }
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                if (currentUserRole === 'OPERATOR' && item.notes) {
                  alert(`Notes (View Only):\n\n${String(item.notes).replace(/<[^>]*>/g, '')}`);
                  return;
                }
                alert('Only EDITORs can edit notes. Please change your role to EDITOR.');
                return;
              }
              claimRowLock();
              handleModalEditing();
              setEditingNotesItem && setEditingNotesItem(item.id);
              setShowNotesModal && setShowNotesModal(true);
            }}
            className={`w-full px-3 py-2 border rounded text-base transition-colors ${isLockedByOther ? cellFill + ' opacity-70 cursor-not-allowed' : cellFillInteractive}`}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Viewers cannot edit notes' : currentUserRole === 'OPERATOR' ? 'Click to view notes (read-only)' : 'Click to edit notes'}
          >
            {item.notes ? (
              <div 
                className="text-left w-full notes-display"
                style={{ lineHeight: '1.4', overflow: 'visible', whiteSpace: 'pre-line' }}
                dangerouslySetInnerHTML={{ 
                  __html: String(item.notes)
                    .replace(/\r\n/g, '<br>') // Handle Windows line breaks
                    .replace(/\r/g, '<br>') // Handle Mac line breaks
                    .replace(/\n/g, '<br>') // Handle Unix line breaks
                }}
              />
            ) : (
              <span className="text-slate-400">Click to edit notes...</span>
            )}
          </div>
        </div>
      )}
      {/* Assets column (after Notes) */}
      {visibleColumns.assets && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.assets }}
        >
          <div
            onClick={() => {
              if (isLockedByOther) {
                alert(lockLabel);
                return;
              }
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                if (item.assets && setViewingAssetsItem && setShowViewAssetsModal) {
                  setViewingAssetsItem(item.id);
                  setShowViewAssetsModal(true);
                  return;
                }
                if (!item.assets) {
                  alert('No assets to view.');
                  return;
                }
                alert('Only EDITORs can edit assets. Please change your role to EDITOR.');
                return;
              }
              claimRowLock();
              handleModalEditing();
              setEditingAssetsItem && setEditingAssetsItem(item.id);
              setShowAssetsModal && setShowAssetsModal(true);
            }}
            className={`w-full px-3 py-2 border rounded text-base transition-colors flex items-center justify-center ${isLockedByOther ? cellFill + ' opacity-70 cursor-not-allowed' : cellFillInteractive}`}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Click to view assets (read-only)' : 'Click to edit assets'}
          >
            {item.assets ? (
              <div className="text-center">
                <div className="text-sm font-medium">
                  {String(item.assets).split('||').length} Asset{String(item.assets).split('||').length !== 1 ? 's' : ''}
                </div>
              </div>
            ) : (
              <span className="text-slate-400">Click to add assets...</span>
            )}
          </div>
        </div>
      )}
      {/* Speakers column (after Assets) */}
      {visibleColumns.speakers && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
          style={{ width: columnWidths.speakers }}
        >
          <div
            onClick={() => {
              if (isLockedByOther) {
                alert(lockLabel);
                return;
              }
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                if (item.speakersText && setViewingSpeakersItem && setShowViewSpeakersModal) {
                  setViewingSpeakersItem(item.id);
                  setShowViewSpeakersModal(true);
                  return;
                }
                if (item.speakersText) {
                  alert(`Speakers (View Only):\n\n${displaySpeakersText ? displaySpeakersText(item.speakersText) : String(item.speakersText)}`);
                  return;
                }
                alert('No speakers to view.');
                return;
              }
              claimRowLock();
              handleModalEditing();
              setEditingSpeakersItem && setEditingSpeakersItem(item.id);
              setShowSpeakersModal && setShowSpeakersModal(true);
            }}
            className={`w-full px-3 py-2 border rounded text-base transition-colors flex items-start justify-start ${isLockedByOther ? cellFill + ' opacity-70 cursor-not-allowed' : cellFillInteractive}`}
            style={{ 
              height: getSpeakersHeight ? getSpeakersHeight(item.speakersText) : undefined,
              minHeight: getSpeakersHeight ? getSpeakersHeight(item.speakersText) : undefined,
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
              overflow: 'hidden',
              paddingBottom: '1rem',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap'
            }}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR' ? 'Click to view speakers (read-only)' : 'Click to edit speakers'}
          >
            <div className="text-left w-full">
              {(displaySpeakersText ? displaySpeakersText(item.speakersText || '') : String(item.speakersText || '')) || 'Click to add speakers...'}
            </div>
          </div>
        </div>
      )}
      {/* Public column (after Speakers) */}
      {visibleColumns.public && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.public }}
        >
          <input
            type="checkbox"
            checked={!!item.isPublic}
            onChange={(e) => {
              if (isLockedByOther) return;
              if (currentUserRole === 'VIEWER') {
                alert('Viewers cannot change public status. Please change your role to EDITOR or OPERATOR.');
                return;
              }
              claimRowLock();
              const oldValue = !!item.isPublic;
              setSchedule((prev: any[]) => prev.map(scheduleItem => 
                scheduleItem.id === item.id 
                  ? { ...scheduleItem, isPublic: e.target.checked }
                  : scheduleItem
              ));
              if (logChange) {
                logChange('FIELD_UPDATE', `Updated Public status for "${item.segmentName}" from ${oldValue} to ${e.target.checked}`, {
                  changeType: 'FIELD_CHANGE',
                  itemId: item.id,
                  itemName: item.segmentName,
                  fieldName: 'isPublic',
                  oldValue: oldValue,
                  newValue: e.target.checked,
                  details: { fieldType: 'checkbox', booleanChange: true }
                });
              }
              handleUserEditing();
              if (saveToAPI) {
                saveToAPI();
              }
            }}
            disabled={isLockedByOther || currentUserRole === 'VIEWER'}
            className={`w-5 h-5 rounded border-2 text-blue-600 ${isRowDimmed ? 'border-purple-600/50 bg-purple-950/55' : 'border-slate-500 bg-slate-700'}`}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Viewers cannot change public status' : 'Toggle public visibility'}
          />
        </div>
      )}
      {/* Timer column: Countdown (default) or Time of Day for Clock page */}
      {visibleColumns.timer && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0"
          style={{ width: columnWidths.timer }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <select
            value={item.timerDisplay === 'todOnly' ? 'todOnly' : item.timerDisplay === 'countUp' ? 'countUp' : (item.timerDisplay === 'timeOfDay' || item.useTimeOfDay === true) ? 'timeOfDay' : 'countdown'}
            onFocus={claimRowLock}
            onBlur={handleSelectBlur}
            onChange={(e) => {
              if (isLockedByOther) return;
              if (currentUserRole === 'VIEWER') {
                alert('Only EDITORs and OPERATORs can change Timer display. Please change your role.');
                return;
              }
              const newValue = e.target.value as 'countdown' | 'countUp' | 'timeOfDay' | 'todOnly';
              const oldValue = item.timerDisplay === 'todOnly' ? 'todOnly' : item.timerDisplay === 'countUp' ? 'countUp' : (item.timerDisplay === 'timeOfDay' || item.useTimeOfDay === true) ? 'timeOfDay' : 'countdown';
              const useTimeOfDay = newValue === 'timeOfDay' || newValue === 'todOnly';
              setSchedule((prev: any[]) => prev.map(scheduleItem => 
                scheduleItem.id === item.id 
                  ? { ...scheduleItem, timerDisplay: newValue, useTimeOfDay }
                  : scheduleItem
              ));
              if (logChange) {
                logChange('FIELD_UPDATE', `Updated Timer for "${item.segmentName}" from ${oldValue} to ${newValue}`, {
                  changeType: 'FIELD_CHANGE',
                  itemId: item.id,
                  itemName: item.segmentName,
                  fieldName: 'timerDisplay',
                  oldValue: oldValue,
                  newValue: newValue,
                  details: { fieldType: 'select' }
                });
              }
              handleUserEditing();
              if (saveToAPI) {
                saveToAPI();
              }
              // Don't unlock/blur immediately — same 5s idle as typing (handleUserEditing timeout)
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className={`w-full min-w-0 max-w-full rounded border text-sm py-1 px-2 disabled:opacity-70 disabled:cursor-not-allowed ${cellFocus}`}
            disabled={isLockedByOther || currentUserRole === 'VIEWER'}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Only EDITORs and OPERATORs can change' : 'Clock page: Countdown, Count Up, Time of Day, or TOD Only'}
          >
            <option value="countdown">Countdown</option>
            <option value="countUp">Count Up</option>
            <option value="timeOfDay">Time Of Day</option>
            <option value="todOnly">TOD Only</option>
          </select>
        </div>
      )}
      {/* Participants column (after Public) */}
      {visibleColumns.participants && (
        <div 
          className="px-4 py-2 border-r border-slate-600 flex items-start justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
          style={{ width: columnWidths.participants }}
        >
          <div
            onClick={() => {
              if (isLockedByOther) {
                alert(lockLabel);
                return;
              }
              if (currentUserRole === 'VIEWER' || currentUserRole === 'OPERATOR') {
                if (currentUserRole === 'OPERATOR' && item.speakers) {
                  alert(`Participants (View Only):\n\n${displaySpeakers ? displaySpeakers(item.speakers) : String(item.speakers)}`);
                  return;
                }
                alert('Only EDITORs can edit participants. Please change your role to EDITOR.');
                return;
              }
              claimRowLock();
              setEditingParticipantsItem && setEditingParticipantsItem(item.id);
              setShowParticipantsModal && setShowParticipantsModal(true);
            }}
            className={`w-full px-3 py-2 border rounded text-base ${isLockedByOther ? cellFill + ' opacity-70 cursor-not-allowed' : cellFillInteractive}`}
            title={isLockedByOther ? lockLabel : currentUserRole === 'VIEWER' ? 'Viewers cannot edit participants' : currentUserRole === 'OPERATOR' ? 'Click to view participants (read-only)' : 'Click to edit participants'}
          >
            {(displaySpeakers ? displaySpeakers(item.speakers || '') : String(item.speakers || '')) || 'Click to add participants...'}
          </div>
        </div>
      )}
      {/* Custom columns (render at the end) */}
      {Array.isArray(customColumns) && customColumns.map((column: any) => (
        visibleCustomColumns?.[column.id] !== false && (
          <div 
            key={column.id}
            className="px-4 py-2 border-r border-slate-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 ease-in-out"
            style={{ 
              width: (customColumnWidths && customColumnWidths[column.id]) || 256,
              height: getRowHeight ? getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns) : undefined
            }}
          >
            <textarea
              value={(item.customFields && item.customFields[column.name]) || ''}
              onFocus={() => { claimRowLock(); handleUserEditing(); }}
              onChange={(e) => {
                if (isLockedByOther) return;
                handleUserEditing();
                const oldValue = (item.customFields && item.customFields[column.name]) || '';
                setSchedule((prev: any[]) => prev.map(scheduleItem => 
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
                    details: { fieldType: 'custom_field', columnName: column.name, characterChange: e.target.value.length - oldValue.length }
                  }
                );
              }}
              disabled={isLockedByOther}
              className={`w-full px-3 py-2 border rounded text-base resize-none ${cellFill}`}
              style={{
                height: getRowHeight ? `calc(${getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)} - 2rem)` as any : undefined,
                maxHeight: getRowHeight ? `calc(${getRowHeight(item.notes, item.speakersText, item.speakers, item.customFields, customColumns)} - 2rem)` as any : undefined,
                overflow: 'hidden',
                lineHeight: '1.6',
                wordWrap: 'break-word',
                overflowWrap: 'break-word'
              }}
              rows={Math.max(2, String((item.customFields && item.customFields[column.name]) || '').split('\n').length)}
              placeholder={isLockedByOther ? lockLabel : `${column.name}...`}
              title={isLockedByOther ? lockLabel : undefined}
            />
          </div>
        )
      ))}
    </>
  );

  if (asFragment) {
    return <>{Content}</> as any;
  }

  const mergedStyle = rowHeight !== undefined ? { ...(style || {}), height: rowHeight } : style;

  return (
    <div key={item.id} data-item-id={item.id} className={`${className || ''} relative`} style={mergedStyle}>
      {Content}
    </div>
  );
}, (prevProps, nextProps) => {
  const prevItem = prevProps.item;
  const nextItem = nextProps.item;

  // Different items → re-render
  if (prevItem?.id !== nextItem?.id) return false;

  // Compare per-row flags/metrics that affect rendering
  const rowId = nextItem?.id;
  if ((prevProps.indentedCues?.[rowId] ?? false) !== (nextProps.indentedCues?.[rowId] ?? false)) return false;
  if ((prevProps.overtimeMinutes?.[rowId] ?? 0) !== (nextProps.overtimeMinutes?.[rowId] ?? 0)) return false;

  // Start cue changes that affect badges
  if (prevProps.startCueId !== nextProps.startCueId) return false;
  if (prevProps.showStartOvertime !== nextProps.showStartOvertime) return false;
  if (prevProps.showMode !== nextProps.showMode) return false;
  if (prevProps.showWasUnderDuration !== nextProps.showWasUnderDuration) return false;
  if (prevProps.originalDuration !== nextProps.originalDuration) return false;

  // Shallow-compare key item fields used in the row
  const fieldsToCheck = [
    'programType', 'shotType', 'segmentName',
    'durationHours', 'durationMinutes', 'durationSeconds',
    'notes', 'assets', 'speakers', 'speakersText',
    'hasPPT', 'hasQA', 'isPublic'
  ] as const;
  for (const field of fieldsToCheck) {
    if ((prevItem as any)?.[field] !== (nextItem as any)?.[field]) return false;
  }

  // Re-render when visibility/width maps or theme/colors change (ref compare)
  if (prevProps.visibleColumns !== nextProps.visibleColumns) return false;
  if (prevProps.columnWidths !== nextProps.columnWidths) return false;
  if (prevProps.programTypes !== nextProps.programTypes) return false;
  if (prevProps.programTypeColors !== nextProps.programTypeColors) return false;
  if (prevProps.shotTypes !== nextProps.shotTypes) return false;

  // Role changes can affect disabled states and styling
  if (prevProps.currentUserRole !== nextProps.currentUserRole) return false;

  // Stable handlers assumed via useCallback; if identities change, re-render
  if (prevProps.setSchedule !== nextProps.setSchedule) return false;
  if (prevProps.handleUserEditing !== nextProps.handleUserEditing) return false;
  if (prevProps.handleModalEditing !== nextProps.handleModalEditing) return false;
  if (prevProps.handleModalClosed !== nextProps.handleModalClosed) return false;
  if (prevProps.logChangeDebounced !== nextProps.logChangeDebounced) return false;
  if (prevProps.logChange !== nextProps.logChange) return false;
  if (prevProps.saveToAPI !== nextProps.saveToAPI) return false;
  if (prevProps.setEditingNotesItem !== nextProps.setEditingNotesItem) return false;
  if (prevProps.setShowNotesModal !== nextProps.setShowNotesModal) return false;
  if (prevProps.setViewingAssetsItem !== nextProps.setViewingAssetsItem) return false;
  if (prevProps.setShowViewAssetsModal !== nextProps.setShowViewAssetsModal) return false;
  if (prevProps.setEditingAssetsItem !== nextProps.setEditingAssetsItem) return false;
  if (prevProps.setShowAssetsModal !== nextProps.setShowAssetsModal) return false;
  if (prevProps.setEditingParticipantsItem !== nextProps.setEditingParticipantsItem) return false;
  if (prevProps.setShowParticipantsModal !== nextProps.setShowParticipantsModal) return false;
  if (prevProps.displaySpeakers !== nextProps.displaySpeakers) return false;
  if (prevProps.setEditingSpeakersItem !== nextProps.setEditingSpeakersItem) return false;
  if (prevProps.setShowSpeakersModal !== nextProps.setShowSpeakersModal) return false;
  if (prevProps.getSpeakersHeight !== nextProps.getSpeakersHeight) return false;
  if (prevProps.displaySpeakersText !== nextProps.displaySpeakersText) return false;
  if (prevProps.customColumns !== nextProps.customColumns) return false;
  if (prevProps.visibleCustomColumns !== nextProps.visibleCustomColumns) return false;
  if (prevProps.customColumnWidths !== nextProps.customColumnWidths) return false;
  if (prevProps.getRowHeight !== nextProps.getRowHeight) return false;

  // Cumulative overtime change could affect the badge display
  if (prevProps.cumulativeOvertime !== nextProps.cumulativeOvertime) return false;
  if (prevProps.isRowDimmed !== nextProps.isRowDimmed) return false;
  if ((prevProps.rowLock?.userId ?? null) !== (nextProps.rowLock?.userId ?? null)) return false;
  if ((prevProps.rowLock?.userName ?? '') !== (nextProps.rowLock?.userName ?? '')) return false;
  if (prevProps.currentUserId !== nextProps.currentUserId) return false;
  if (prevProps.onRowEditStart !== nextProps.onRowEditStart) return false;
  if (prevProps.onRowEditEnd !== nextProps.onRowEditEnd) return false;

  // No relevant changes → skip re-render
  return true;
});

export default ScheduleRow;
