import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

interface ChangeLogEntry {
  id: string;
  event_id: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: string;
  new_value: string;
  description: string;
  row_number: number;
  cue_number: string;
  metadata: any;
  created_at: string;
  formatted_time: string;
  time_ago: string;
}

interface CompleteChangeLogProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

const CompleteChangeLog: React.FC<CompleteChangeLogProps> = ({ eventId, isOpen, onClose }) => {
  const [changes, setChanges] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    if (isOpen && eventId) {
      fetchChanges();
      fetchSummary();
    }
  }, [isOpen, eventId]);

  const fetchChanges = async () => {
    setLoading(true);
    try {
      console.log('🔍 Fetching all changes for event:', eventId);
      
      // First try the RPC function
      const { data, error } = await supabase.rpc('get_change_log', {
        p_event_id: eventId,
        p_limit: 100,
        p_offset: 0
      });
      
      console.log('📊 Changes data from RPC:', data);
      console.log('❌ Changes error from RPC:', error);
      
      if (error) {
        console.log('⚠️ RPC failed, trying direct table query...');
        
        // Fallback: query the table directly
        const { data: tableData, error: tableError } = await supabase
          .from('change_log')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(100);
          
        console.log('📊 Table data:', tableData);
        console.log('❌ Table error:', tableError);
        
        if (tableError) {
          console.error('Error querying table:', tableError);
          return;
        }
        
        // Convert table data to the expected format
        const formattedData = tableData?.map(item => ({
          ...item,
          formatted_time: new Date(item.created_at).toLocaleString(),
          time_ago: 'Unknown'
        })) || [];
        
        setChanges(formattedData);
      } else {
        setChanges(data || []);
      }
    } catch (error) {
      console.error('Error fetching changes:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const { data, error } = await supabase.rpc('get_change_log_summary', {
        p_event_id: eventId
      });
      
      if (error) {
        console.error('Error fetching summary:', error);
        return;
      }
      
      setSummary(data?.[0] || null);
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE':
      case 'ADD_ITEM':
        return 'text-green-400';
      case 'UPDATE':
      case 'FIELD_CHANGE':
        return 'text-blue-400';
      case 'DELETE':
      case 'REMOVE_ITEM':
        return 'text-red-400';
      case 'MOVE':
        return 'text-yellow-400';
      case 'DUPLICATE':
        return 'text-purple-400';
      default:
        return 'text-gray-400';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'CREATE':
      case 'ADD_ITEM':
        return '➕';
      case 'UPDATE':
      case 'FIELD_CHANGE':
        return '✏️';
      case 'DELETE':
      case 'REMOVE_ITEM':
        return '🗑️';
      case 'MOVE':
        return '↕️';
      case 'DUPLICATE':
        return '📋';
      default:
        return '📝';
    }
  };

  const getTableDisplayName = (tableName: string) => {
    switch (tableName) {
      case 'schedule_items': return 'Schedule Item';
      case 'custom_columns': return 'Custom Column';
      case 'settings': return 'Settings';
      case 'run_of_show_data': return 'Run of Show';
      default: return tableName;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">Change History</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Summary */}
        {summary && (
          <div className="bg-slate-700 p-6 rounded-lg mx-6 mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
              <div className="text-center">
                <div className="text-slate-300 text-xs uppercase tracking-wide mb-1">Total Changes</div>
                <div className="text-white font-bold text-2xl">{summary.total_changes}</div>
              </div>
              <div className="text-center">
                <div className="text-slate-300 text-xs uppercase tracking-wide mb-1">Active Editors</div>
                <div className="text-white font-bold text-2xl">{summary.editors_active}</div>
              </div>
              <div className="text-center">
                <div className="text-slate-300 text-xs uppercase tracking-wide mb-1">Last Change</div>
                <div className="text-white font-bold text-lg">{summary.last_change_at ? new Date(summary.last_change_at).toLocaleString() : 'Never'}</div>
              </div>
              <div className="text-center">
                <div className="text-slate-300 text-xs uppercase tracking-wide mb-1">Most Active</div>
                <div className="text-white font-bold text-lg">{summary.most_active_editor || 'None'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Changes List */}
        <div className="flex-1 overflow-y-auto px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-slate-300">Loading changes...</span>
            </div>
          ) : changes.length > 0 ? (
            <div className="space-y-4">
              {changes.map((change) => (
                <div key={change.id} className="bg-slate-700 rounded-lg p-4 border-l-4 border-slate-600 hover:border-slate-500 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getActionIcon(change.action)}</span>
                      <span className={`font-semibold ${getActionColor(change.action)}`}>
                        {change.action}
                      </span>
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{change.formatted_time}</div>
                      <div>{change.time_ago}</div>
                    </div>
                  </div>
                  
                  {/* Only the essential information */}
                  <div className="space-y-1 text-base">
                    <div className="text-slate-200">
                      <strong>User:</strong> {change.user_name || 'Unknown'}
                    </div>
                    <div className="text-slate-200">
                      <strong>ROW {change.row_number || '?'} | {change.cue_number || 'CUE'}</strong>
                    </div>
                    <div className="text-slate-200">
                      <strong>Column:</strong> {change.field_name?.replace(/([A-Z])/g, ' $1').trim() || 'Unknown'}
                    </div>
                    <div className="text-slate-200">
                      <strong>Changed to:</strong> <span className="text-green-300">{change.new_value || 'Unknown'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <div className="text-6xl mb-4">📝</div>
              <div className="text-xl">No changes recorded yet</div>
              <div className="text-sm mt-2">Changes will appear here as you edit the run of show</div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-700">
          <div className="flex justify-between items-center">
            <div className="text-sm text-slate-400">
              Showing {changes.length} changes
            </div>
            <div className="flex gap-3">
              <button
                onClick={fetchChanges}
                disabled={loading}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 disabled:bg-slate-700 text-white rounded-lg transition-colors"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompleteChangeLog;

