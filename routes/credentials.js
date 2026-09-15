import express from 'express';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { encryptSecret, isCredentialEncryptionConfigured } from '../services/crypto.js';

const router = express.Router();

// Columns that are safe to return to the client. The ciphertext/iv/tag are
// NEVER selected or returned — decryption happens only inside backend automation.
const SAFE_COLUMNS = 'id, portal_id, authentication_type, username, enabled, created_at, updated_at, last_used_at, last_status_check';

function encGuard(res) {
  if (!isCredentialEncryptionConfigured()) {
    res.status(503).json({
      error: 'Secure credential storage is not enabled on this server.',
      code: 'CREDENTIAL_ENC_NOT_CONFIGURED',
    });
    return false;
  }
  return true;
}

// List the signed-in user's saved portal credentials (no secrets) — for the
// settings / connected-portals screen (§17).
router.get('/', requireUser, async (req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('portal_credentials').select(SAFE_COLUMNS)
      .eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ credentials: data || [], encryptionEnabled: isCredentialEncryptionConfigured() });
  } catch (err) {
    console.error('credentials list error:', err.message);
    res.status(500).json({ error: 'Could not load connected portals', code: 'DB_ERROR' });
  }
});

// Save (encrypt) a portal credential — only after explicit user consent (§17).
// body: { portal_id, authentication_type?, username?, secret }
//  * `secret` is the password OR token; it is encrypted immediately and the
//    plaintext is not stored, logged, or echoed back.
router.post('/', requireUser, async (req, res) => {
  if (!encGuard(res)) return;
  const { portal_id, authentication_type, username, secret } = req.body || {};
  if (!portal_id) return res.status(400).json({ error: 'portal_id is required', code: 'INVALID_INPUT' });
  if (!secret || typeof secret !== 'string') return res.status(400).json({ error: 'A credential is required', code: 'INVALID_INPUT' });

  const authType = ['PASSWORD', 'OAUTH', 'API_TOKEN', 'REFRESH_TOKEN'].includes(authentication_type)
    ? authentication_type : 'PASSWORD';

  try {
    const supabase = getSupabaseAdmin();
    // Confirm the portal exists (FK) — friendly error rather than a raw FK failure.
    const { data: portal } = await supabase.from('portals').select('id').eq('id', portal_id).maybeSingle();
    if (!portal) return res.status(404).json({ error: 'Unknown portal', code: 'PORTAL_NOT_FOUND' });

    const enc = encryptSecret(secret);
    const row = {
      user_id: req.user.id,
      portal_id,
      authentication_type: authType,
      username: username ? String(username).trim() : null,
      secret_ciphertext: enc.ciphertext,
      secret_iv: enc.iv,
      secret_tag: enc.tag,
      key_version: enc.keyVersion,
      enabled: true,
    };
    const { data, error } = await supabase
      .from('portal_credentials')
      .upsert(row, { onConflict: 'user_id,portal_id' })
      .select(SAFE_COLUMNS).single();
    if (error) throw error;
    res.json({ credential: data });
  } catch (err) {
    console.error('credentials save error:', err.message); // never logs the secret
    res.status(500).json({ error: 'Could not save the credential', code: 'DB_ERROR' });
  }
});

// Enable/disable automatic status tracking for a saved credential (§17).
router.patch('/:id', requireUser, async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled must be a boolean', code: 'INVALID_INPUT' });
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('portal_credentials').update({ enabled })
      .eq('id', req.params.id).eq('user_id', req.user.id)
      .select(SAFE_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Credential not found', code: 'NOT_FOUND' });
    res.json({ credential: data });
  } catch (err) {
    console.error('credentials patch error:', err.message);
    res.status(500).json({ error: 'Could not update the credential', code: 'DB_ERROR' });
  }
});

// Delete stored credentials (§17).
router.delete('/:id', requireUser, async (req, res) => {
  try {
    await getSupabaseAdmin().from('portal_credentials')
      .delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('credentials delete error:', err.message);
    res.status(500).json({ error: 'Could not delete the credential', code: 'DB_ERROR' });
  }
});

export default router;
