import { createBrowserClient } from '@supabase/ssr';

// These are PUBLIC keys - safe to include in client-side code
// Railway doesn't pass build-args to Docker, so we use env vars at runtime
// or fallback to hardcoded values for the client bundle
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://goykmdyodqhptkzfgumq.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdveWttZHlvZHFocHRremZndW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzY2MTkwNjcsImV4cCI6MjA1MjE5NTA2N30.xH0opYYk6hhNgNttjinXq5gHvFzXSVfrGMiPq9h2JHo';

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
}
