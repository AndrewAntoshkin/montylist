import { createBrowserClient } from '@supabase/ssr';

// These are PUBLIC keys - safe to include in client-side code
// Use env vars if available (local dev), fallback to hardcoded for Railway build
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://goykmdyodqhptkzfgumq.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdveWttZHlvZHFocHRremZndW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwMzc5ODAsImV4cCI6MjA3ODYxMzk4MH0.aCivbd_mT8FMbYJmLRV6SkuC_UVr0yzfbW_xOItjW3I';

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
}
