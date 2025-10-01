-- Enable real-time for timer_messages table
-- This allows ClockPage to receive real-time updates when timer messages change

-- Add timer_messages table to real-time publication
ALTER PUBLICATION supabase_realtime ADD TABLE timer_messages;

-- Verify the table is added to real-time
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime' 
AND tablename = 'timer_messages';
