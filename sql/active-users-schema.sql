-- Create the active_users table for tracking user sessions
CREATE TABLE IF NOT EXISTS active_users (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    username TEXT NOT NULL,
    browser_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'VIEWER',
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_active_users_event_id ON active_users(event_id);
CREATE INDEX IF NOT EXISTS idx_active_users_last_seen ON active_users(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_active_users_username ON active_users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_users_event_username ON active_users(event_id, username);

-- Enable Row Level Security (RLS)
ALTER TABLE active_users ENABLE ROW LEVEL SECURITY;

-- Create policies for RLS (drop existing ones first to avoid conflicts)
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON active_users;
DROP POLICY IF EXISTS "Allow all operations for anonymous users" ON active_users;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all operations for authenticated users" ON active_users
    FOR ALL USING (auth.role() = 'authenticated');

-- Allow all operations for anonymous users (for development - you may want to restrict this in production)
CREATE POLICY "Allow all operations for anonymous users" ON active_users
    FOR ALL USING (true);

-- Create a trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_active_users_updated_at 
    BEFORE UPDATE ON active_users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create a function to clean up old inactive users (can be called manually or via cron)
CREATE OR REPLACE FUNCTION cleanup_inactive_users()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM active_users 
    WHERE last_seen < NOW() - INTERVAL '1 hour';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to run cleanup every hour (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-inactive-users', '0 * * * *', 'SELECT cleanup_inactive_users();');
