// ============================================================================
// Authenticated encryption for portal credentials (§4, §18).
//
//  * Algorithm: AES-256-GCM (confidentiality + integrity/authentication).
//  * The key comes ONLY from the CREDENTIAL_ENCRYPTION_KEY env secret — never
//    from Supabase, never from the frontend, never committed to Git.
//  * Plaintext secrets are decrypted only transiently in backend memory and
//    wiped afterwards (see wipe()).
//
// Generate a key once and put it in your server env (.env / secret manager):
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// ============================================================================
import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const KEY_VERSION = 1; // bump + add a lookup here if you ever rotate keys.

let cachedKey = null;

// Returns the 32-byte key, or throws a coded error if it isn't configured.
// Callers should treat CREDENTIAL_ENC_NOT_CONFIGURED as "credential storage
// disabled" (503) rather than a fatal error — the journey still works without it.
function getKey() {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    const err = new Error('Credential encryption key not configured');
    err.code = 'CREDENTIAL_ENC_NOT_CONFIGURED';
    throw err;
  }
  // Accept base64 (preferred) or hex; must decode to exactly 32 bytes.
  let key;
  try {
    key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== 32) {
    const err = new Error('CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (use base64 of 32 random bytes)');
    err.code = 'CREDENTIAL_ENC_INVALID_KEY';
    throw err;
  }
  cachedKey = key;
  return cachedKey;
}

export function isCredentialEncryptionConfigured() {
  try { getKey(); return true; } catch { return false; }
}

// Encrypt a UTF-8 plaintext secret. Returns base64 ciphertext/iv/tag for storage.
// The caller is responsible for zeroing the plaintext string reference afterwards
// (JS strings are immutable, so avoid keeping them around).
export function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit nonce recommended for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const buf = Buffer.from(String(plaintext), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  wipe(buf);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

// Decrypt back to a plaintext string. Throws on tampering (auth tag mismatch).
// Decrypt ONLY in backend memory, use immediately, then drop the reference.
export function decryptSecret({ ciphertext, iv, tag }) {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  const plaintext = out.toString('utf8');
  wipe(out);
  return plaintext;
}

// Best-effort zeroing of a Buffer holding a transient secret.
export function wipe(buf) {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}
