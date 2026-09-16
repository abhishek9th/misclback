import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { evaluateAllSchemes } from '../services/eligibilityEngine.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The curated scheme catalogue lives in the frontend data file (single source
// of the structured eligibility fields). Import it once at module load.
let SCHEMES_CACHE = null;
async function getSchemes() {
  if (SCHEMES_CACHE) return SCHEMES_CACHE;
  const url = pathToFileURL(path.resolve(__dirname, '../data/schemes.js')).href;
  const mod = await import(url);
  SCHEMES_CACHE = mod.SCHEMES || [];
  return SCHEMES_CACHE;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// GET /api/eligibility/dashboard — proactively evaluate the signed-in user's
// profile against every curated scheme. Deterministic; no AI in the verdict.
router.get('/dashboard', requireUser, async (req, res) => {
  const supabase = getSupabaseAdmin();
  const uid = req.user.id;

  try {
    const schemes = await getSchemes();

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, date_of_birth, social_category, gender, disability_status, annual_income, state, district, education_level, occupation')
      .eq('id', uid).maybeSingle();

    const structuredProfile = {
      annual_income: profile?.annual_income ?? null,
      category: profile?.social_category || null,
      gender: profile?.gender || null,
      disability_status: profile?.disability_status ?? null,
      state: profile?.state || null,
    };

    // Snapshot shape the requirementEngine (document/readiness) expects.
    const reqProfile = {
      age: ageFromDob(profile?.date_of_birth),
      category: profile?.social_category || null,
      gender: profile?.gender || null,
      disability_status: Boolean(profile?.disability_status),
      occupation_status: profile?.occupation || null,
      annual_income: profile?.annual_income ?? null,
      state: profile?.state || null,
      district: profile?.district || null,
      education_level: profile?.education_level || null,
      business_status: null, // scheme-specific, not in the permanent profile
    };

    const schemeIds = schemes.map((s) => s.id);
    const [{ data: reqRows }, { data: documents }, { data: availability }, applied] = await Promise.all([
      supabase.from('scheme_requirements').select('*').in('scheme_id', schemeIds),
      supabase.from('user_documents').select('document_type, verification_status, expiry_date, uploaded_at').eq('user_id', uid),
      supabase.from('document_availability').select('document_type, status').eq('user_id', uid),
      supabase.from('scheme_applications').select('scheme_id, scheme_name, status').eq('user_id', uid).then((r) => r).catch(() => ({ data: [] })),
    ]);
    const applications = (applied?.data || []).map((a) => ({ ...a, status_source: 'USER_REPORTED' }));

    const requirementsBySchemeId = {};
    for (const row of reqRows || []) {
      (requirementsBySchemeId[row.scheme_id] ||= []).push(row);
    }

    const { summary, schemes: evaluated } = evaluateAllSchemes({
      schemes,
      structuredProfile,
      reqProfile,
      requirementsBySchemeId,
      documents: documents || [],
      availability: availability || [],
      appliedSchemeIds: applications.map((a) => a.scheme_id),
      applications,
    });

    // Profile completeness — which permanent-eligibility fields are still blank
    // (each blank one can hide otherwise-matchable schemes). §24.
    const completenessFields = [
      { key: 'date_of_birth', label_en: 'Date of birth', label_hi: 'जन्म तिथि', filled: !!profile?.date_of_birth },
      { key: 'social_category', label_en: 'Social category', label_hi: 'सामाजिक श्रेणी', filled: !!profile?.social_category },
      { key: 'gender', label_en: 'Gender', label_hi: 'लिंग', filled: !!profile?.gender },
      { key: 'annual_income', label_en: 'Annual family income', label_hi: 'वार्षिक पारिवारिक आय', filled: profile?.annual_income != null },
      { key: 'state', label_en: 'State', label_hi: 'राज्य', filled: !!profile?.state },
      { key: 'district', label_en: 'District', label_hi: 'ज़िला', filled: !!profile?.district },
      { key: 'education_level', label_en: 'Education level', label_hi: 'शिक्षा स्तर', filled: !!profile?.education_level },
    ];
    const filled = completenessFields.filter((f) => f.filled).length;
    const completeness = {
      percent: Math.round((filled / completenessFields.length) * 100),
      missing: completenessFields.filter((f) => !f.filled).map(({ filled: _f, ...rest }) => rest),
    };

    res.json({
      checked_at: new Date().toISOString(),
      user_name: profile?.full_name || null,
      summary,
      completeness,
      schemes: evaluated,
    });
  } catch (err) {
    console.error('eligibility dashboard error:', err.message);
    res.status(500).json({ error: 'Could not build your eligibility dashboard', code: 'ELIGIBILITY_ERROR' });
  }
});

export default router;
