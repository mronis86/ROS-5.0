import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

interface Comment {
  id: string;
  lineNumber: number;
  text: string;
  author: string;
  timestamp: Date;
}

interface ScriptData {
  id?: string;
  event_id: string;
  script_text: string;
  comments: Comment[];
  created_at?: Date;
  updated_at?: Date;
}

type UserRole = 'SCROLLER' | 'VIEWER';

const ScriptsFollowPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get('eventId');
  const eventName = searchParams.get('eventName');

  // State
  const [scriptText, setScriptText] = useState<string>('');
  const [comments, setComments] = useState<Comment[]>([]);
  const [userRole, setUserRole] = useState<UserRole>('VIEWER');
  const [scrollerPosition, setScrollerPosition] = useState<number>(0);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [newComment, setNewComment] = useState<string>('');
  const [userName, setUserName] = useState<string>('User');
  
  const scriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load script data on mount
  useEffect(() => {
    if (!eventId) {
      console.error('No event ID provided');
      return;
    }

    const loadScriptData = async () => {
      try {
        // TODO: Implement DatabaseService.getScriptData(eventId)
        console.log('Loading script data for event:', eventId);
        // const data = await DatabaseService.getScriptData(eventId);
        // setScriptText(data.script_text || '');
        // setComments(data.comments || []);
      } catch (error) {
        console.error('Error loading script data:', error);
      }
    };

    loadScriptData();
  }, [eventId]);

  // WebSocket setup for real-time scroll position sync
  useEffect(() => {
    if (!eventId) return;

    console.log('🔌 Setting up WebSocket for Scripts Follow');

    const callbacks = {
      onScrollPositionUpdated: (data: any) => {
        console.log('📜 Scroll position updated:', data);
        if (data && data.event_id === eventId && userRole === 'VIEWER') {
          setScrollerPosition(data.position);
          // Auto-scroll viewer to scroller's position
          if (scriptRef.current) {
            scriptRef.current.scrollTop = data.position;
          }
        }
      },
      onCommentAdded: (data: any) => {
        console.log('💬 Comment added:', data);
        if (data && data.event_id === eventId) {
          setComments(prev => [...prev, data.comment]);
        }
      },
      onConnectionChange: (connected: boolean) => {
        console.log('🔌 Scripts Follow WebSocket status:', connected);
      }
    };

    socketClient.connect(eventId, callbacks);

    return () => {
      console.log('🔌 Cleaning up Scripts Follow WebSocket');
      socketClient.disconnect(eventId);
    };
  }, [eventId, userRole]);

  // Handle scroll events (Scroller only)
  const handleScroll = () => {
    if (userRole !== 'SCROLLER' || !scriptRef.current) return;

    const position = scriptRef.current.scrollTop;
    setScrollerPosition(position);

    // Broadcast scroll position via WebSocket
    if (eventId) {
      // TODO: Implement socket broadcast for scroll position
      console.log('📜 Broadcasting scroll position:', position);
    }
  };

  // Handle script import
  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      setScriptText(text);
      console.log('✅ Script imported successfully');
      
      // Save to database
      if (eventId) {
        // TODO: Implement DatabaseService.saveScriptData
        console.log('💾 Saving script to database...');
      }
    } catch (error) {
      console.error('❌ Error importing script:', error);
    } finally {
      setIsImporting(false);
    }
  };

  // Add comment
  const handleAddComment = () => {
    if (!newComment.trim() || selectedLine === null) return;

    const comment: Comment = {
      id: Date.now().toString(),
      lineNumber: selectedLine,
      text: newComment.trim(),
      author: userName,
      timestamp: new Date()
    };

    setComments(prev => [...prev, comment]);
    setNewComment('');
    setSelectedLine(null);

    // Broadcast comment via WebSocket
    if (eventId) {
      // TODO: Implement socket broadcast for comments
      console.log('💬 Broadcasting comment:', comment);
    }

    // Save to database
    if (eventId) {
      // TODO: Implement DatabaseService.saveComment
      console.log('💾 Saving comment to database...');
    }
  };

  // Get comments for a specific line
  const getCommentsForLine = (lineNumber: number): Comment[] => {
    return comments.filter(c => c.lineNumber === lineNumber);
  };

  // Split script into lines
  const scriptLines = scriptText.split('\n');

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors"
            >
              ← Back
            </button>
            <h1 className="text-2xl font-bold">Scripts Follow</h1>
            {eventName && <span className="text-slate-400">- {eventName}</span>}
          </div>

          <div className="flex items-center gap-4">
            {/* Role Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Role:</span>
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value as UserRole)}
                className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="SCROLLER">Scroller</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <div className={`w-3 h-3 rounded-full ${userRole === 'SCROLLER' ? 'bg-green-500' : 'bg-blue-500'}`} />
            </div>

            {/* Import Script Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
            >
              {isImporting ? 'Importing...' : '📄 Import Script'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.doc,.docx"
              onChange={handleFileImport}
              className="hidden"
            />

            {/* User Name Input */}
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Your name"
              className="px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Role Info Banner */}
        <div className="mt-3 px-4 py-2 bg-slate-700 rounded text-sm">
          {userRole === 'SCROLLER' ? (
            <span>🎬 You are the <strong>Scroller</strong> - Your scroll position is being broadcast to all viewers.</span>
          ) : (
            <span>👁️ You are a <strong>Viewer</strong> - Following the scroller's position automatically.</span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-140px)]">
        {/* Comments Section - Left Side */}
        <div className="w-1/3 bg-slate-800 border-r border-slate-700 p-6 overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            💬 Comments
            <span className="text-sm font-normal text-slate-400">({comments.length})</span>
          </h2>

          {/* Add Comment Form */}
          {selectedLine !== null && (
            <div className="mb-6 p-4 bg-slate-700 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-400">
                  Adding comment to Line {selectedLine + 1}
                </span>
                <button
                  onClick={() => setSelectedLine(null)}
                  className="text-slate-400 hover:text-white text-sm"
                >
                  ✕
                </button>
              </div>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Type your comment..."
                className="w-full px-3 py-2 bg-slate-600 border border-slate-500 rounded text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
              <button
                onClick={handleAddComment}
                disabled={!newComment.trim()}
                className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors w-full"
              >
                Add Comment
              </button>
            </div>
          )}

          {/* Comments List */}
          <div className="space-y-3">
            {comments.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">
                No comments yet. Click on a line number to add a comment.
              </p>
            ) : (
              comments
                .sort((a, b) => a.lineNumber - b.lineNumber)
                .map((comment) => (
                  <div key={comment.id} className="p-3 bg-slate-700 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-blue-400">
                        Line {comment.lineNumber + 1}
                      </span>
                      <span className="text-xs text-slate-400">
                        {new Date(comment.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-white mb-1">{comment.text}</p>
                    <span className="text-xs text-slate-400">- {comment.author}</span>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Script Section - Right Side */}
        <div className="flex-1 bg-slate-900 p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">📜 Script</h2>
            {userRole === 'VIEWER' && (
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-600 rounded text-sm">
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Following Scroller
              </div>
            )}
          </div>

          {scriptText ? (
            <div
              ref={scriptRef}
              onScroll={handleScroll}
              className={`h-[calc(100%-60px)] overflow-y-auto bg-slate-800 rounded-lg p-6 ${
                userRole === 'VIEWER' ? 'cursor-default' : ''
              }`}
              style={{
                scrollBehavior: userRole === 'VIEWER' ? 'smooth' : 'auto'
              }}
            >
              <div className="font-mono text-sm leading-relaxed">
                {scriptLines.map((line, index) => {
                  const lineComments = getCommentsForLine(index);
                  const hasComments = lineComments.length > 0;
                  
                  return (
                    <div
                      key={index}
                      className={`flex items-start gap-3 py-1 hover:bg-slate-700 transition-colors ${
                        selectedLine === index ? 'bg-blue-900' : ''
                      }`}
                    >
                      {/* Line Number */}
                      <button
                        onClick={() => setSelectedLine(index)}
                        className={`flex-shrink-0 w-12 text-right text-xs font-medium select-none cursor-pointer transition-colors ${
                          hasComments
                            ? 'text-blue-400 hover:text-blue-300'
                            : 'text-slate-500 hover:text-slate-400'
                        }`}
                        title={hasComments ? `${lineComments.length} comment(s)` : 'Click to add comment'}
                      >
                        {index + 1}
                        {hasComments && <span className="ml-1">💬</span>}
                      </button>

                      {/* Script Line */}
                      <div className="flex-1 text-white whitespace-pre-wrap break-words">
                        {line || '\u00A0'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="h-[calc(100%-60px)] flex items-center justify-center bg-slate-800 rounded-lg">
              <div className="text-center">
                <div className="text-6xl mb-4">📄</div>
                <p className="text-slate-400 text-lg mb-4">No script loaded</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded font-medium transition-colors"
                >
                  Import Script
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScriptsFollowPage;

