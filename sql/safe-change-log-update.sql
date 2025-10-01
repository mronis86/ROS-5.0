-- Safe Change Log Update (Preserves Existing Data)
-- This script adds the new columns without dropping existing data

-- Add new columns to existing change_log table
ALTER TABLE change_log 
ADD COLUMN IF NOT EXISTS table_name text,
ADD COLUMN IF NOT EXISTS record_id text,
ADD COLUMN IF NOT EXISTS row_number integer,
ADD COLUMN IF NOT EXISTS cue_number text;

-- Update the log_change function to include new parameters
CREATE OR REPLACE FUNCTION log_change(
  p_event_id text,
  p_user_id uuid,
  p_user_name text,
  p_user_role text,
  p_action text,
  p_table_name text DEFAULT NULL,
  p_record_id text DEFAULT NULL,
  p_field_name text DEFAULT NULL,
  p_old_value text DEFAULT NULL,
  p_new_value text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_row_number integer DEFAULT NULL,
  p_cue_number text DEFAULT NULL,
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
      table_name,
      record_id,
      field_name,
      old_value,
      new_value,
      description,
      row_number,
      cue_number,
      metadata
    ) VALUES (
      p_event_id,
      p_user_id,
      p_user_name,
      p_user_role,
      p_action,
      p_table_name,
      p_record_id,
      p_field_name,
      p_old_value,
      p_new_value,
      p_description,
      p_row_number,
      p_cue_number,
      p_metadata
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
  ELSE
    -- Return NULL if user is not an EDITOR
    RETURN NULL;
  END IF;
END;
$$;

-- Update the get_change_log function to include new columns
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
  table_name text,
  record_id text,
  field_name text,
  old_value text,
  new_value text,
  description text,
  row_number integer,
  cue_number text,
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
    cl.table_name,
    cl.record_id,
    cl.field_name,
    cl.old_value,
    cl.new_value,
    cl.description,
    cl.row_number,
    cl.cue_number,
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

-- Grant permissions for the updated function
GRANT EXECUTE ON FUNCTION log_change(text, uuid, text, text, text, text, text, text, text, text, integer, text, jsonb) TO authenticated;

-- Verify the data is still there
SELECT 
  'run_of_show_data' as table_name,
  COUNT(*) as record_count,
  'Your main data should be here' as note
FROM run_of_show_data;

SELECT 
  'change_log' as table_name,
  COUNT(*) as record_count,
  'Change log entries (may be empty if you just created the table)' as note
FROM change_log;
