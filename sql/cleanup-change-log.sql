-- Quick cleanup script to remove all change log functions and tables
-- Run this first, then run the main script

-- Drop all log_change functions
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT proname, oidvectortypes(proargtypes) as args 
              FROM pg_proc 
              WHERE proname = 'log_change') 
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.proname || '(' || r.args || ') CASCADE';
    END LOOP;
END $$;

-- Drop all get_change_log functions
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT proname, oidvectortypes(proargtypes) as args 
              FROM pg_proc 
              WHERE proname = 'get_change_log') 
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.proname || '(' || r.args || ') CASCADE';
    END LOOP;
END $$;

-- Drop all get_change_log_summary functions
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT proname, oidvectortypes(proargtypes) as args 
              FROM pg_proc 
              WHERE proname = 'get_change_log_summary') 
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.proname || '(' || r.args || ') CASCADE';
    END LOOP;
END $$;

-- Drop the table
DROP TABLE IF EXISTS change_log CASCADE;

-- Drop any views
DROP VIEW IF EXISTS change_log_view CASCADE;

