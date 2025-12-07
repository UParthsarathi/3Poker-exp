import { createClient } from '@supabase/supabase-js';

// Default values for fallback
const DEFAULT_URL = 'https://xxkgxosmtvjhbzoxqnsf.supabase.co';
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4a2d4b3NtdHZqaGJ6b3hxbnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2OTc0MTksImV4cCI6MjA4MDI3MzQxOX0.DjYl3kA43ae4fHG_nOoQhAMAWZE4Miqgk3D9fIYVgLw';

// Safely access environment variables
// This prevents "Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')"
const getEnv = (key: string, defaultValue: string) => {
  try {
    // Check if import.meta.env is defined before accessing properties
    const env = import.meta.env;
    if (env && env[key]) {
      return env[key];
    }
  } catch (e) {
    // Ignore errors in environments where import.meta is not available
  }
  return defaultValue;
};

// CRITICAL FIX: Trim the values to remove any accidental whitespace from copy-pasting
const SUPABASE_URL = getEnv('VITE_SUPABASE_URL', DEFAULT_URL).trim();
const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY', DEFAULT_KEY).trim();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Error signing out:', error.message);
  // Reload to clear state cleanly
  window.location.reload();
};