-- Complete Change Log System
-- This tracks ALL changes made to run_of_show_data

-- Drop existing functions first to avoid conflicts
DROP FUNCTION IF EXISTS log_change(text, uuid, text, text, text, text, text, text, text, jsonb);
DROP FUNCTION IF EXISTS get_change_log(text, integer, integer);
DROP FUNCTION IF EXISTS get_change_log_summary(text);
DROP TABLE IF EXISTS change_log CASCADE;

-- Create a comprehensive change_log table
CREATE TABLE IF NOT EXISTS change_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text NOT NULL,
  user_role text NOT NULL,
  action text NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'ADD_ITEM', 'REMOVE_ITEM', 'FIELD_CHANGE'
  field_name text, -- Specific field that changed
  old_value text, -- Previous value
  new_value text, -- New value
  description text, -- Human-readable description
  metadata jsonb, -- Additional data
  created_at timestamp with time zone DEFAULT now()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_change_log_event_id ON change_log (event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_id ON change_log (user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log (created_at);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON change_log (action);

-- Create a function to log changes
CREATE OR REPLACE FUNCTION log_change(
  p_event_id text,
  p_user_id uuid,
  p_user_name text,
  p_user_role text,
  p_action text,
  p_field_name text DEFAULT NULL,
  p_old_value text DEFAULT NULL,
  p_new_value text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- Only log if user has EDITOR role
  IF p_user_role = 'EDITOR' THEN
    INSERT INTO change_log (
      event_id,
      user_id,
      user_name,
      user_role,
      action,
      field_name,
      old_value,
      new_value,
      description,
      metadata
    ) VALUES (
      p_event_id,
      p_user_id,
      p_user_name,
      p_user_role,
      p_action,
      p_field_name,
      p_old_value,
      p_new_value,
      p_description,
      p_metadata
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
  ELSE
    -- Return NULL if user is not an EDITOR
    RETURN NULL;
  END IF;
END;
$$;

-- Create a function to get all changes for an event
CREATE OR REPLACE FUNCTION get_change_log(
  p_event_id text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  event_id text,
  user_id uuid,
  user_name text,
  user_role text,
  action text,
  field_name text,
  old_value text,
  new_value text,
  description text,
  metadata jsonb,
  created_at timestamp with time zone,
  formatted_time text,
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
    cl.user_name,
    cl.user_role,
    cl.action,
    cl.field_name,
    cl.old_value,
    cl.new_value,
    cl.description,
    cl.metadata,
    cl.created_at,
    to_char(cl.created_at, 'YYYY-MM-DD HH12:MI:SS AM') as formatted_time,
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

-- Create a function to get change summary
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
    (SELECT cl2.user_name 
     FROM change_log cl2 
     WHERE cl2.event_id = p_event_id 
     GROUP BY cl2.user_name 
     ORDER BY COUNT(*) DESC 
     LIMIT 1) as most_active_editor,
    -- Most active editor's change count
    (SELECT COUNT(*) 
     FROM change_log cl3 
     WHERE cl3.event_id = p_event_id 
     AND cl3.user_name = (
       SELECT cl4.user_name 
       FROM change_log cl4 
       WHERE cl4.event_id = p_event_id 
       GROUP BY cl4.user_name 
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
      SELECT 1 FROM run_of_show_data rosd 
      WHERE rosd.event_id = change_log.event_id 
      AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
    )
  );

CREATE POLICY "Editors can insert change log entries" ON change_log
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM run_of_show_data rosd 
      WHERE rosd.event_id = change_log.event_id 
      AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
    )
  );

-- Grant permissions
GRANT ALL ON change_log TO authenticated;
GRANT EXECUTE ON FUNCTION log_change(text, uuid, text, text, text, text, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION get_change_log(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_change_log_summary(text) TO authenticated;
