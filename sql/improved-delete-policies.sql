-- ===== IMPROVED DELETE POLICIES FOR CHANGE LOG CLEARING =====

-- First, check what policies already exist
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('change_log', 'change_log_batches');

-- Drop existing DELETE policies if they exist (optional)
-- DROP POLICY IF EXISTS "Users can delete change logs for their events" ON change_log;
-- DROP POLICY IF EXISTS "Users can delete change batches for their events" ON change_log_batches;

-- More permissive DELETE policy for change_log table
CREATE POLICY "Allow authenticated users to delete change logs" ON change_log
    FOR DELETE 
    TO authenticated 
    USING (
        -- Allow if user is authenticated and it's their event
        auth.uid() IS NOT NULL AND (
            -- Check if user has access via user_sessions
            EXISTS (
                SELECT 1 FROM user_sessions 
                WHERE user_sessions.user_id = auth.uid() 
                AND user_sessions.event_id = change_log.event_id
            )
            OR
            -- Check if user has access via run_of_show_data
            EXISTS (
                SELECT 1 FROM run_of_show_data 
                WHERE run_of_show_data.event_id = change_log.event_id 
                AND (
                    run_of_show_data.last_modified_by::text = auth.uid()::text 
                    OR run_of_show_data.created_by::text = auth.uid()::text
                )
            )
            OR
            -- Allow if user created the change log entry
            change_log.user_id = auth.uid()
        )
    );

-- More permissive DELETE policy for change_log_batches table  
CREATE POLICY "Allow authenticated users to delete change batches" ON change_log_batches
    FOR DELETE 
    TO authenticated 
    USING (
        -- Allow if user is authenticated and it's their event
        auth.uid() IS NOT NULL AND (
            -- Check if user has access via run_of_show_data
            EXISTS (
                SELECT 1 FROM run_of_show_data 
                WHERE run_of_show_data.event_id = change_log_batches.event_id 
                AND (
                    run_of_show_data.last_modified_by::text = auth.uid()::text 
                    OR run_of_show_data.created_by::text = auth.uid()::text
                )
            )
            OR
            -- Check if user has access via user_sessions
            EXISTS (
                SELECT 1 FROM user_sessions 
                WHERE user_sessions.user_id = auth.uid() 
                AND user_sessions.event_id = change_log_batches.event_id
            )
            OR
            -- Allow if user created the batch
            change_log_batches.created_by = auth.uid()
        )
    );

-- Alternative: If the above is too restrictive, try this more permissive version
-- WARNING: This is less secure but will definitely work for testing

-- CREATE POLICY "Allow all authenticated delete on change_log" ON change_log
--     FOR DELETE 
--     TO authenticated 
--     USING (auth.uid() IS NOT NULL);

-- CREATE POLICY "Allow all authenticated delete on change_log_batches" ON change_log_batches
--     FOR DELETE 
--     TO authenticated 
--     USING (auth.uid() IS NOT NULL);
