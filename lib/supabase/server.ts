import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// Use env vars if available (local dev), fallback to hardcoded for Railway build
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://goykmdyodqhptkzfgumq.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdveWttZHlvZHFocHRremZndW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwMzc5ODAsImV4cCI6MjA3ODYxMzk4MH0.aCivbd_mT8FMbYJmLRV6SkuC_UVr0yzfbW_xOItjW3I';

// Service key comes from runtime env (NOT embedded in build)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

// Service Role client for admin operations (like creating public URLs)
export function createServiceRoleClient() {
  return createSupabaseClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
