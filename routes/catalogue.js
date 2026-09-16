import { Router } from 'express';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { requireUser } from '../services/requireUser.js';

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

router.get('/eligible', requireUser, async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data: profile } = await supabase
      .from('profiles')
      .select('annual_income, social_category, gender, education_level, state, date_of_birth, age')
      .eq('id', req.user.id).maybeSingle();

    const inVocab = (v, vocab) => (v && vocab.includes(String(v).toLowerCase()) ? String(v).toLowerCase() : null);
    const benefitTypes = String(req.query.benefit_types || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));

    const { data, error } = await supabase.rpc('match_catalogue_schemes', {
      p_income: profile?.annual_income ?? null,
      p_category: inVocab(profile?.social_category, CAT_VOCAB),
      p_gender: inVocab(profile?.gender, GENDER_VOCAB),
      p_education: inVocab(profile?.education_level, EDU_VOCAB),
      p_state: profile?.state || null,
      p_age: profile?.age ?? ageFromDob(profile?.date_of_birth),
      p_benefit_types: benefitTypes.length ? benefitTypes : null,
      p_limit: limit,
    });
    if (error) throw error;
    res.json({ schemes: data || [] });
  } catch (error) {
    console.error('Catalogue eligible error:', error.message);
    res.status(502).json({ error: 'Could not load eligible schemes right now.' });
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
