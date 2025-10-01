import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

interface LastChangeInfo {
  event_id: string;
  event_name: string;
  last_modified_by: string;
  last_modified_by_name: string;
  last_modified_by_role: string;
  updated_at: string;
  formatted_time: string;
  time_ago: string;
}

interface SimpleChangeLogProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

const SimpleChangeLog: React.FC<SimpleChangeLogProps> = ({ eventId, isOpen, onClose }) => {
  const [lastChange, setLastChange] = useState<LastChangeInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && eventId) {
      fetchLastChange();
    }
  }, [isOpen, eventId]);

  const fetchLastChange = async () => {
    setLoading(true);
    try {
      console.log('🔍 Fetching last change for event:', eventId);
      
      // Query the table directly (skip the SQL function for now)
      const { data: tableData, error: tableError } = await supabase
        .from('run_of_show_data')
        .select('event_id, event_name, last_modified_by, last_modified_by_name, last_modified_by_role, updated_at')
        .eq('event_id', eventId)
        .order('updated_at', { ascending: false })
        .limit(1);
        
      console.log('📊 Table data:', tableData);
      console.log('❌ Table error:', tableError);
      console.log('📊 Table data length:', tableData?.length);
      
      if (tableError) {
        console.error('Error querying table:', tableError);
        return;
      }
      
      if (tableData && tableData.length > 0) {
        const item = tableData[0];
        console.log('✅ Setting last change:', item);
        setLastChange({
          event_id: item.event_id,
          event_name: item.event_name,
          last_modified_by: item.last_modified_by,
          last_modified_by_name: item.last_modified_by_name,
          last_modified_by_role: item.last_modified_by_role,
          updated_at: item.updated_at,
          formatted_time: new Date(item.updated_at).toLocaleString(),
          time_ago: 'Unknown'
        });
      } else {
        console.log('⚠️ No data found in run_of_show_data table');
      }
    } catch (error) {
      console.error('Error fetching last change:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-white">Last Change Info</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ×
          </button>
        </div>

        {loading ? (
          <div className="text-center text-white">Loading...</div>
        ) : lastChange ? (
          <div className="space-y-4">
            <div className="bg-slate-700 p-6 rounded-lg text-center">
              <div className="text-2xl font-bold text-white mb-2">
                {lastChange.last_modified_by_name}
              </div>
              <div className="text-lg text-gray-300">
                {lastChange.formatted_time}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-white">
            No change information available.
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SimpleChangeLog;
