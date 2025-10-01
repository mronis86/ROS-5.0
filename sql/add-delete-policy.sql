-- Add DELETE policies for change_log and change_log_batches tables
-- This allows users to delete change logs for events they have access to

-- DELETE policy for change_log table
CREATE POLICY "Users can delete change logs for their events" ON change_log
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM user_sessions 
            WHERE user_sessions.user_id = auth.uid() 
            AND user_sessions.event_id = change_log.event_id
        )
    );

-- DELETE policy for change_log_batches table
CREATE POLICY "Users can delete change batches for their events" ON change_log_batches
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM run_of_show_data rosd 
            WHERE rosd.event_id = change_log_batches.event_id 
            AND (rosd.last_modified_by::text = auth.uid()::text OR auth.uid() IS NOT NULL)
        )
    );
