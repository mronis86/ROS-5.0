import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Event } from '../types/Event';
import { DatabaseService } from '../services/database';

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
  speakers: string; // Legacy field
  speakersText: string; // Current field - JSON string of speaker objects
  hasPPT: boolean;
  hasQA: boolean;
  timerId: string;
  customFields: Record<string, string>;
  isPublic?: boolean;
  isIndented?: boolean;
}

const ReportsPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Get event data from URL parameters or location state
  const urlParams = new URLSearchParams(location.search);
  const eventIdParam = urlParams.get('eventId');
  const eventNameParam = urlParams.get('eventName');

  const [event, setEvent] = useState<Event>(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id) return fromState;
    return {
      id: eventIdParam || '',
      name: eventNameParam || 'Current Event',
      date: '',
      location: '',
      numberOfDays: 1
    };
  });

  const eventId = event?.id || eventIdParam || '';
  const eventName = event?.name || eventNameParam || '';

  // Load full event (location, date) from calendar when we have eventId but missing location/date
  useEffect(() => {
    const fromState = location.state?.event as Event | undefined;
    if (fromState?.id && fromState.id === event?.id) {
      setEvent(fromState);
      return;
    }
    const id = eventIdParam || event?.id;
    const nameForMatch = (event?.name || eventNameParam || '').trim().toLowerCase();
    if (!id || (event?.location && event?.date)) return;
    let cancelled = false;
    const parseScheduleData = (raw: any): { location?: string; numberOfDays?: number } | null => {
      if (raw == null) return null;
      if (typeof raw === 'object') return raw;
      if (typeof raw === 'string') {
        try {
          return JSON.parse(raw) as { location?: string; numberOfDays?: number };
        } catch {
          return null;
        }
      }
      return null;
    };
    const applyCalendarEvent = (calEvent: any) => {
      if (cancelled || !calEvent) return;
      const scheduleData = parseScheduleData(calEvent.schedule_data);
      const loc = scheduleData?.location ?? calEvent.location ?? '';
      const dateObj = calEvent.date ? new Date(calEvent.date) : null;
      const simpleDate = dateObj ? dateObj.toISOString().split('T')[0] : '';
      setEvent((prev) => ({
        ...prev,
        id: prev?.id || calEvent.id || id,
        name: prev?.name || calEvent.name || 'Current Event',
        date: prev?.date || simpleDate,
        location: prev?.location || loc,
        numberOfDays: prev?.numberOfDays ?? scheduleData?.numberOfDays ?? 1
      }));
    };
    const fetchListAndApply = () => {
      DatabaseService.getCalendarEvents()
        .then((list) => {
          if (cancelled || !list?.length) return;
          let found = list.find((e: any) => String(e.id) === String(id));
          if (!found && nameForMatch) {
            found = list.find((e: any) => (e.name || '').trim().toLowerCase() === nameForMatch);
          }
          applyCalendarEvent(found || null);
        })
        .catch(() => {});
    };
    // Try single-event endpoint first (works after Railway deploy)
    DatabaseService.getCalendarEvent(id)
      .then((calEvent: any) => {
        if (cancelled) return;
        const scheduleData = parseScheduleData(calEvent?.schedule_data);
        const hasLocation = !!(scheduleData?.location ?? calEvent?.location);
        if (calEvent && hasLocation) {
          applyCalendarEvent(calEvent);
        } else if (calEvent && !hasLocation) {
          // Event returned but no location (e.g. from localStorage fallback) – fetch list to get server data
          fetchListAndApply();
        } else {
          applyCalendarEvent(calEvent);
        }
      })
      .catch(() => {
        // Fallback: fetch full list and find by id or name (works before GET :id is deployed)
        fetchListAndApply();
      });
    return () => { cancelled = true; };
  }, [eventIdParam, event?.id, event?.name, eventNameParam, event?.location, event?.date, location.state?.event]);

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [masterStartTime, setMasterStartTime] = useState('');
  const [reportType, setReportType] = useState('showfile');
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('landscape');

  // Number of report days: use event.numberOfDays, or max day in schedule, or settings from API (whichever is highest)
  const scheduleMaxDay = schedule.length ? Math.max(...schedule.map(s => s.day || 1)) : 0;
  const reportDaysCount = Math.max(
    1,
    event?.numberOfDays || 0,
    scheduleMaxDay
  );
  // Options for date/day selector: calendar date + Day N when we have event.date
  const reportDayOptions = (() => {
    const base = event?.date;
    const opts: { value: number; label: string }[] = [];
    for (let d = 1; d <= reportDaysCount; d++) {
      let label = `Day ${d}`;
      if (base && d >= 1) {
        try {
          const date = new Date(base + 'T12:00:00');
          if (!isNaN(date.getTime())) {
            date.setDate(date.getDate() + (d - 1));
            const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            label = `${formatted} (Day ${d})`;
          }
        } catch { /* keep Day N */ }
      }
      opts.push({ value: d, label });
    }
    return opts;
  })();

  // Keep selectedDay in range when report days change (e.g. after refresh)
  useEffect(() => {
    if (selectedDay > reportDaysCount) setSelectedDay(reportDaysCount);
  }, [reportDaysCount, selectedDay]);
  const [eventTimezone, setEventTimezone] = useState<string>('America/New_York'); // Default to EST
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSuccessAt, setRefreshSuccessAt] = useState<number | null>(null);

  // Load schedule from localStorage (same logic as initial load)
  const loadScheduleFromStorage = useCallback((): ScheduleItem[] => {
    let savedSchedule = null;
    if (event?.id) {
      savedSchedule = localStorage.getItem(`runOfShowSchedule_${event.id}`);
    }
    if (!savedSchedule && eventId) {
      savedSchedule = localStorage.getItem(`runOfShowSchedule_${eventId}`);
    }
    if (!savedSchedule) {
      const keys = Object.keys(localStorage);
      const scheduleKeys = keys.filter(key => key.startsWith('runOfShowSchedule_'));
      if (scheduleKeys.length > 0) {
        const latestKey = scheduleKeys[scheduleKeys.length - 1];
        savedSchedule = localStorage.getItem(latestKey);
      }
    }
    if (savedSchedule) {
      try {
        return JSON.parse(savedSchedule);
      } catch {
        return [];
      }
    }
    return [];
  }, [event?.id, eventId]);

  // Refresh report data: re-read localStorage and fetch master start time (and optionally schedule) from API
  const refreshReportData = useCallback(async () => {
    const eventIdForFetch = event?.id || eventIdParam;
    setIsRefreshing(true);
    try {
      // 1) Try API first for latest schedule + settings (use URL param if event.id not set yet)
      if (eventIdForFetch) {
        try {
          const data = await DatabaseService.getRunOfShowData(eventIdForFetch);
          if (data?.schedule_items && Array.isArray(data.schedule_items) && data.schedule_items.length > 0) {
            setSchedule(data.schedule_items);
          } else {
            const fromStorage = loadScheduleFromStorage();
            if (fromStorage.length > 0) setSchedule(fromStorage);
          }
          if (data?.settings?.masterStartTime) {
            setMasterStartTime(data.settings.masterStartTime);
          } else if (data?.settings?.dayStartTimes?.['1']) {
            setMasterStartTime(data.settings.dayStartTimes['1']);
          } else {
            let saved = localStorage.getItem(`masterStartTime_${eventIdForFetch}`);
            if (!saved) {
              const keys = Object.keys(localStorage).filter(k => k.startsWith('masterStartTime_'));
              if (keys.length > 0) saved = localStorage.getItem(keys[keys.length - 1]);
            }
            setMasterStartTime(saved || '09:00');
          }
          if (data?.settings?.timezone) {
            setEventTimezone(data.settings.timezone);
          }
          // Enrich event for report headers (condensed/full): date, name, location, numberOfDays from run-of-show data
          const rosDate = data.event_date
            ? (typeof data.event_date === 'string' && data.event_date.length >= 10
                ? data.event_date.slice(0, 10)
                : new Date(data.event_date).toISOString().split('T')[0])
            : '';
          setEvent((prev) => ({
            ...prev,
            id: prev?.id || eventIdForFetch,
            name: data.event_name ?? prev?.name ?? 'Current Event',
            date: rosDate || prev?.date || '',
            location: (data as any).event_location || data.settings?.location || prev?.location || '',
            numberOfDays: data?.settings?.numberOfDays ?? (data as any).numberOfDays ?? prev?.numberOfDays ?? 1
          }));
        } catch {
          const fromStorage = loadScheduleFromStorage();
          if (fromStorage.length > 0) setSchedule(fromStorage);
          let saved = eventIdForFetch ? localStorage.getItem(`masterStartTime_${eventIdForFetch}`) : null;
          if (!saved) {
            const keys = Object.keys(localStorage).filter(k => k.startsWith('masterStartTime_'));
            if (keys.length > 0) saved = localStorage.getItem(keys[keys.length - 1]);
          }
          setMasterStartTime(saved || '09:00');
        }
      } else {
        const fromStorage = loadScheduleFromStorage();
        if (fromStorage.length > 0) setSchedule(fromStorage);
      }
    } finally {
      setIsRefreshing(false);
      setRefreshSuccessAt(Date.now());
    }
  }, [event?.id, eventIdParam, loadScheduleFromStorage]);

  // Clear success state after a short delay
  useEffect(() => {
    if (refreshSuccessAt === null) return;
    const t = setTimeout(() => setRefreshSuccessAt(null), 2500);
    return () => clearTimeout(t);
  }, [refreshSuccessAt]);

  // Format CUE display consistently
  const formatCueDisplay = (cue: string | number | undefined) => {
    if (!cue && cue !== 0) return ''; // Return empty string to allow fallback
    // Convert to string if it's a number
    const cueStr = String(cue);
    // If cue already has proper spacing, return as is
    if (cueStr.includes('CUE ')) return cueStr;
    // If cue is like "CUE2", convert to "CUE 2"
    if (cueStr.match(/^CUE\d+$/)) return cueStr.replace(/^CUE(\d+)$/, 'CUE $1');
    // For plain numbers or other formats, add "CUE " prefix
    return `CUE ${cueStr}`;
  };

  // Program type display label (HTML-safe); two-line labels so badge stays narrow (like Full-Stage Ted-Talk)
  const formatProgramTypeLabel = (programType: string) => {
    if (!programType) return '';
    const twoLine: Record<string, string> = {
      'Full-Stage/Ted-Talk': 'Full-Stage<br>Ted-Talk',
      'Podium Transition': 'Podium<br>Transition',
      'Panel Transition': 'Panel<br>Transition',
      'Breakout Session': 'Breakout<br>Session',
    };
    return twoLine[programType] ?? programType;
  };

  // UTC conversion functions (same as other pages)
  const getCurrentTimeUTC = (): Date => {
    return new Date();
  };

  const convertLocalTimeToUTC = (localTime: Date, timezone: string): Date => {
    try {
      // Create a date that represents the local time in the event timezone
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const day = now.getDate();
      
      // Create a date object for the scheduled time in the event timezone
      const scheduledDate = new Date(year, month, day, localTime.getHours(), localTime.getMinutes(), 0);
      
      // Get the timezone offset for the event timezone
      const eventTime = new Date(scheduledDate.toLocaleString("en-US", { timeZone: timezone }));
      const utcTime = new Date(scheduledDate.toLocaleString("en-US", { timeZone: 'UTC' }));
      const offsetMs = eventTime.getTime() - utcTime.getTime();
      
      // Apply the offset to get the correct UTC time
      const result = new Date(scheduledDate.getTime() + offsetMs);
      
      return result;
    } catch (error) {
      console.warn('Error converting local time to UTC:', error);
      return localTime; // Fallback to original time
    }
  };

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

  // Initial load: same as refresh
  useEffect(() => {
    refreshReportData();
  }, [refreshReportData]);

  // Format master start time to 12-hour format
  const formatMasterStartTime = (timeString: string) => {
    if (!timeString) return 'Not set';
    
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Helper function to truncate text with ellipsis
  const truncateText = (text: string, maxLength: number = 20) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  };

  // AI-powered function to split names into 2 lines intelligently
  const formatNameForTwoLines = (fullName: string): { html: string, needsSmallText: boolean } => {
    if (!fullName || fullName.trim().length === 0) return { html: '', needsSmallText: false };
    
    const name = fullName.trim();
    const parts = name.split(/\s+/);
    
    if (parts.length <= 1) return { html: name, needsSmallText: false };
    
    // Common titles and prefixes
    const titles = ['Dr', 'Dr.', 'Prof', 'Prof.', 'Mr', 'Mr.', 'Mrs', 'Mrs.', 'Ms', 'Ms.', 'Hon', 'Hon.', 'Honorable', 'Sen', 'Sen.', 'Senator', 'Rep', 'Rep.', 'Representative', 'Gov', 'Gov.', 'Governor', 'Mayor', 'Judge', 'Ambassador', 'Amb', 'Amb.', 'General', 'Gen', 'Gen.', 'Admiral', 'Adm', 'Adm.', 'Colonel', 'Col', 'Col.', 'Major', 'Maj', 'Maj.', 'Captain', 'Capt', 'Capt.', 'Lieutenant', 'Lt', 'Lt.', 'Sergeant', 'Sgt', 'Sgt.', 'Chief', 'Commander', 'Comm'];
    
    // Common suffixes and designations
    const suffixes = ['Jr', 'Jr.', 'Sr', 'Sr.', 'III', 'IV', 'V', 'Ph.D', 'PhD', 'MD', 'DDS', 'DVM', 'Esq', 'Esq.', 'CPA', 'PE', 'RN', 'LPN'];
    
    let title = '';
    let firstName = '';
    let lastName = '';
    let suffix = '';
    let party = '';
    
    // Extract title
    if (titles.includes(parts[0])) {
      title = parts[0];
      parts.shift();
    }
    
    // Extract party designation
    const partyMatch = name.match(/\([DR]\)/i);
    if (partyMatch) {
      party = partyMatch[0];
      // Remove party from parts
      const partyIndex = parts.findIndex(part => part.match(/\([DR]\)/i));
      if (partyIndex !== -1) {
        parts.splice(partyIndex, 1);
      }
    }
    
    // Extract suffix
    if (parts.length > 0 && suffixes.includes(parts[parts.length - 1])) {
      suffix = parts[parts.length - 1];
      parts.pop();
    }
    
    // Remaining parts are the actual name
    if (parts.length === 0) return { html: name, needsSmallText: false };
    
    if (parts.length === 1) {
      firstName = parts[0];
    } else {
      // Split name intelligently - usually last name is the longest or last part
      const lastNameIndex = parts.length - 1;
      lastName = parts[lastNameIndex];
      firstName = parts.slice(0, lastNameIndex).join(' ');
    }
    
    // Smart line balancing - try to balance the lines better
    const maxCharsPerLine = 9;
    
    // First attempt: standard split
    let line1 = [title, firstName].filter(Boolean).join(' ');
    let line2 = [lastName, suffix, party].filter(Boolean).join(' ');
    
    // If first line is too long, try to move some of the first name to second line
    if (line1.length > maxCharsPerLine && firstName.includes(' ')) {
      const firstNameParts = firstName.split(' ');
      if (firstNameParts.length > 1) {
        // Move the last part of the first name to the second line
        const lastFirstNamePart = firstNameParts.pop();
        const newFirstName = firstNameParts.join(' ');
        line1 = [title, newFirstName].filter(Boolean).join(' ');
        line2 = [lastFirstNamePart, lastName, suffix, party].filter(Boolean).join(' ');
      }
    }
    
    // If still too long, try moving more parts
    if (line1.length > maxCharsPerLine && firstName.includes(' ')) {
      const firstNameParts = firstName.split(' ');
      if (firstNameParts.length > 2) {
        // Move the last two parts of the first name to the second line
        const lastTwoFirstNameParts = firstNameParts.splice(-2);
        const newFirstName = firstNameParts.join(' ');
        line1 = [title, newFirstName].filter(Boolean).join(' ');
        line2 = [lastTwoFirstNameParts.join(' '), lastName, suffix, party].filter(Boolean).join(' ');
      }
    }
    
    // Check if we need smaller text
    const needsSmallText = line1.length > maxCharsPerLine || line2.length > maxCharsPerLine;
    
    return {
      html: `${line1}<br/>${line2}`,
      needsSmallText: needsSmallText
    };
  };

  // Calculate start time function (simple - no overtime adjustments for print reports)
  const calculateStartTime = (index: number) => {
    console.log(`calculateStartTime called with index: ${index}, masterStartTime: ${masterStartTime}`);
    
    if (!masterStartTime) {
      console.log('No master start time, returning empty string');
      return '';
    }
    
    let totalMinutes = 0;
    for (let i = 0; i < index; i++) {
      const item = schedule[i];
      totalMinutes += (item.durationHours * 60) + item.durationMinutes;
    }
    
    console.log(`Total minutes for index ${index}: ${totalMinutes}`);
    
    const [startHours, startMinutes] = masterStartTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(startHours, startMinutes + totalMinutes, 0, 0);
    
    // Format as 12-hour time (e.g., "1:30 PM")
    const result = startDate.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
    
    console.log(`Calculated start time for index ${index}: ${result}`);
    return result;
  };

  // Get color for program type badge (matching RunOfShowPage colors)
  const getProgramTypeColor = (programType: string) => {
    const colors: Record<string, string> = {
      'PreShow/End': '#8B5CF6',        // Bright Purple
      'Podium Transition': '#8B4513',  // Dark Brown
      'Panel Transition': '#404040',   // Darker Grey
      'Full-Stage/Ted-Talk': '#EA580C', // Bright Orange (matches RunOfShowPage)
      'Sub Cue': '#F3F4F6',           // White with border
      'No Transition': '#059669',      // Bright Teal
      'Video': '#F59E0B',              // Bright Yellow/Orange
      'Panel+Remote': '#1E40AF',       // Dark blue (remote panel)
      'Remote Only': '#60A5FA',        // Light Blue
      'Break F&B/B2B': '#EC4899',              // Bright Pink
      'Breakout Session': '#20B2AA',           // Seafoam
      'TBD': '#6B7280',                // Medium Gray
      'KILLED': '#DC2626',             // Bright Red
      'Podium': '#FFFFFF',             // White (no highlighting)
      'Panel': '#FFFFFF',              // White (no highlighting)
    };
    return colors[programType] || '#D3D3D3'; // Light gray default
  };

  // Program type labels for condensed report color legend (same order as Run of Show program type dropdown)
  const condensedColorLegend: { label: string; key: string }[] = [
    { label: 'PreShow/End', key: 'PreShow/End' },
    { label: 'Podium Transition', key: 'Podium Transition' },
    { label: 'Panel Transition', key: 'Panel Transition' },
    { label: 'Full Stage / Ted Talk', key: 'Full-Stage/Ted-Talk' },
    { label: 'Sub Cue', key: 'Sub Cue' },
    { label: 'No Transition', key: 'No Transition' },
    { label: 'Video', key: 'Video' },
    { label: 'Panel + Remote', key: 'Panel+Remote' },
    { label: 'Remote Only', key: 'Remote Only' },
    { label: 'Break F&B / B2B', key: 'Break F&B/B2B' },
    { label: 'Breakout Session', key: 'Breakout Session' },
    { label: 'TBD', key: 'TBD' },
    { label: 'KILLED', key: 'KILLED' },
  ];

  // Get row background color (white for types that only highlight CUE badge; others = full row highlight)
  const getRowBackgroundColor = (programType: string) => {
    if (programType === 'Panel Transition' || programType === 'Podium Transition' ||
        programType === 'Panel' || programType === 'Podium' ||
        programType === 'Panel+Remote' || programType === 'Full-Stage/Ted-Talk') {
      return '#FFFFFF'; // White background; CUE column has colored badge
    }
    return getProgramTypeColor(programType);
  };

  // Color used in the legend and in the CUE badge for each type (identifying color)
  const getLegendOrBadgeColor = (programType: string) => {
    const badgeColors: Record<string, string> = {
      'Panel': '#404040',
      'Panel Transition': '#404040',
      'Podium': '#8B4513',
      'Podium Transition': '#8B4513',
      'Panel+Remote': '#1E40AF',
      'Full-Stage/Ted-Talk': '#EA580C',
      'Sub Cue': '#9CA3AF',
    };
    return badgeColors[programType] ?? getProgramTypeColor(programType);
  };

  // Extract top-level <li>...</li> only (so nested lists don't break numbering/order)
  const extractTopLevelLis = (content: string): string[] => {
    const items: string[] = [];
    const lower = content.toLowerCase();
    let pos = 0;
    while (true) {
      const open = lower.indexOf('<li', pos);
      if (open === -1) break;
      let depth = 1;
      let p = lower.indexOf('>', open) + 1;
      const start = p;
      while (depth > 0 && p < content.length) {
        const nextLi = lower.indexOf('<li', p);
        const nextClose = lower.indexOf('</li>', p);
        if (nextClose === -1) break;
        if (nextLi !== -1 && nextLi < nextClose) {
          depth += 1;
          p = nextLi + 1;
        } else {
          depth -= 1;
          if (depth === 0) {
            items.push(content.slice(start, nextClose).trim());
            pos = nextClose + 5;
            break;
          }
          p = nextClose + 5;
        }
      }
      if (depth !== 0) break;
    }
    return items;
  };

  // Indent for nested lists in report notes (so "1. List item" appears on its own line under a bullet)
  const NESTED_LIST_INDENT = '      '; // 6 spaces

  // Convert inner HTML of an li to plain text, preserving nested list indentation
  const liInnerToText = (html: string, bulletIndent = ''): string => {
    let inner = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<p[^>]*>/gi, '');
    // Nested <ul><li>...</li></ul> -> newline then indented bullets
    inner = inner.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, ulContent) => {
      const lis = extractTopLevelLis(ulContent);
      const block = lis
        .map(liHtml => bulletIndent + NESTED_LIST_INDENT + '• ' + liInnerToText(liHtml, bulletIndent + NESTED_LIST_INDENT).trim())
        .join('\n');
      return lis.length ? '\n' + block + '\n' : '';
    });
    // Nested <ol><li>...</li></ol> -> newline then indented numbers (1. 2. 3.)
    inner = inner.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, olContent) => {
      const lis = extractTopLevelLis(olContent);
      const block = lis
        .map((liHtml, i) => bulletIndent + NESTED_LIST_INDENT + (i + 1) + '. ' + liInnerToText(liHtml, bulletIndent + NESTED_LIST_INDENT).trim())
        .join('\n');
      return lis.length ? '\n' + block + '\n' : '';
    });
    return inner.replace(/<[^>]*>/g, '').replace(/\n+/g, '\n').trim();
  };

  // Normalize notes for print: preserve line breaks, bullet/number lists, strip HTML, escape for HTML output
  const notesForPrint = (raw: string): string => {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // Process <ul> BEFORE <ol> so nested <ol> inside a bullet (e.g. "adsad" then "1. List item", "2.") is
    // handled inside liInnerToText with a newline + indent, not turned into "adsad1. List item"
    s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
      const items = extractTopLevelLis(content);
      return items
        .map(liHtml => '• ' + liInnerToText(liHtml))
        .filter(Boolean)
        .join('\n') + (items.length ? '\n' : '');
    });

    // Top-level <ol> (and any <ol> that wasn't inside a ul) -> numbered list (1. 2. 3.)
    s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
      const items = extractTopLevelLis(content);
      return items
        .map((liHtml, i) => {
          const text = liInnerToText(liHtml);
          return text ? `${i + 1}. ${text}` : `${i + 1}.`;
        })
        .join('\n') + (items.length ? '\n' : '');
    });
    // Standalone or remaining <li>...</li> (e.g. not inside ol/ul) -> bullet
    s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => '• ' + liInnerToText(inner) + '\n');
    s = s.replace(/<\/?ul[^>]*>/gi, '');
    s = s.replace(/<\/?ol[^>]*>/gi, '');

    // Line breaks from br and p tags
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p>/gi, '\n');
    s = s.replace(/<p[^>]*>/gi, '');

    // Strip remaining HTML tags
    s = s.replace(/<[^>]*>/g, '');
    s = s.trim();
    return s;
  };

  const escapeHtml = (s: string): string => {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  // Sanitize notes HTML for safe inclusion in report: strip script and event handlers, keep list/formatting
  const sanitizeNotesHtml = (html: string): string => {
    if (!html || typeof html !== 'string') return '';
    let s = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
    return s.trim();
  };

  // Use notes HTML as-is in report so formatting (lists, indent) matches the full note for that row
  const notesHtmlForReport = (notes: string | undefined): string => {
    if (!notes || !notes.trim() || notes === 'None' || notes === 'null' || notes === 'undefined') return escapeHtml('None');
    return sanitizeNotesHtml(notes);
  };

  // CSS for notes cells when they contain HTML lists - same structure as in-app notes, print-friendly
  const reportNotesListCss = `
        .notes-content-cell, .report-notes-cell { white-space: normal; color: #000; }
        .notes-content-cell ul, .report-notes-cell ul { list-style-type: disc; list-style-position: outside; margin: 6px 0; padding-left: 24px; }
        .notes-content-cell ol, .report-notes-cell ol { list-style-type: decimal; list-style-position: outside; margin: 6px 0; padding-left: 28px; }
        .notes-content-cell li, .report-notes-cell li { margin: 2px 0; line-height: 1.4; padding-left: 2px; }
        .notes-content-cell ul ul, .report-notes-cell ul ul { list-style-type: circle; padding-left: 24px; }
        .notes-content-cell ul ul ul, .report-notes-cell ul ul ul { list-style-type: square; padding-left: 24px; }
        .notes-content-cell ol ol, .report-notes-cell ol ol { list-style-type: lower-alpha; padding-left: 28px; }
        .notes-content-cell ol ol ol, .report-notes-cell ol ol ol { list-style-type: lower-roman; padding-left: 28px; }
        .notes-content-cell p, .report-notes-cell p { margin: 4px 0; }
  `;

  // Generate report content
  const generateReportContent = () => {
    const isShowFile = reportType === 'showfile';
    const isSpeakers = reportType === 'speakers';
    const orientation = printOrientation;
    const placeholderPhotoUrl = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin + '/speaker-placeholder.svg' : '';
    
    // Filter schedule by selected day (fallback to day 1 if no day field)
    const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
    
    // For multi-day events, show the calendar date for the selected day (Day 1 = event date, Day 2 = +1, etc.)
    const displayDate = (() => {
      const base = event?.date;
      if (!base || selectedDay < 2) return base || 'Not specified';
      const n = event?.numberOfDays ?? 1;
      if (n < 2) return base;
      try {
        const d = new Date(base + 'T12:00:00');
        if (isNaN(d.getTime())) return base;
        d.setDate(d.getDate() + (selectedDay - 1));
        return d.toISOString().slice(0, 10);
      } catch {
        return base;
      }
    })();
    
    console.log('=== GENERATING REPORT ===');
    console.log('Report type:', reportType);
    console.log('Selected day:', selectedDay);
    console.log('Total schedule items:', schedule.length);
    console.log('Filtered schedule items:', filteredSchedule.length);
    console.log('Sample item:', filteredSchedule[0]);
    console.log('Master start time:', masterStartTime);
    
    // Test calculateStartTime with first item
    if (filteredSchedule.length > 0) {
      const testIndex = schedule.findIndex(s => s.id === filteredSchedule[0].id);
      const testStartTime = calculateStartTime(testIndex);
      console.log('Test start time calculation:', {
        testIndex,
        testStartTime,
        item: filteredSchedule[0].segmentName
      });
    }
    
    if (isShowFile) {
      // Generate section-based show file format
      let content = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>ROS Show File - ${event?.name || 'Event'}</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 0; 
              padding: 15px;
              font-size: 11px;
              line-height: 1.3;
              background: white;
            }
            @media print {
              body { 
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              * {
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            .header { 
              text-align: center; 
              margin-bottom: 15px; 
            }
            .header h1 { 
              font-size: 16px; 
              margin: 0; 
              color: #000;
              font-weight: normal;
            }
            .header h2 { 
              font-size: 12px; 
              margin: 3px 0 0 0; 
              color: #333; 
              font-weight: normal;
            }
            .event-info { 
              background: #f5f5f5; 
              padding: 8px; 
              margin-bottom: 12px; 
              font-size: 10px;
              border: 1px solid #ddd;
            }
            .section { 
              margin-bottom: 8px; 
              border: 1px solid #000;
              page-break-inside: avoid;
            }
            .section-header { 
              padding: 6px 8px; 
              font-weight: normal; 
              font-size: 11px;
              color: white;
              background: #366092;
              border-bottom: 1px solid #000;
            }
            .section-content { 
              padding: 0; 
              background: white;
            }
            .modal-table { 
              width: 100%;
              border-collapse: collapse;
              border: 2px solid #000;
              background: white;
            }
            .modal-table td { 
              border: 1px solid #000; 
              padding: 6px 8px; 
              background: white;
              vertical-align: top;
            }
            .modal-table .header-cell { 
              background: #d9d9d9; 
              font-weight: normal; 
              text-align: center;
              font-size: 10px;
              width: 70px;
              min-width: 70px;
            }
            .modal-table .segment-cell { 
              min-width: 180px;
              max-width: 250px;
              word-wrap: break-word;
              font-size: 11px;
            }
            .modal-table .notes-cell { 
              background: #f0f0f0; 
              min-height: 35px;
              min-width: 200px;
              font-size: 10px;
            }
            .modal-table         .participants-cell { 
          background: #f0f0f0; 
          min-height: 60px;
          min-width: 600px;
          width: 600px;
          max-width: 600px;
        }
            .modal-table .start-time-cell { 
              background: #e7f3ff; 
              font-weight: normal;
              font-size: 12px;
            }
            .times-cell {
              background: #e7f3ff;
              font-weight: normal;
              text-align: center;
              vertical-align: middle;
              width: 80px;
              min-width: 80px;
            }
            .times-content {
              display: flex;
              flex-direction: column;
              gap: 2px;
            }
            .start-time {
              font-size: 11px;
              font-weight: normal;
              color: #000;
            }
            .duration {
              font-size: 11px;
              font-weight: normal;
              color: #000;
            }
            .time-label {
              font-size: 9px;
              font-weight: normal;
              color: #333;
              margin-right: 4px;
            }
            .simple-table { 
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              background: white;
            }
            .simple-table td { 
              border: 1px solid #000; 
              padding: 8px; 
              background: white;
              vertical-align: top;
              font-size: 11px;
            }
        .simple-table .header-cell { 
          background: #d9d9d9; 
          font-weight: normal; 
          text-align: center;
          font-size: 10px;
        }
        /* Fixed CUE column (first column) for print */
        .simple-table td:nth-child(1),
        .simple-table tr:first-child td:nth-child(1) {
          width: 105px;
          min-width: 105px;
          max-width: 105px;
          box-sizing: border-box;
        }
        .stacked-header {
          width: 300px;
        }
        .stacked-cell {
          width: 300px;
          max-width: 300px;
          vertical-align: top;
          padding: 8px;
        }
        .stacked-item {
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #e0e0e0;
          display: flex;
          flex-direction: column;
        }
        .stacked-item:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        .stacked-label {
          font-weight: normal;
          font-size: 9px;
          color: #333;
          margin-bottom: 3px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .stacked-value {
          font-size: 10px;
          line-height: 1.3;
          word-wrap: break-word;
          color: #000;
          padding-left: 4px;
        }
        .slot-cell {
          width: 75px;
          height: 155px;
          vertical-align: top;
          min-width: 75px;
          max-width: 75px;
        }
        .slot-container {
          height: 155px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 4px;
        }
        .slot-top {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .slot-name {
          font-weight: normal;
          font-size: 11px;
          line-height: 1.2;
        }
        .slot-title {
          font-size: 10px;
          line-height: 1.1;
          color: #666;
        }
        .slot-org {
          font-size: 10px;
          line-height: 1.1;
          color: #666;
        }
        .slot-photo {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 8px;
        }
        .slot-photo-img {
          width: 50px;
          height: 65px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid #ccc;
          margin: 0 auto;
        }
        .slot-text {
          margin-top: 4px;
          text-align: center;
          font-size: 9px;
          line-height: 1.2;
          color: #000;
          max-height: 90px;
          overflow: hidden;
        }
        .slot-name {
          font-weight: bold;
          font-size: 8px;
          margin-bottom: 2px;
          white-space: normal;
          word-wrap: break-word;
          text-align: center;
          line-height: 1.0;
          max-height: 18px;
          overflow: hidden;
        }
        .slot-name-small {
          font-weight: bold;
          font-size: 7px;
          margin-bottom: 2px;
          white-space: normal;
          word-wrap: break-word;
          text-align: center;
          line-height: 1.0;
          max-height: 16px;
          overflow: hidden;
        }
        .slot-title {
          font-size: 8px;
          color: #333;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .slot-org {
          font-size: 8px;
          color: #666;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .slot-role {
          font-size: 8px;
          color: #000;
          font-weight: bold;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 3px;
          padding: 1px 3px;
          margin-top: 2px;
          white-space: normal;
          word-wrap: break-word;
          text-align: center;
          min-height: 10px;
        }
        .notes-header-row {
          background: #e0e0e0;
        }
        .notes-header-cell {
          padding: 6px 8px;
          font-size: 10px;
          font-weight: normal;
          text-align: center;
          border-top: 2px solid #ddd;
          background: #e0e0e0;
        }
        .notes-content-row {
          background: #f9f9f9;
        }
        .notes-content-cell {
          padding: 8px;
          font-size: 10px;
          line-height: 1.3;
          background: #f9f9f9;
        }
        ${reportNotesListCss}
            .modal-cell .field-label { 
              font-weight: normal; 
              font-size: 11px; 
              color: #333; 
              margin-bottom: 4px;
            }
            .modal-cell .field-value { 
              font-size: 12px; 
              color: #000;
              line-height: 1.3;
            }
            .speaker-item { 
              display: flex; 
              align-items: center; 
              margin-bottom: 6px;
              padding: 6px;
              background: white;
              border: 1px solid #ddd;
              border-radius: 4px;
              box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            .speaker-photo { 
              width: 40px; 
              height: 40px; 
              border-radius: 4px; 
              object-fit: cover; 
              border: 2px solid #007acc;
              margin-right: 10px;
              flex-shrink: 0;
            }
            .speaker-info { 
              flex: 1;
            }
            .speaker-badges { 
              display: flex; 
              gap: 4px;
              margin-bottom: 3px;
            }
            .speaker-name { 
              font-weight: normal; 
              font-size: 11px; 
              color: #000;
              margin-bottom: 2px;
            }
            .slot-badge { 
              background: #007acc; 
              color: white; 
              padding: 2px 6px; 
              border-radius: 6px; 
              font-size: 8px; 
              font-weight: normal;
            }
            .location-badge { 
              background: #28a745; 
              color: white; 
              padding: 2px 6px; 
              border-radius: 6px; 
              font-size: 8px; 
              font-weight: normal;
            }
            .speaker-title { 
              color: #666; 
              font-size: 10px;
              margin-bottom: 1px;
            }
            .speaker-org { 
              color: #888; 
              font-size: 9px;
            }
            .footer { 
              margin-top: 40px; 
              text-align: center; 
              color: #666; 
              font-size: 12px;
              border-top: 1px solid #ddd;
              padding-top: 20px;
            }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
              @page { 
                size: A4 ${orientation}; 
                margin: 0.2in; 
              }
              .section { 
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>ROS SHOW FILE</h1>
            <h2>${event?.name || 'Event'}${(event?.numberOfDays && event.numberOfDays > 1) ? ` - Day ${selectedDay}` : ''}</h2>
          </div>
          <div class="event-info">
            <p><strong>Date:</strong> ${displayDate} | <strong>Location:</strong> ${event?.location || 'Not specified'} | <strong>Start Time:</strong> ${formatMasterStartTime(masterStartTime)} | <strong>Total Items:</strong> ${schedule.length} | <strong>Day:</strong> ${selectedDay}</p>
          </div>
          
      `;
      
      filteredSchedule.forEach((item, index) => {
        // Find the original index in the full schedule for accurate time calculation
        const originalIndex = schedule.findIndex(s => s.id === item.id);
        const startTime = calculateStartTime(originalIndex);
        const duration = `${item.durationHours.toString().padStart(2, '0')}:${item.durationMinutes.toString().padStart(2, '0')}:${item.durationSeconds.toString().padStart(2, '0')}`;
        const programColor = getProgramTypeColor(item.programType || '');
        
        console.log(`SHOW FILE - Item ${index} (${item.segmentName}):`, {
          originalIndex,
          startTime,
          duration,
          masterStartTime,
          itemId: item.id
        });
        
        // Parse speakers if they exist
        let speakersArray = [];
        if (item.speakersText) {
          try {
            speakersArray = JSON.parse(item.speakersText);
            console.log(`Speakers parsed for item ${index} (${item.segmentName}):`, speakersArray);
            // Debug each speaker's photoLink
            speakersArray.forEach((speaker, speakerIndex) => {
              console.log(`  Speaker ${speakerIndex + 1}:`, {
                fullName: speaker.fullName,
                photoLink: speaker.photoLink,
                photoUrl: speaker.photoUrl,
                hasPhoto: !!(speaker.photoLink || speaker.photoUrl)
              });
            });
          } catch (error) {
            console.log(`Error parsing speakers for item ${index}:`, error);
            // If parsing fails, treat as simple string
            speakersArray = [{ fullName: item.speakersText, title: '', org: '', photoLink: '' }];
          }
        } else {
          console.log(`No speakersText for item ${index}:`, item.segmentName);
        }
        
        // Combine PPT and Q&A
        let pptQaText = '';
        if (item.hasPPT && item.hasQA) {
          pptQaText = 'PPT + Q&A';
        } else if (item.hasPPT) {
          pptQaText = 'PPT';
        } else if (item.hasQA) {
          pptQaText = 'Q&A';
        } else {
          pptQaText = 'None';
        }
        
        content += `
          <div class="section">
            <div class="section-content">
              <table class="simple-table">
                <tr>
                  <td class="header-cell">CUE</td>
                  <td class="header-cell">TIME</td>
                  <td class="header-cell stacked-header">SEGMENT INFO</td>
                  <td class="header-cell">SLOT 1</td>
                  <td class="header-cell">SLOT 2</td>
                  <td class="header-cell">SLOT 3</td>
                  <td class="header-cell">SLOT 4</td>
                  <td class="header-cell">SLOT 5</td>
                  <td class="header-cell">SLOT 6</td>
                  <td class="header-cell">SLOT 7</td>
                </tr>
                <tr>
                  <td>
                    <div style="margin-bottom: 4px;">${formatCueDisplay(item.customFields?.cue) || `CUE ${index + 1}`}</div>
                    <div style="background-color: ${programColor}; color: ${item.programType === 'Sub Cue' ? 'black' : 'white'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: normal; display: inline-block; width: fit-content; ${item.programType === 'Sub Cue' ? 'border: 1px solid #000000;' : ''}">${formatProgramTypeLabel(item.programType) || 'Unknown'}</div>
                  </td>
                  <td class="times-cell">
                    <div class="times-content">
                      <div class="start-time">
                        <span class="time-label">Start:</span> ${startTime}
                      </div>
                      <div class="duration">
                        <span class="time-label">Dur:</span> ${duration}
                      </div>
                    </div>
                  </td>
                  <td class="stacked-cell">
                    <div class="stacked-item">
                      <div class="stacked-label">SEGMENT:</div>
                      <div class="stacked-value">${item.segmentName || 'Untitled Segment'}</div>
                    </div>
                    <div class="stacked-item">
                      <div class="stacked-label">SHOT:</div>
                      <div class="stacked-value">${item.shotType || 'Not specified'}</div>
                    </div>
                    <div class="stacked-item">
                      <div class="stacked-label">PPT/Q&A:</div>
                      <div class="stacked-value">${pptQaText}</div>
                    </div>
                  </td>
        `;
        
        // Add speakers to their respective slot columns with structured format
        const slotData = ['', '', '', '', '', '', '']; // Initialize 7 empty slots
        
        if (speakersArray.length > 0) {
          speakersArray.forEach((speaker: any, speakerIndex: number) => {
            const fullName = speaker.fullName || speaker.name || 'Unknown';
            const title = speaker.title || '';
            const org = speaker.org || '';
            const slot = speaker.slot || 1;
            const location = speaker.location || 'Podium';
            const photoLink = speaker.photoLink || speaker.photoUrl || '';
            const locationPrefix = location === 'Podium' ? 'P' : location === 'Seat' ? 'S' : 'V';
            
            // Truncate title and org to keep layout consistent, but allow full names
            const truncatedTitle = truncateText(title, 15);
            const truncatedOrg = truncateText(org, 15);
            
            console.log(`    Processing speaker ${speakerIndex + 1} (${fullName}): photoLink="${photoLink}"`);
            
            // Create structured slot content with photo and text
            const nameResult = formatNameForTwoLines(fullName);
            const nameClass = nameResult.needsSmallText ? 'slot-name-small' : 'slot-name';
            let slotContent = `
              <div class="slot-container">
                <div class="slot-top">
                  <div class="slot-photo"><img src="${photoLink || placeholderPhotoUrl}" alt="${fullName}" class="slot-photo-img" /></div>
                  <div class="slot-text">
                    <div class="${nameClass}">${nameResult.html}</div>
                    <div class="slot-title">${truncatedTitle}...</div>
                    <div class="slot-org">${truncatedOrg}...</div>
                  </div>
                </div>
                <div class="slot-role">${location}</div>
              </div>
            `;
            
            // Place speaker in the correct slot column (slot 1-7)
            const slotIndex = Math.min(slot - 1, 6); // Ensure it's within 0-6 range
            if (slotIndex >= 0 && slotIndex < 7) {
              slotData[slotIndex] = slotContent;
            }
          });
        }
        
        // Add the 7 slot columns
        for (let i = 0; i < 7; i++) {
          content += `<td class="slot-cell">${slotData[i] || ''}</td>`;
        }
        
        content += `
                </tr>
                <tr class="notes-header-row">
                  <td colspan="11" class="notes-header-cell">NOTES</td>
                </tr>
                <tr class="notes-content-row">
                  <td colspan="11" class="notes-content-cell">${notesHtmlForReport(item.notes)}</td>
                </tr>
              </table>
            </div>
          </div>
        `;
        
      });
      
      content += `
          <div class="footer">
            <p>Generated: ${new Date().toLocaleString()} | Run of Show Application</p>
          </div>
        </body>
        </html>
      `;
      
      return content;
    } else if (isSpeakers) {
      // Generate speakers report format - photos and roles only
      let content = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>ROS Show File - ${event?.name || 'Event'}</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 0; 
              padding: 15px;
              font-size: 11px;
              line-height: 1.3;
              background: white;
            }
            @media print {
              body { 
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              * {
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            .header { 
              text-align: center; 
              margin-bottom: 15px; 
            }
            .header h1 { 
              font-size: 16px; 
              margin: 0; 
              color: #000;
              font-weight: normal;
            }
            .header h2 { 
              font-size: 12px; 
              margin: 3px 0 0 0; 
              color: #333; 
              font-weight: normal;
            }
            .event-info { 
              background: #f5f5f5; 
              padding: 8px; 
              margin-bottom: 12px; 
              font-size: 10px;
              border: 1px solid #ddd;
            }
            .section { 
              margin-bottom: 8px; 
              border: 1px solid #000;
              page-break-inside: avoid;
            }
            .section-header { 
              padding: 6px 8px; 
              font-weight: normal; 
              font-size: 11px;
              color: white;
              background: #366092;
              border-bottom: 1px solid #000;
            }
            .section-content { 
              padding: 0; 
              background: white;
            }
            .modal-table { 
              width: 100%;
              border-collapse: collapse;
              border: 2px solid #000;
              background: white;
            }
            .modal-table td { 
              border: 1px solid #000; 
              padding: 6px 8px; 
              background: white;
              vertical-align: top;
            }
            .modal-table .header-cell { 
              background: #d9d9d9; 
              font-weight: normal; 
              text-align: center;
              font-size: 10px;
              width: 70px;
              min-width: 70px;
            }
            .modal-table .segment-cell { 
              min-width: 180px;
              max-width: 250px;
              word-wrap: break-word;
              font-size: 11px;
            }
            .modal-table .notes-cell { 
              background: #f0f0f0; 
              min-height: 35px;
              min-width: 200px;
              font-size: 10px;
            }
            .modal-table         .participants-cell { 
          background: #f0f0f0; 
          min-height: 60px;
          min-width: 600px;
          width: 600px;
          max-width: 600px;
        }
            .modal-table .start-time-cell { 
              background: #e7f3ff; 
              font-weight: normal;
              font-size: 12px;
            }
            .times-cell {
              background: #e7f3ff;
              font-weight: normal;
              text-align: center;
              vertical-align: middle;
              width: 80px;
              min-width: 80px;
            }
            .times-content {
              display: flex;
              flex-direction: column;
              gap: 2px;
            }
            .start-time {
              font-size: 11px;
              font-weight: normal;
              color: #000;
            }
            .duration {
              font-size: 11px;
              font-weight: normal;
              color: #000;
            }
            .time-label {
              font-size: 9px;
              font-weight: normal;
              color: #333;
              margin-right: 4px;
            }
            .simple-table { 
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              background: white;
            }
            .simple-table td { 
              border: 1px solid #000; 
              padding: 8px; 
              background: white;
              vertical-align: top;
              font-size: 11px;
            }
        .simple-table .header-cell { 
          background: #d9d9d9; 
          font-weight: normal; 
          text-align: center;
          font-size: 10px;
        }
        /* Fixed CUE column (first column) for print */
        .simple-table td:nth-child(1),
        .simple-table tr:first-child td:nth-child(1) {
          width: 105px;
          min-width: 105px;
          max-width: 105px;
          box-sizing: border-box;
        }
        .stacked-header {
          width: 300px;
        }
        .stacked-cell {
          width: 300px;
          max-width: 300px;
          vertical-align: top;
          padding: 8px;
        }
        .stacked-item {
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid #e0e0e0;
          display: flex;
          flex-direction: column;
        }
        .stacked-item:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        .stacked-label {
          font-weight: normal;
          font-size: 9px;
          color: #333;
          margin-bottom: 3px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .stacked-value {
          font-size: 10px;
          line-height: 1.3;
          word-wrap: break-word;
          color: #000;
          padding-left: 4px;
        }
        .slot-cell {
          width: 75px;
          height: 155px;
          vertical-align: top;
          min-width: 75px;
          max-width: 75px;
        }
        .slot-container {
          height: 155px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 4px;
        }
        .slot-top {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .slot-name {
          font-weight: normal;
          font-size: 11px;
          line-height: 1.2;
        }
        .slot-title {
          font-size: 10px;
          line-height: 1.1;
          color: #666;
        }
        .slot-org {
          font-size: 10px;
          line-height: 1.1;
          color: #666;
        }
        .slot-photo {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 8px;
        }
        .slot-photo-img {
          width: 50px;
          height: 65px;
          object-fit: cover;
          border-radius: 4px;
          border: 1px solid #ccc;
          margin: 0 auto;
        }
        .slot-text {
          margin-top: 4px;
          text-align: center;
          font-size: 9px;
          line-height: 1.2;
          color: #000;
          max-height: 90px;
          overflow: hidden;
        }
        .slot-name {
          font-weight: bold;
          font-size: 8px;
          margin-bottom: 2px;
          white-space: normal;
          word-wrap: break-word;
          text-align: center;
          line-height: 1.0;
          max-height: 18px;
          overflow: hidden;
        }
        .slot-name-small {
          font-weight: bold;
          font-size: 7px;
          margin-bottom: 2px;
          white-space: normal;
          word-wrap: break-word;
          text-align: center;
          line-height: 1.0;
          max-height: 16px;
          overflow: hidden;
        }
        .slot-title {
          font-size: 8px;
          color: #333;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .slot-org {
          font-size: 8px;
          color: #666;
          margin-bottom: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .slot-role {
          font-size: 8px;
          color: #000;
          font-weight: bold;
          background-color: #f0f0f0;
          border: 1px solid #ccc;
          border-radius: 3px;
          padding: 1px 3px;
          margin-top: 2px;
          white-space: normal;
          word-wrap: break-word;
          text-align: center;
          min-height: 10px;
        }
        .notes-header-row {
          background: #e0e0e0;
        }
        .notes-header-cell {
          padding: 6px 8px;
          font-size: 10px;
          font-weight: normal;
          text-align: center;
          border-top: 2px solid #ddd;
          background: #e0e0e0;
        }
        .notes-content-row {
          background: #f9f9f9;
        }
        .notes-content-cell {
          padding: 8px;
          font-size: 10px;
          line-height: 1.3;
          background: #f9f9f9;
        }
        ${reportNotesListCss}
            .modal-cell .field-label { 
              font-weight: normal; 
              font-size: 11px; 
              color: #333; 
              margin-bottom: 4px;
            }
            .modal-cell .field-value { 
              font-size: 12px; 
              color: #000;
              line-height: 1.3;
            }
            .speaker-item { 
              display: flex; 
              align-items: center; 
              margin-bottom: 6px;
              padding: 6px;
              background: white;
              border: 1px solid #ddd;
              border-radius: 4px;
              box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            .speaker-photo { 
              width: 40px; 
              height: 40px; 
              border-radius: 4px; 
              object-fit: cover; 
              border: 2px solid #007acc;
              margin-right: 10px;
              flex-shrink: 0;
            }
            .speaker-info { 
              flex: 1;
            }
            .speaker-badges { 
              display: flex; 
              gap: 4px;
              margin-bottom: 3px;
            }
            .speaker-name { 
              font-weight: normal; 
              font-size: 11px; 
              color: #000;
              margin-bottom: 2px;
            }
            .slot-badge { 
              background: #007acc; 
              color: white; 
              padding: 2px 6px; 
              border-radius: 6px; 
              font-size: 8px; 
              font-weight: normal;
            }
            .location-badge { 
              background: #28a745; 
              color: white; 
              padding: 2px 6px; 
              border-radius: 6px; 
              font-size: 8px; 
              font-weight: normal;
            }
            .speaker-title { 
              color: #666; 
              font-size: 10px;
              margin-bottom: 1px;
            }
            .speaker-org { 
              color: #888; 
              font-size: 9px;
            }
            .footer { 
              margin-top: 40px; 
              text-align: center; 
              color: #666; 
              font-size: 12px;
              border-top: 1px solid #ddd;
              padding-top: 20px;
            }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
              @page { 
                size: A4 ${orientation}; 
                margin: 0.2in; 
              }
              .section { 
                page-break-inside: avoid;
              }
            }
            /* Speaker subtext styling - smaller font for titles and organizations */
            .speaker-subtext {
              font-size: 10px;
              color: #000;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>ROS SPEAKERS</h1>
            <h2>${event?.name || 'Event'}${(event?.numberOfDays && event.numberOfDays > 1) ? ` - Day ${selectedDay}` : ''}</h2>
          </div>
          <div class="event-info">
            <p><strong>Date:</strong> ${displayDate} | <strong>Location:</strong> ${event?.location || 'Not specified'} | <strong>Start Time:</strong> ${formatMasterStartTime(masterStartTime)} | <strong>Total Items:</strong> ${schedule.length} | <strong>Day:</strong> ${selectedDay}</p>
          </div>
          
      `;
      
      filteredSchedule.forEach((item, index) => {
        // Find the original index in the full schedule for accurate time calculation
        const originalIndex = schedule.findIndex(s => s.id === item.id);
        const startTime = calculateStartTime(originalIndex);
        const duration = `${item.durationHours.toString().padStart(2, '0')}:${item.durationMinutes.toString().padStart(2, '0')}:${item.durationSeconds.toString().padStart(2, '0')}`;
        const programColor = getProgramTypeColor(item.programType || '');
        
        console.log(`SPEAKERS - Item ${index} (${item.segmentName}):`, {
          originalIndex,
          startTime,
          duration,
          masterStartTime,
          itemId: item.id
        });
        
        // Parse speakers if they exist
        let speakersArray = [];
        if (item.speakersText) {
          try {
            speakersArray = JSON.parse(item.speakersText);
            console.log(`Speakers parsed for item ${index}:`, speakersArray);
          } catch (error) {
            console.log(`Error parsing speakers for item ${index}:`, error);
            // If parsing fails, treat as simple string
            speakersArray = [{ fullName: item.speakersText, title: '', org: '', photoLink: '' }];
          }
        } else {
          console.log(`No speakersText for item ${index}:`, item.segmentName);
        }
        
        // Combine PPT and Q&A
        let pptQaText = '';
        if (item.hasPPT && item.hasQA) {
          pptQaText = 'PPT + Q&A';
        } else if (item.hasPPT) {
          pptQaText = 'PPT';
        } else if (item.hasQA) {
          pptQaText = 'Q&A';
        } else {
          pptQaText = 'None';
        }
        
        content += `
          <div class="section">
            <div class="section-content">
              <table class="simple-table">
                <tr>
                  <td class="header-cell">CUE & TIME</td>
                  <td class="header-cell stacked-header">SEGMENT INFO</td>
                  <td class="header-cell">PARTICIPANTS</td>
                  <td class="header-cell">SLOT 1</td>
                  <td class="header-cell">SLOT 2</td>
                  <td class="header-cell">SLOT 3</td>
                  <td class="header-cell">SLOT 4</td>
                  <td class="header-cell">SLOT 5</td>
                  <td class="header-cell">SLOT 6</td>
                  <td class="header-cell">SLOT 7</td>
                </tr>
                <tr>
                  <td class="times-cell">
                    <div style="margin-bottom: 4px; font-weight: bold;">${formatCueDisplay(item.customFields?.cue) || `CUE ${index + 1}`}</div>
                    <div style="background-color: ${programColor}; color: ${item.programType === 'Sub Cue' ? 'black' : 'white'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: normal; display: inline-block; width: fit-content; ${item.programType === 'Sub Cue' ? 'border: 1px solid #000000;' : ''}">${formatProgramTypeLabel(item.programType) || 'Unknown'}</div>
                    <div class="times-content" style="margin-top: 6px;">
                      <div class="start-time">
                        <span class="time-label">Start:</span> ${startTime}
                      </div>
                      <div class="duration">
                        <span class="time-label">Dur:</span> ${duration}
                      </div>
                    </div>
                  </td>
                  <td class="stacked-cell">
                    <div class="stacked-item">
                      <div class="stacked-label">SEGMENT:</div>
                      <div class="stacked-value">${item.segmentName || 'Untitled Segment'}</div>
                    </div>
                    <div class="stacked-item">
                      <div class="stacked-label">SHOT:</div>
                      <div class="stacked-value">${item.shotType || 'Not specified'}</div>
                    </div>
                    <div class="stacked-item">
                      <div class="stacked-label">PPT/Q&A:</div>
                      <div class="stacked-value">${pptQaText}</div>
                    </div>
                  </td>
                  <td class="participants-cell">
        `;
        
        // Parse speakers for participants column (like condensed report)
        let participantsText = '';
        if (speakersArray.length > 0) {
          participantsText = speakersArray.map((s: any) => {
            const fullName = s.fullName || s.name || s;
            const title = s.title || '';
            const org = s.org || '';
            const location = s.location || 'Podium';
            const slot = s.slot || 1;
            const locationPrefix = location === 'Podium' ? 'P' : location === 'Seat' ? 'S' : 'V';
            
            // Build speaker info with bold names and smaller subtext (like condensed report)
            let speakerInfo = `<strong>${locationPrefix}${slot} - ${fullName}</strong>`;
            if (title || org) {
              const titleOrg = [title, org].filter(Boolean).join(', ');
              speakerInfo += `<br><span class="speaker-subtext">${titleOrg}</span>`;
            }
            return speakerInfo;
          }).join('<br><br>'); // Better separation between speakers
        }
        
        content += participantsText || 'No speakers assigned';
        content += `
                  </td>
        `;
        
        // Add speakers to their respective slot columns with simplified format (photos and roles only)
        const slotData = ['', '', '', '', '', '', '']; // Initialize 7 empty slots
        
        if (speakersArray.length > 0) {
          speakersArray.forEach((speaker: any, speakerIndex: number) => {
            const fullName = speaker.fullName || speaker.name || 'Unknown';
            const title = speaker.title || '';
            const org = speaker.org || '';
            const slot = speaker.slot || 1;
            const location = speaker.location || 'Podium';
            const photoLink = speaker.photoLink || speaker.photoUrl || '';
            const locationPrefix = location === 'Podium' ? 'P' : location === 'Seat' ? 'S' : 'V';
            
            // Truncate title and org to keep layout consistent, but allow full names
            const truncatedTitle = truncateText(title, 15);
            const truncatedOrg = truncateText(org, 15);
            
            console.log(`    Processing speaker ${speakerIndex + 1} (${fullName}): photoLink="${photoLink}"`);
            
            // Create simplified slot content with only photo and role for speakers report
            let slotContent = `
              <div class="slot-container">
                <div class="slot-top">
                  <div class="slot-photo"><img src="${photoLink || placeholderPhotoUrl}" alt="${fullName}" class="slot-photo-img" /></div>
                </div>
                <div class="slot-role">${location}</div>
              </div>
            `;
            
            // Place speaker in the correct slot column (slot 1-7)
            const slotIndex = Math.min(slot - 1, 6); // Ensure it's within 0-6 range
            if (slotIndex >= 0 && slotIndex < 7) {
              slotData[slotIndex] = slotContent;
            }
          });
        }
        
        // Add the 7 slot columns
        for (let i = 0; i < 7; i++) {
          content += `<td class="slot-cell">${slotData[i] || ''}</td>`;
        }
        
        content += `
                </tr>
                <tr class="notes-header-row">
                  <td colspan="11" class="notes-header-cell">NOTES</td>
                </tr>
                <tr class="notes-content-row">
                  <td colspan="11" class="notes-content-cell">${notesHtmlForReport(item.notes)}</td>
                </tr>
              </table>
            </div>
          </div>
        `;
        
      });
      
      content += `
          <div class="footer">
            <p>Generated: ${new Date().toLocaleString()} | Run of Show Application</p>
          </div>
        </body>
        </html>
      `;
      
      return content;
    } else {
      // Generate condensed table format
      let content = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Run of Show Report - ${event?.name || 'Event'}</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              margin: 20px; 
              font-size: 14px;
            }
            .header { 
              text-align: center; 
              margin-bottom: 16px; 
            }
            .header h1 { 
              font-size: 24px; 
              margin: 0; 
            }
            .header h2 { 
              font-size: 18px; 
              margin: 5px 0 0 0; 
              color: #666; 
            }
            .event-info { 
              background: #f5f5f5; 
              padding: 15px; 
              border-radius: 5px; 
              margin-bottom: 12px; 
              font-size: 12px;
              text-align: center;
            }
            .color-legend {
              margin-bottom: 20px;
              margin-top: 0;
              padding: 12px 15px;
              background: #fafafa;
              border: 1px solid #e5e5e5;
              border-radius: 5px;
              font-size: 11px;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .color-legend-title { margin: 0 0 10px 0; color: #333; }
            .color-legend-rows {
              display: flex;
              flex-wrap: wrap;
              gap: 8px 12px;
            }
            .color-legend-row {
              padding: 6px 12px;
              border-radius: 4px;
              font-weight: 500;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            table { 
              width: 100%; 
              border-collapse: collapse; 
              margin-top: 20px; 
            }
            th, td { 
              border: 1px solid #ddd; 
              padding: 8px; 
              text-align: left; 
              font-size: 12px;
            }
            /* Column width specifications */
            th:nth-child(1), td:nth-child(1) { width: 8%; }  /* CUE */
            th:nth-child(2), td:nth-child(2) { width: 8%; } /* START */
            th:nth-child(3), td:nth-child(3) { width: 8%; } /* DURATION */
            th:nth-child(4), td:nth-child(4) { width: 20%; } /* SEGMENT */
            th:nth-child(5), td:nth-child(5) { width: 10%; } /* SHOT/PPT */
            th:nth-child(6), td:nth-child(6) { width: 26%; } /* PARTICIPANTS */
            th:nth-child(7), td:nth-child(7) { width: 20%; } /* NOTES */
            
            /* Speaker subtext styling - smaller font for titles and organizations */
            .speaker-subtext {
              font-size: 10px;
              color: #000;
            }
            th { 
              background-color: #f2f2f2; 
              font-weight: normal; 
            }
            tr { 
              -webkit-print-color-adjust: exact !important;
              color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            ${reportNotesListCss}
            .footer { 
              margin-top: 30px; 
              text-align: center; 
              color: #666; 
              font-size: 12px;
            }
            @media print {
              body { margin: 0; }
              .no-print { display: none; }
              @page { 
                size: A4 ${orientation}; 
                margin: 0.2in; 
              }
              tr { 
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>RUN OF SHOW REPORT - CONDENSED</h1>
            <h2>${event?.name || 'Event'}${(event?.numberOfDays && event.numberOfDays > 1) ? ` - Day ${selectedDay}` : ''}</h2>
          </div>
          
          <div class="event-info">
            <p><strong>Date:</strong> ${displayDate} | 
               <strong>Location:</strong> ${event?.location || 'Not specified'} | 
               <strong>Start Time:</strong> ${formatMasterStartTime(masterStartTime)} | 
               <strong>Total Items:</strong> ${schedule.length} | <strong>Day:</strong> ${selectedDay}</p>
          </div>
          
          <div class="color-legend">
            <p class="color-legend-title"><strong>Color coding</strong> — CUE label/badge color or row background (matches table below):</p>
            <div class="color-legend-rows">
              ${condensedColorLegend.map(({ label, key }) => {
                const legendColor = getLegendOrBadgeColor(key);
                const isLight = legendColor === '#FFFFFF' || legendColor === '#F3F4F6' || legendColor === '#D3D3D3' || legendColor === '#F59E0B';
                const textColor = isLight ? '#333' : '#fff';
                return `<div class="color-legend-row" style="background-color: ${legendColor}; color: ${textColor}; border: 1px solid #999;">${label}</div>`;
              }).join('')}
            </div>
          </div>
          
          <table>
            <thead>
              <tr>
                <th>CUE</th>
                <th>START</th>
                <th>DURATION</th>
                <th>SEGMENT</th>
                <th>SHOT/PPT</th>
                <th>PARTICIPANTS</th>
                <th>NOTES</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      filteredSchedule.forEach((item, index) => {
        // Find the original index in the full schedule for accurate time calculation
        const originalIndex = schedule.findIndex(s => s.id === item.id);
        const startTime = calculateStartTime(originalIndex);
        const duration = `${item.durationHours.toString().padStart(2, '0')}:${item.durationMinutes.toString().padStart(2, '0')}:${item.durationSeconds.toString().padStart(2, '0')}`;
        const programColor = getProgramTypeColor(item.programType || '');
        
        // Parse speakers if they exist
        let speakersText = '';
        if (item.speakersText) {
          try {
            const speakersArray = JSON.parse(item.speakersText);
            speakersText = speakersArray.map((s: any) => {
              const fullName = s.fullName || s.name || s;
              const title = s.title || '';
              const org = s.org || '';
              const location = s.location || 'Podium';
              const slot = s.slot || 1;
              const locationPrefix = location === 'Podium' ? 'P' : location === 'Seat' ? 'S' : 'V';
              
              // Build speaker info with bold names and smaller subtext
              let speakerInfo = `<strong>${locationPrefix}${slot} - ${fullName}</strong>`;
              if (title || org) {
                const titleOrg = [title, org].filter(Boolean).join(', ');
                speakerInfo += `<br><span class="speaker-subtext">${titleOrg}</span>`;
              }
              return speakerInfo;
            }).join('<br><br>'); // Better separation between speakers
          } catch {
            speakersText = item.speakersText;
          }
        }
        
        // Combine ShotType and PPT/Q&A into one column
        let shotPptText = '';
        const shotType = item.shotType || '';
        let pptQaText = '';
        if (item.hasPPT && item.hasQA) {
          pptQaText = 'PPT + Q&A';
        } else if (item.hasPPT) {
          pptQaText = 'PPT';
        } else if (item.hasQA) {
          pptQaText = 'Q&A';
        } else {
          pptQaText = '';
        }
        
        // Combine shot type and PPT/Q&A
        if (shotType && pptQaText) {
          shotPptText = `${shotType} | ${pptQaText}`;
        } else if (shotType) {
          shotPptText = shotType;
        } else if (pptQaText) {
          shotPptText = pptQaText;
        } else {
          shotPptText = '';
        }
        
        const cueDisplay = formatCueDisplay(item.customFields?.cue);
        const cueBadge = item.programType === 'Sub Cue'
          ? `<span style="background-color: #9CA3AF; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${cueDisplay}</span>`
          : (item.programType === 'Podium' || item.programType === 'Podium Transition')
            ? `<span style="background-color: #8B4513; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${cueDisplay}</span>`
            : (item.programType === 'Panel' || item.programType === 'Panel Transition')
              ? `<span style="background-color: #404040; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${cueDisplay}</span>`
              : item.programType === 'Panel+Remote'
                ? `<span style="background-color: ${programColor}; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${cueDisplay}</span>`
                : item.programType === 'Full-Stage/Ted-Talk'
                  ? `<span style="background-color: #EA580C; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${cueDisplay}</span>`
                  : cueDisplay;
        content += `
          <tr style="background-color: ${getRowBackgroundColor(item.programType)};">
            <td>${cueBadge}</td>
            <td>${startTime}</td>
            <td>${duration}</td>
            <td>${item.segmentName || 'Untitled Segment'}</td>
            <td>${shotPptText}</td>
            <td style="white-space: pre-line;">${speakersText}</td>
            <td class="report-notes-cell" style="font-size: 12px;">${notesHtmlForReport(item.notes)}</td>
          </tr>
        `;
      });
      
      content += `
            </tbody>
          </table>
          
          <div class="footer">
            <p>Generated: ${new Date().toLocaleString()} | Run of Show Application</p>
          </div>
        </body>
        </html>
      `;
      
      return content;
    }
  };

  const printReport = () => {
    const content = generateReportContent();
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(content);
      printWindow.document.close();
      // Wait for document and all images to load before opening print dialog
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };
    }
  };

  const downloadReport = () => {
    const content = generateReportContent();
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ros-${reportType === 'showfile' ? 'show-file' : reportType === 'speakers' ? 'speakers' : 'condensed'}${(event?.numberOfDays && event.numberOfDays > 1) ? `-day-${selectedDay}` : ''}-${event?.name?.replace(/\s+/g, '-') || 'event'}-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white pt-16">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => {
                  // Close the current tab/window
                  window.close();
                }}
                className="text-slate-300 hover:text-white transition-colors mr-6"
              >
                ← Back to Run of Show
              </button>
              <h1 className="text-xl font-semibold">Reports and Printing</h1>
            </div>
            <div className="text-slate-400">
              {event?.name || 'Event'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-slate-800 rounded-xl p-8 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-6">Generate Reports</h2>
          
          {/* Report Options */}
          <div className="bg-slate-700 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-white mb-4">Report Options</h3>
            
            <div className="relative">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Side - Report Options */}
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Report Type
                    </label>
                    <select
                      value={reportType}
                      onChange={(e) => setReportType(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="showfile">ROS Show</option>
                      <option value="speakers">ROS Speakers</option>
                      <option value="condensed">ROS CONDENSED</option>
                    </select>
                  </div>
                  
                  {/* Print Orientation */}
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">
                      Print Orientation
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                        printOrientation === 'portrait' 
                          ? 'border-blue-500 bg-blue-500/20 text-blue-300' 
                          : 'border-slate-500 bg-slate-600/50 text-slate-300 hover:border-slate-400 hover:bg-slate-600/70'
                      }`}>
                        <input
                          type="radio"
                          name="orientation"
                          value="portrait"
                          checked={printOrientation === 'portrait'}
                          onChange={(e) => setPrintOrientation(e.target.value as 'portrait' | 'landscape')}
                          className="sr-only"
                        />
                        <div className="flex flex-col items-center">
                          <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="18" height="24" rx="2" strokeWidth="2"/>
                            <path d="M8 7h8M8 11h8M8 15h4" strokeWidth="1.5"/>
                          </svg>
                          <span className="text-sm font-medium">Portrait</span>
                        </div>
                      </label>
                      
                      <label className={`flex items-center justify-center p-3 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
                        printOrientation === 'landscape' 
                          ? 'border-blue-500 bg-blue-500/20 text-blue-300' 
                          : 'border-slate-500 bg-slate-600/50 text-slate-300 hover:border-slate-400 hover:bg-slate-600/70'
                      }`}>
                        <input
                          type="radio"
                          name="orientation"
                          value="landscape"
                          checked={printOrientation === 'landscape'}
                          onChange={(e) => setPrintOrientation(e.target.value as 'portrait' | 'landscape')}
                          className="sr-only"
                        />
                        <div className="flex flex-col items-center">
                          <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="24" height="18" rx="2" strokeWidth="2"/>
                            <path d="M7 8h10M7 12h10M7 16h6" strokeWidth="1.5"/>
                          </svg>
                          <span className="text-sm font-medium">Landscape</span>
                        </div>
                      </label>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      {printOrientation === 'landscape' 
                        ? 'Recommended for tables and wide content' 
                        : 'Better for text-heavy documents'
                      }
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Select date / day
                    </label>
                    <select
                      value={Math.min(selectedDay, reportDaysCount)}
                      onChange={(e) => setSelectedDay(parseInt(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {reportDayOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {/* Right Side - Report Format Information */}
                <div className="flex items-center justify-center h-full">
                  <div className="bg-slate-600/30 rounded-lg p-4 border border-slate-500 w-full max-w-[31rem]">
                    <h4 className="text-lg font-semibold text-white mb-3 text-center">Report Format Information</h4>
                    <div className="space-y-2 text-sm">
                      <p><span className="text-blue-300 text-base">● ROS Show:</span> Section-based format with speaker photos</p>
                      <p><span className="text-orange-300 text-base">● ROS Speakers:</span> Section-based format with dedicated speaker column</p>
                      <p><span className="text-green-300 text-base">● ROS CONDENSED:</span> Table format with all information</p>
                      <p><span className="text-purple-300 text-base">● Color Coding:</span> Sections colored by program type</p>
                    </div>
                  </div>
                </div>
              </div>
              
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-4">
            <button
              onClick={printReport}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Report
            </button>
            
            <button
              onClick={downloadReport}
              className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Report
            </button>

            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                onClick={() => refreshReportData()}
                disabled={isRefreshing}
                className={`px-6 py-3 font-medium rounded-lg transition-all duration-300 flex items-center gap-2 ${
                  isRefreshing
                    ? 'bg-slate-600 text-white opacity-60 cursor-not-allowed'
                    : 'bg-slate-600 hover:bg-slate-500 text-white'
                }`}
                title="Reload schedule and settings from storage / API"
              >
                {isRefreshing ? (
                  <>
                    <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Refreshing…
                  </>
                ) : refreshSuccessAt ? (
                  <>
                    <svg className="w-5 h-5 flex-shrink-0 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Refreshed!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh data
                  </>
                )}
              </button>
              {refreshSuccessAt && (
                <span className="text-green-400 text-xs font-medium transition-opacity duration-300">
                  Schedule and settings reloaded
                </span>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-white mb-4">Report Preview</h3>
            <div className="bg-slate-700 rounded-lg p-4 max-h-96 overflow-y-auto">
              <div className="text-slate-300 text-sm">
                <p><strong>Event:</strong> {event?.name || 'Current Event'}</p>
                <p><strong>Total Items:</strong> {schedule.length}{(event?.numberOfDays && event.numberOfDays > 1) ? ` | <strong>Day ${selectedDay} Items:</strong> ${schedule.filter(item => (item.day || 1) === selectedDay).length}` : ''}</p>
                <p><strong>Master Start Time:</strong> {formatMasterStartTime(masterStartTime)}</p>
                <p><strong>Report Type:</strong> {reportType === 'showfile' ? 'ROS Show' : reportType === 'speakers' ? 'ROS Speakers' : 'ROS CONDENSED'}</p>
                <p><strong>Format:</strong> {reportType === 'showfile' ? 'Section-based with speaker photos' : reportType === 'speakers' ? 'Section-based with dedicated speaker column' : 'Table format'}</p>
                <p><strong>Orientation:</strong> {printOrientation === 'landscape' ? 'Landscape (recommended for tables)' : 'Portrait'}</p>
                <p><strong>Color Coding:</strong> Sections colored by program type</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportsPage;