import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { evaluateAllSchemes } from '../services/eligibilityEngine.js';
import { normalizeSituation, buildAdvice } from '../services/advisor/advisorEngine.js';
import { explainAdvice, sentence } from '../services/advisor/advisorExplainer.js';
import { analyseBusiness } from '../services/advisor/businessFeasibility.js';
import { aiSearch } from '../services/aiSchemeSearch.js';

// Financial Advisory. Pipeline (see services/advisor/advisorEngine.js):
//   situation → profile → eligible schemes → eligibility engine → financial
//   calculation → optimisation → ONE recommendation → plain-language explanation.
// All numbers are computed deterministically; the language model only explains.
const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let SCHEMES_CACHE = null;
async function getSchemes() {
  if (SCHEMES_CACHE) return SCHEMES_CACHE;
  const url = pathToFileURL(path.resolve(__dirname, '../data/schemes.js')).href;
  SCHEMES_CACHE = (await import(url)).SCHEMES || [];
  return SCHEMES_CACHE;
}

const CAT_VOCAB = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];
const GENDER_VOCAB = ['male', 'female', 'other'];
const inVocab = (v, vocab) => (v && vocab.includes(String(v).toLowerCase()) ? String(v).toLowerCase() : null);

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  return Number.isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// Catalogue loan schemes (AI-extracted terms) the matcher thinks fit this user.
async function catalogueLoanRows(supabase, profile) {
  try {
    const { data: matched, error } = await supabase.rpc('match_catalogue_schemes', {
      p_income: profile?.annual_income ?? null,
      p_category: inVocab(profile?.social_category, CAT_VOCAB),
      p_gender: inVocab(profile?.gender, GENDER_VOCAB),
      p_education: null,
      p_state: profile?.state || null,
      p_age: profile?.age ?? ageFromDob(profile?.date_of_birth),
      p_benefit_types: ['loan'],
      p_limit: 40,
    });
    if (error || !matched?.length) return [];
    const slugs = matched.map((m) => m.slug).filter(Boolean);
    if (!slugs.length) return [];
    const { data } = await supabase.from('myscheme_catalogue')
      .select('name, slug, states, is_loan_scheme, rate_type, loan_amount_min, loan_amount_max, tenure_min_months, tenure_max_months, interest_rate, interest_rate_min, interest_rate_max, interest_subsidy_pct')
      .in('slug', slugs).eq('is_loan_scheme', true);
    return data || [];
  } catch (err) {
    console.warn('advisor: catalogue lookup skipped:', err.message);
    return [];
  }
}

const withText = (list, lang, codeKey) => list.map((x) => ({
  ...x,
  reasons_text: (x[codeKey] || []).map((w) => sentence(w.code, w.detail, lang)).filter(Boolean),
}));

// POST /api/advisor/plan  { situation: {...}, language: 'en'|'hi' }
router.post('/plan', requireUser, async (req, res) => {
  const lang = req.body?.language === 'hi' ? 'hi' : 'en';
  let situation;
  try {
    situation = normalizeSituation(req.body?.situation || {});
  } catch (err) {
    return res.status(400).json({ error: err.message, code: err.code || 'INVALID_INPUT', field: err.field || null });
  }

  const supabase = getSupabaseAdmin();
  const uid = req.user.id;
  try {
    const schemes = await getSchemes();
    const { data: profile } = await supabase
      .from('profiles')
      .select('date_of_birth, social_category, gender, disability_status, annual_income, state, district, education_level, occupation, age')
      .eq('id', uid).maybeSingle();

    const structuredProfile = {
      annual_income: profile?.annual_income ?? null,
      category: profile?.social_category || null,
      gender: profile?.gender || null,
      disability_status: profile?.disability_status ?? null,
      state: profile?.state || null,
    };
    const reqProfile = {
      age: ageFromDob(profile?.date_of_birth), category: structuredProfile.category, gender: structuredProfile.gender,
      disability_status: Boolean(profile?.disability_status), occupation_status: profile?.occupation || null,
      annual_income: structuredProfile.annual_income, state: structuredProfile.state, district: profile?.district || null,
      education_level: profile?.education_level || null,
      business_status: situation.goal === 'new' ? 'new' : 'existing',
    };

    const schemeIds = schemes.map((s) => s.id);
    const [{ data: reqRows }, { data: documents }, { data: availability }, applied, catalogueRows] = await Promise.all([
      supabase.from('scheme_requirements').select('*').in('scheme_id', schemeIds),
      supabase.from('user_documents').select('document_type, verification_status, expiry_date, uploaded_at').eq('user_id', uid),
      supabase.from('document_availability').select('document_type, status').eq('user_id', uid),
      supabase.from('scheme_applications').select('scheme_id, scheme_name, status').eq('user_id', uid).then((r) => r).catch(() => ({ data: [] })),
      catalogueLoanRows(supabase, profile),
    ]);
    const applications = (applied?.data || []).map((a) => ({ ...a, status_source: 'USER_REPORTED' }));
    const requirementsBySchemeId = {};
    for (const row of reqRows || []) (requirementsBySchemeId[row.scheme_id] ||= []).push(row);

    const { schemes: evaluated } = evaluateAllSchemes({
      schemes, structuredProfile, reqProfile, requirementsBySchemeId,
      documents: documents || [], availability: availability || [],
      appliedSchemeIds: applications.map((a) => a.scheme_id), applications,
    });

    const advice = buildAdvice({ situation, profile: structuredProfile, curatedEvaluated: evaluated, curatedSchemes: schemes, catalogueRows });
    const explanation = await explainAdvice(advice, lang);

    const profileGaps = [];
    if (!structuredProfile.category) profileGaps.push('category');
    if (!structuredProfile.gender) profileGaps.push('gender');
    if (!structuredProfile.state) profileGaps.push('state');

    const tag = (p) => p && ({ ...p, flags_text: p.flags.map((f) => sentence(f, null, lang)).filter(Boolean) });
    res.json({
      checked_at: new Date().toISOString(),
      language: lang,
      profile_used: { category: structuredProfile.category, gender: structuredProfile.gender, state: structuredProfile.state },
      profile_gaps: profileGaps,
      situation: advice.situation,
      recommended: tag(advice.recommended),
      alternatives: advice.alternatives.map(tag),
      blocked: withText(advice.blocked, lang, 'problems'),
      excluded: withText(advice.excluded, lang, 'why'),
      possible_catalogue_options: advice.possible_catalogue_options,
      enablers: advice.enablers,
      adjustments: advice.adjustments,
      assumptions_text: advice.assumptions.map((a) => sentence(a, null, lang)).filter(Boolean),
      explanation,
    });
  } catch (err) {
    console.error('advisor plan error:', err.message); // never log the user's figures
    res.status(500).json({ error: 'Could not build your funding plan right now', code: 'ADVISOR_ERROR' });
  }
});

