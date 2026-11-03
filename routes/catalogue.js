import { Router } from 'express';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { requireUser } from '../services/requireUser.js';
import { matchCatalogue, buildReadiness } from '../services/catalogueMatcher.js';
import { extractDocuments, DOC_LABELS } from '../services/eligibilityRules.js';
import { aiSearch } from '../services/aiSchemeSearch.js';
import { getRequirements, personalise, readinessSummary } from '../services/documentRequirements.js';

// Native browse/search over the full myscheme.gov.in catalogue scraped into
// public.myscheme_catalogue (see backend/scripts/scrapeSchemeIndex.mjs and
// scrapeSchemeDetails.mjs). Every scheme here is real, sourced from the
// government's own platform — this route only queries/paginates that data,
// never generates or alters scheme facts.
const router = Router();

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 50;

router.get('/search', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { q, level, ministry, state, category, page = '1', pageSize = String(PAGE_SIZE_DEFAULT) } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(pageSize, 10) || PAGE_SIZE_DEFAULT));
    const from = (pageNum - 1) * size;
    const to = from + size - 1;

    let query = supabase.from('myscheme_catalogue').select('*', { count: 'exact' });

    if (q && q.trim()) {
      query = query.or(`name.ilike.%${q.trim()}%,short_description.ilike.%${q.trim()}%`);
    }
    if (level) query = query.eq('level', level);
    if (ministry) query = query.contains('ministries', [ministry]);
    if (state) query = query.contains('states', [state]);
    if (category) query = query.contains('category_tags', [category]);

    const { data, error, count } = await query.order('name', { ascending: true }).range(from, to);
    if (error) throw error;

    res.json({ schemes: data, total: count, page: pageNum, pageSize: size });
  } catch (error) {
    console.error('Catalogue search error:', error.message);
    res.status(502).json({ error: 'Could not search the scheme catalogue right now.' });
  }
});

router.get('/filters', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    // Supabase caps a select at 1000 rows, so page through the whole catalogue
    // to collect EVERY distinct state/ministry (not just those in the first 1000).
    const ministrySet = new Set();
    const stateSet = new Set();
    let total = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('myscheme_catalogue').select('ministries, states').range(from, from + 999);
      if (error) throw error;
      for (const row of data) {
        (row.ministries || []).forEach((m) => ministrySet.add(m));
        (row.states || []).forEach((s) => stateSet.add(s));
      }
      total += data.length;
      if (data.length < 1000) break;
    }
    res.json({
      ministries: [...ministrySet].sort(),
      states: [...stateSet].sort(),
      totalSchemes: total,
    });
  } catch (error) {
    console.error('Catalogue filters error:', error.message);
    res.status(502).json({ error: 'Could not load catalogue filters right now.' });
  }
});

// GET /api/catalogue/eligible?benefit_types=loan,subsidy — catalogue schemes the
// signed-in user is likely eligible for, from AI-EXTRACTED criteria. Compatible-
// match only (unknowns never exclude), most-specific first. These are surfaced
// as "AI-assisted — confirm on the official portal", never verified results.
const EDU_VOCAB = ['school', '10th', '12th', 'diploma', 'undergraduate', 'postgraduate', 'phd', 'vocational'];
const CAT_VOCAB = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];
const GENDER_VOCAB = ['male', 'female', 'other'];

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

async function loadProfile(supabase, userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('annual_income, social_category, gender, education_level, state, date_of_birth, age')
    .eq('id', userId).maybeSingle();
  const inVocab = (v, vocab) => (v && vocab.includes(String(v).toLowerCase()) ? String(v).toLowerCase() : null);
  return {
    income: profile?.annual_income ?? null,
    category: inVocab(profile?.social_category, CAT_VOCAB),
    gender: inVocab(profile?.gender, GENDER_VOCAB),
    education: inVocab(profile?.education_level, EDU_VOCAB),
    state: profile?.state || null,
    age: profile?.age ?? ageFromDob(profile?.date_of_birth),
  };
}

const csvList = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// Strict, sector-aware matching (see services/catalogueMatcher.js). Each result
// carries profile_gaps: criteria the scheme has that the user's profile can't answer.
router.get('/eligible', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const profile = await loadProfile(supabase, req.user.id);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const sector = String(req.query.sector || '').trim() || null;
    const { total, schemes } = await matchCatalogue(profile, {
      benefitTypes: csvList(req.query.benefit_types),
      audiences: csvList(req.query.audiences),
      sector,
      limit,
    });
    res.json({ schemes, total });
  } catch (error) {
    console.error('Catalogue eligible error:', error.message);
    res.status(502).json({ error: 'Could not load eligible schemes right now.' });
  }
});

