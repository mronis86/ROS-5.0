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
  const [fontSize, setFontSize] = useState<number>(14); // Font size in px
  const [currentVisibleLine, setCurrentVisibleLine] = useState<number>(0); // Track current line in view
  const [visibleLineRange, setVisibleLineRange] = useState<{ start: number; end: number }>({ start: 0, end: 20 });
  const [showAllComments, setShowAllComments] = useState<boolean>(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState<string>('');
  const [isWebSocketConnected, setIsWebSocketConnected] = useState<boolean>(false);
  
  const scriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollThrottleRef = useRef<NodeJS.Timeout | null>(null);

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

  // Recalculate visible range when font size changes
  useEffect(() => {
    if (!scriptRef.current) return;
    
    // Wait a bit for the DOM to update with new font size
    setTimeout(() => {
      if (!scriptRef.current) return;
      
      const position = scriptRef.current.scrollTop;
      const containerHeight = scriptRef.current.clientHeight;
      
      // Use actual line elements for precise calculation
      const lineElements = scriptRef.current.querySelectorAll('[data-line-number]');
      
      if (lineElements.length > 0) {
        let totalHeight = 0;
        const sampleSize = Math.min(5, lineElements.length);
        
        for (let i = 0; i < sampleSize; i++) {
          totalHeight += (lineElements[i] as HTMLElement).offsetHeight;
        }
        
        const avgLineHeight = totalHeight / sampleSize;
        const startLine = Math.max(0, Math.floor(position / avgLineHeight));
        const visibleLines = Math.ceil(containerHeight / avgLineHeight);
        const endLine = startLine + visibleLines;
        
        setCurrentVisibleLine(startLine);
        setVisibleLineRange({ start: startLine, end: endLine });
      }
    }, 50); // Small delay to ensure DOM has updated
  }, [fontSize]);

  // WebSocket setup for real-time scroll position sync
  useEffect(() => {
    if (!eventId) return;

    console.log('🔌 Setting up WebSocket for Scripts Follow');

    // Connect to Socket.IO and join the event room
    socketClient.connect(eventId, {
      onConnectionChange: (connected: boolean) => {
        console.log('🔌 Scripts Follow WebSocket status:', connected);
        setIsWebSocketConnected(connected);
      }
    });

    // Listen for scroll sync events (Viewers only)
    if (userRole === 'VIEWER') {
      const socket = socketClient.getSocket();
      if (socket) {
        console.log('👁️ Viewer: Listening for scroll sync events');
        
        socket.on('scriptScrollSync', (data: { scrollPosition: number; lineNumber: number; fontSize: number; timestamp: number }) => {
          console.log('📜 Received scroll sync:', data);
          setScrollerPosition(data.scrollPosition);
          
          // Sync font size first if it's different
          if (data.fontSize && data.fontSize !== fontSize) {
            console.log(`📏 Syncing font size from ${fontSize}px to ${data.fontSize}px`);
            setFontSize(data.fontSize);
          }
          
          // Auto-scroll viewer to scroller's position
          if (scriptRef.current) {
            // Wait for font size to apply if it changed
            setTimeout(() => {
              if (!scriptRef.current) return;
              
              scriptRef.current.scrollTop = data.scrollPosition;
              
              // Update visible line range for viewer with accurate calculation
              setTimeout(() => {
                if (!scriptRef.current) return;
                
                const containerHeight = scriptRef.current.clientHeight;
                const lineElements = scriptRef.current.querySelectorAll('[data-line-number]');
                
                if (lineElements.length > 0) {
                  let totalHeight = 0;
                  const sampleSize = Math.min(5, lineElements.length);
                  
                  for (let i = 0; i < sampleSize; i++) {
                    totalHeight += (lineElements[i] as HTMLElement).offsetHeight;
                  }
                  
                  const avgLineHeight = totalHeight / sampleSize;
                  const startLine = Math.max(0, Math.floor(data.scrollPosition / avgLineHeight));
                  const visibleLines = Math.ceil(containerHeight / avgLineHeight);
                  const endLine = startLine + visibleLines;
                  
                  setCurrentVisibleLine(startLine);
                  setVisibleLineRange({ start: startLine, end: endLine });
                }
              }, 50);
            }, data.fontSize !== fontSize ? 100 : 0); // Extra delay if font changed
          }
        });
      }
    }

    return () => {
      console.log('🔌 Cleaning up Scripts Follow WebSocket');
      const socket = socketClient.getSocket();
      if (socket) {
        socket.off('scriptScrollSync');
      }
    };
  }, [eventId, userRole]);

  // Handle scroll events (Scroller only)
  const handleScroll = () => {
    if (!scriptRef.current) return;

    const position = scriptRef.current.scrollTop;
    const containerHeight = scriptRef.current.clientHeight;
    
    // Get the actual rendered line elements to calculate precise line heights
    const lineElements = scriptRef.current.querySelectorAll('[data-line-number]');
    
    if (lineElements.length > 0) {
      // Use the actual height of the first few lines to calculate average line height
      let totalHeight = 0;
      const sampleSize = Math.min(5, lineElements.length);
      
      for (let i = 0; i < sampleSize; i++) {
        totalHeight += (lineElements[i] as HTMLElement).offsetHeight;
      }
      
      const avgLineHeight = totalHeight / sampleSize;
      const startLine = Math.max(0, Math.floor(position / avgLineHeight));
      const visibleLines = Math.ceil(containerHeight / avgLineHeight);
      const endLine = startLine + visibleLines;
      
      setCurrentVisibleLine(startLine);
      setVisibleLineRange({ start: startLine, end: endLine });
    } else {
      // Fallback calculation if no elements yet
      const lineHeight = fontSize * 2; // Conservative estimate
      const startLine = Math.max(0, Math.floor(position / lineHeight));
      const visibleLines = Math.ceil(containerHeight / lineHeight);
      const endLine = startLine + visibleLines;
      
      setCurrentVisibleLine(startLine);
      setVisibleLineRange({ start: startLine, end: endLine });
    }

    if (userRole === 'SCROLLER') {
      setScrollerPosition(position);

      // Broadcast scroll position via WebSocket (throttled to avoid spam)
      if (eventId) {
        if (scrollThrottleRef.current) {
          clearTimeout(scrollThrottleRef.current);
        }
        
        scrollThrottleRef.current = setTimeout(() => {
          const startLine = Math.max(0, Math.floor(position / (fontSize * 2)));
          socketClient.emitScriptScroll(position, startLine, fontSize);
          console.log('📜 Broadcasting scroll position:', position, 'line:', startLine, 'fontSize:', fontSize);
        }, 100); // Throttle to max 10 updates per second
      }
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

  // Get comments that are currently visible in the script viewport
  const getVisibleComments = (): Comment[] => {
    if (showAllComments) {
      return comments.sort((a, b) => a.lineNumber - b.lineNumber);
    }
    
    // Add a small buffer to ensure we don't cut off comments too early
    const buffer = 1; // Show comments 1 line before they become visible
    return comments.filter(
      c => c.lineNumber >= Math.max(0, visibleLineRange.start - buffer) && 
           c.lineNumber <= visibleLineRange.end + buffer
    ).sort((a, b) => a.lineNumber - b.lineNumber);
  };

  // Start editing a comment
  const startEditComment = (comment: Comment) => {
    setEditingCommentId(comment.id);
    setEditText(comment.text);
  };

  // Save edited comment
  const saveEditComment = (commentId: string) => {
    if (editText.trim()) {
      setComments(comments.map(c => 
        c.id === commentId ? { ...c, text: editText.trim() } : c
      ));
    }
    setEditingCommentId(null);
    setEditText('');
  };

  // Cancel editing
  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditText('');
  };

  // Delete comment
  const deleteComment = (commentId: string) => {
    setComments(comments.filter(c => c.id !== commentId));
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
        <div className="mt-3 px-4 py-2 bg-slate-700 rounded text-sm flex items-center justify-between">
          <div>
            {userRole === 'SCROLLER' ? (
              <span>🎬 You are the <strong>Scroller</strong> - Your scroll position is being broadcast to all viewers.</span>
            ) : (
              <span>👁️ You are a <strong>Viewer</strong> - Following the scroller's position automatically.</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isWebSocketConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-slate-400">
              {isWebSocketConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-140px)]">
        {/* Comments Section - Left Side */}
        <div className="w-1/3 bg-slate-800 border-r border-slate-700 p-6 overflow-y-auto">
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                💬 Comments
                <span className="text-sm font-normal text-slate-400">({comments.length} total)</span>
              </h2>
              
              {/* Toggle between All Comments and Visible Only */}
              <button
                onClick={() => setShowAllComments(!showAllComments)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  showAllComments 
                    ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                    : 'bg-green-900 hover:bg-green-800 text-green-300'
                }`}
              >
                {showAllComments ? '📋 Show All' : '👁️ Visible Only'}
              </button>
            </div>
            
            {!showAllComments && (
              <div className="flex items-center gap-2 mt-2">
                <div className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded font-medium">
                  👁️ Showing visible only
                </div>
                <div className="text-xs text-slate-400">
                  Lines {Math.max(1, visibleLineRange.start)} - {visibleLineRange.end + 1}
                </div>
              </div>
            )}
          </div>

          {/* Add Comment Form - Always visible when line selected */}
          {selectedLine !== null && (
            <div className="mb-6 p-4 bg-gradient-to-br from-blue-900 to-blue-800 rounded-lg border-2 border-blue-500 shadow-lg animate-in fade-in duration-200">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-lg font-bold text-white flex items-center gap-2">
                    💬 Add Comment
                  </div>
                  <span className="text-sm text-blue-300">
                    Line {selectedLine + 1}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSelectedLine(null);
                    setNewComment('');
                  }}
                  className="text-slate-300 hover:text-white text-xl font-bold"
                  title="Cancel"
                >
                  ✕
                </button>
              </div>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Type your comment here..."
                className="w-full px-3 py-3 bg-slate-700 border-2 border-slate-600 rounded text-white text-base resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                rows={4}
                autoFocus
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-base font-bold transition-colors"
                >
                  💾 Save Comment
                </button>
                <button
                  onClick={() => {
                    setSelectedLine(null);
                    setNewComment('');
                  }}
                  className="px-4 py-3 bg-slate-600 hover:bg-slate-500 rounded text-base font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          
          {/* Instruction when no line selected */}
          {selectedLine === null && (
            <div className="mb-6 p-4 bg-slate-700 rounded-lg border-2 border-dashed border-slate-600 text-center">
              <div className="text-slate-400 text-sm">
                👉 Click a <span className="text-blue-400 font-bold">line number</span> on the script to add a comment
              </div>
            </div>
          )}

          {/* Comments List - Only Visible Comments */}
          <div className="space-y-3">
            {comments.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">
                No comments yet. Click on a line number to add a comment.
              </p>
            ) : getVisibleComments().length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-400 text-sm mb-2">
                  No comments visible on screen
                </p>
                <p className="text-slate-500 text-xs">
                  Scroll to lines with 📝 to see their comments
                </p>
              </div>
            ) : (
              getVisibleComments().map((comment) => {
                // Calculate position relative to viewport
                const linePosition = comment.lineNumber - visibleLineRange.start;
                const totalVisible = visibleLineRange.end - visibleLineRange.start;
                const positionPercent = (linePosition / totalVisible) * 100;
                
                // Determine if comment is actually visible or just in buffer zone
                const isActuallyVisible = comment.lineNumber >= visibleLineRange.start && 
                                        comment.lineNumber <= visibleLineRange.end;
                
                // Determine position label
                let positionLabel = '';
                let positionColor = 'bg-slate-600';
                
                if (showAllComments) {
                  // No position label in "Show All" mode
                  positionLabel = '';
                } else if (!isActuallyVisible) {
                  if (comment.lineNumber < visibleLineRange.start) {
                    positionLabel = 'Above';
                    positionColor = 'bg-gray-600';
                  } else {
                    positionLabel = 'Below';
                    positionColor = 'bg-gray-600';
                  }
                } else if (positionPercent < 25) {
                  positionLabel = 'Top';
                  positionColor = 'bg-blue-600';
                } else if (positionPercent < 75) {
                  positionLabel = 'Middle';
                  positionColor = 'bg-green-600';
                } else {
                  positionLabel = 'Bottom';
                  positionColor = 'bg-purple-600';
                }
                
                const isEditing = editingCommentId === comment.id;
                
                return (
                  <div 
                    key={comment.id} 
                    className={`p-3 rounded-lg transition-all ${
                      showAllComments
                        ? 'bg-slate-700 border-l-4 border-blue-500 hover:bg-slate-600'
                        : isActuallyVisible 
                          ? 'bg-slate-700 border-l-4 border-green-500 hover:bg-slate-600' 
                          : 'bg-slate-800 border-l-4 border-gray-500 opacity-75 hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-blue-400">
                          Line {comment.lineNumber + 1}
                        </span>
                        {positionLabel && (
                          <span className={`text-xs ${positionColor} text-white px-2 py-0.5 rounded font-bold`}>
                            {positionLabel}
                          </span>
                        )}
                      </div>
                      
                      {/* Edit/Delete buttons */}
                      {!isEditing && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => startEditComment(comment)}
                            className="p-1 hover:bg-slate-600 rounded transition-colors"
                            title="Edit comment"
                          >
                            <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Delete this comment?')) {
                                deleteComment(comment.id);
                              }
                            }}
                            className="p-1 hover:bg-slate-600 rounded transition-colors"
                            title="Delete comment"
                          >
                            <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full p-2 bg-slate-800 text-white rounded border border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          rows={3}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEditComment(comment.id)}
                            className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition-colors"
                          >
                            💾 Save
                          </button>
                          <button
                            onClick={cancelEditComment}
                            className="px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded text-sm transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-white mb-1">{comment.text}</p>
                        <span className="text-xs text-slate-400">- {comment.author}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Script Section - Right Side */}
        <div className="flex-1 bg-slate-900 p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">📜 Script</h2>
            
            <div className="flex items-center gap-4">
              {/* Font Size Controls - Disabled for Viewers */}
              <div className="flex items-center gap-2 bg-slate-800 rounded px-3 py-1">
                <span className="text-sm text-slate-400">Text Size:</span>
                <button
                  onClick={() => setFontSize(prev => Math.max(10, prev - 2))}
                  disabled={userRole === 'VIEWER'}
                  className={`w-8 h-8 rounded text-white font-bold transition-colors ${
                    userRole === 'VIEWER' 
                      ? 'bg-slate-600 cursor-not-allowed opacity-50' 
                      : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                  title={userRole === 'VIEWER' ? 'Synced with Scroller' : 'Decrease font size'}
                >
                  A-
                </button>
                <span className="text-sm text-white w-8 text-center">{fontSize}px</span>
                <button
                  onClick={() => setFontSize(prev => Math.min(32, prev + 2))}
                  disabled={userRole === 'VIEWER'}
                  className={`w-8 h-8 rounded text-white font-bold transition-colors ${
                    userRole === 'VIEWER' 
                      ? 'bg-slate-600 cursor-not-allowed opacity-50' 
                      : 'bg-slate-700 hover:bg-slate-600'
                  }`}
                  title={userRole === 'VIEWER' ? 'Synced with Scroller' : 'Increase font size'}
                >
                  A+
                </button>
                {userRole === 'VIEWER' && (
                  <span className="text-xs text-blue-400 ml-2">🔒 Synced</span>
                )}
              </div>
              
              {userRole === 'VIEWER' && (
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-600 rounded text-sm">
                  <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  Following Scroller
                </div>
              )}
            </div>
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
              <div className="font-mono leading-relaxed" style={{ fontSize: `${fontSize}px` }}>
                {scriptLines.map((line, index) => {
                  const lineComments = getCommentsForLine(index);
                  const hasComments = lineComments.length > 0;
                  
                  return (
                    <div
                      key={index}
                      data-line-number={index}
                      className={`flex items-start gap-3 py-2 transition-colors ${
                        selectedLine === index 
                          ? 'bg-blue-900 ring-2 ring-blue-500' 
                          : hasComments 
                          ? 'bg-slate-750 hover:bg-slate-700 border-l-4 border-blue-500' 
                          : 'hover:bg-slate-700'
                      }`}
                    >
                      {/* Line Number */}
                      <button
                        onClick={() => setSelectedLine(index)}
                        className={`flex-shrink-0 w-16 text-right font-bold select-none cursor-pointer transition-colors ${
                          hasComments
                            ? 'text-blue-400 hover:text-blue-300'
                            : 'text-slate-500 hover:text-slate-400'
                        }`}
                        style={{ fontSize: `${Math.max(12, fontSize - 2)}px` }}
                        title={hasComments ? `${lineComments.length} comment(s) - Click to add more` : 'Click to add comment'}
                      >
                        <div className="flex items-center justify-end gap-1">
                          {index + 1}
                          {hasComments && (
                            <div className="flex flex-col items-center">
                              <span className="text-yellow-400">📝</span>
                              <span className="text-xs bg-blue-600 text-white rounded-full px-1 min-w-[16px] text-center">
                                {lineComments.length}
                              </span>
                            </div>
                          )}
                        </div>
                      </button>

                      {/* Script Line */}
                      <div className={`flex-1 whitespace-pre-wrap break-words ${
                        hasComments ? 'text-white font-medium' : 'text-white'
                      }`}>
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

