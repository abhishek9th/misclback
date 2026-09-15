import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { evaluateConflicts, canonicalStatus } from '../services/conflictEngine.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let NAME_BY_ID = null;
async function schemeNames() {
  if (NAME_BY_ID) return NAME_BY_ID;
  const url = pathToFileURL(path.resolve(__dirname, '../../src/data/schemes.js')).href;
  const { SCHEMES } = await import(url);
  NAME_BY_ID = Object.fromEntries(SCHEMES.map((s) => [s.id, s.name]));
  return NAME_BY_ID;
}

// Load the signed-in user's application history (real status from the DB).
export async function loadApplications(supabase, uid) {
  const { data } = await supabase
    .from('scheme_applications')
    .select('scheme_id, scheme_name, status')
    .eq('user_id', uid);
  return (data || []).map((a) => ({ ...a, status_source: 'USER_REPORTED' }));
}

// GET /api/conflicts/:schemeId — does anything the user already has conflict
// with this target scheme?
router.get('/:schemeId', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const [apps, names] = await Promise.all([loadApplications(supabase, req.user.id), schemeNames()]);
    const result = evaluateConflicts(req.params.schemeId, apps, names);
    const own = apps.find((a) => a.scheme_id === req.params.schemeId);
    res.json({ ...result, own_status: own ? canonicalStatus(own.status) : null });
  } catch (err) {
    console.error('conflict check error:', err.message);
    res.status(500).json({ error: 'Could not check scheme conflicts', code: 'CONFLICT_ERROR' });
  }
});

export default router;
