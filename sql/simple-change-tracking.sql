-- Simple Change Tracking System
-- This uses the existing run_of_show_data table to track changes

-- Note: Run cleanup-change-log.sql first to remove all existing functions

-- Create a simple change_log table that stores snapshots
CREATE TABLE IF NOT EXISTS change_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  username text NOT NULL,
  user_role text NOT NULL,
  action text NOT NULL, -- 'CREATE', 'UPDATE', 'FIELD_CHANGE'
  field_name text, -- Specific field that changed
  old_value text, -- Previous value (as text for simplicity)
  new_value text, -- New value (as text for simplicity)
  change_summary text, -- Human-readable summary
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_change_log_event_id ON change_log (event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_id ON change_log (user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log (created_at);

-- Create a function to log a simple change (matches app expectations)
CREATE OR REPLACE FUNCTION log_change(
  p_event_id text,
  p_user_id uuid,
  p_user_name text,
  p_user_role text,
  p_action text,
  p_table_name text,
  p_record_id text,
  p_field_name text DEFAULT NULL,
  p_old_value text DEFAULT NULL,
  p_new_value text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_change_summary text;
  v_old_text text;
  v_new_text text;
BEGIN
  -- Only log if user has EDITOR role
  IF p_user_role = 'EDITOR' THEN
    -- Use the text values directly (app already converts to text)
    v_old_text := COALESCE(p_old_value, 'NULL');
    v_new_text := COALESCE(p_new_value, 'NULL');
    
    -- Create a simple summary
    v_change_summary := COALESCE(p_description, 
      p_action || ' on ' || p_table_name || 
      CASE WHEN p_field_name IS NOT NULL THEN ' (' || p_field_name || ')' ELSE '' END
    );
    
    INSERT INTO change_log (
      event_id,
      user_id,
      username,
      user_role,
      action,
      field_name,
      old_value,
      new_value,
      change_summary
    ) VALUES (
      p_event_id,
      p_user_id,
      p_user_name,
      p_user_role,
      p_action,
      p_field_name,
      v_old_text,
      v_new_text,
      v_change_summary
    );
  END IF;
END;
$$;

-- Create a function to get changes for an event (matches app expectations)
CREATE OR REPLACE FUNCTION get_change_log(
  p_event_id text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  event_id text,
  user_id uuid,
  username text,
  user_role text,
  action text,
  field_name text,
  old_value text,
  new_value text,
  change_summary text,
  created_at timestamp with time zone,
  time_ago text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cl.id,
    cl.event_id,
    cl.user_id,
    cl.username,
    cl.user_role,
    cl.action,
    cl.field_name,
    cl.old_value,
    cl.new_value,
    cl.change_summary,
    cl.created_at,
    -- Calculate time ago
    CASE 
      WHEN cl.created_at > now() - interval '1 minute' THEN 'Just now'
      WHEN cl.created_at > now() - interval '1 hour' THEN 
        EXTRACT(minutes FROM (now() - cl.created_at))::text || ' minutes ago'
      WHEN cl.created_at > now() - interval '1 day' THEN 
        EXTRACT(hours FROM (now() - cl.created_at))::text || ' hours ago'
      ELSE 
        EXTRACT(days FROM (now() - cl.created_at))::text || ' days ago'
    END as time_ago
  FROM change_log cl
  WHERE cl.event_id = p_event_id
  ORDER BY cl.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Create a function to get change summary (matches app expectations)
CREATE OR REPLACE FUNCTION get_change_log_summary(
  p_event_id text
)
RETURNS TABLE(
  total_changes bigint,
  editors_active bigint,
  last_change_at timestamp with time zone,
  most_active_editor text,
  most_active_editor_changes bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_changes,
    COUNT(DISTINCT cl.user_id) as editors_active,
    MAX(cl.created_at) as last_change_at,
    -- Most active editor
    (SELECT cl2.username 
     FROM change_log cl2 
     WHERE cl2.event_id = p_event_id 
     GROUP BY cl2.username 
     ORDER BY COUNT(*) DESC 
     LIMIT 1) as most_active_editor,
    -- Most active editor's change count
    (SELECT COUNT(*) 
     FROM change_log cl3 
     WHERE cl3.event_id = p_event_id 
     AND cl3.username = (
       SELECT cl4.username 
       FROM change_log cl4 
       WHERE cl4.event_id = p_event_id 
       GROUP BY cl4.username 
       ORDER BY COUNT(*) DESC 
       LIMIT 1
     )) as most_active_editor_changes
  FROM change_log cl
  WHERE cl.event_id = p_event_id;
END;
$$;

-- Enable RLS
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view changes for events they have access to" ON change_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_sessions us 
      WHERE us.event_id = change_log.event_id 
      AND us.user_id = auth.uid()
    )
  );

CREATE POLICY "Editors can insert change log entries" ON change_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_sessions us 
      WHERE us.event_id = change_log.event_id 
      AND us.user_id = auth.uid()
      AND us.user_role = 'EDITOR'
    )
  );

-- Grant permissions
GRANT ALL ON change_log TO authenticated;
GRANT EXECUTE ON FUNCTION log_change TO authenticated;
GRANT EXECUTE ON FUNCTION get_change_log TO authenticated;
GRANT EXECUTE ON FUNCTION get_change_log_summary TO authenticated;

-- Create a simple view for easy querying
CREATE OR REPLACE VIEW change_log_view AS
SELECT 
  cl.id,
  cl.event_id,
  cl.username,
  cl.user_role,
  cl.action,
  cl.field_name,
  cl.old_value,
  cl.new_value,
  cl.change_summary,
  cl.created_at,
  -- Format timestamp
  to_char(cl.created_at, 'YYYY-MM-DD HH24:MI:SS') as formatted_time,
  -- Time ago
  CASE 
    WHEN cl.created_at > now() - interval '1 minute' THEN 'Just now'
    WHEN cl.created_at > now() - interval '1 hour' THEN 
      EXTRACT(minutes FROM (now() - cl.created_at))::text || ' minutes ago'
    WHEN cl.created_at > now() - interval '1 day' THEN 
      EXTRACT(hours FROM (now() - cl.created_at))::text || ' hours ago'
    ELSE 
      EXTRACT(days FROM (now() - cl.created_at))::text || ' days ago'
  END as time_ago
FROM change_log cl
ORDER BY cl.created_at DESC;

GRANT SELECT ON change_log_view TO authenticated;
