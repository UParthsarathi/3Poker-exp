import { createClient } from '@supabase/supabase-js';

// Safely access import.meta.env to prevent crashes if it's undefined
// @ts-ignore
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

// User provided credentials
const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://xxkgxosmtvjhbzoxqnsf.supabase.co';
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4a2d4b3NtdHZqaGJ6b3hxbnNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2OTc0MTksImV4cCI6MjA4MDI3MzQxOX0.DjYl3kA43ae4fHG_nOoQhAMAWZE4Miqgk3D9fIYVgLw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Error signing out:', error.message);
  // Reload to clear state cleanly
  window.location.reload();
};