import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';
import { evaluateRequirements } from '../services/requirementEngine.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let SCHEMES_CACHE = null;
async function getSchemes() {
  if (SCHEMES_CACHE) return SCHEMES_CACHE;
  const url = pathToFileURL(path.resolve(__dirname, '../../src/data/schemes.js')).href;
  SCHEMES_CACHE = (await import(url)).SCHEMES || [];
  return SCHEMES_CACHE;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  return Number.isNaN(d.getTime()) ? null : Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// GET /api/documents/vault — the user's central document vault, and crucially
// how many more schemes each still-missing document would make application-ready
// (§17/§18/§19). "One document → many schemes" is computed by checking, per
// scheme, whether a given document is the ONLY thing still missing.
router.get('/vault', requireUser, async (req, res) => {
  const supabase = getSupabaseAdmin();
  const uid = req.user.id;
  try {
    const schemes = await getSchemes();
    const schemeIds = schemes.map((s) => s.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('date_of_birth, social_category, gender, disability_status, annual_income, state, district, education_level, occupation')
      .eq('id', uid).maybeSingle();

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
      business_status: null,
    };

    const [{ data: reqRows }, { data: documents }, { data: availability }] = await Promise.all([
      supabase.from('scheme_requirements').select('*').in('scheme_id', schemeIds),
      supabase.from('user_documents').select('document_type, verification_status, expiry_date, uploaded_at').eq('user_id', uid),
      supabase.from('document_availability').select('document_type, status').eq('user_id', uid),
    ]);

    const reqBySchemeId = {};
    for (const r of reqRows || []) (reqBySchemeId[r.scheme_id] ||= []).push(r);

    // Document-like requirement types (everything except pure eligibility flags).
    const isDocLike = (r) => r.requirement_type !== 'eligibility';

    // Registry keyed by document requirement_key, plus per-scheme missing sets.
    const registry = new Map(); // key -> { key, name, satisfied, required_by:Set, unlocks:Set }
    const nameByKey = new Map();

    for (const scheme of schemes) {
      const rows = reqBySchemeId[scheme.id] || [];
      if (!rows.length) continue;
      const results = evaluateRequirements(rows, reqProfile, documents || [], availability || []);

      // All missing REQUIRED items for this scheme (documents + any required flag).
      const missingRequired = results.filter((r) => r.applies && r.required && !(r.status === 'READY' || r.status === 'UPLOADED'));
      // Missing DOCUMENT-like items only.
      const missingDocs = missingRequired.filter((r) => isDocLike(r));
      // A scheme is "unlocked" by document X iff X is the single remaining
      // missing required item (adding it makes the scheme application-ready).
      const soleMissing = missingRequired.length === 1 && isDocLike(missingRequired[0]) ? missingRequired[0].requirement_key : null;

      for (const r of results) {
        if (!r.applies || !isDocLike(r)) continue;
        const satisfied = r.status === 'READY' || r.status === 'UPLOADED';
        if (!registry.has(r.requirement_key)) {
          registry.set(r.requirement_key, { key: r.requirement_key, name: r.requirement_name, satisfied, required_by: new Set(), unlocks: new Set() });
          nameByKey.set(r.requirement_key, r.requirement_name);
        }
        const entry = registry.get(r.requirement_key);
        entry.required_by.add(scheme.id);
        // satisfied status is global per key; keep it true if any result says ready
        if (satisfied) entry.satisfied = true;
      }
      if (soleMissing && registry.has(soleMissing)) registry.get(soleMissing).unlocks.add(scheme.id);
    }

    const docs = [...registry.values()]
      .map((e) => ({ key: e.key, name: e.name, satisfied: e.satisfied, required_by: e.required_by.size, unlocks: e.satisfied ? 0 : e.unlocks.size }))
      .sort((a, b) => {
        if (a.satisfied !== b.satisfied) return a.satisfied ? 1 : -1; // missing first
        return b.unlocks - a.unlocks || b.required_by - a.required_by;
      });

    res.json({
      documents: docs,
      have: docs.filter((d) => d.satisfied).length,
      total: docs.length,
    });
  } catch (err) {
    console.error('document vault error:', err.message);
    res.status(500).json({ error: 'Could not load your document vault', code: 'VAULT_ERROR' });
  }
});

export default router;
