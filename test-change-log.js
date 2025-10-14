// Test script to check if change_log table exists and can be written to
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function testChangeLog() {
  try {
    console.log('🔍 Testing change_log table...\n');

    // 1. Check if table exists
    console.log('1. Checking if change_log table exists...');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'change_log'
      );
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log('✅ change_log table exists\n');
    } else {
      console.log('❌ change_log table does NOT exist\n');
      console.log('Please run the SQL migration: sql/complete-change-log-system.sql');
      process.exit(1);
    }

    // 2. Check table structure
    console.log('2. Checking table structure...');
    const columns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'change_log'
      ORDER BY ordinal_position;
    `);
    console.log('Columns:');
    columns.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });
    console.log('');

    // 3. Try to insert a test record
    console.log('3. Testing INSERT operation...');
    const testInsert = await pool.query(`
      INSERT INTO change_log (
        event_id, user_id, user_name, action, 
        table_name, record_id, old_values, new_values, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      ) RETURNING id, created_at;
    `, [
      'test-event-' + Date.now(),
      '00000000-0000-0000-0000-000000000000',
      'Test User',
      'TEST',
      'test_table',
      'test-record',
      null,
      JSON.stringify({ description: 'This is a test change log entry' }),
      JSON.stringify({ test: true })
    ]);
    
    const insertedId = testInsert.rows[0].id;
    console.log(`✅ Successfully inserted test record with ID: ${insertedId}`);
    console.log(`   Created at: ${testInsert.rows[0].created_at}\n`);

    // 4. Verify the record
    console.log('4. Verifying the test record...');
    const verify = await pool.query(`
      SELECT * FROM change_log WHERE id = $1;
    `, [insertedId]);
    
    if (verify.rows.length > 0) {
      console.log('✅ Test record found in database');
      console.log(`   Action: ${verify.rows[0].action}`);
      console.log(`   Description: ${verify.rows[0].description}`);
      console.log(`   User: ${verify.rows[0].user_name} (${verify.rows[0].user_role})\n`);
    } else {
      console.log('❌ Test record NOT found\n');
    }

    // 5. Clean up test record
    console.log('5. Cleaning up test record...');
    await pool.query('DELETE FROM change_log WHERE id = $1;', [insertedId]);
    console.log('✅ Test record deleted\n');

    // 6. Count total records
    console.log('6. Checking total records in change_log...');
    const count = await pool.query('SELECT COUNT(*) as total FROM change_log;');
    console.log(`   Total records: ${count.rows[0].total}\n`);

    console.log('✅ All tests passed! The change_log table is working correctly.\n');
    
  } catch (error) {
    console.error('❌ Error testing change_log:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testChangeLog();

