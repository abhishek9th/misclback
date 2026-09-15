import { getSupabaseAdmin } from './supabaseAdmin.js';

// Express middleware: authenticate the caller by their Supabase access token
// (Bearer <jwt>), sent by the frontend from the persisted supabase-js session.
// On success sets req.user = { id, email } and continues; otherwise 401/503.
//
// We validate the token with the admin client's auth.getUser(token), which
// verifies the JWT signature against the project without needing the JWT secret
// in our own env. No user password ever passes through here.
export async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Please sign in to continue', code: 'NO_TOKEN' });
  }
  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return res.status(503).json({ error: 'Server is not configured', code: err.code || 'SUPABASE_NOT_CONFIGURED' });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.', code: 'INVALID_TOKEN' });
    }
    req.user = { id: data.user.id, email: data.user.email };
    req.accessToken = token;
    next();
  } catch (err) {
    console.error('requireUser error:', err.message);
    return res.status(401).json({ error: 'Could not verify your session', code: 'AUTH_FAILED' });
  }
}
