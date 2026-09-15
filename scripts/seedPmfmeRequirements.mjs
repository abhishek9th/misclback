/**
 * Authoritative, DECOMPOSED requirement set for PMFME (PM Formalisation of
 * Micro food processing Enterprises) — the §18/§40 test case.
 *
 * Replaces the 4 collapsed rows that the generic seed produced (which merged
 * "Aadhaar व PAN" -> one identity row and dropped the Project Report entirely).
 * Here EVERY requirement is an individual record with a type, mandatory/
 * conditional flag, alternative-document group, UI category, and the official
 * source. The engine (requirementEngine.js) then evaluates each one against the
 * user's profile + document vault and returns a per-item status.
 *
 * Source: PMFME Scheme Guidelines — Ministry of Food Processing Industries
 * (https://pmfme.mofpi.gov.in/). Items whose applicability depends on
 * scheme-specific facts we don't hold in the permanent profile (premises
 * owned/rented, new/existing enterprise) are modelled as conditional or as
 * alternative-document groups — never silently assumed (§6/§10).
 *
 * Idempotent: deletes the scheme's existing rows, then inserts this set.
 */
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SCHEME_ID = 'scheme_pmfme';
const SOURCE = {
  source_name: 'PMFME Scheme Guidelines — Ministry of Food Processing Industries',
  source_url: 'https://pmfme.mofpi.gov.in/',
  source_type: 'ministry_website',
  source_last_verified: new Date().toISOString().slice(0, 10),
};

// key, name, type, required, priority(1-5), delay, category, + condition extras
const REQS = [
  // ---- Identity ----
  { key: 'aadhaar', name: 'Aadhaar Card', type: 'identity', required: true, priority: 1, delay: 'CRITICAL', cat: 'Identity',
    desc: 'Aadhaar is mandatory for registration and for direct benefit transfer of the credit-linked subsidy.' },
  { key: 'pan_card', name: 'PAN Card', type: 'identity', required: true, priority: 1, delay: 'HIGH', cat: 'Identity' },
  { key: 'photo', name: 'Passport-size Photograph', type: 'document', required: true, priority: 3, delay: 'LOW', cat: 'Identity' },

  // ---- Address & Premises ----
  { key: 'address_proof', name: 'Residential Address Proof', type: 'address', required: true, priority: 2, delay: 'MEDIUM', cat: 'Address & Premises',
    alternatives: [{ key: 'aadhaar', name: 'Aadhaar' }, { key: 'voter_id', name: 'Voter ID' }, { key: 'ration_card', name: 'Ration Card' }, { key: 'utility_bill', name: 'Utility Bill' }] },
  { key: 'premises_proof', name: 'Business Premises Proof', type: 'address', required: true, priority: 1, delay: 'HIGH', cat: 'Address & Premises',
    desc: 'If the premises are owned, submit ownership proof; if rented, submit the rent/lease agreement.',
    alternatives: [{ key: 'ownership_proof', name: 'Ownership Proof' }, { key: 'rent_agreement', name: 'Rent / Lease Agreement' }] },

  // ---- Financial ----
  { key: 'bank_account', name: 'Bank Account Details (cancelled cheque / passbook)', type: 'bank', required: true, priority: 1, delay: 'HIGH', cat: 'Financial' },
  { key: 'bank_statement_6m', name: 'Bank Statement — last 6 months', type: 'bank', required: true, priority: 2, delay: 'MEDIUM', cat: 'Financial' },
  { key: 'machinery_quotation', name: 'Machinery / Equipment Quotation', type: 'project_information', required: true, priority: 2, delay: 'HIGH', cat: 'Financial' },
  { key: 'capex_estimate', name: 'Capital Expenditure / Project Cost Estimate', type: 'financial_information', required: true, priority: 2, delay: 'MEDIUM', cat: 'Financial' },

  // ---- Project ----
  { key: 'project_report', name: 'Detailed Project Report (DPR)', type: 'project_information', required: true, priority: 1, delay: 'CRITICAL', cat: 'Project',
    desc: 'A detailed project report covering the proposed food-processing unit, cost and viability.' },

  // ---- Business (conditional — existing enterprise) ----
  { key: 'udyam_registration', name: 'Udyam / MSME Registration', type: 'document', required: true, priority: 2, delay: 'MEDIUM', cat: 'Business',
    applies_when: { field: 'enterprise_status', in: ['existing'], options: ['new', 'existing'] },
    question: 'Is this a new or an existing enterprise?',
    not_applicable_reason: 'Only required for an existing enterprise' },
  { key: 'fssai_registration', name: 'FSSAI Registration / License', type: 'document', required: true, priority: 2, delay: 'HIGH', cat: 'Business',
    applies_when: { field: 'enterprise_status', in: ['existing'], options: ['new', 'existing'] },
    question: 'Is this a new or an existing enterprise?',
    not_applicable_reason: 'Required for an operating food enterprise; new units obtain it during setup' },

  // ---- Category (applies only if the applicant is SC/ST/OBC) ----
  { key: 'category_certificate', name: 'Caste / Category Certificate', type: 'category_specific', required: false, priority: 3, delay: 'LOW', cat: 'Category & Eligibility',
    applicable_categories: ['sc', 'st', 'obc'],
    desc: 'Required only if claiming any category-based priority/benefit.' },

  // ---- Eligibility ----
  { key: 'min_age', name: 'Minimum age 18 years', type: 'eligibility', required: true, priority: 1, delay: 'CRITICAL', cat: 'Eligibility', min_age: 18 },

  // ---- Profile information (data, not a document) ----
  { key: 'social_category_info', name: 'Social category', type: 'personal_information', required: false, priority: 4, delay: 'LOW', cat: 'Profile Information',
    profile_field: 'category', desc: 'Your social category from your profile (used for any category-based benefit).' },
];

function toRow(r) {
  const condition = { category: r.cat };
  if (r.alternatives) condition.alternatives = r.alternatives;
  if (r.applies_when) { condition.applies_when = r.applies_when; condition.question = r.question; condition.not_applicable_reason = r.not_applicable_reason; }
  if (r.profile_field) condition.profile_field = r.profile_field;
  if (r.min_age) condition.min_age = r.min_age;
  return {
    scheme_id: SCHEME_ID,
    requirement_key: r.key,
    requirement_name: r.name,
    description: r.desc || null,
    requirement_type: r.type,
    required: r.required,
    condition,
    applicable_categories: r.applicable_categories || null,
    applicable_gender: null,
    applicable_disability_status: null,
    applicable_occupation: null,
    applicable_age_min: null,
    applicable_age_max: null,
    ...SOURCE,
    priority: r.priority,
    delay_risk: r.delay,
    rejection_risk: r.delay,
  };
}

async function run() {
  const supabase = getSupabaseAdmin();
  await supabase.from('schemes').upsert({ scheme_id: SCHEME_ID, name: 'PM Formalisation of Micro Food Processing Enterprises (PMFME)', is_active: true }, { onConflict: 'scheme_id' });

  const { error: delErr } = await supabase.from('scheme_requirements').delete().eq('scheme_id', SCHEME_ID);
  if (delErr) { console.error('delete failed:', delErr.message); process.exit(1); }

  const rows = REQS.map(toRow);
  const { error } = await supabase.from('scheme_requirements').upsert(rows, { onConflict: 'scheme_id,requirement_key' });
  if (error) { console.error('insert failed:', error.message); process.exit(1); }

  console.log(`Seeded ${rows.length} decomposed PMFME requirements.`);
  console.log(rows.map((r) => `  - [${r.requirement_type}] ${r.requirement_name}`).join('\n'));
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
