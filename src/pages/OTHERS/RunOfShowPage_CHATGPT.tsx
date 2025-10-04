import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Event } from '../types/Event';
import { DatabaseService, TimerMessage } from '../services/database';
import { changeLogService, LocalChange } from '../services/changeLogService';
import { supabase } from '../services/supabase';
import { BackupService, BackupData } from '../services/backupService';
import { useAuth } from '../contexts/AuthContext';
import RoleSelectionModal from '../components/RoleSelectionModal';
import CompleteChangeLog from '../components/CompleteChangeLog';
import DriftStatusIndicator from '../components/DriftStatusIndicator';
import OSCModal from '../components/OSCModal';
import OSCModalSimple from '../components/OSCModalSimple';
import OSCModalSimplified from '../components/OSCModalSimplified';
import DisplayModal from '../components/DisplayModal';
import ExcelImportModal from '../components/ExcelImportModal';
import { driftDetector } from '../services/driftDetector';

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
  const { user, loading: authLoading } = useAuth();

  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);

  return (
    <div className="p-4 overflow-x-auto">
      <table className="table-auto w-full border-collapse">
        <thead>
          <tr className="bg-gray-200">
            <th className="p-2 text-left">Cue</th>
            <th className="p-2 text-left">Segment</th>
            <th className="p-2 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((item) => (
            <tr key={item.id} className="align-top border-b">
              <td className="p-2 align-top">{item.customFields?.cue || 'CUE'}</td>
              <td className="p-2 align-top">{item.segmentName}</td>
              <td className="p-3 align-top whitespace-pre-wrap break-words leading-relaxed h-auto overflow-visible">
                {item.notes || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RunOfShowPage;
