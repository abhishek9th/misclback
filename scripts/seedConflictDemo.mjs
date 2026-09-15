import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
const __d = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__d, '../../.env') });
const supabase = getSupabaseAdmin();
const { data: u } = await supabase.auth.admin.listUsers();
const demo = u.users.find((x) => x.email === 'user01@schemesetu.demo');
if (!demo) { console.log('demo user not found'); process.exit(1); }
const { error } = await supabase.from('scheme_applications').upsert({
  user_id: demo.id, scheme_id: 'scheme_pmegp',
  scheme_name: 'Prime Minister Employment Generation Programme (PMEGP)',
  scheme_type: 'business', status: 'approved',
}, { onConflict: 'user_id,scheme_id' });
console.log('seeded PMEGP approved for demo user:', error?.message || 'OK');
process.exit(0);