// POST /api/advisor/business-analysis  { inputs: {...}, include_schemes?: boolean }
// Deterministic feasibility analysis (services/advisor/businessFeasibility.js): every figure is calculated
// from what the user entered. Scheme suggestions come from the AI scheme search and are shown as options to
// check, never as approved or guaranteed.
const NUM_KEYS = ['total_investment', 'working_capital', 'own_savings', 'household_income_monthly', 'household_expenses_monthly',
  'existing_emi_monthly', 'employees', 'salary_per_employee_month', 'rent_month', 'other_fixed_month', 'depreciation_month',
  'monthly_revenue', 'monthly_variable_costs', 'loan_amount', 'loan_rate_annual', 'loan_tenure_months', 'min_own_contribution_pct'];
const FIELD_FOR_SECTOR = { dairy: 'dairy_livestock', poultry: 'dairy_livestock', retail: 'retail_trading', manufacturing: 'manufacturing' };

function cleanInputs(body) {
  const src = body && typeof body === 'object' ? body : {};
  const out = { sector: String(src.sector || 'other'), stage: src.stage === 'existing' ? 'existing' : 'new', location: src.location === 'urban' ? 'urban' : src.location === 'rural' ? 'rural' : null, drivers: {} };
  const bad = (k) => { const e = new Error(`${k} must be a number from 0 to 1,000,000,000`); e.field = k; return e; };
  const read = (k, v) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) throw bad(k);
    return n;
  };
  for (const k of NUM_KEYS) { const v = read(k, src[k]); if (v !== undefined) out[k] = v; }
  for (const [k, v] of Object.entries(src.drivers && typeof src.drivers === 'object' ? src.drivers : {})) {
    if (!/^[a-z_]{2,40}$/.test(k)) continue;
    const n = read(`drivers.${k}`, v);
    if (n !== undefined) out.drivers[k] = n;
  }
  return out;
}

router.post('/business-analysis', requireUser, async (req, res) => {
  let inputs;
  try { inputs = cleanInputs(req.body?.inputs); }
  catch (e) { return res.status(400).json({ error: e.message, code: 'INVALID_INPUT', field: e.field || null }); }
  try {
    const analysis = analyseBusiness(inputs);
    if (req.body?.include_schemes !== false && analysis.final_recommendation.decision !== 'INSUFFICIENT DATA') {
      try {
        const supabase = getSupabaseAdmin();
        const { data: profile } = await supabase.from('profiles').select('social_category, gender, annual_income, state, date_of_birth').eq('id', req.user.id).maybeSingle();
        const sectorText = analysis.business_overview.sector_label;
        const found = await Promise.race([
          aiSearch({
            criteria: FIELD_FOR_SECTOR[inputs.sector] ? { field: FIELD_FOR_SECTOR[inputs.sector], business_status: inputs.stage } : { business_status: inputs.stage },
            profile: { state: profile?.state || null, category: inVocab(profile?.social_category, CAT_VOCAB), gender: inVocab(profile?.gender, GENDER_VOCAB), income: profile?.annual_income ?? null, age: ageFromDob(profile?.date_of_birth) },
            query: `${inputs.stage === 'new' ? 'Start a new' : 'Grow my existing'} ${sectorText.toLowerCase()} business, project cost about Rs ${analysis.business_overview.total_investment ?? ''}`,
            limit: 6,
          }),
          new Promise((resolve) => setTimeout(() => resolve(null), 30000)),
        ]);
        analysis.recommended_schemes = (found?.schemes || []).map((s) => ({
          slug: s.slug, name: s.name, help_type: s.benefit_types || [], level: s.level, states: s.states || [],
          maximum_loan: s.loan_amount_max ?? null, interest_or_subsidy: s.interest_subsidy_note || null,
          official_link: s.application_url, note: 'A suggestion to check, not an approval. Read the scheme terms (eligibility, interest, collateral) before relying on it.',
        }));
      } catch (e) { console.error('advisor scheme lookup failed:', e.message); }
    }
    res.json(analysis);
  } catch (err) {
    console.error('business analysis error:', err.message); // never log the user's figures
    res.status(500).json({ error: 'Could not run the analysis right now', code: 'ANALYSIS_ERROR' });
  }
});

export default router;
