// One-off backfill: profiles.aadhaar_number / profiles.pan_number were legacy
// PLAINTEXT columns (from 20260911_schemesetu_profiles.sql). This script moves
// any existing values into the new encrypted identity_documents_sensitive
// table (AES-256-GCM, backend/services/crypto.js), then nulls the plaintext
// columns — preserving the data while fixing the "stored in plaintext" gap.
// Safe to re-run: skips users who already have an identity row, and skips
// profiles with nothing to migrate.
//
// Requires CREDENTIAL_ENCRYPTION_KEY to be set.
// Usage:  node backend/scripts/backfill-encrypt-identity.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { encryptSecret, isCredentialEncryptionConfigured } from '../services/crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  if (!isCredentialEncryptionConfigured()) {
    console.error('CREDENTIAL_ENCRYPTION_KEY is not set — cannot encrypt. Aborting.');
    process.exit(1);
  }
  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from('profiles')
    .select('id, aadhaar_number, pan_number')
    .or('aadhaar_number.not.is.null,pan_number.not.is.null');
  if (error) throw error;

  if (!rows.length) {
    console.log('No plaintext aadhaar_number/pan_number values found — nothing to migrate.');
    return;
  }

  let migrated = 0;
  for (const row of rows) {
    const { data: existing } = await supabase
      .from('identity_documents_sensitive').select('user_id').eq('user_id', row.id).maybeSingle();

    const patch = { user_id: row.id };
    if (row.aadhaar_number && !existing?.aadhaar_ciphertext) {
      const digits = String(row.aadhaar_number).replace(/\D/g, '');
      if (digits.length === 12) {
        const enc = encryptSecret(digits);
        Object.assign(patch, { aadhaar_ciphertext: enc.ciphertext, aadhaar_iv: enc.iv, aadhaar_tag: enc.tag, aadhaar_last4: digits.slice(-4) });
      }
    }
    if (row.pan_number && !existing?.pan_ciphertext) {
      const upper = String(row.pan_number).trim().toUpperCase();
      if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(upper)) {
        const enc = encryptSecret(upper);
        Object.assign(patch, { pan_ciphertext: enc.ciphertext, pan_iv: enc.iv, pan_tag: enc.tag, pan_last4: upper.slice(-4) });
      }
    }

    if (Object.keys(patch).length > 1) {
      const { error: upErr } = await supabase.from('identity_documents_sensitive').upsert(patch, { onConflict: 'user_id' });
      if (upErr) { console.error(`Failed to migrate user ${row.id}:`, upErr.message); continue; }
      await supabase.from('profiles').update({ aadhaar_number: null, pan_number: null }).eq('id', row.id);
      migrated += 1;
    }
  }

  console.log(`Backfill complete. Migrated ${migrated} of ${rows.length} candidate profile row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Backfill failed:', err.message); process.exit(1); });
