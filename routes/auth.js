import express from 'express';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { verifyAccessToken, normalizeMobile } from '../services/otpService.js';

const router = express.Router();

// Map internal error codes -> HTTP status + user-facing message.
function fail(res, code, fallback, status = 400) {
  return res.status(status).json({ error: fallback, code });
}

// OTP send/verify/retry happen client-side via the MSG91 OTP Widget. The browser
// sends us the resulting access token in /register, which we re-validate here.

// Decode a data URL or bare base64 string into a Buffer.
function decodeImage(photoBase64) {
  if (!photoBase64 || typeof photoBase64 !== 'string') return null;
  const comma = photoBase64.indexOf(',');
  const raw = photoBase64.startsWith('data:') && comma !== -1 ? photoBase64.slice(comma + 1) : photoBase64;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
// { email, password, fullName, mobile, verificationToken, photoBase64, profile }
// Creates the Supabase Auth user (email identity; password hashed by Supabase),
// uploads the mandatory live photo to the private "faces" bucket, and inserts
// the linked profiles row. Phone OTP must already have been verified.
router.post('/register', async (req, res) => {
  const { email, password, fullName, mobile, verificationToken, photoBase64, profile = {} } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const normMobile = normalizeMobile(mobile);
  const name = String(fullName || '').trim();

  // --- Validation of the mandatory fields ---
  if (!EMAIL_RE.test(mail)) return fail(res, 'INVALID_EMAIL', 'Please enter a valid email address');
  if (String(password || '').length < 6) return fail(res, 'WEAK_PASSWORD', 'Password must be at least 6 characters');
  if (!name) return fail(res, 'INVALID_NAME', 'Full name is required');
  if (!normMobile) return fail(res, 'INVALID_MOBILE', 'Invalid mobile number');
  const photo = decodeImage(photoBase64);
  if (!photo) return fail(res, 'PHOTO_REQUIRED', 'A live photo is required to create your profile');

  // --- Validation of the optional profile fields (only checked if provided) ---
  if (profile.age !== undefined && profile.age !== null && profile.age !== '') {
    const ageNum = Number(profile.age);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 120) return fail(res, 'INVALID_AGE', 'Please select a valid age');
  }
  if (profile.pincode && !/^[0-9]{6}$/.test(String(profile.pincode).trim())) {
    return fail(res, 'INVALID_PINCODE', 'PIN code must be 6 digits');
  }
  if (profile.date_of_birth) {
    const dob = new Date(profile.date_of_birth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) return fail(res, 'INVALID_DOB', 'Please enter a valid date of birth');
  }

  // Re-validate the MSG91 widget access token server-side (secret authkey).
  // Dev escape hatch: OTP_SERVER_VERIFY=false trusts the client-side OTP the
  // widget already verified (use ONLY in development — set it to true in prod
  // once a real MSG91 account Auth Key is configured).
  if (process.env.OTP_SERVER_VERIFY !== 'false') {
    try {
      await verifyAccessToken(verificationToken);
    } catch (err) {
      console.error('access token validation failed:', err.code || '', err.message);
      if (err.code === 'OTP_NOT_CONFIGURED') return fail(res, err.code, 'OTP service is not configured', 503);
      return fail(res, 'OTP_NOT_VERIFIED', 'Please verify your mobile number with OTP first', 401);
    }
  } else {
    console.warn('[dev] OTP_SERVER_VERIFY=false — skipping MSG91 token re-validation for /register');
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return fail(res, err.code || 'SUPABASE_NOT_CONFIGURED', 'Server is not configured', 503);
  }

  let authId = null;
  let uploadedPath = null;
  try {
    // Friendly uniqueness checks before creating anything.
    const { data: existing, error: exErr } = await supabase
      .from('profiles')
      .select('email, phone')
      .or(`email.eq.${mail},phone.eq.${normMobile}`)
      .limit(1)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing?.email === mail) return fail(res, 'EMAIL_REGISTERED', 'This email is already registered. Please log in.', 409);
    if (existing?.phone === normMobile) return fail(res, 'MOBILE_REGISTERED', 'This mobile number is already registered. Please log in.', 409);

    // Create the auth user (Supabase stores a bcrypt hash of the password).
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: mail,
      password,
      email_confirm: true, // no confirmation email; account is active immediately
      user_metadata: { full_name: name, phone: normMobile },
    });
    if (createErr) {
      if (/already been registered|already exists|duplicate/i.test(createErr.message))
        return fail(res, 'EMAIL_REGISTERED', 'This email is already registered. Please log in.', 409);
      throw createErr;
    }
    authId = created.user.id;

    // Upload the mandatory live photo to the private faces bucket at <uid>/...
    uploadedPath = `${authId}/live_${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('faces')
      .upload(uploadedPath, photo, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw upErr;

    // Insert the linked profile row (live_photo_url now satisfied).
    const baseRow = {
      id: authId,
      email: mail,
      full_name: name,
      phone: normMobile,
      live_photo_url: uploadedPath,
      state: profile.state || null,
      gender: profile.gender || null,
      social_category: profile.social_category || null,
      date_of_birth: profile.date_of_birth || null,
      age: profile.age ? Number(profile.age) : null,
      spouse_name: profile.spouse_name || null,
      address: profile.address || null,
      pincode: profile.pincode || null,
      education_level: profile.education_level || null, // "qualification"
    };
    let { error: profErr } = await supabase.from('profiles').insert(baseRow);

    // Self-heal: if the table still has the old NOT NULL legacy columns
    // (user_id / mobile) from the first schema, satisfy them and retry so
    // registration works even before the cleanup migration is run.
    if (profErr && /null value in column "(user_id|mobile)"/.test(profErr.message)) {
      ({ error: profErr } = await supabase
        .from('profiles')
        .insert({ ...baseRow, user_id: authId, mobile: normMobile }));
    }

    if (profErr) {
      if (/duplicate|unique/i.test(profErr.message))
        return fail(res, 'EMAIL_REGISTERED', 'This account already exists. Please log in.', 409);
      throw profErr;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('register error:', err.code || '', err.message);
    // Best-effort rollback so we don't leave an orphaned auth user or file.
    if (uploadedPath) await supabase.storage.from('faces').remove([uploadedPath]).catch(() => {});
    if (authId) await supabase.auth.admin.deleteUser(authId).catch(() => {});
    return fail(res, 'REGISTRATION_FAILED', 'Registration failed. Please try again.', 500);
  }
});

// POST /api/auth/resolve-mobile  { mobile } -> { email }
// Lets users log in with their mobile number: we map it to the account email,
// then the client signs in with email + password.
router.post('/resolve-mobile', async (req, res) => {
  const normMobile = normalizeMobile(req.body?.mobile);
  if (!normMobile) return fail(res, 'INVALID_MOBILE', 'Please enter a valid 10-digit mobile number');
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (err) { return fail(res, err.code || 'SUPABASE_NOT_CONFIGURED', 'Server is not configured', 503); }
  try {
    const { data, error } = await supabase.from('profiles').select('email').eq('phone', normMobile).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 'USER_NOT_FOUND', 'No account found for this mobile number', 404);
    res.json({ ok: true, email: data.email });
  } catch (err) {
    console.error('resolve-mobile error:', err.message);
    return fail(res, 'DB_ERROR', 'Something went wrong. Please try again.', 500);
  }
});

// POST /api/auth/forgot-check  { mobile } -> { ok:true } if a profile exists
// for that mobile (so the client can then send an OTP to it).
router.post('/forgot-check', async (req, res) => {
  const normMobile = normalizeMobile(req.body?.mobile);
  if (!normMobile) return fail(res, 'INVALID_MOBILE', 'Please enter a valid 10-digit mobile number');
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (err) { return fail(res, err.code || 'SUPABASE_NOT_CONFIGURED', 'Server is not configured', 503); }
  try {
    const { data, error } = await supabase.from('profiles').select('id').eq('phone', normMobile).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 'USER_NOT_FOUND', 'No account is registered with this mobile number', 404);
    res.json({ ok: true });
  } catch (err) {
    console.error('forgot-check error:', err.message);
    return fail(res, 'DB_ERROR', 'Something went wrong. Please try again.', 500);
  }
});

// POST /api/auth/reset-password  { mobile, verificationToken, newPassword }
// Verifies the MSG91 OTP token, matches the mobile to a registered profile,
// then updates that user's password. Returns the email for auto sign-in.
router.post('/reset-password', async (req, res) => {
  const { mobile, verificationToken, newPassword } = req.body || {};
  const normMobile = normalizeMobile(mobile);
  if (!normMobile) return fail(res, 'INVALID_MOBILE', 'Invalid mobile number');
  if (String(newPassword || '').length < 6) return fail(res, 'WEAK_PASSWORD', 'Password must be at least 6 characters');

  if (process.env.OTP_SERVER_VERIFY !== 'false') {
    try {
      await verifyAccessToken(verificationToken);
    } catch (err) {
      if (err.code === 'OTP_NOT_CONFIGURED') return fail(res, err.code, 'OTP service is not configured', 503);
      return fail(res, 'OTP_NOT_VERIFIED', 'Please verify the OTP first', 401);
    }
  }

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (err) { return fail(res, err.code || 'SUPABASE_NOT_CONFIGURED', 'Server is not configured', 503); }

  try {
    const { data, error } = await supabase.from('profiles').select('id, email').eq('phone', normMobile).maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 'USER_NOT_FOUND', 'No account is registered with this mobile number', 404);

    const { error: updErr } = await supabase.auth.admin.updateUserById(data.id, { password: newPassword });
    if (updErr) throw updErr;

    res.json({ ok: true, email: data.email });
  } catch (err) {
    console.error('reset-password error:', err.message);
    return fail(res, 'RESET_FAILED', 'Could not reset password. Please try again.', 500);
  }
});

export default router;
