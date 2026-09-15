import express from 'express';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { encryptSecret, isCredentialEncryptionConfigured } from '../services/crypto.js';
import { logSensitiveAccess } from '../services/auditLog.js';

const router = express.Router();

// Never selects the ciphertext/iv/tag columns back to the client body — only
// masked/derived fields, even though RLS would also allow the owner to read
// the raw ciphertext directly via supabase-js (harmless without the server
// key, but there's no reason to hand it to the frontend at all).
const SAFE_COLUMNS = `
  aadhaar_last4, aadhaar_verified, aadhaar_verified_at,
  pan_last4, pan_verified, pan_verified_at,
  other_government_id_type,
  created_at, updated_at
`;

const AADHAAR_RE = /^[0-9]{12}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function encGuard(res) {
  if (!isCredentialEncryptionConfigured()) {
    res.status(503).json({ error: 'Secure identity storage is not enabled on this server.', code: 'CREDENTIAL_ENC_NOT_CONFIGURED' });
    return false;
  }
  return true;
}

// GET /api/identity — masked view of the signed-in user's stored government IDs.
router.get('/', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('identity_documents_sensitive').select(SAFE_COLUMNS)
      .eq('user_id', req.user.id).maybeSingle();
    if (error) throw error;

    await logSensitiveAccess({
      userId: req.user.id, accessedBy: req.user.id, tableName: 'identity_documents_sensitive',
      action: 'read', purpose: 'view_masked_identity', req,
    });

    res.json({ identity: data || null, encryptionEnabled: isCredentialEncryptionConfigured() });
  } catch (err) {
    console.error('identity read error:', err.message);
    res.status(500).json({ error: 'Could not load your identity information', code: 'DB_ERROR' });
  }
});

// PUT /api/identity — set/update Aadhaar and/or PAN. Encrypts server-side;
// only ever stores the last 4 characters unencrypted, for display.
// body: { aadhaar?: string, pan?: string }
router.put('/', requireUser, async (req, res) => {
  if (!encGuard(res)) return;
  const { aadhaar, pan } = req.body || {};
  const patch = {};

  if (aadhaar !== undefined && aadhaar !== null && aadhaar !== '') {
    const digits = String(aadhaar).replace(/\s/g, '');
    if (!AADHAAR_RE.test(digits)) return res.status(400).json({ error: 'Aadhaar number must be 12 digits', code: 'INVALID_AADHAAR' });
    const enc = encryptSecret(digits);
    Object.assign(patch, {
      aadhaar_ciphertext: enc.ciphertext, aadhaar_iv: enc.iv, aadhaar_tag: enc.tag,
      aadhaar_last4: digits.slice(-4),
      // Storing/changing the number resets any prior verification — SchemeSetu
      // never claims a value is verified just because it was typed in (§14).
      aadhaar_verified: false, aadhaar_verified_at: null,
    });
  }

  if (pan !== undefined && pan !== null && pan !== '') {
    const upper = String(pan).trim().toUpperCase();
    if (!PAN_RE.test(upper)) return res.status(400).json({ error: 'Enter a valid PAN (e.g. ABCDE1234F)', code: 'INVALID_PAN' });
    const enc = encryptSecret(upper);
    Object.assign(patch, {
      pan_ciphertext: enc.ciphertext, pan_iv: enc.iv, pan_tag: enc.tag,
      pan_last4: upper.slice(-4),
      pan_verified: false, pan_verified_at: null,
    });
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Provide an aadhaar and/or pan value', code: 'INVALID_INPUT' });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('identity_documents_sensitive')
      .upsert({ user_id: req.user.id, ...patch }, { onConflict: 'user_id' })
      .select(SAFE_COLUMNS).single();
    if (error) throw error;

    await logSensitiveAccess({
      userId: req.user.id, accessedBy: req.user.id, tableName: 'identity_documents_sensitive',
      action: 'update', purpose: 'onboarding_save', req,
    });

    res.json({ identity: data });
  } catch (err) {
    console.error('identity save error:', err.message); // never logs the value
    res.status(500).json({ error: 'Could not save your identity information', code: 'DB_ERROR' });
  }
});

// DELETE /api/identity — remove all stored government ID data (right to erasure).
router.delete('/', requireUser, async (req, res) => {
  try {
    await getSupabaseAdmin().from('identity_documents_sensitive').delete().eq('user_id', req.user.id);
    await logSensitiveAccess({
      userId: req.user.id, accessedBy: req.user.id, tableName: 'identity_documents_sensitive',
      action: 'delete', purpose: 'user_requested_deletion', req,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('identity delete error:', err.message);
    res.status(500).json({ error: 'Could not delete your identity information', code: 'DB_ERROR' });
  }
});

export default router;
