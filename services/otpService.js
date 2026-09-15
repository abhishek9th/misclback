// Server-side validation of the MSG91 OTP Widget access token.
// The browser verifies the OTP via the MSG91 widget (window.verifyOtp) and
// receives an access token; we re-validate that token here with the secret
// authkey before trusting that the mobile was verified. The authkey stays
// server-side only.
const VERIFY_URL = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';

export function normalizeMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return null;
}

// Returns the MSG91 response on success; throws with a code on failure.
export async function verifyAccessToken(token) {
  if (!process.env.MSG91_AUTHKEY) {
    const err = new Error('OTP service not configured');
    err.code = 'OTP_NOT_CONFIGURED';
    throw err;
  }
  if (!token) {
    const err = new Error('Missing verification token');
    err.code = 'OTP_NOT_VERIFIED';
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let data;
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authkey: process.env.MSG91_AUTHKEY, 'access-token': token }),
      signal: ctrl.signal,
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'OTP service timed out' : 'OTP service unreachable');
    err.code = 'OTP_NOT_VERIFIED';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (data.type !== 'success') {
    const err = new Error(data.message || 'OTP verification could not be confirmed');
    err.code = 'OTP_NOT_VERIFIED';
    throw err;
  }
  return data;
}
