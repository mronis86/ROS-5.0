const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function checkSubCueTimersTable() {
  try {
    console.log('🔍 Checking sub_cue_timers table in Neon database...');
    
    // Check if table exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'sub_cue_timers'
      );
    `);
    
    console.log('📋 sub_cue_timers table exists:', tableExists.rows[0].exists);
    
    if (tableExists.rows[0].exists) {
      // Check table structure
      const columns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'sub_cue_timers' 
        ORDER BY ordinal_position;
      `);
      
      console.log('📋 Current table structure:');
      columns.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
      
      // Check if there are any records
      const count = await pool.query('SELECT COUNT(*) FROM sub_cue_timers');
      console.log(`📊 Total records in table: ${count.rows[0].count}`);
    } else {
      console.log('❌ sub_cue_timers table does not exist - need to create it');
    }
    
  } catch (error) {
    console.error('❌ Error checking sub_cue_timers table:', error);
  } finally {
    await pool.end();
  }
}

checkSubCueTimersTable();
