const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function fixSubCueTimersSchema() {
  try {
    console.log('🔧 Fixing sub_cue_timers table schema...');
    
    // Read the migration file
    const fs = require('fs');
    const migrationSQL = fs.readFileSync('migrations/007_fix_sub_cue_timers_schema.sql', 'utf8');
    
    // Execute the migration
    await pool.query(migrationSQL);
    
    console.log('✅ sub_cue_timers table schema fixed successfully!');
    
    // Test the table by inserting and querying a record
    console.log('🧪 Testing sub_cue_timers table...');
    
    const testEventId = '00000000-0000-0000-0000-000000000001';
    
    // Insert a test sub-cue timer
    const insertResult = await pool.query(
      `INSERT INTO sub_cue_timers (
        event_id, item_id, user_id, user_name, user_role, duration_seconds, 
        row_number, cue_display, timer_id, is_active, is_running, started_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        testEventId, 
        1234567890, 
        'test-user', 
        'Test User', 
        'OPERATOR', 
        60, 
        1, 
        'Test Cue', 
        'test-timer-id', 
        true, 
        true, 
        new Date().toISOString()
      ]
    );
    
    console.log('✅ Test sub-cue timer inserted:', insertResult.rows[0]);
    
    // Query the test sub-cue timer
    const queryResult = await pool.query(
      'SELECT * FROM sub_cue_timers WHERE event_id = $1',
      [testEventId]
    );
    
    console.log('✅ Test sub-cue timer retrieved:', queryResult.rows[0]);
    
    // Clean up test record
    await pool.query('DELETE FROM sub_cue_timers WHERE event_id = $1', [testEventId]);
    console.log('✅ Test record cleaned up');
    
    console.log('🎉 sub_cue_timers table is ready for use!');
    
  } catch (error) {
    console.error('❌ Error fixing sub_cue_timers table schema:', error);
  } finally {
    await pool.end();
  }
}

fixSubCueTimersSchema();
