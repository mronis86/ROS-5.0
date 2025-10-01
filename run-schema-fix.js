#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runSchemaFix() {
  console.log('🔧 Starting database schema fix...');
  
  // Create database connection
  const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    // Test connection
    console.log('🔍 Testing database connection...');
    const testResult = await pool.query('SELECT NOW()');
    console.log('✅ Database connected:', testResult.rows[0].now);

    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '004_fix_active_timers_schema.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Running schema fix migration...');
    
    // Execute the migration
    const result = await pool.query(migrationSQL);
    
    console.log('✅ Schema fix completed successfully!');
    console.log('📊 Migration result:', result);
    
    // Verify the table structure
    console.log('🔍 Verifying table structure...');
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'active_timers' 
      ORDER BY ordinal_position
    `);
    
    console.log('📋 Active timers table structure:');
    tableInfo.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
    });
    
    // Test inserting a record
    console.log('🧪 Testing record insertion...');
    const testInsert = await pool.query(`
      INSERT INTO active_timers (
        event_id, 
        item_id, 
        user_id, 
        timer_state, 
        is_active, 
        is_running, 
        started_at,
        duration_seconds
      ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        123,
        'test-user',
        'loaded',
        true,
        false,
        '2099-12-31T23:59:59.999Z',
        300
      ) RETURNING *
    `);
    
    console.log('✅ Test record inserted:', testInsert.rows[0].id);
    
    // Clean up test record
    await pool.query("DELETE FROM active_timers WHERE event_id = '00000000-0000-0000-0000-000000000001'");
    console.log('🧹 Test record cleaned up');
    
  } catch (error) {
    console.error('❌ Schema fix failed:', error.message);
    console.error('📋 Error details:', error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Database connection closed');
  }
}

// Run the schema fix
runSchemaFix().then(() => {
  console.log('🎉 Schema fix completed successfully!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Schema fix failed:', error);
  process.exit(1);
});
