# Change Log Debugging Guide

## Issue: Changes not appearing in change_log table

### Step 1: Verify the change_log table exists

Run this SQL in your Neon console:

```sql
SELECT EXISTS (
  SELECT FROM information_schema.tables 
  WHERE table_name = 'change_log'
);
```

If it returns `false`, run the migration:
```bash
# Run this SQL file in Neon console
sql/complete-change-log-system.sql
```

### Step 2: Check API endpoints

Test if the API endpoints are working:

```bash
# Test GET endpoint
curl http://localhost:3001/api/change-log/YOUR_EVENT_ID

# Test POST endpoint
curl -X POST http://localhost:3001/api/change-log \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "test-event",
    "user_id": "test-user",
    "user_name": "Test User",
    "user_role": "EDITOR",
    "action": "TEST",
    "table_name": "test_table",
    "record_id": "test-record",
    "description": "Test change"
  }'
```

### Step 3: Check browser console

Open browser DevTools Console and look for:

1. **Change log service initialization:**
   ```
   🔄 Auto-syncing X changes...
   ```

2. **API calls:**
   ```
   📤 Sending change to API: {...}
   ✅ Change logged successfully: {...}
   ```

3. **Errors:**
   ```
   ❌ Error logging individual change: ...
   ```

### Step 4: Check localStorage

Open browser DevTools > Application > Local Storage and look for:
- `runofshow_local_changes` - Should contain your local changes

### Step 5: Manual sync test

In the browser console, run:
```javascript
// Check if changes exist
changeLogService.getChangesCount()

// Get unsynced changes
changeLogService.getUnsyncedChanges()

// Force sync
changeLogService.syncChanges()
```

### Step 6: Check API server logs

Look for these in your API server logs:
```
📝 Logging change: {...}
✅ Change logged: <change-id>
```

### Common Issues:

1. **Table doesn't exist** → Run SQL migration
2. **API not accessible** → Check NEON_DATABASE_URL and API server
3. **CORS issues** → Check API server CORS settings
4. **User not authenticated** → Check if user has EDITOR role
5. **Changes not triggering** → Check if `logChange()` is being called

### Quick Fix:

If nothing works, you can manually insert a test record:

```sql
INSERT INTO change_log (
  event_id, user_id, user_name, user_role, action, 
  table_name, record_id, description
) VALUES (
  'test-event-123',
  '00000000-0000-0000-0000-000000000000',
  'Test User',
  'EDITOR',
  'TEST',
  'test_table',
  'test-record',
  'Manual test entry'
);

-- Then check if it appears
SELECT * FROM change_log ORDER BY created_at DESC LIMIT 5;
```

