-- Simple Last Change Log System
-- This reads the existing user tracking data from run_of_show_data table

-- Create a simple view that shows the last change info
CREATE OR REPLACE VIEW last_change_log AS
SELECT 
  event_id,
  event_name,
  last_modified_by,
  last_modified_by_name,
  last_modified_by_role,
  updated_at,
  -- Format the timestamp nicely (12-hour format)
  to_char(updated_at, 'YYYY-MM-DD HH12:MI:SS AM') as formatted_time,
  -- Calculate time ago
  CASE 
    WHEN updated_at > now() - interval '1 minute' THEN 'Just now'
    WHEN updated_at > now() - interval '1 hour' THEN 
      EXTRACT(minutes FROM (now() - updated_at))::text || ' minutes ago'
    WHEN updated_at > now() - interval '1 day' THEN 
      EXTRACT(hours FROM (now() - updated_at))::text || ' hours ago'
    ELSE 
      EXTRACT(days FROM (now() - updated_at))::text || ' days ago'
  END as time_ago
FROM run_of_show_data
ORDER BY updated_at DESC;

-- Create a function to get last change for a specific event
CREATE OR REPLACE FUNCTION get_last_change(
  p_event_id text
)
RETURNS TABLE(
  event_id text,
  event_name text,
  last_modified_by uuid,
  last_modified_by_name text,
  last_modified_by_role text,
  updated_at timestamp with time zone,
  formatted_time text,
  time_ago text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rosd.event_id,
    rosd.event_name,
    rosd.last_modified_by,
    rosd.last_modified_by_name,
    rosd.last_modified_by_role,
    rosd.updated_at,
    to_char(rosd.updated_at, 'YYYY-MM-DD HH12:MI:SS AM') as formatted_time,
    CASE 
      WHEN rosd.updated_at > now() - interval '1 minute' THEN 'Just now'
      WHEN rosd.updated_at > now() - interval '1 hour' THEN 
        EXTRACT(minutes FROM (now() - rosd.updated_at))::text || ' minutes ago'
      WHEN rosd.updated_at > now() - interval '1 day' THEN 
        EXTRACT(hours FROM (now() - rosd.updated_at))::text || ' hours ago'
      ELSE 
        EXTRACT(days FROM (now() - rosd.updated_at))::text || ' days ago'
    END as time_ago
  FROM run_of_show_data rosd
  WHERE rosd.event_id = p_event_id
  ORDER BY rosd.updated_at DESC
  LIMIT 1;
END;
$$;

-- Create a function to get change history (all events)
CREATE OR REPLACE FUNCTION get_change_history(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  event_id text,
  event_name text,
  last_modified_by uuid,
  last_modified_by_name text,
  last_modified_by_role text,
  updated_at timestamp with time zone,
  formatted_time text,
  time_ago text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rosd.event_id,
    rosd.event_name,
    rosd.last_modified_by,
    rosd.last_modified_by_name,
    rosd.last_modified_by_role,
    rosd.updated_at,
    to_char(rosd.updated_at, 'YYYY-MM-DD HH12:MI:SS AM') as formatted_time,
    CASE 
      WHEN rosd.updated_at > now() - interval '1 minute' THEN 'Just now'
      WHEN rosd.updated_at > now() - interval '1 hour' THEN 
        EXTRACT(minutes FROM (now() - rosd.updated_at))::text || ' minutes ago'
      WHEN rosd.updated_at > now() - interval '1 day' THEN 
        EXTRACT(hours FROM (now() - rosd.updated_at))::text || ' hours ago'
      ELSE 
        EXTRACT(days FROM (now() - rosd.updated_at))::text || ' days ago'
    END as time_ago
  FROM run_of_show_data rosd
  ORDER BY rosd.updated_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Grant permissions
GRANT SELECT ON last_change_log TO authenticated;
GRANT EXECUTE ON FUNCTION get_last_change(text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_change_history(integer, integer) TO authenticated;
