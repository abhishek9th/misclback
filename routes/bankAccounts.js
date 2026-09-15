import express from 'express';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { encryptSecret, isCredentialEncryptionConfigured } from '../services/crypto.js';
import { logSensitiveAccess } from '../services/auditLog.js';

const router = express.Router();

const SAFE_COLUMNS = `
  bank_account_id, account_holder_name, bank_name, account_number_last4, ifsc,
  account_type, bank_account_verified, verification_date, is_primary,
  created_at, updated_at
`;

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

function encGuard(res) {
  if (!isCredentialEncryptionConfigured()) {
    res.status(503).json({ error: 'Secure bank details storage is not enabled on this server.', code: 'CREDENTIAL_ENC_NOT_CONFIGURED' });
    return false;
  }
  return true;
}

// GET /api/bank-accounts — masked list of the signed-in user's bank accounts.
router.get('/', requireUser, async (req, res) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('bank_accounts').select(SAFE_COLUMNS)
      .eq('user_id', req.user.id).order('is_primary', { ascending: false });
    if (error) throw error;

    await logSensitiveAccess({
      userId: req.user.id, accessedBy: req.user.id, tableName: 'bank_accounts',
      action: 'read', purpose: 'view_masked_bank_accounts', req,
    });

    res.json({ accounts: data || [], encryptionEnabled: isCredentialEncryptionConfigured() });
  } catch (err) {
    console.error('bank accounts read error:', err.message);
    res.status(500).json({ error: 'Could not load your bank accounts', code: 'DB_ERROR' });
  }
});

// POST /api/bank-accounts — add a bank account. Encrypts the account number
// server-side; only the last 4 characters are stored unencrypted.
// body: { account_holder_name, bank_name, account_number, ifsc, account_type, is_primary? }
router.post('/', requireUser, async (req, res) => {
  if (!encGuard(res)) return;
  const { account_holder_name, bank_name, account_number, ifsc, account_type, is_primary } = req.body || {};

  if (!account_number || String(account_number).replace(/\D/g, '').length < 6) {
    return res.status(400).json({ error: 'Enter a valid account number', code: 'INVALID_ACCOUNT_NUMBER' });
  }
  const ifscUpper = String(ifsc || '').trim().toUpperCase();
  if (!IFSC_RE.test(ifscUpper)) {
    return res.status(400).json({ error: 'Enter a valid IFSC code (e.g. SBIN0001234)', code: 'INVALID_IFSC' });
  }

  const digits = String(account_number).trim();
  const enc = encryptSecret(digits);

  try {
    const supabase = getSupabaseAdmin();

    if (is_primary) {
      await supabase.from('bank_accounts').update({ is_primary: false }).eq('user_id', req.user.id);
    }

    const { data, error } = await supabase
      .from('bank_accounts')
      .insert({
        user_id: req.user.id,
        account_holder_name: account_holder_name || null,
        bank_name: bank_name || null,
        account_number_ciphertext: enc.ciphertext,
        account_number_iv: enc.iv,
        account_number_tag: enc.tag,
        account_number_last4: digits.slice(-4),
        ifsc: ifscUpper,
        account_type: account_type || null,
        is_primary: Boolean(is_primary),
      })
      .select(SAFE_COLUMNS).single();
    if (error) throw error;

    await logSensitiveAccess({
      userId: req.user.id, accessedBy: req.user.id, tableName: 'bank_accounts',
      recordId: data.bank_account_id, action: 'create', purpose: 'onboarding_save', req,
    });

    res.json({ account: data });
  } catch (err) {
    console.error('bank account save error:', err.message); // never logs the number
    res.status(500).json({ error: 'Could not save the bank account', code: 'DB_ERROR' });
  }
});

// PATCH /api/bank-accounts/:id — set as primary (non-sensitive fields only).
router.patch('/:id', requireUser, async (req, res) => {
  const { is_primary } = req.body || {};
  try {
    const supabase = getSupabaseAdmin();
    if (is_primary) {
      await supabase.from('bank_accounts').update({ is_primary: false }).eq('user_id', req.user.id);
    }
    const { data, error } = await supabase
      .from('bank_accounts').update({ is_primary: Boolean(is_primary) })
      .eq('bank_account_id', req.params.id).eq('user_id', req.user.id)
      .select(SAFE_COLUMNS).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Bank account not found', code: 'NOT_FOUND' });
    res.json({ account: data });
  } catch (err) {
    console.error('bank account update error:', err.message);
    res.status(500).json({ error: 'Could not update the bank account', code: 'DB_ERROR' });
  }
});

// DELETE /api/bank-accounts/:id
router.delete('/:id', requireUser, async (req, res) => {
  try {
    await getSupabaseAdmin().from('bank_accounts').delete()
      .eq('bank_account_id', req.params.id).eq('user_id', req.user.id);
    await logSensitiveAccess({
      userId: req.user.id, accessedBy: req.user.id, tableName: 'bank_accounts',
      recordId: req.params.id, action: 'delete', purpose: 'user_requested_deletion', req,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('bank account delete error:', err.message);
    res.status(500).json({ error: 'Could not delete the bank account', code: 'DB_ERROR' });
  }
});

export default router;
