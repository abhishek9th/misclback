/**
 * Step 3 of promoting catalogue schemes to the CURATED tier: merges the reviewed
 * records (backend/data/curation/authored_batch_*.json) with each scheme's official
 * catalogue data and writes them in the exact src/data/schemes.js format.
 *
 *   node backend/scripts/buildCuratedSchemes.mjs
 *
 * Output: src/data/curatedSchemesExtra.js (and a byte-identical copy in backend/data/).
 * schemes.js appends CURATED_EXTRA to its own list. Reviewer overrides (cat/gen/inc/
 * minage/maxage/states) win over the automatically extracted criteria.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { INDIAN_STATES } from '../../src/services/locationService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const CUR_DIR = path.resolve(__dirname, '../data/curation');
const authored = fs.readdirSync(CUR_DIR).filter((f) => /^authored_batch_\d+\.json$/.test(f)).sort()
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(CUR_DIR, f), 'utf8')));

const sb = getSupabaseAdmin();
const rows = [];
const slugs = authored.map((a) => a.slug);
for (let i = 0; i < slugs.length; i += 100) {
  const { data, error } = await sb.from('myscheme_catalogue')
    .select('slug,name,level,states,income_limit,eligible_categories,eligible_genders,min_age,max_age,source_url')
    .in('slug', slugs.slice(i, i + 100));
  if (error) throw error;
  rows.push(...data);
}
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const details = new Map(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/myscheme-scrape/scheme_details.json'), 'utf8')).map((d) => [d.slug, d]));

// Catalogue state names → the names used in the app's state list (src/services/locationService.js)
const STATE_MAP = { Delhi: 'Delhi (NCT)', 'Jammu and Kashmir': 'Jammu & Kashmir', 'Andaman and Nicobar Islands': 'Andaman & Nicobar Islands' };
const CAT_HI = { sc: 'अनुसूचित जाति (SC)', st: 'अनुसूचित जनजाति (ST)', obc: 'अन्य पिछड़ा वर्ग (OBC)', ews: 'आर्थिक रूप से कमज़ोर वर्ग (EWS)', minorities: 'अल्पसंख्यक समुदाय', general: 'सामान्य वर्ग' };
// Conditions the profile cannot verify (occupation, marital/household status, group membership,
// being a student…). Each becomes a "special eligibility" requirement, so the scheme shows as
// "possible — confirm you meet this" instead of a confident match for everyone.
const PRECONDITIONS = {
  'lbssk-spuct': 'You are a Safai Karamchari / identified manual scavenger (or their dependent)',
  'lbssk-sms': 'You are a Safai Karamchari / identified manual scavenger (or their dependent)',
  srms: 'You are an identified manual scavenger (with MS-ID) or their dependent',
  'msynskfdc-h': 'You are a woman Safai Karamchari or a dependent daughter of one',
  nsywgntdnt: 'You are a woman from a nomadic or denotified tribe',
  'seed-ee': 'You belong to a De-notified, Nomadic or Semi-Nomadic Tribe',
  sddpsa: 'You belong to the Tea Tribes / Adivasi community of Assam',
  visvas: 'You are in a Self-Help Group where at least 70% of members are SC / OBC / Safai Karamcharis',
  ssshgm: "You are a member of a registered minority women's Self-Help Group",
  sma: "You are a member of an OBC women's Self-Help Group",
  'nhdp-dba-saic': 'You are a master craftsperson with a national/state handicrafts award, aged 60+',
  bydbta: 'You are a master craftsperson with a national/state handicrafts award, aged 60+',
  'vls-nmdfc': 'You are a traditional artisan or craftsperson',
  dlsk: 'You are a leather artisan from a listed SC sub-caste',
  gispw: 'You are a powerloom weaver or worker',
  'mgbby-odisha': 'You are a handloom weaver earning at least 50% of income from weaving',
  sgsscst: 'You are a traditional artisan',
  ipshaaciec: 'You are a handloom / handicraft artisan in one of the listed activities',
  nkmds: 'You are a construction worker registered with the labour department (or their dependent)',
  jrfry: 'You are a small or marginal raiyat / bataidaar farmer',
  hcpp: 'You are a BPL farmer growing hybrid chilli',
  isfepqiisaradoceoplcrnp: 'You are a large-cardamom grower with up to 8 hectares',
  hsfepqiisaradocscrnpkaos: 'You are a small-cardamom grower',
  dsctar: 'You are a small coffee grower (up to 10 hectares) replanting old plantations',
  isfepqisaradocphipfsclctw: 'You are a spice grower buying a polisher',
  cdpnercc: 'You are a tribal coffee grower in the North-East',
  cdpnerwa: 'You are a tribal coffee grower in the North-East',
  mpds: 'You are buying an improved-breed male pig',
  wmcl: 'You are a child of an SC/ST labourer in a coffee plantation or curing works',
  lsmpcltt: 'You are a member of a Large Sized Multi-Purpose Co-operative Society',
  'jiyo-parsi': 'You are a Parsi / Zoroastrian married couple',
  amptmsy: 'You are a divorced or abandoned Muslim woman',
  seloanwomen: 'You are a widow, divorced or abandoned woman',
  mmvenay: 'You are a widow, or a single woman aged 40+',
  mtamsy: 'You are a woman raising up to two children in financial hardship (widow / destitute)',
  'isss-wid': 'You are a destitute widow, divorced or deserted woman',
  'mssp-vm': 'You are a vulnerable woman covered by the scheme (e.g. widow, divorced; unmarried women 45+)',
  mbpy: 'You are 60+, a widow, a leprosy patient or a person with a disability',
  sms: 'You are an unmarried girl about to be married',
  klp: 'You are an unmarried girl about to be married',
  fatnukyv: 'You are marrying in a mass marriage ceremony',
  smas: 'Your family holds an AAY / PHH ration card and this is a first marriage',
  dwis: 'Either partner in your marriage has a disability of 40% or more',
  mapdbpl: 'You are a disabled BPL applicant marrying for the first time',
  cssipcra1scstpaa1: 'You are a victim of atrocity, or a partner in an inter-caste marriage',
  gascstpsfcad: 'You are a patient suffering from cancer or another malignant disease',
  'fadse': 'You are unemployed and want to start self-employment',
  gssy: 'Your family is in a vulnerable group (HIV/AIDS-affected, destitute, manual scavenger, PVTG, released bonded labour, single mother)',
  ueeupwd: 'You are unemployed, registered with the Employment Exchange for 2+ years',
  us: 'You are a woman starting a trade or service business',
  mkyh: 'You are a BPL woman on the BPL survey list',
  msgbcdc: 'You have experience in a business requiring technical skills',
};
const STUDENT_PRECONDITION = 'You are currently studying at the level this scheme covers';
const STATE_HI = Object.fromEntries(INDIAN_STATES.map((s) => [s.name, s.name_hi]));
const rupee = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const clean = (s) => String(s || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ');
const has = (v) => v !== undefined;

function reasons(s, a) {
  const r = [];
  const cats = (s.eligible_categories || []).filter((c) => c !== 'all');
  if (cats.length) r.push(`यह योजना ${cats.map((c) => CAT_HI[c]).join(' / ')} के लिए है`);
  if (s.eligible_genders.includes('female')) r.push('यह योजना केवल महिलाओं के लिए है');
  if (s.eligible_genders.includes('lgbtq')) r.push('यह योजना ट्रांसजेंडर व्यक्तियों के लिए है');
  if (s.income_limit) r.push(`परिवार की वार्षिक आय ${rupee(s.income_limit)} तक होनी चाहिए`);
  else if (a.review && /income/i.test(a.review)) r.push('आय सीमा श्रेणी के अनुसार अलग है — आधिकारिक पोर्टल पर देखें');
  if (s.min_age && s.max_age) r.push(`आयु ${s.min_age} से ${s.max_age} वर्ष के बीच होनी चाहिए`);
  else if (s.min_age) r.push(`न्यूनतम आयु ${s.min_age} वर्ष`);
  else if (s.max_age) r.push(`अधिकतम आयु ${s.max_age} वर्ष`);
  r.push(s.scope === 'central' ? 'यह भारत के सभी राज्यों में उपलब्ध है' : `यह ${s.states.map((x) => STATE_HI[x] || x).join(', ')} के निवासियों के लिए है`);
  if (s.business_status && s.business_status.length === 1 && s.business_status[0] === 'new') r.push('यह नया व्यवसाय शुरू करने वालों के लिए है');
  return r.slice(0, 6);
}

const out = [];
const problems = [];
for (const a of authored) {
  const row = bySlug.get(a.slug);
  if (!row) { problems.push(`${a.slug}: not found in catalogue`); continue; }
  const central = /central/i.test(row.level || '');
  const states = central ? ['all'] : (row.states || []).map((x) => STATE_MAP[x] || x);
  if (!central && !states.length) { problems.push(`${a.slug}: state scheme without a state`); continue; }
  const dbGenders = (row.eligible_genders || []).map((g) => (g === 'other' ? 'lgbtq' : g));
  const dbCats = (row.eligible_categories || []).filter((c) => c !== 'general');
  const s = {
    id: `scheme_${a.slug.replace(/[^a-z0-9]+/g, '_')}`,
    name: clean(row.name),
    name_hi: a.name_hi,
    type: a.type,
    scope: central ? 'central' : 'state',
    states,
    income_limit: has(a.inc) ? a.inc : (row.income_limit ?? null),
    eligible_genders: has(a.gen) ? a.gen : (dbGenders.length ? dbGenders : ['all']),
    eligible_categories: has(a.cat) ? a.cat : (dbCats.length ? dbCats : ['all']),
    min_age: has(a.minage) ? a.minage : (row.min_age ?? null),
    max_age: has(a.maxage) ? a.maxage : (row.max_age ?? null),
  };
  if (a.type === 'business' || a.type === 'skill_employment') { s.fields = a.fields || []; s.business_status = a.bstatus || ['all']; }
  if (a.type === 'student') { s.student_type = a.student_type; s.education_levels = a.edu_levels || ['all']; s.course_fields = a.course_fields || ['all']; }
  s.min_financial_assistance = a.min_fin ?? null;
  s.max_financial_assistance = a.max_fin ?? null;
  s.subsidy_percentage = a.subsidy_hi || null;
  s.interest_rate = a.interest_hi || null;
  const precondition = PRECONDITIONS[a.slug] || (a.type === 'student' ? STUDENT_PRECONDITION : null);
  if (precondition) s.precondition = precondition;
  s.description_hi = a.desc_hi;
  s.benefits_hi = a.ben_hi;
  s.eligibility_reasons_hi = reasons(s, a);
  s.required_documents_hi = a.docs_hi;
  s.application_steps_hi = a.steps_hi;
  const d = details.get(a.slug) || {};
  s.official_link = a.link || d.official_website || row.source_url;
  s.curation = {
    level: 'reviewed_against_official_text',
    source: 'myscheme.gov.in',
    source_url: row.source_url,
    reviewed_at: '2026-09-30',
    ...(a.review ? { note: a.review } : {}),
  };
  // sanity
  for (const k of ['name_hi', 'description_hi']) if (!s[k]) problems.push(`${a.slug}: missing ${k}`);
  if (!s.benefits_hi?.length || !s.application_steps_hi?.length || !s.required_documents_hi?.length) problems.push(`${a.slug}: empty benefits/steps/documents`);
  out.push(s);
}

const ids = out.map((s) => s.id);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) problems.push(`duplicate ids: ${[...new Set(dup)].join(', ')}`);

const header = `// GENERATED by backend/scripts/buildCuratedSchemes.mjs — do not edit by hand.
// Curated-tier schemes promoted from the myScheme catalogue. Each record was reviewed
// against the scheme's official text (source: myscheme.gov.in); see \`curation\` on each.
// Reviewer corrections to the automatic extraction are recorded in \`curation.note\`.
export const CURATED_EXTRA = `;
const body = header + JSON.stringify(out, null, 2) + ';\n';
fs.writeFileSync(path.resolve(__dirname, '../../src/data/curatedSchemesExtra.js'), body);
fs.writeFileSync(path.resolve(__dirname, '../data/curatedSchemesExtra.js'), body);

const byType = {}; out.forEach((s) => (byType[s.type] = (byType[s.type] || 0) + 1));
console.log(`Authored: ${authored.length} | built: ${out.length} | by type: ${JSON.stringify(byType)}`);
console.log(problems.length ? `PROBLEMS (${problems.length}):\n - ${problems.join('\n - ')}` : 'No problems.');
