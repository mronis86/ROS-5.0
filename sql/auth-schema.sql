-- Enable Row Level Security
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- Create user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'VIEWER',
    email TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for user_profiles
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;

CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Create a trigger to automatically update the updated_at timestamp
CREATE TRIGGER update_user_profiles_updated_at 
    BEFORE UPDATE ON user_profiles 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create change_log table for tracking changes
CREATE TABLE IF NOT EXISTS change_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    event_id TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    user_name TEXT,
    action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE'
    table_name TEXT NOT NULL, -- 'schedule_items', 'custom_columns', etc.
    record_id TEXT,
    old_values JSONB,
    new_values JSONB,
    description TEXT
);

-- Create indexes for change_log
CREATE INDEX IF NOT EXISTS idx_change_log_event_id ON change_log(event_id);
CREATE INDEX IF NOT EXISTS idx_change_log_user_id ON change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_change_log_created_at ON change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_log_action ON change_log(action);

-- Enable Row Level Security for change_log
ALTER TABLE change_log ENABLE ROW LEVEL SECURITY;

-- Create policies for change_log
DROP POLICY IF EXISTS "Users can view change log for events they have access to" ON change_log;
DROP POLICY IF EXISTS "Users can insert change log entries" ON change_log;

CREATE POLICY "Users can view change log for events they have access to" ON change_log
    FOR SELECT USING (true); -- Allow all authenticated users to view changes

CREATE POLICY "Users can insert change log entries" ON change_log
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Update active_users table to reference authenticated users
ALTER TABLE active_users 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for the new user_id column
CREATE INDEX IF NOT EXISTS idx_active_users_user_id ON active_users(user_id);

-- Update policies for active_users to work with authenticated users
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON active_users;
DROP POLICY IF EXISTS "Allow all operations for anonymous users" ON active_users;

CREATE POLICY "Users can manage their own active sessions" ON active_users
    FOR ALL USING (auth.uid() = user_id);

-- Create function to log changes
CREATE OR REPLACE FUNCTION log_change(
    p_event_id TEXT,
    p_action TEXT,
    p_table_name TEXT,
    p_record_id TEXT DEFAULT NULL,
    p_old_values JSONB DEFAULT NULL,
    p_new_values JSONB DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    change_id UUID;
    current_user_id UUID;
    current_user_name TEXT;
BEGIN
    -- Get current user info
    current_user_id := auth.uid();
    
    -- Get user name from profile
    SELECT full_name INTO current_user_name 
    FROM user_profiles 
    WHERE id = current_user_id;
    
    -- Insert change log entry
    INSERT INTO change_log (
        event_id,
        user_id,
        user_name,
        action,
        table_name,
        record_id,
        old_values,
        new_values,
        description
    ) VALUES (
        p_event_id,
        current_user_id,
        current_user_name,
        p_action,
        p_table_name,
        p_record_id,
        p_old_values,
        p_new_values,
        p_description
    ) RETURNING id INTO change_id;
    
    RETURN change_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create function to get user role
CREATE OR REPLACE FUNCTION get_user_role(p_user_id UUID DEFAULT NULL)
RETURNS TEXT AS $$
DECLARE
    user_role TEXT;
BEGIN
    -- Use provided user_id or current user
    IF p_user_id IS NULL THEN
        p_user_id := auth.uid();
    END IF;
    
    -- Get user role from profile
    SELECT role INTO user_role 
    FROM user_profiles 
    WHERE id = p_user_id;
    
    -- Return role or default to VIEWER
    RETURN COALESCE(user_role, 'VIEWER');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
