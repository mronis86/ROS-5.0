import { createClient } from '@supabase/supabase-js';

// Using Neon as the database backend through Supabase
// You'll need to create a new Supabase project that uses Neon as the database
const supabaseUrl = 'https://huqijhevmtgardkyeowa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1cWlqaGV2bXRnYXJka3llb3dhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcyNDgyNTQsImV4cCI6MjA3MjgyNDI1NH0.1G81Zif1YWQwISEGJw4XMzY89Rlvh6Jda1-j-roPZBk';

export const supabase = createClient(supabaseUrl, supabaseKey);

// Check if Supabase is properly configured
export const isSupabaseConfigured = supabaseUrl && supabaseKey && 
  supabaseUrl !== 'YOUR_SUPABASE_URL' && 
  supabaseKey !== 'YOUR_SUPABASE_ANON_KEY';

