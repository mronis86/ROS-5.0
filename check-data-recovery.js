// Data Recovery Check Script
// Run this in your browser's console to check if your data is still there

console.log('🔍 Checking for data recovery...');

// Check localStorage first
const localStorageKeys = Object.keys(localStorage).filter(key => 
  key.includes('runOfShow') || 
  key.includes('run_of_show') || 
  key.includes('event') || 
  key.includes('schedule')
);

console.log('📱 localStorage keys found:', localStorageKeys);

// Check each localStorage key for data
localStorageKeys.forEach(key => {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    console.log(`📄 ${key}:`, data);
  } catch (e) {
    console.log(`❌ ${key}: Not valid JSON`);
  }
});

// Instructions for checking Supabase
console.log(`
🗄️ To check your Supabase data:

1. Go to your Supabase dashboard
2. Navigate to the Table Editor
3. Look at the 'run_of_show_data' table
4. Check the 'schedule_items' column (it's JSONB)
5. Your 3 rows should be there as JSON data

The data structure should look like:
{
  "id": 1,
  "event_id": "your-event-id",
  "schedule_items": [
    { "id": 1, "name": "Item 1", ... },
    { "id": 2, "name": "Item 2", ... },
    { "id": 3, "name": "Item 3", ... }
  ],
  ...
}

If you see the data in Supabase but not in the app, the issue might be:
- Authentication/permissions
- Event ID mismatch
- Data loading logic

Let me know what you find!
`);
