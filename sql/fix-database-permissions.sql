-- Fix Database Permissions for Neon
-- This script grants the necessary permissions for anonymous users to delete from tables

-- Grant permissions for anonymous/public access
-- Allow anonymous users to perform all operations on these tables
GRANT ALL ON TABLE active_timers TO anon;
GRANT ALL ON TABLE sub_cue_timers TO anon;
GRANT ALL ON TABLE completed_cues TO anon;
GRANT ALL ON TABLE timer_actions TO anon;

-- Grant permissions for authenticated users
GRANT ALL ON TABLE active_timers TO authenticated;
GRANT ALL ON TABLE sub_cue_timers TO authenticated;
GRANT ALL ON TABLE completed_cues TO authenticated;
GRANT ALL ON TABLE timer_actions TO authenticated;

-- Grant permissions for service role
GRANT ALL ON TABLE active_timers TO service_role;
GRANT ALL ON TABLE sub_cue_timers TO service_role;
GRANT ALL ON TABLE completed_cues TO service_role;
GRANT ALL ON TABLE timer_actions TO service_role;

-- Grant sequence permissions (for UUID generation)
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Verify permissions were granted
SELECT 
    schemaname,
    tablename,
    tableowner,
    hasinserts,
    hasselects,
    hasupdates,
    hasdeletes
FROM pg_tables 
WHERE tablename IN ('active_timers', 'sub_cue_timers', 'completed_cues', 'timer_actions')
AND schemaname = 'public';
