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
import { driftDetector } from '../services/driftDetector';

// Speaker interface/type definition
interface Speaker {
  id: string;
  slot: number;
  location: 'Podium' | 'Seat' | 'Virtual';
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

  // Enhanced change log with local buffer and Supabase sync
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [changeLog, setChangeLog] = useState<LocalChange[]>([]);
  const [masterChangeLog, setMasterChangeLog] = useState<any[]>([]);
  const [showMasterChangeLog, setShowMasterChangeLog] = useState(false);

  // Debounced change tracking
  const [pendingChanges, setPendingChanges] = useState<Map<string, any>>(new Map());
  const changeTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Add a ref to track processed changes to prevent duplicates
  const processedChangesRef = useRef(new Set());

  // === Removed participants modal/state ===
  // speakers modal kept intact
  const [showSpeakersModal, setShowSpeakersModal] = useState(false);
  const [editingSpeakersItem, setEditingSpeakersItem] = useState<number | null>(null);
  const [tempSpeakersText, setTempSpeakersText] = useState<Speaker[]>([]);
  const [tempSpeakers, setTempSpeakers] = useState<Speaker[]>([]);

  // Many other states omitted for brevity (unchanged from original)

  return (
    <div className=\"run-of-show-page\">
      {/* Other UI elements */}
      {showSpeakersModal && (
        <div className=\"modal\">
          {/* Speakers modal content */}
        </div>
      )}
    </div>
  );
};

export default RunOfShowPage;
