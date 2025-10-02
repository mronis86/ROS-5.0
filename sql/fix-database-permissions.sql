-- Fix Database Permissions for Neon
-- This script grants the necessary permissions for public access to delete from tables

-- Grant permissions for public access (allows anonymous users)
-- Allow public users to perform all operations on these tables
GRANT ALL ON TABLE active_timers TO public;
GRANT ALL ON TABLE sub_cue_timers TO public;
GRANT ALL ON TABLE completed_cues TO public;
GRANT ALL ON TABLE timer_actions TO public;

-- Grant permissions for authenticated users (if they exist)
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
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO public;
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
