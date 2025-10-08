import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Event } from '../types/Event';

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
  const eventId = urlParams.get('eventId');
  const eventName = urlParams.get('eventName');
  
  const event: Event = location.state?.event || {
    id: eventId || '',
    name: eventName || 'Current Event',
    date: '',
    location: '',
    schedule: []
  };
  
  // Debug logging
  console.log('ReportsPage event data:', {
    fromState: !!location.state?.event,
    eventId,
    eventName,
    finalEvent: event,
    userRole: localStorage.getItem('currentUserRole')
  });
  
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [masterStartTime, setMasterStartTime] = useState('');
  const [reportType, setReportType] = useState('showfile');
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>('landscape');

  // Load schedule data
  useEffect(() => {
    console.log('=== REPORTS PAGE INITIALIZATION ===');
    console.log('Event:', event);
    
    // Load schedule data
    let savedSchedule = null;
    
    if (event?.id) {
      const scheduleKey = `runOfShowSchedule_${event.id}`;
      savedSchedule = localStorage.getItem(scheduleKey);
    }
    
    if (!savedSchedule && eventId) {
      const urlScheduleKey = `runOfShowSchedule_${eventId}`;
      savedSchedule = localStorage.getItem(urlScheduleKey);
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
        const parsedSchedule = JSON.parse(savedSchedule);
        setSchedule(parsedSchedule);
        console.log('Schedule loaded:', parsedSchedule);
        console.log('First schedule item:', parsedSchedule[0]);
        console.log('Schedule item duration fields:', parsedSchedule[0] ? {
          durationHours: parsedSchedule[0].durationHours,
          durationMinutes: parsedSchedule[0].durationMinutes,
          durationSeconds: parsedSchedule[0].durationSeconds
        } : 'No items');
      } catch (error) {
        console.log('Error parsing schedule:', error);
      }
    }
    
    // Load master start time
    const keys = Object.keys(localStorage);
    const masterTimeKeys = keys.filter(key => key.startsWith('masterStartTime_'));
    console.log('Master time keys found:', masterTimeKeys);
    
    // Try to get master start time for the specific event first
    let savedMasterTime = null;
    if (event?.id) {
      savedMasterTime = localStorage.getItem(`masterStartTime_${event.id}`);
      console.log(`Master time for event ${event.id}:`, savedMasterTime);
    }
    
    // If not found for specific event, try the latest one
    if (!savedMasterTime && masterTimeKeys.length > 0) {
      const latestMasterKey = masterTimeKeys[masterTimeKeys.length - 1];
      savedMasterTime = localStorage.getItem(latestMasterKey);
      console.log('Latest master time key:', latestMasterKey, 'Value:', savedMasterTime);
    }
    
    if (savedMasterTime) {
      setMasterStartTime(savedMasterTime);
      console.log('Master start time set to:', savedMasterTime);
    } else {
      console.log('No master start time found in localStorage');
      // Set a default time for testing
      setMasterStartTime('09:00');
      console.log('Set default master start time to 09:00');
    }
  }, [event?.id, eventId]);

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

  // Calculate start time function (same as RunOfShowPage)
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
      'Sub Cue': '#F3F4F6',           // White with border
      'No Transition': '#059669',      // Bright Teal
      'Video': '#F59E0B',              // Bright Yellow/Orange
      'Panel+Remote': '#1E40AF',       // Darker Blue
      'Remote Only': '#60A5FA',        // Light Blue
      'Break': '#EC4899',              // Bright Pink
      'TBD': '#6B7280',                // Medium Gray
      'KILLED': '#DC2626',             // Bright Red
      'Podium': '#FFFFFF',             // White (no highlighting)
      'Panel': '#FFFFFF',              // White (no highlighting)
    };
    return colors[programType] || '#D3D3D3'; // Light gray default
  };

  // Get row background color (white for Panel/Podium, colored for others)
  const getRowBackgroundColor = (programType: string) => {
    // Panel Transition and Podium Transition should have white backgrounds
    if (programType === 'Panel Transition' || programType === 'Podium Transition' || 
        programType === 'Panel' || programType === 'Podium') {
      return '#FFFFFF'; // White background
    }
    // All other types get their program type color as background
    return getProgramTypeColor(programType);
  };

  // Generate report content
  const generateReportContent = () => {
    const isShowFile = reportType === 'showfile';
    const isSpeakers = reportType === 'speakers';
    const orientation = printOrientation;
    
    // Filter schedule by selected day (fallback to day 1 if no day field)
    const filteredSchedule = schedule.filter(item => (item.day || 1) === selectedDay);
    
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
                    <div style="margin-bottom: 4px;">${item.customFields.cue || `CUE ${index + 1}`}</div>
                    <div style="background-color: ${programColor}; color: ${item.programType === 'Sub Cue' ? 'black' : 'white'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: normal; display: inline-block; ${item.programType === 'Sub Cue' ? 'border: 1px solid #000000;' : ''}">${item.programType || 'Unknown'}</div>
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
                  <div class="slot-photo">${photoLink ? `<img src="${photoLink}" alt="${fullName}" class="slot-photo-img" />` : ''}</div>
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
                  <td colspan="11" class="notes-content-cell">${item.notes || 'None'}</td>
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
                    <div style="margin-bottom: 4px; font-weight: bold;">${item.customFields.cue || `CUE ${index + 1}`}</div>
                    <div style="background-color: ${programColor}; color: ${item.programType === 'Sub Cue' ? 'black' : 'white'}; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: normal; display: inline-block; ${item.programType === 'Sub Cue' ? 'border: 1px solid #000000;' : ''}">${item.programType || 'Unknown'}</div>
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
                  <div class="slot-photo">${photoLink ? `<img src="${photoLink}" alt="${fullName}" class="slot-photo-img" />` : ''}</div>
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
                  <td colspan="11" class="notes-content-cell">${item.notes || 'None'}</td>
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
              margin-bottom: 30px; 
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
              margin-bottom: 20px; 
              font-size: 12px;
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
            <h1>RUN OF SHOW REPORT</h1>
            <h2>${event?.name || 'Event'}${(event?.numberOfDays && event.numberOfDays > 1) ? ` - Day ${selectedDay}` : ''}</h2>
            <h3>ROS CONDENSED</h3>
          </div>
          
          <div class="event-info">
            <p><strong>Event:</strong> ${event?.name || 'Current Event'} | 
               <strong>Date:</strong> ${event?.date || 'Not specified'} | 
               <strong>Location:</strong> ${event?.location || 'Not specified'} | 
               <strong>Start Time:</strong> ${masterStartTime || 'Not set'} | 
               <strong>Total Items:</strong> ${schedule.length}</p>
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
        
        // Clean up notes for display
        let notesText = '';
        if (item.notes) {
          // Remove HTML tags and clean up the notes
          const cleanNotes = item.notes.replace(/<[^>]*>/g, '').trim();
          if (cleanNotes && cleanNotes.length > 0 && 
              cleanNotes !== 'None' && cleanNotes !== 'null' && cleanNotes !== 'undefined') {
            notesText = cleanNotes;
          }
        }
        
        content += `
          <tr style="background-color: ${getRowBackgroundColor(item.programType)};">
            <td>${item.programType === 'Sub Cue' ? `<span style="background-color: #9CA3AF; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${item.customFields?.cue || ''}</span>` : (item.programType === 'Podium' || item.programType === 'Podium Transition') ? `<span style="background-color: #8B4513; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${item.customFields?.cue || ''}</span>` : (item.programType === 'Panel' || item.programType === 'Panel Transition') ? `<span style="background-color: #404040; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;">${item.customFields?.cue || ''}</span>` : (item.customFields?.cue || '')}</td>
            <td>${startTime}</td>
            <td>${duration}</td>
            <td>${item.segmentName || 'Untitled Segment'}</td>
            <td>${shotPptText}</td>
            <td style="white-space: pre-line;">${speakersText}</td>
            <td style="white-space: pre-line; font-size: 12px;">${notesText}</td>
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
      printWindow.focus();
      printWindow.print();
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
                      <option value="showfile">ROS Show File</option>
                      <option value="condensed">ROS CONDENSED</option>
                      <option value="speakers">ROS Speakers</option>
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
                  
                  {(event?.numberOfDays && event.numberOfDays > 1) && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Select Day
                      </label>
                      <select
                        value={selectedDay}
                        onChange={(e) => setSelectedDay(parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {Array.from({ length: event.numberOfDays }, (_, i) => (
                          <option key={i + 1} value={i + 1}>Day {i + 1}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                
                {/* Right Side - Report Format Information */}
                <div className="flex items-center justify-center h-full">
                  <div className="bg-slate-600/30 rounded-lg p-4 border border-slate-500 w-full max-w-md">
                    <h4 className="text-lg font-semibold text-white mb-3 text-center">Report Format Information</h4>
                    <div className="space-y-2 text-sm">
                      <p><span className="text-blue-300 text-base">● ROS Show File:</span> Section-based format with speaker photos</p>
                      <p><span className="text-green-300 text-base">● ROS CONDENSED:</span> Table format with all information</p>
                      <p><span className="text-orange-300 text-base">● ROS Speakers:</span> Table format with dedicated speaker column</p>
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
          </div>

          {/* Preview */}
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-white mb-4">Report Preview</h3>
            <div className="bg-slate-700 rounded-lg p-4 max-h-96 overflow-y-auto">
              <div className="text-slate-300 text-sm">
                <p><strong>Event:</strong> {event?.name || 'Current Event'}</p>
                <p><strong>Total Items:</strong> {schedule.length}{(event?.numberOfDays && event.numberOfDays > 1) ? ` | <strong>Day ${selectedDay} Items:</strong> ${schedule.filter(item => (item.day || 1) === selectedDay).length}` : ''}</p>
                <p><strong>Master Start Time:</strong> {formatMasterStartTime(masterStartTime)}</p>
                <p><strong>Report Type:</strong> {reportType === 'showfile' ? 'ROS Show File' : reportType === 'speakers' ? 'ROS Speakers' : 'ROS CONDENSED'}</p>
                <p><strong>Format:</strong> {reportType === 'showfile' ? 'Section-based with speaker photos' : reportType === 'speakers' ? 'Table format with dedicated speaker column' : 'Table format'}</p>
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