/**
 * Extends the Application Readiness & Document Checker's structured
 * requirement data (public.scheme_requirements) from PMEGP-only to every
 * scheme in SchemeSetu's own curated catalogue (src/data/schemes.js).
 *
 * SOURCE OF TRUTH: every requirement row generated here is DERIVED from
 * fields already present on that scheme's own object in schemes.js
 * (eligible_categories, eligible_genders, business_status, income_limit,
 * required_documents_hi) — nothing is invented. Free-text document lines are
 * mapped to a canonical requirement via keyword matching (see DOC_RULES); a
 * line matching no rule is kept verbatim (in Hindi) rather than guessed at,
 * so no fact is ever translated-and-possibly-wrong or fabricated.
 *
 * Idempotent: upserts by (scheme_id, requirement_key), safe to re-run after
 * schemes.js changes.
 *
 * Usage: node backend/scripts/seedSchemeRequirements.mjs [--dry-run]
 */
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DRY_RUN = process.argv.includes('--dry-run');

// Each rule: a regex tested against the Hindi document line, and the
// canonical requirement it maps to. First match wins. `skip: true` means the
// line is intentionally dropped (its fact is already captured more precisely
// elsewhere, e.g. caste-certificate lines are superseded by the per-category
// rows derived from eligible_categories below).
const DOC_RULES = [
  { test: /फोटो/, key: 'photo', name: 'Passport-size Photograph', type: 'document', priority: 3, delay: 'LOW' },
  { test: /पासपोर्ट/, key: 'passport', name: 'Valid Passport', type: 'identity', priority: 1, delay: 'CRITICAL' },
  { test: /आधार|वोटर|पहचान पत्र/, key: 'identity_proof', name: 'Identity Proof (Aadhaar / Voter ID)', type: 'identity', priority: 1, delay: 'CRITICAL' },
  { test: /पैन कार्ड/, key: 'pan_card', name: 'PAN Card', type: 'identity', priority: 2, delay: 'HIGH' },
  { test: /जाति प्रमाण|OBC.*EBC|EBC.*जाति/i, skip: true },
  { test: /दिव्यांगता|UDID/, key: 'disability_certificate', name: 'Disability Certificate / UDID Card', type: 'disability_specific', disabilityOnly: true, priority: 1, delay: 'HIGH' },
  { test: /ट्रांसजेंडर/, key: 'transgender_certificate', name: 'Transgender Certificate', type: 'document', required: false, priority: 3, delay: 'LOW' },
  { test: /निवास|डोमीसाइल/, key: 'address_proof', name: 'Address / Domicile Proof', type: 'address', priority: 1, delay: 'HIGH' },
  { test: /राशन कार्ड|परिवार पहचान/, key: 'ration_card', name: 'Ration Card / Family ID', type: 'document', priority: 3, delay: 'MEDIUM' },
  { test: /आय प्रमाण|आईटीआर|ITR/, key: 'income_certificate', name: 'Income Certificate', type: 'financial_information', priority: 2, delay: 'MEDIUM' },
  { test: /बैंक|पासबुक|रद्द चेक/, key: 'bank_account', name: 'Bank Account Details', type: 'bank', priority: 1, delay: 'HIGH' },
  { test: /मार्कशीट|अंकपत्र|अंकसूची|अंकतालिका/, key: 'academic_marksheet', name: 'Academic Marksheet', type: 'education', priority: 2, delay: 'MEDIUM' },
  { test: /आयु प्रमाण|जन्म तिथि/, key: 'age_proof', name: 'Age Proof', type: 'document', priority: 2, delay: 'MEDIUM' },
  { test: /शैक्षणिक योग्यता/, key: 'education_certificate', name: 'Educational Qualification Certificate', type: 'education', priority: 2, delay: 'MEDIUM' },
  { test: /प्रवेश|एडमिशन|दाखिल|फीस रसीद|फीस स्ट्रक्चर|कॉलेज आईडी/, key: 'admission_proof', name: 'Admission / Enrollment Proof', type: 'document', priority: 1, delay: 'HIGH' },
  { test: /प्रोजेक्ट|व्यवसाय योजना|DPR|कोटेशन|मशीनरी.*बिल/, key: 'project_report', name: 'Project Report / Business Plan', type: 'project_information', priority: 1, delay: 'CRITICAL' },
  { test: /रजिस्ट्रेशन|लाइसेंस|GST|जीएसटी|FSSAI|पार्टनरशिप|फर्म/, key: 'business_registration_proof', name: 'Business Registration / License Proof', type: 'document', priority: 2, delay: 'HIGH' },
  { test: /भूमि|किराए.*समझौता/, key: 'land_or_rent_proof', name: 'Land / Rent Agreement', type: 'document', priority: 3, delay: 'MEDIUM' },
  { test: /व्यवसाय.*विवरण|व्यवसाय या प्रशिक्षण योजना/, key: 'business_description', name: 'Traditional Trade / Occupation Details', type: 'document', priority: 3, delay: 'LOW' },
];

const CATEGORY_LABEL = {
  sc: 'SC Certificate', st: 'ST Certificate', obc: 'OBC (Non-Creamy Layer) Certificate',
  ews: 'EWS Certificate', minorities: 'Minority Community Certificate',
};

