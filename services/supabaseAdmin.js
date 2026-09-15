import { createClient } from '@supabase/supabase-js';

// Server-side Supabase client using the SERVICE ROLE key. This bypasses RLS and
// must NEVER be imported into frontend code. Created lazily so the server can
// still boot (and serve non-auth routes) if the keys aren't set yet.
let cached = null;

export function getSupabaseAdmin() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    const err = new Error('Supabase admin not configured');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
