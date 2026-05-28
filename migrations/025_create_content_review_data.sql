-- Content Review: per-event review status, notes, and UI preferences (Neon Postgres)

CREATE TABLE IF NOT EXISTS content_review_data (
    event_id TEXT PRIMARY KEY,
    reviews JSONB NOT NULL DEFAULT '{}'::jsonb,
    stream_url TEXT,
    creative_pdf_url TEXT,
    active_stage TEXT NOT NULL DEFAULT 'creative',
    side_rail_width_px INTEGER,
    last_modified_by TEXT,
    last_modified_by_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT content_review_active_stage_check CHECK (active_stage IN ('creative', 'ros'))
);

CREATE INDEX IF NOT EXISTS idx_content_review_data_updated_at ON content_review_data(updated_at);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_content_review_data_updated_at'
    ) THEN
        CREATE TRIGGER update_content_review_data_updated_at
            BEFORE UPDATE ON content_review_data
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE content_review_data IS 'Content Review page state: cue approval status (creative/ros), stream URL, creative PDF URL';
COMMENT ON COLUMN content_review_data.reviews IS 'Map of schedule item_id -> { creative: {status, note, ...}, ros: {...} }';

GRANT ALL ON TABLE content_review_data TO public;
GRANT ALL ON TABLE content_review_data TO authenticated;
GRANT ALL ON TABLE content_review_data TO service_role;
