import express from 'express';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const router = express.Router();

const CONSENT_TYPES = new Set([
  'profile_data_storage', 'document_storage', 'sensitive_data_processing',
  'auto_fill', 'government_portal_submission', 'aadhaar_verification', 'bank_verification',
]);

// GET /api/consents — the signed-in user's own consent history.
router.get('/', requireUser, async (req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('user_consents').select('*')
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ consents: data || [] });
  } catch (err) {
    console.error('consents read error:', err.message);
    res.status(500).json({ error: 'Could not load your consent history', code: 'DB_ERROR' });
  }
});

// POST /api/consents — record one or more consent decisions. Captures
// ip_address/user_agent server-side so the audit trail can't be forged by the
// client (§ user_consents spec).
// body: { consents: [{ type, version, granted }, ...] }
router.post('/', requireUser, async (req, res) => {
  const list = Array.isArray(req.body?.consents) ? req.body.consents : [];
  if (!list.length) return res.status(400).json({ error: 'At least one consent decision is required', code: 'INVALID_INPUT' });

  const rows = [];
  for (const c of list) {
    if (!CONSENT_TYPES.has(c.type)) return res.status(400).json({ error: `Unknown consent type: ${c.type}`, code: 'INVALID_CONSENT_TYPE' });
    if (typeof c.granted !== 'boolean') return res.status(400).json({ error: 'granted must be true or false', code: 'INVALID_INPUT' });
    const now = new Date().toISOString();
    rows.push({
      user_id: req.user.id,
      consent_type: c.type,
      consent_text_version: c.version || '1.0',
      granted: c.granted,
      granted_at: c.granted ? now : null,
      revoked_at: c.granted ? null : now,
      ip_address: req.ip || null,
      user_agent: req.headers['user-agent'] || null,
    });
  }

  try {
    const { data, error } = await getSupabaseAdmin().from('user_consents').insert(rows).select();
    if (error) throw error;
    res.json({ consents: data });
  } catch (err) {
    console.error('consents save error:', err.message);
    res.status(500).json({ error: 'Could not save your consent choices', code: 'DB_ERROR' });
  }
});

export default router;
