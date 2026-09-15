import express from 'express';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import {
  evaluateRequirements, computeEligibility, computeReadinessScore, classifyMissingByPriority,
} from '../services/requirementEngine.js';
import { explainReadiness } from '../services/groqReadinessExplainer.js';

const router = express.Router();

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

// Builds the MINIMAL profile snapshot the requirement engine needs — never
// full Aadhaar/PAN/bank numbers, only the flags/values requirements actually
// filter on (§ data minimization sent to Groq).
async function buildProfileSnapshot(supabase, userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('date_of_birth, social_category, gender, disability_status, annual_income, state, district')
    .eq('id', userId).maybeSingle();

  const { data: employment } = await supabase
    .from('employment').select('employment_status')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();

  return {
    age: ageFromDob(profile?.date_of_birth),
    category: profile?.social_category || null,
    gender: profile?.gender || null,
    disability_status: Boolean(profile?.disability_status),
    occupation_status: employment?.employment_status || null,
    annual_income: profile?.annual_income ?? null,
    state: profile?.state || null,
    district: profile?.district || null,
    business_status: null, // not tracked per-profile today — engine reports UNKNOWN, never guesses
  };
}

// GET /api/readiness/:schemeId — full readiness report for the signed-in user.
router.get('/:schemeId', requireUser, async (req, res) => {
  const { schemeId } = req.params;
  const language = req.query.lang === 'en' ? 'en' : 'hi';
  const supabase = getSupabaseAdmin();

  try {
    const { data: schemeRequirements, error: reqErr } = await supabase
      .from('scheme_requirements').select('*').eq('scheme_id', schemeId);
    if (reqErr) throw reqErr;

    if (!schemeRequirements || schemeRequirements.length === 0) {
      return res.status(404).json({
        error: 'SchemeSetu has not yet verified structured requirements for this scheme.',
        code: 'REQUIREMENTS_NOT_AVAILABLE',
      });
    }

    const profile = await buildProfileSnapshot(supabase, req.user.id);

    const { data: documents } = await supabase
      .from('user_documents').select('document_type, verification_status, expiry_date, uploaded_at')
      .eq('user_id', req.user.id);

    const { data: availability } = await supabase
      .from('document_availability').select('document_type, status')
      .eq('user_id', req.user.id);

    const results = evaluateRequirements(schemeRequirements, profile, documents || [], availability || []);
    const eligibility = computeEligibility(results);
    const readiness = computeReadinessScore(results);
    const missingByPriority = classifyMissingByPriority(readiness.missing);
    const categoryResults = results.filter((r) => r.applies && [
      'category_specific', 'disability_specific', 'gender_specific', 'occupation_specific',
    ].includes(r.requirement_type));

    // Group EVERY requirement by its UI category so the frontend can render the
    // complete checklist (§8/§16/§17) — never a sliced/collapsed subset.
    const byCategory = {};
    for (const r of results) {
      const cat = r.category || 'Other';
      (byCategory[cat] ||= []).push(r);
    }
    const groupedRequirements = Object.entries(byCategory).map(([category, items]) => ({ category, items }));

    let explanation = null;
    let explanationError = null;
    try {
      explanation = await explainReadiness({
        scheme: { id: schemeId, name: schemeRequirements[0]?.requirement_name ? schemeId : schemeId },
        profile, results, eligibility, readiness, language,
      });
    } catch (err) {
      console.error('readiness explanation error:', err.message);
      explanationError = err.code === 'GROQ_NOT_CONFIGURED' ? 'GROQ_NOT_CONFIGURED' : 'EXPLANATION_UNAVAILABLE';
    }

    res.json({
      scheme_id: schemeId,
      eligibility,
      readiness: {
        score: readiness.score,
        applicable_count: readiness.applicable_count,
        satisfied_count: readiness.satisfied_count,
        missing_count: readiness.missing_count,
        conditional_count: (readiness.conditional || []).length,
        not_applicable_count: (readiness.not_applicable || []).length,
      },
      results,
      grouped_requirements: groupedRequirements,
      conditional: readiness.conditional || [],
      not_applicable: readiness.not_applicable || [],
      missing_by_priority: missingByPriority,
      category_specific: categoryResults,
      explanation,
      explanation_error: explanationError,
    });
  } catch (err) {
    console.error('readiness report error:', err.message);
    res.status(500).json({ error: 'Could not build the readiness report', code: 'READINESS_ERROR' });
  }
});

export default router;
