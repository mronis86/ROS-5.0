-- Extended Event Controls: per-event specialty module data (separate from run_of_show_data)

CREATE TABLE IF NOT EXISTS extended_event_data (
    event_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    module_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extended_event_data_enabled
  ON extended_event_data (enabled)
  WHERE enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_extended_event_data_updated_at
  ON extended_event_data (updated_at);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'update_extended_event_data_updated_at'
    ) THEN
        CREATE TRIGGER update_extended_event_data_updated_at
            BEFORE UPDATE ON extended_event_data
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE extended_event_data IS
  'Specialty Extend Event Controls linked to calendar/ROS event_id (e.g. Civics Bee roster). Kept separate from run_of_show_data.';
COMMENT ON COLUMN extended_event_data.enabled IS 'When true, ROS menu shows Extend Event Controls';
COMMENT ON COLUMN extended_event_data.modules IS 'JSON array of module ids, e.g. ["civicsBee"]';
COMMENT ON COLUMN extended_event_data.module_data IS 'Map of module id -> payload, e.g. { "civicsBee": { "entries": [...] } }';

GRANT ALL ON TABLE extended_event_data TO public;
GRANT ALL ON TABLE extended_event_data TO authenticated;
GRANT ALL ON TABLE extended_event_data TO service_role;