function slug(s) {
  // \p{M} (combining marks — Devanagari matras/virama) must stay attached to
  // their base letter, or words like "व्यवसाय" fragment into single-akshara junk.
  return s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

function buildRequirementsForScheme(scheme) {
  const rows = [];
  const seenKeys = new Set();
  const push = (row) => {
    if (seenKeys.has(row.requirement_key)) return;
    seenKeys.add(row.requirement_key);
    rows.push({
      scheme_id: scheme.id,
      description: null,
      condition: {},
      applicable_categories: null,
      applicable_gender: null,
      applicable_disability_status: null,
      applicable_occupation: null,
      applicable_age_min: null,
      applicable_age_max: null,
      source_url: scheme.official_link || null,
      source_name: scheme.name,
      source_type: 'official_portal',
      source_last_verified: new Date().toISOString().slice(0, 10),
      required: true,
      priority: 3,
      delay_risk: 'MEDIUM',
      rejection_risk: 'MEDIUM',
      ...row,
    });
  };

  // 1. Category-specific certificates — only for categories this scheme's
  //    own eligible_categories actually lists (never 'general'/'all').
  for (const cat of scheme.eligible_categories || []) {
    if (cat === 'general' || cat === 'all') continue;
    if (!CATEGORY_LABEL[cat]) continue;
    push({
      requirement_key: `${cat}_certificate`,
      requirement_name: CATEGORY_LABEL[cat],
      requirement_type: 'category_specific',
      applicable_categories: [cat],
      priority: 1,
      delay_risk: 'HIGH',
      rejection_risk: 'HIGH',
    });
  }

  // 2. Gender/PwD restriction, when the scheme isn't open to everyone.
  //    schemes.js overloads eligible_genders with two pseudo-values used only
  //    by the frontend's own filterService: 'pwd' (disability, not gender —
  //    mapped to the engine's real applicable_disability_status field) and
  //    'lgbtq' (mapped to 'other', the closest existing profiles.gender value
  //    for transgender applicants — see GENDERS in LoginScreen.jsx).
  const genders = scheme.eligible_genders || [];
  if (genders.includes('pwd')) {
    push({
      requirement_key: 'gender_eligibility',
      requirement_name: 'Open to persons with disabilities (PwD) only',
      requirement_type: 'eligibility',
      applicable_disability_status: true,
      priority: 1,
      delay_risk: 'CRITICAL',
      rejection_risk: 'CRITICAL',
    });
  } else if (genders.includes('lgbtq')) {
    push({
      requirement_key: 'gender_eligibility',
      requirement_name: 'Open to transgender applicants only',
      requirement_type: 'eligibility',
      applicable_gender: ['other'],
      priority: 1,
      delay_risk: 'CRITICAL',
      rejection_risk: 'CRITICAL',
    });
  } else if (genders.length && !genders.includes('all')) {
    push({
      requirement_key: 'gender_eligibility',
      requirement_name: `Open to: ${genders.join(', ')} applicants only`,
      requirement_type: 'eligibility',
      applicable_gender: genders,
      priority: 1,
      delay_risk: 'CRITICAL',
      rejection_risk: 'CRITICAL',
    });
  }

  // 3. New-business-only restriction (mirrors PMEGP's own 'business_new' key)
  //    — only when the scheme's own data restricts to 'new' and nothing else.
  const bstatus = scheme.business_status || [];
  if (bstatus.length === 1 && bstatus[0] === 'new') {
    push({
      requirement_key: 'business_new',
      requirement_name: 'New unit only',
      description: 'This scheme funds only a NEW enterprise, not an existing or expanding one.',
      requirement_type: 'eligibility',
      priority: 1,
      delay_risk: 'CRITICAL',
      rejection_risk: 'CRITICAL',
    });
  }

  // 4. Documents — mapped from this scheme's own required_documents_hi list.
  for (const line of scheme.required_documents_hi || []) {
    const rule = DOC_RULES.find((r) => r.test.test(line));
    if (rule?.skip) continue;
    if (rule) {
      push({
        requirement_key: rule.key,
        requirement_name: rule.name,
        requirement_type: rule.type,
        required: rule.required !== false,
        applicable_disability_status: rule.disabilityOnly ? true : null,
        priority: rule.priority,
        delay_risk: rule.delay,
        rejection_risk: rule.delay,
      });
    } else {
      // No canonical match — keep the scheme's own wording verbatim (Hindi)
      // rather than guess a translation or invent a new fact.
      push({
        requirement_key: `doc_${slug(line)}`,
        requirement_name: line,
        requirement_type: 'document',
        priority: 3,
        delay_risk: 'MEDIUM',
        rejection_risk: 'MEDIUM',
      });
    }
  }

  return rows;
}

async function run() {
  const schemesModuleUrl = pathToFileURL(path.resolve(__dirname, '../../src/data/schemes.js')).href;
  const { SCHEMES } = await import(schemesModuleUrl);
  console.log(`Loaded ${SCHEMES.length} curated schemes`);

  const supabase = DRY_RUN ? null : getSupabaseAdmin();

  let totalRows = 0;
  for (const scheme of SCHEMES) {
    const rows = buildRequirementsForScheme(scheme);
    totalRows += rows.length;
    console.log(`${scheme.id}: ${rows.length} requirements${DRY_RUN ? ' [' + rows.map((r) => r.requirement_key).join(', ') + ']' : ''}`);

    if (DRY_RUN) continue;

    const { error: schemeErr } = await supabase
      .from('schemes')
      .upsert({ scheme_id: scheme.id, name: scheme.name, is_active: true }, { onConflict: 'scheme_id' });
    if (schemeErr) { console.error(`  schemes upsert failed: ${schemeErr.message}`); continue; }

    const { error: reqErr } = await supabase
      .from('scheme_requirements')
      .upsert(rows, { onConflict: 'scheme_id,requirement_key' });
    if (reqErr) console.error(`  scheme_requirements upsert failed: ${reqErr.message}`);
  }

  console.log(`\nTotal requirement rows: ${totalRows}${DRY_RUN ? ' (dry run — nothing written)' : ' — written'}`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
