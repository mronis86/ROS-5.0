# Socket.IO Implementation - Current Status

**Date:** October 10, 2025  
**Branch:** socket-io-attempt (now on master)  
**Deployed:** Railway (deploying now)

---

## ✅ **Fixed Issues**

### 1. Timer Button State Persistence ✅
**Problem:** LOAD button not holding "LOADED" state  
**Root Cause:** WebSocket sending `item_id` as STRING, buttons comparing as NUMBER  
**Fix:** Added type conversion in WebSocket `onTimerUpdated` callback  
```javascript
const numericItemId = typeof data.item_id === 'string' ? parseInt(data.item_id) : data.item_id;
setActiveItemId(numericItemId);
```
**Status:** FIXED - buttons now work correctly

### 2. Toast Notifications ✅
**Problem:** Not showing toast when timer starts  
**Root Cause:** Logic was correct, just needed message format improvement  
**Fix:** 
- Changed message format to "57m before CUE 0 expected start"
- Added 10-second auto-dismiss
**Status:** FIXED - toasts working

### 3. ClockPage Timer Synchronization ✅
**Problem:** Timer flipping between values when time adjusted  
**Root Cause:** Conflicting updates from postMessage AND WebSocket  
**Fix:** Disabled postMessage, using WebSocket only (like PhotoViewPage)  
**Status:** FIXED - ClockPage now standalone with WebSocket

---

## ⚠️ **Known Issues to Fix**

### 1. Timer Adjustment Buttons (-5, -1, +1, +5)
**Problem:** Buttons not responding  
**Status:** DEBUGGING ADDED  
**Next Step:** Check console logs to see why buttons aren't working  
**Possible Causes:**
- activeItemId not set correctly
- User role check failing
- API call failing

### 2. Flickering/Smoothness
**Problem:** UI feels flickery compared to WebSocket version  
**Possible Causes:**
- Too many re-renders from WebSocket updates
- `runOfShowDataUpdated` callback updating schedule too frequently
- React re-rendering entire component on state changes

**Potential Solutions:**
- Add `React.memo()` to memoize schedule rows
- Use `useMemo()` for expensive calculations
- Throttle WebSocket updates
- Only update changed items instead of entire schedule

### 3. Start Time Saving
**Problem:** Needs verification  
**Status:** Debugging logs added  
**Next Step:** Verify logs show proper saving

---

## 🔧 **Recommended Next Steps**

1. **Test Timer Adjustment Buttons:**
   - Load a cue
   - Start the timer
   - Click +1 or -1
   - Check console for `⏱️⏱️⏱️ ADJUST TIMER CLICKED` logs
   - Report what the logs show

2. **Identify Flickering Source:**
   - Open browser performance profiler
   - Start a timer
   - Look for excessive re-renders
   - Check if `runOfShowDataUpdated` is being called repeatedly

3. **Optimize Re-renders:**
   - Add `React.memo` to schedule row components
   - Use `useCallback` for event handlers
   - Throttle WebSocket updates if needed

---

## 📊 **Performance Comparison**

### WebSocket Version (Old):
- ✅ Smooth, no flickering
- ✅ Responsive buttons
- ❌ Had the STRING vs NUMBER bug (but we didn't notice)
- ❌ Same `runOfShowDataUpdated` callback

### Socket.IO Version (Current):
- ✅ Type conversion fix applied
- ✅ ClockPage standalone
- ✅ Toast notifications improved
- ⚠️ Flickering issues
- ⚠️ Button responsiveness issues

---

## 💡 **Theory**

The WebSocket and Socket.IO versions should be nearly identical in terms of updates. The flickering might be caused by:

1. **React 18 Strict Mode** - Mounting components twice in development
2. **Unnecessary re-renders** - State updates triggering full component re-renders
3. **Browser tab visibility API** - Different behavior when switching tabs

The fix might be as simple as optimizing the React rendering, not the WebSocket logic itself.

---

## 🎯 **Action Plan**

1. Get timer adjustment button logs
2. Add React.memo to schedule rows
3. Use useMemo for calculated values
4. Test if flickering improves
5. If still issues, compare WebSocket vs Socket.IO callbacks line-by-line

---

**Updated:** Debugging logs added to timer adjustment function
**Next:** Wait for user testing and logs

