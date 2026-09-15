// One-off script: create a demo login account for SchemeSetu.
// Bypasses the normal OTP + live-photo capture flow (service-role only) since
// this is a fixed demo account, not a real registration. Safe to re-run —
// it's idempotent (updates the password if the account already exists).
//
// Usage:  node backend/scripts/create-demo-user.mjs
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEMO_EMAIL = 'user01@schemesetu.demo';
const DEMO_PASSWORD = 'Admin@01';
const DEMO_MOBILE = '919000000001'; // placeholder — normalized form (91 + 10 digits)
const DEMO_NAME = 'Demo User';

// 1x1 transparent PNG — placeholder for the mandatory live_photo_url.
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function main() {
  const supabase = getSupabaseAdmin();

  // Find an existing profile/auth user for this email so re-runs are idempotent.
  const { data: existingProfile } = await supabase
    .from('profiles').select('id, email').eq('email', DEMO_EMAIL).maybeSingle();

  let userId = existingProfile?.id;
  let needsProfileRow = false;

  if (userId) {
    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD });
    if (updErr) throw updErr;
    console.log('Demo user already existed — password reset to the requested value.');
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DEMO_NAME, phone: DEMO_MOBILE },
    });
    if (createErr) {
      // A previous run may have created the auth user but failed before the
      // profile row was inserted — find that existing auth user and continue.
      if (/already been registered|already exists|duplicate/i.test(createErr.message)) {
        let page = 1;
        while (!userId) {
          const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
          if (listErr) throw listErr;
          const match = list.users.find((u) => u.email?.toLowerCase() === DEMO_EMAIL);
          if (match) userId = match.id;
          else if (list.users.length < 200) break;
          page += 1;
        }
        if (!userId) throw createErr;
        const { error: updErr } = await supabase.auth.admin.updateUserById(userId, { password: DEMO_PASSWORD });
        if (updErr) throw updErr;
        needsProfileRow = true;
        console.log('Found existing auth user without a profile row — completing setup.');
      } else {
        throw createErr;
      }
    } else {
      userId = created.user.id;
      needsProfileRow = true;
    }
  }

  if (needsProfileRow) {
    const photoPath = `${userId}/demo_placeholder.png`;
    const { error: upErr } = await supabase.storage
      .from('faces')
      .upload(photoPath, PLACEHOLDER_PNG, { contentType: 'image/png', upsert: true });
    if (upErr) throw upErr;

    const baseRow = {
      id: userId,
      email: DEMO_EMAIL,
      full_name: DEMO_NAME,
      phone: DEMO_MOBILE,
      live_photo_url: photoPath,
      state: 'Uttar Pradesh',
      gender: 'other',
      social_category: 'general',
      annual_income: 250000,
    };
    let { error: profErr } = await supabase.from('profiles').insert(baseRow);
    // Self-heal for the legacy schema, same as backend/routes/auth.js /register.
    if (profErr && /null value in column "(user_id|mobile)"/.test(profErr.message)) {
      ({ error: profErr } = await supabase
        .from('profiles')
        .insert({ ...baseRow, user_id: userId, mobile: DEMO_MOBILE }));
    }
    if (profErr) throw profErr;
    console.log('Demo user created.');
  }

  console.log('---');
  console.log('Login email:   ', DEMO_EMAIL);
  console.log('Login password:', DEMO_PASSWORD);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to create demo user:', err.message);
    process.exit(1);
  });
