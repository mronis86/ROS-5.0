import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { DatabaseService } from '../services/database';
import { socketClient } from '../services/socket-client';

type CommentType = 'GENERAL' | 'CUE' | 'AUDIO' | 'GFX' | 'VIDEO' | 'LIGHTING';

interface Comment {
  id: string;
  lineNumber: number;
  text: string;
  author: string;
  timestamp: Date | string; // Can be Date locally or string from WebSocket
  type: CommentType;
}

// Comment type configuration with colors and icons
const COMMENT_TYPES: Record<CommentType, { label: string; color: string; bgColor: string; icon: string }> = {
  GENERAL: { label: 'General', color: 'text-slate-300', bgColor: 'bg-slate-600', icon: '💬' },
  CUE: { label: 'Cue', color: 'text-yellow-300', bgColor: 'bg-yellow-600', icon: '🎬' },
  AUDIO: { label: 'Audio', color: 'text-green-300', bgColor: 'bg-green-600', icon: '🎵' },
  GFX: { label: 'GFX', color: 'text-purple-300', bgColor: 'bg-purple-600', icon: '🎨' },
  VIDEO: { label: 'Video', color: 'text-red-300', bgColor: 'bg-red-600', icon: '📹' },
  LIGHTING: { label: 'Lighting', color: 'text-orange-300', bgColor: 'bg-orange-600', icon: '💡' }
};

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
  const [isEditingScript, setIsEditingScript] = useState<boolean>(false);
  const [editScriptText, setEditScriptText] = useState<string>('');
  const [previewComments, setPreviewComments] = useState<Comment[]>([]);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const originalScriptTextRef = useRef<string>('');
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
  const [currentScriptId, setCurrentScriptId] = useState<string | null>(null);
  const [currentScriptName, setCurrentScriptName] = useState<string>('');
  const [savedScripts, setSavedScripts] = useState<any[]>([]);
  const [showScriptManager, setShowScriptManager] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [commentType, setCommentType] = useState<CommentType>('GENERAL');
  
  const scriptRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastScrollBroadcastRef = useRef<number>(0);

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

    console.log('🔌 Setting up WebSocket for Scripts Follow, role:', userRole);

    // Connect to Socket.IO and join the event room (no callbacks to avoid conflicts)
    socketClient.connect(eventId, {});

    const socket = socketClient.getSocket();
    if (!socket) {
      console.error('❌ Socket not available');
      return;
    }

    // Listen for connection status directly on the socket
    const handleConnect = () => {
      console.log('🔌 Scripts Follow WebSocket connected');
      setIsWebSocketConnected(true);
    };

    const handleDisconnect = () => {
      console.log('🔌 Scripts Follow WebSocket disconnected');
      setIsWebSocketConnected(false);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    // Set initial connection status
    setIsWebSocketConnected(socket.connected);

    // Remove any existing listener first
    socket.off('scriptScrollSync');

    // Listen for scroll sync events (Viewers only)
    if (userRole === 'VIEWER') {
      console.log('👁️ Viewer: Setting up scroll sync listener');
      
      const handleScrollSync = (data: { scrollPosition: number; lineNumber: number; fontSize: number; timestamp: number }) => {
        console.log('📜 Received scroll sync:', data);
        setScrollerPosition(data.scrollPosition);
        
        // Sync font size first if it's different
        if (data.fontSize && data.fontSize !== fontSize) {
          console.log(`📏 Syncing font size from ${fontSize}px to ${data.fontSize}px`);
          setFontSize(data.fontSize);
        }
        
        // Auto-scroll viewer to scroller's position with smooth animation
        if (scriptRef.current) {
          // Wait for font size to apply if it changed
          setTimeout(() => {
            if (!scriptRef.current) return;
            
            // Use instant scrolling for real-time sync (smooth causes lag)
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
      };

      socket.on('scriptScrollSync', handleScrollSync);
      console.log('✅ Viewer: Scroll sync listener attached');
    } else {
      console.log('🎬 Scroller: No listener needed (broadcasting mode)');
    }

    // Listen for comment sync events (All users)
    const handleCommentSync = (data: { action: 'add' | 'edit' | 'delete'; comment?: any; commentId?: string }) => {
      console.log('💬 Received comment sync:', data.action, data.commentId || data.comment?.id);
      
      switch (data.action) {
        case 'add':
          if (data.comment) {
            // Convert timestamp string back to Date if needed
            const comment: Comment = {
              ...data.comment,
              timestamp: typeof data.comment.timestamp === 'string' 
                ? new Date(data.comment.timestamp) 
                : data.comment.timestamp
            };
            
            setComments(prev => {
              // Avoid duplicates
              if (prev.some(c => c.id === comment.id)) {
                console.log('💬 Comment already exists, skipping:', comment.id);
                return prev;
              }
              console.log('💬 Adding comment:', comment.id);
              return [...prev, comment];
            });
          }
          break;
        case 'edit':
          if (data.comment) {
            const comment: Comment = {
              ...data.comment,
              timestamp: typeof data.comment.timestamp === 'string' 
                ? new Date(data.comment.timestamp) 
                : data.comment.timestamp
            };
            
            setComments(prev => prev.map(c => 
              c.id === comment.id ? comment : c
            ));
          }
          break;
        case 'delete':
          if (data.commentId) {
            setComments(prev => prev.filter(c => c.id !== data.commentId));
          }
          break;
      }
    };

    socket.on('scriptCommentSync', handleCommentSync);
    console.log('✅ Comment sync listener attached');

    return () => {
      console.log('🔌 Cleaning up Scripts Follow WebSocket');
      const socket = socketClient.getSocket();
      if (socket) {
        socket.off('scriptScrollSync');
        socket.off('scriptCommentSync');
        socket.off('connect', handleConnect);
        socket.off('disconnect', handleDisconnect);
        console.log('✅ Removed Scripts Follow socket listeners');
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

      // Broadcast scroll position via WebSocket (throttled but immediate)
      if (eventId) {
        const now = Date.now();
        const timeSinceLastBroadcast = now - lastScrollBroadcastRef.current;
        
        // Broadcast immediately if 50ms has passed (20 updates per second max)
        if (timeSinceLastBroadcast >= 50) {
          const startLine = Math.max(0, Math.floor(position / (fontSize * 2)));
          socketClient.emitScriptScroll(position, startLine, fontSize);
          lastScrollBroadcastRef.current = now;
          console.log('📜 Broadcasting scroll position:', position, 'line:', startLine, 'fontSize:', fontSize);
        }
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
      timestamp: new Date(),
      type: commentType
    };

    setComments(prev => [...prev, comment]);
    setNewComment('');
    setSelectedLine(null);

    // Broadcast comment via WebSocket
    if (eventId) {
      console.log('💬 Broadcasting new comment');
      socketClient.emitScriptComment('add', comment);
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
      const updatedComment = comments.find(c => c.id === commentId);
      if (updatedComment) {
        const newComment = { ...updatedComment, text: editText.trim() };
        setComments(comments.map(c => 
          c.id === commentId ? newComment : c
        ));
        
        // Broadcast edit via WebSocket
        if (eventId) {
          console.log('💬 Broadcasting comment edit');
          socketClient.emitScriptComment('edit', newComment, commentId);
        }
      }
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
    
    // Broadcast delete via WebSocket
    if (eventId) {
      console.log('💬 Broadcasting comment delete');
      socketClient.emitScriptComment('delete', undefined, commentId);
    }
  };

  // Start editing script
  const startEditScript = () => {
    setEditScriptText(scriptText);
    originalScriptTextRef.current = scriptText;
    setPreviewComments(comments);
    setIsEditingScript(true);
  };

  // Adjust comment line numbers based on script edits
  const adjustCommentLineNumbers = (oldText: string, newText: string, commentsToAdjust: Comment[] = comments): Comment[] => {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    
    // If no changes, return comments as-is
    if (oldText === newText) return commentsToAdjust;
    
    // Create a mapping of old line numbers to new line numbers
    const lineMapping: Map<number, number> = new Map();
    
    // Simple algorithm: track content changes
    // For each old line, find where it ended up in the new text
    for (let oldIdx = 0; oldIdx < oldLines.length; oldIdx++) {
      const oldLine = oldLines[oldIdx].trim();
      if (!oldLine) continue; // Skip empty lines
      
      // Find this line in the new text
      for (let newIdx = 0; newIdx < newLines.length; newIdx++) {
        if (newLines[newIdx].trim() === oldLine && !lineMapping.has(oldIdx)) {
          lineMapping.set(oldIdx, newIdx);
          break;
        }
      }
    }
    
    // Update comment line numbers based on the mapping
    const updatedComments = commentsToAdjust.map(comment => {
      const oldLineNumber = comment.lineNumber;
      
      // If we have a direct mapping, use it
      if (lineMapping.has(oldLineNumber)) {
        return {
          ...comment,
          lineNumber: lineMapping.get(oldLineNumber)!
        };
      }
      
      // If no direct mapping, try to estimate based on nearby lines
      // Find the closest mapped line before this comment
      let closestBefore = -1;
      let closestBeforeNew = -1;
      for (let i = oldLineNumber - 1; i >= 0; i--) {
        if (lineMapping.has(i)) {
          closestBefore = i;
          closestBeforeNew = lineMapping.get(i)!;
          break;
        }
      }
      
      // Find the closest mapped line after this comment
      let closestAfter = oldLines.length;
      let closestAfterNew = newLines.length;
      for (let i = oldLineNumber + 1; i < oldLines.length; i++) {
        if (lineMapping.has(i)) {
          closestAfter = i;
          closestAfterNew = lineMapping.get(i)!;
          break;
        }
      }
      
      // Calculate the offset
      if (closestBefore >= 0 && closestAfter < oldLines.length) {
        // Comment is between two known lines
        const oldOffset = oldLineNumber - closestBefore;
        const newLineNumber = closestBeforeNew + oldOffset;
        return {
          ...comment,
          lineNumber: Math.min(newLineNumber, newLines.length - 1)
        };
      } else if (closestBefore >= 0) {
        // Only have a line before
        const oldOffset = oldLineNumber - closestBefore;
        const newLineNumber = closestBeforeNew + oldOffset;
        return {
          ...comment,
          lineNumber: Math.min(newLineNumber, newLines.length - 1)
        };
      } else if (closestAfter < oldLines.length) {
        // Only have a line after
        const oldOffset = closestAfter - oldLineNumber;
        const newLineNumber = Math.max(0, closestAfterNew - oldOffset);
        return {
          ...comment,
          lineNumber: newLineNumber
        };
      }
      
      // Keep original if we can't determine
      return comment;
    });
    
    console.log('📍 Adjusted comment line numbers:', {
      oldCount: commentsToAdjust.length,
      newCount: updatedComments.length,
      changes: updatedComments.filter((c, i) => c.lineNumber !== commentsToAdjust[i].lineNumber).length
    });
    
    return updatedComments;
  };

  // Save script edits
  const saveScriptEdit = async () => {
    // Adjust comment line numbers based on changes
    const adjustedComments = adjustCommentLineNumbers(scriptText, editScriptText);
    setComments(adjustedComments);
    
    setScriptText(editScriptText);
    setIsEditingScript(false);
    
    // Save to database if we have a current script
    if (currentScriptId) {
      try {
        // Update the script in database
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/scripts/${currentScriptId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            script_text: editScriptText,
            script_name: currentScriptName 
          })
        });
        
        if (response.ok) {
          console.log('✅ Script updated in database');
          
          // Update comment line numbers in database
          for (const comment of adjustedComments) {
            const originalComment = comments.find(c => c.id === comment.id);
            if (originalComment && originalComment.lineNumber !== comment.lineNumber) {
              await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/script-comments/${comment.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  line_number: comment.lineNumber,
                  comment_text: comment.text,
                  comment_type: comment.type
                })
              });
            }
          }
          
          console.log('✅ Comment line numbers updated in database');
        } else {
          throw new Error('Failed to update script');
        }
      } catch (error) {
        console.error('❌ Error saving script:', error);
        alert('Failed to save script changes');
      }
    }
  };

  // Cancel script editing
  const cancelScriptEdit = () => {
    setEditScriptText('');
    setIsEditingScript(false);
  };

  // Handle edit text change with real-time comment adjustment preview
  const handleEditTextChange = (newText: string) => {
    setEditScriptText(newText);
    
    // Update preview comments in real-time
    const adjustedComments = adjustCommentLineNumbers(originalScriptTextRef.current, newText);
    setPreviewComments(adjustedComments);
  };

  // Sync scroll between textarea and line numbers
  const handleEditScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Load list of saved scripts
  const loadSavedScripts = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/scripts`);
      const data = await response.json();
      setSavedScripts(data);
    } catch (error) {
      console.error('Error loading saved scripts:', error);
    }
  };

  // Save current script to database
  const saveScriptToDatabase = async () => {
    if (!scriptText.trim()) {
      alert('No script to save!');
      return;
    }

    const scriptName = prompt('Enter a name for this script:', currentScriptName || 'Untitled Script');
    if (!scriptName) return;

    setIsSaving(true);
    try {
      const url = currentScriptId 
        ? `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/scripts/${currentScriptId}`
        : `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/scripts`;
      
      const method = currentScriptId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_name: scriptName,
          script_text: scriptText,
          created_by: userName
        })
      });

      const savedScript = await response.json();
      setCurrentScriptId(savedScript.id);
      setCurrentScriptName(savedScript.script_name);
      
      // Save comments
      if (currentScriptId) {
        // Delete existing comments and re-add (simple approach)
        // In production, you'd want a more sophisticated sync
        for (const comment of comments) {
          await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/script-comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              script_id: savedScript.id,
              line_number: comment.lineNumber,
              comment_text: comment.text,
              comment_type: comment.type,
              author: comment.author
            })
          });
        }
      }

      alert(`Script "${scriptName}" saved successfully!`);
      loadSavedScripts();
    } catch (error) {
      console.error('Error saving script:', error);
      alert('Failed to save script');
    } finally {
      setIsSaving(false);
    }
  };

  // Load a script from database
  const loadScriptFromDatabase = async (scriptId: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/scripts/${scriptId}`);
      const data = await response.json();
      
      setScriptText(data.script.script_text);
      setCurrentScriptId(data.script.id);
      setCurrentScriptName(data.script.script_name);
      
      // Load comments
      const loadedComments = data.comments.map((c: any) => ({
        id: c.id,
        lineNumber: c.line_number,
        text: c.comment_text,
        author: c.author,
        timestamp: new Date(c.created_at),
        type: c.comment_type || 'GENERAL'
      }));
      setComments(loadedComments);
      
      setShowScriptManager(false);
      alert(`Script "${data.script.script_name}" loaded!`);
    } catch (error) {
      console.error('Error loading script:', error);
      alert('Failed to load script');
    }
  };

  // Delete a script from database
  const deleteScriptFromDatabase = async (scriptId: string, scriptName: string) => {
    if (!confirm(`Delete script "${scriptName}"? This cannot be undone.`)) {
      return;
    }

    try {
      await fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/api/scripts/${scriptId}`, {
        method: 'DELETE'
      });
      
      alert(`Script "${scriptName}" deleted!`);
      loadSavedScripts();
      
      // Clear current script if it was deleted
      if (currentScriptId === scriptId) {
        setCurrentScriptId(null);
        setCurrentScriptName('');
        setScriptText('');
        setComments([]);
      }
    } catch (error) {
      console.error('Error deleting script:', error);
      alert('Failed to delete script');
    }
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
            {currentScriptName && (
              <span className="px-3 py-1 bg-green-600 rounded text-sm font-medium">
                📄 {currentScriptName}
              </span>
            )}
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
              {isImporting ? 'Importing...' : '📄 Import'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.doc,.docx"
              onChange={handleFileImport}
              className="hidden"
            />

            {/* Save Script Button */}
            <button
              onClick={saveScriptToDatabase}
              disabled={isSaving || !scriptText}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
            >
              {isSaving ? 'Saving...' : '💾 Save'}
            </button>

            {/* Load Script Button */}
            <button
              onClick={() => {
                loadSavedScripts();
                setShowScriptManager(true);
              }}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded text-sm font-medium transition-colors"
            >
              📂 Load
            </button>

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
                    {COMMENT_TYPES[commentType].icon} Add Comment
                  </div>
                  <span className="text-sm text-blue-300">
                    Line {selectedLine + 1}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSelectedLine(null);
                    setNewComment('');
                    setCommentType('GENERAL');
                  }}
                  className="text-slate-300 hover:text-white text-xl font-bold"
                  title="Cancel"
                >
                  ✕
                </button>
              </div>
              
              {/* Comment Type Selector */}
              <div className="mb-4">
                <label className="text-base font-bold text-white mb-3 block">🎯 Comment Type:</label>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.keys(COMMENT_TYPES) as CommentType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => setCommentType(type)}
                      className={`px-4 py-3 rounded-lg text-base font-bold transition-all duration-200 shadow-lg ${
                        commentType === type
                          ? `${COMMENT_TYPES[type].bgColor} text-white ring-2 ring-yellow-400 transform scale-105`
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:scale-102'
                      }`}
                    >
                      <span className="text-lg">{COMMENT_TYPES[type].icon}</span> {COMMENT_TYPES[type].label}
                    </button>
                  ))}
                </div>
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
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Comment Type Badge - Larger and more squared */}
                        <span className={`text-sm px-3 py-2 rounded-md font-bold shadow-md ${COMMENT_TYPES[comment.type || 'GENERAL'].bgColor} text-white flex items-center gap-1`}>
                          <span className="text-base">{COMMENT_TYPES[comment.type || 'GENERAL'].icon}</span>
                          <span>{COMMENT_TYPES[comment.type || 'GENERAL'].label}</span>
                        </span>
                        
                        <div className="bg-slate-600 px-3 py-2 rounded-md">
                          <span className="text-sm font-bold text-blue-300">
                            📍 Line {comment.lineNumber + 1}
                          </span>
                        </div>
                        
                        {positionLabel && (
                          <span className={`text-sm ${positionColor} text-white px-3 py-2 rounded-md font-bold shadow-sm`}>
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
                      <div className="space-y-3">
                        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-600">
                          <p className="text-sm text-white leading-relaxed">{comment.text}</p>
                        </div>
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
              
              {/* Edit Script Button - Only for Scrollers */}
              {userRole === 'SCROLLER' && (
                <button
                  onClick={isEditingScript ? saveScriptEdit : startEditScript}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition-colors"
                  title={isEditingScript ? 'Save script changes' : 'Edit script text'}
                >
                  {isEditingScript ? '💾 Save' : '✏️ Edit'}
                </button>
              )}
              
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
              {isEditingScript ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-600">
                    <div>
                      <h3 className="text-lg font-bold text-white">✏️ Edit Script</h3>
                      <p className="text-sm text-slate-400 mt-1">
                        💬 Lines with yellow markers have comments • Comments stay on their line numbers
                      </p>
                    </div>
                    <button
                      onClick={cancelScriptEdit}
                      className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded text-sm transition-colors"
                    >
                      ✕ Cancel
                    </button>
                  </div>
                  <div className="flex flex-1 gap-2 overflow-hidden">
                    {/* Line numbers with comment indicators */}
                    <div 
                      ref={lineNumbersRef}
                      className="bg-slate-900/50 rounded-lg p-4 overflow-y-auto border border-slate-700 scrollbar-hide" 
                      style={{ minWidth: '60px', overflowY: 'scroll' }}
                    >
                      <div className="font-mono leading-relaxed text-right pr-2" style={{ fontSize: `${fontSize}px` }}>
                        {editScriptText.split('\n').map((_, index) => {
                          const lineComments = previewComments.filter(c => c.lineNumber === index);
                          const hasComment = lineComments.length > 0;
                          return (
                            <div 
                              key={index} 
                              className={`relative ${hasComment ? 'text-yellow-400 font-bold' : 'text-slate-500'}`}
                            >
                              {hasComment && (
                                <div className="absolute left-0 w-1 h-full bg-yellow-400 rounded-full"></div>
                              )}
                              <span className="relative">{index + 1}</span>
                              {hasComment && (
                                <span className="ml-1 text-xs">({lineComments.length})</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    {/* Textarea */}
                    <textarea
                      ref={editTextareaRef}
                      value={editScriptText}
                      onChange={(e) => handleEditTextChange(e.target.value)}
                      onScroll={handleEditScroll}
                      className="flex-1 bg-slate-900 text-white p-4 rounded-lg border border-slate-600 focus:outline-none focus:ring-2 focus:ring-green-500 resize-none font-mono leading-relaxed"
                      style={{ fontSize: `${fontSize}px` }}
                      placeholder="Enter your script text here..."
                    />
                  </div>
                </div>
              ) : (
              <div className="font-mono leading-relaxed" style={{ fontSize: `${fontSize}px` }}>
                {scriptLines.map((line, index) => {
                  const lineComments = getCommentsForLine(index);
                  const hasComments = lineComments.length > 0;
                  
                  return (
                    <div
                      key={index}
                      data-line-number={index}
                      className={`relative flex items-start gap-3 py-2 transition-colors ${
                        selectedLine === index 
                          ? 'bg-blue-900 ring-2 ring-blue-500' 
                          : 'hover:bg-slate-700' 
                      }`}
                    >
                      {/* Yellow indicator line - positioned absolutely so it doesn't affect layout */}
                      {hasComments && (
                        <div className="absolute left-0 top-2 w-1 bg-yellow-400 rounded-full shadow-lg" style={{ height: 'calc(100% - 1rem)' }}></div>
                      )}
                      
                      {/* Line Number - Fixed width to maintain alignment */}
                      <div className="flex-shrink-0 w-16 text-right pr-2 relative z-10">
                        <button
                          onClick={() => setSelectedLine(index)}
                          className={`font-bold select-none cursor-pointer transition-colors ${
                            hasComments
                              ? 'text-blue-400 hover:text-blue-300'
                              : 'text-slate-500 hover:text-slate-400'
                          }`}
                          style={{ fontSize: `${Math.max(12, fontSize - 2)}px` }}
                          title={hasComments ? `${lineComments.length} comment(s) - Click to add more` : 'Click to add comment'}
                        >
                          {index + 1}
                        </button>
                      </div>
                      
                      {/* Script Line and Icons */}
                      <div className="flex-1 flex items-start justify-between relative z-10">
                        <div className={`whitespace-pre-wrap break-words ${
                          hasComments 
                            ? 'text-white font-medium bg-blue-900 rounded-md px-2 py-1' 
                            : 'text-white'
                        }`}>
                          {line || '\u00A0'}
                        </div>
                        {hasComments && (
                          <div className="flex items-center gap-1 flex-shrink-0 ml-4 bg-slate-800 px-2 py-1 rounded-lg">
                            {/* Show comment type icons */}
                            {[...new Set(lineComments.map(c => c.type || 'GENERAL'))].map(type => (
                              <span 
                                key={type} 
                                className={`text-lg px-1 rounded-full ${COMMENT_TYPES[type as CommentType].bgColor} shadow-md`}
                                title={COMMENT_TYPES[type as CommentType].label}
                              >
                                {COMMENT_TYPES[type as CommentType].icon}
                              </span>
                            ))}
                            <span className="text-sm bg-yellow-500 text-white rounded-full px-2 min-w-[24px] text-center font-bold shadow-md">
                              {lineComments.length}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
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

      {/* Script Manager Modal */}
      {showScriptManager && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-2xl font-bold">📂 Saved Scripts</h2>
              <button
                onClick={() => setShowScriptManager(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {savedScripts.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <p className="text-lg mb-2">No saved scripts yet</p>
                  <p className="text-sm">Import a script and click Save to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {savedScripts.map((script) => (
                    <div
                      key={script.id}
                      className="bg-slate-700 rounded-lg p-4 hover:bg-slate-650 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-bold text-lg mb-1">{script.script_name}</h3>
                          <div className="text-sm text-slate-400">
                            <p>Created: {new Date(script.created_at).toLocaleDateString()}</p>
                            {script.created_by && <p>By: {script.created_by}</p>}
                          </div>
                        </div>
                        
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => loadScriptFromDatabase(script.id)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => deleteScriptFromDatabase(script.id, script.script_name)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm font-medium transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptsFollowPage;

