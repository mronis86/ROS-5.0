import React, { useState, useEffect } from 'react';
import { DatabaseService } from '../services/database';

interface ChangeLogEntry {
  id: string;
  created_at: string;
  user_name: string;
  user_role: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'MOVE' | 'DUPLICATE';
  table_name: string;
  record_id: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  description?: string;
  metadata?: any;
}

interface ChangeLogProps {
  eventId: string;
  isOpen: boolean;
  onClose: () => void;
}

const ChangeLog: React.FC<ChangeLogProps> = ({ eventId, isOpen, onClose }) => {
  const [changes, setChanges] = useState<ChangeLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && eventId) {
      fetchChanges();
    }
  }, [isOpen, eventId]);

  const fetchChanges = async () => {
    setLoading(true);
    try {
      const changeLog = await DatabaseService.getChangeLog(eventId, 100);
      setChanges(changeLog);
    } catch (error) {
      console.error('Error fetching change log:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'text-green-400';
      case 'UPDATE': return 'text-blue-400';
      case 'DELETE': return 'text-red-400';
      case 'MOVE': return 'text-yellow-400';
      case 'DUPLICATE': return 'text-purple-400';
      default: return 'text-slate-400';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'CREATE': return '➕';
      case 'UPDATE': return '✏️';
      case 'DELETE': return '🗑️';
      case 'MOVE': return '↕️';
      case 'DUPLICATE': return '📋';
      default: return '📝';
    }
  };

  const getTableDisplayName = (tableName: string) => {
    switch (tableName) {
      case 'schedule_items': return 'Schedule Item';
      case 'custom_columns': return 'Custom Column';
      case 'settings': return 'Settings';
      default: return tableName;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[9999] p-4">
      <div className="bg-slate-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">Change History</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-2xl"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-slate-300">Loading changes...</span>
            </div>
          ) : changes.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              No changes recorded yet
            </div>
          ) : (
            <div className="space-y-4">
              {changes.map((change) => (
                <div
                  key={change.id}
                  className="bg-slate-700 rounded-lg p-4 border-l-4 border-slate-600"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getActionIcon(change.action)}</span>
                      <span className={`font-semibold ${getActionColor(change.action)}`}>
                        {change.action}
                      </span>
                      <span className="text-slate-300">on</span>
                      <span className="text-white font-medium">{getTableDisplayName(change.table_name)}</span>
                    </div>
                    <span className="text-slate-400 text-sm">
                      {formatTimestamp(change.created_at)}
                    </span>
                  </div>

                  <div className="text-slate-300 text-sm mb-2">
                    <strong>User:</strong> {change.user_name || 'Unknown'} 
                    <span className="text-slate-400 ml-2">({change.user_role})</span>
                  </div>

                  {change.description && (
                    <div className="text-slate-300 text-sm mb-2">
                      <strong>Description:</strong> {change.description}
                    </div>
                  )}

                  {change.field_name && (
                    <div className="text-slate-300 text-sm mb-2">
                      <strong>Field:</strong> <span className="text-blue-300">{change.field_name}</span>
                    </div>
                  )}

                  {change.record_id && (
                    <div className="text-slate-400 text-xs">
                      <strong>Record ID:</strong> {change.record_id}
                    </div>
                  )}

                  {/* Show field changes for updates */}
                  {change.action === 'UPDATE' && change.field_name && change.old_value !== undefined && change.new_value !== undefined && (
                    <div className="mt-3 p-3 bg-slate-800 rounded border border-slate-600">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <h4 className="text-red-400 text-sm font-medium mb-1">Before:</h4>
                          <div className="bg-slate-900 p-2 rounded text-sm text-slate-300 break-words">
                            {change.old_value || '(empty)'}
                          </div>
                        </div>
                        <div>
                          <h4 className="text-green-400 text-sm font-medium mb-1">After:</h4>
                          <div className="bg-slate-900 p-2 rounded text-sm text-slate-300 break-words">
                            {change.new_value || '(empty)'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-700">
          <button
            onClick={fetchChanges}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-white rounded-lg transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangeLog;