// POST /api/catalogue/ai-search — Groq-assisted: understands the user's answers + profile
// (+ optional free text), searches the stored catalogue text, then judges each shortlisted
// scheme against the user. Falls back to rules if Groq is unavailable.
router.post('/ai-search', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const profile = await loadProfile(supabase, req.user.id);
    const criteria = (req.body && typeof req.body.criteria === 'object' && req.body.criteria) || {};
    const query = String(req.body?.query || '').slice(0, 500);
    const limit = Math.min(60, Math.max(1, parseInt(req.body?.limit, 10) || 30));
    // Only the non-sensitive flow answers are passed on.
    const safe = {};
    for (const k of ['field', 'business_status', 'financial_need', 'student_type', 'skill_type', 'work_status', 'state', 'study_field', 'education_level', 'course', 'course_field', 'amount', 'crop']) {
      if (criteria[k] != null && criteria[k] !== '') safe[k] = criteria[k];
    }
    // Facts the user typed into the follow-up form (never persisted here).
    const answers = {};
    for (const k of ['state', 'district', 'landholding', 'category', 'annual_income', 'age', 'gender', 'crop', 'investment_required', 'business_stage', 'business_type']) {
      const v = req.body?.answers?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') answers[k] = String(v).slice(0, 60);
    }
    // What this user told us before (stable facts only) is passed to the AI as context, and what
    // we understood from this search is stored for next time. Best effort: a missing table is fine.
    let remembered = null;
    try {
      const { data: prev } = await supabase.from('user_search_profiles').select('extracted').eq('user_id', req.user.id).maybeSingle();
      const p = prev?.extracted?.profile;
      if (p) remembered = Object.fromEntries(['state', 'district', 'category', 'gender', 'age', 'annual_income', 'landholding', 'business_type'].filter((k) => p[k] != null).map((k) => [k, p[k]]));
    } catch { /* table not created yet */ }
    const result = await aiSearch({ criteria: safe, profile, query, answers, remembered, limit });
    const { extracted, ...out } = result;
    if (extracted) {
      try {
        await supabase.from('user_search_profiles').upsert({
          user_id: req.user.id, criteria: safe, last_query: query || null, answers, extracted, updated_at: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    }
    res.json(out);
  } catch (error) {
    console.error('Catalogue ai-search error:', error.message);
    res.status(502).json({ error: 'Could not run the AI search right now.' });
  }
});

// DELETE /api/catalogue/my-search-data — erase what we saved from this user's searches.
router.delete('/my-search-data', requireUser, async (req, res) => {
  try {
    const { error } = await getSupabaseAdmin().from('user_search_profiles').delete().eq('user_id', req.user.id);
    if (error && !/does not exist|schema cache/i.test(error.message)) throw error;
    res.json({ ok: true });
  } catch (e) {
    console.error('delete search data error:', e.message);
    res.status(502).json({ error: 'Could not delete your saved search details right now.' });
  }
});

// GET /api/catalogue/:slug/readiness — the scheme's structured criteria checked
// against the signed-in user's profile (met / unmet / missing from profile).
router.get('/:slug/readiness', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data: scheme, error } = await supabase.from('myscheme_catalogue')
      .select('slug,name,income_limit,eligible_categories,eligible_genders,education_levels,states,min_age,max_age,audiences,eligibility_extracted,documents_required')
      .eq('slug', req.params.slug).maybeSingle();
    if (error) throw error;
    if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
    const profile = await loadProfile(supabase, req.user.id);
    const items = buildReadiness(scheme, profile);

    // Documents this scheme asks for, checked off against what the user has stored.
    let docText = scheme.documents_required;
    if (typeof docText === 'string' && /^\s*[\[{]/.test(docText)) { try { docText = JSON.parse(docText); } catch { /* keep */ } }
    docText = (Array.isArray(docText) ? docText : [docText]).map((x) => String(x ?? '')).join('\n');
    const [{ data: uploaded }, { data: avail }] = await Promise.all([
      supabase.from('user_documents').select('document_type').eq('user_id', req.user.id),
      supabase.from('document_availability').select('document_type, status').eq('user_id', req.user.id),
    ]);
    const have = new Set((uploaded || []).map((d) => d.document_type));
    const ready = new Set((avail || []).filter((d) => ['uploaded', 'verified', 'available_online', 'available_physical'].includes(d.status)).map((d) => d.document_type));
    const documents = extractDocuments(docText).map((d) => ({
      ...d, status: have.has(d.key) ? 'uploaded' : ready.has(d.key) ? 'available' : 'missing',
    }));

    res.json({
      items,
      documents,
      missing: items.filter((i) => i.status === 'missing').map((i) => i.key),
      automated: Boolean(scheme.eligibility_extracted),
    });
  } catch (error) {
    console.error('Catalogue readiness error:', error.message);
    res.status(502).json({ error: 'Could not check readiness right now.' });
  }
});

// GET /api/catalogue/:slug/requirements — the scheme's documents (AI-read from the official text, stored
// once, per category and income) personalised to the signed-in user's category and income, with the
// user's own documents checked off.
router.get('/:slug/requirements', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const reqs = await getRequirements(req.params.slug);
    if (!reqs) return res.json({ available: false, reason: 'No document list could be read for this scheme.' });
    const profile = await loadProfile(supabase, req.user.id);
    const personal = personalise(reqs.documents, profile);
    const [{ data: uploaded }, { data: avail }] = await Promise.all([
      supabase.from('user_documents').select('document_type').eq('user_id', req.user.id),
      supabase.from('document_availability').select('document_type, status').eq('user_id', req.user.id),
    ]);
    const have = new Set((uploaded || []).map((d) => d.document_type));
    const ready = new Set((avail || []).filter((d) => ['uploaded', 'verified', 'available_online', 'available_physical'].includes(d.status)).map((d) => d.document_type));
    const documents = personal.map((d) => ({
      ...d, have: d.key ? (have.has(d.key) ? 'uploaded' : ready.has(d.key) ? 'available' : 'missing') : 'unknown',
    }));
    res.json({
      available: true, source: reqs.source, readiness: readinessSummary(documents), category_notes: reqs.category_notes, extracted_at: reqs.extracted_at,
      profile_used: { category: profile.category, income: profile.income },
      missing_profile: [!profile.category && 'social_category', (profile.income === null || profile.income === undefined) && 'annual_income'].filter(Boolean),
      documents,
    });
  } catch (error) {
    console.error('Catalogue requirements error:', error.message);
    res.status(502).json({ error: 'Could not load the document requirements right now.' });
  }
});

// GET /api/catalogue/:slug/application-readiness — everything the readiness card needs, computed ONLY
// from stored data (scheme criteria, stored document requirements, the user's profile and documents).
// No AI call happens here.
router.get('/:slug/application-readiness', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data: scheme, error } = await supabase.from('myscheme_catalogue')
      .select('slug,name,income_limit,eligible_categories,eligible_genders,education_levels,states,min_age,max_age,audiences,eligibility_extracted')
      .eq('slug', req.params.slug).maybeSingle();
    if (error) throw error;
    if (!scheme) return res.status(404).json({ error: 'Scheme not found' });
    const profile = await loadProfile(supabase, req.user.id);

    // 1. Eligibility requirements (stored structured criteria vs the profile)
    const requirements = buildReadiness(scheme, profile).map((i) => ({
      key: i.key, name: i.label, description: i.requirement,
      status: i.status === 'met' ? 'met' : i.status === 'unmet' ? 'unmet' : 'unknown',
    }));

    // 2. Documents (stored per-scheme requirements, personalised) against what the user holds
    const reqs = await getRequirements(req.params.slug);
    const [{ data: uploaded }, { data: avail }] = await Promise.all([
      supabase.from('user_documents').select('document_type').eq('user_id', req.user.id),
      supabase.from('document_availability').select('document_type, status').eq('user_id', req.user.id),
    ]);
    const have = new Set((uploaded || []).map((d) => d.document_type));
    const ready = new Set((avail || []).filter((d) => ['uploaded', 'verified', 'available_online', 'available_physical'].includes(d.status)).map((d) => d.document_type));
    const docs = (reqs ? personalise(reqs.documents, profile) : []).map((d) => ({
      ...d, have: d.key ? (have.has(d.key) ? 'uploaded' : ready.has(d.key) ? 'available' : 'missing') : 'unknown',
    }));
    const required = docs.filter((d) => d.status === 'required');
    const requiredKeys = new Set(docs.filter((d) => d.status !== 'not_needed').map((d) => d.key).filter(Boolean));
    const mine = new Set([...have, ...ready]);
    const extra = [...mine].filter((k) => !requiredKeys.has(k)).map((k) => ({ key: k, label: DOC_LABELS[k] || k.replace(/_/g, ' ') }));

    // 3. Overall readiness: eligibility items satisfied + required documents held
    const unmet = requirements.filter((r) => r.status === 'unmet');
    const done = requirements.filter((r) => r.status === 'met').length + required.filter((d) => d.have !== 'missing' && d.have !== 'unknown').length;
    const total = requirements.length + required.length;
    res.json({
      eligibility: {
        status: unmet.length ? 'NOT_ELIGIBLE' : (requirements.length && requirements.every((r) => r.status === 'met') ? 'ELIGIBLE' : 'UNKNOWN'),
        reasons: unmet.map((r) => `${r.name}: ${r.description}`),
        automated: Boolean(scheme.eligibility_extracted),
      },
      readiness: { percent: total ? Math.round((done / total) * 100) : null, done, total, pending: total - done },
      requirements,
      documents: {
        required_have: required.filter((d) => d.have === 'uploaded' || d.have === 'available'),
        required_missing: required.filter((d) => d.have === 'missing' || d.have === 'unknown'),
        conditional: docs.filter((d) => d.status === 'conditional'),
        depends: docs.filter((d) => d.status === 'depends'),
        not_needed: docs.filter((d) => d.status === 'not_needed'),
        extra,
      },
      profile_used: { category: profile.category, income: profile.income },
      missing_profile: [!profile.category && 'social_category', (profile.income === null || profile.income === undefined) && 'annual_income'].filter(Boolean),
      documents_source: reqs?.source || null,
    });
  } catch (e) {
    console.error('application-readiness error:', e.message);
    res.status(502).json({ error: 'Could not load the readiness card right now.' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('myscheme_catalogue')
      .select('*')
      .eq('slug', req.params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Scheme not found' });
    res.json({ scheme: data });
  } catch (error) {
    console.error('Catalogue detail error:', error.message);
    res.status(502).json({ error: 'Could not load this scheme right now.' });
  }
});

export default router;
