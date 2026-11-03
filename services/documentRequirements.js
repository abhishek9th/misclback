import { getSupabaseAdmin } from './supabaseAdmin.js';
import { aiJson, hasAI } from './aiSchemeSearch.js';
import { docKeyFor, extractDocuments } from './eligibilityRules.js';

// Document requirements per scheme, extracted by AI from the scheme's OFFICIAL text and stored in
// Postgres (scheme_document_requirements) so each scheme is read only once. Every document records
// who it applies to (which social categories, which income range), so the same scheme can need
// different papers for a General applicant than for an SC/ST applicant. Nothing is invented: a
// document is stored only if the text states it, with the sentence it came from.

const CATEGORIES = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];
const memory = new Map();       // fallback if the table has not been created
const MISSING = (e) => e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message || ''));

const SYSTEM = `You read the OFFICIAL text of one Indian government scheme and list the documents an applicant must submit.
Use ONLY what the text states. Never add a document that the text does not mention. If the text lists no documents, return an empty list.
For EACH document say who needs it:
- applies_to: ["all"] when everyone needs it, otherwise the social categories that need it, from ${JSON.stringify(CATEGORIES)} (e.g. a caste certificate: ["sc","st"]; "if applicable"/"wherever required" documents still list who it is for).
- Identity-type documents everyone has (Aadhaar, photo, bank passbook, project report) apply to "all". Category proofs apply only to the category they prove: a caste certificate is needed by SC/ST/OBC applicants (not General); "special category"/reservation certificates are "conditional" for the reserved groups the text names; a disability certificate is "conditional" (condition: person with disability); an income certificate is needed only where the text ties it to an income limit or an EWS/BPL benefit. If the text names the reserved categories (SC, ST, OBC, minorities, women, ex-servicemen, physically handicapped, NER, hill/border areas), reflect that in applies_to or condition.
- income: {"max": number|null, "min": number|null} in rupees per year when the text makes the document depend on income (e.g. an income certificate only up to a limit, or a different document above it); otherwise {"max":null,"min":null}.
- required: "always" | "conditional" (conditional = only in a stated situation, put the situation in condition).
- condition: short plain text of the situation, or null.
- evidence: the exact short phrase from the text that supports this document (max 140 chars).
Also return "category_notes": any statement that the document list differs by category or income, in one short sentence each, taken from the text.
Return ONLY JSON: {"documents":[{"name":string,"applies_to":[string],"income":{"max":number|null,"min":number|null},"required":"always|conditional","condition":string|null,"evidence":string}],"category_notes":[string]}`;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n);
const plain = (v) => {
  let x = v;
  if (typeof x === 'string' && /^\s*[[{]/.test(x)) { try { x = JSON.parse(x); } catch { /* keep */ } }
  return (Array.isArray(x) ? x : [x]).map((y) => String(y ?? '')).join('\n');
};

// Papers outside our standard list (e.g. "Copy of insurance of the cow") still get a stable key so a user can
// upload them and the scheme's readiness can recognise them.
const customKey = (name) => `doc_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48)}`;

function clean(out) {
  const docs = (Array.isArray(out?.documents) ? out.documents : []).slice(0, 30).map((d) => {
    const at = (Array.isArray(d.applies_to) ? d.applies_to : ['all']).map((x) => String(x).toLowerCase()).filter((x) => x === 'all' || CATEGORIES.includes(x));
    const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    const name = clip(d.name, 120);
    return {
      name, key: docKeyFor(name) || customKey(name), applies_to: at.length ? at : ['all'],
      income: { max: num(d.income?.max), min: num(d.income?.min) },
      required: d.required === 'conditional' ? 'conditional' : 'always',
      condition: d.condition ? clip(d.condition, 160) : null, evidence: clip(d.evidence, 160),
    };
  }).filter((d) => d.name && !/^(any )?other (applicable )?documents?|as (may be )?(applicable|required)$/i.test(d.name));
  return { documents: docs, category_notes: (Array.isArray(out?.category_notes) ? out.category_notes : []).slice(0, 5).map((x) => clip(x, 200)) };
}

// AI extraction for ONE scheme. Used only by the batch script (scripts/extractDocumentRequirements.mjs)
// that fills the database ahead of time; it is never called while a user is browsing.
export async function extractWithAI(row) {
  // Only the parts of the text that can name a document, to keep each call small.
  const sentences = (t) => plain(t).replace(/\s+/g, ' ').split(/(?<=[.;])\s+/);
  const about = /certificate|proof|document|copy of|photo|aadhaar|pan\b|passbook|card|report|affidavit|income|caste|category|domicile|marksheet|registration|land|record/i;
  const text = [
    `DOCUMENTS REQUIRED:\n${clip(plain(row.documents_required), 1600)}`,
    `ELIGIBILITY (relevant lines):\n${clip(sentences(row.eligibility_text).filter((x) => about.test(x)).join(' '), 800)}`,
    `HOW TO APPLY (relevant lines):\n${clip(sentences(row.application_process).filter((x) => about.test(x)).join(' '), 500)}`,
  ].join('\n\n');
  return clean(await aiJson('fast', SYSTEM, JSON.stringify({ scheme: row.name, text }), 1800));
}

export async function saveRequirements(slug, result, source = 'ai') {
  const record = { ...result, extracted_at: new Date().toISOString(), source };
  memory.set(slug, record);
  const { error } = await getSupabaseAdmin().from('scheme_document_requirements')
    .upsert({ slug, documents: result.documents, category_notes: result.category_notes, extracted_at: record.extracted_at, source });
  if (error && !MISSING(error)) throw error;
  return record;
}

// Deterministic fallback from the stored record when AI extraction has not been run for a scheme.
// Category proofs go to the categories they prove; an income certificate follows the scheme's income limit.
export function fromRules(row) {
  const docs = extractDocuments(plain(row.documents_required)).map(({ key, label }) => {
    const base = { name: label, key, applies_to: ['all'], income: { max: null, min: null }, required: 'always', condition: null, evidence: '' };
    if (key === 'caste_certificate') return { ...base, applies_to: ['sc', 'st', 'obc'] };
    if (key === 'disability_certificate') return { ...base, required: 'conditional', condition: 'for persons with disability' };
    if (key === 'income_certificate' && row.income_limit != null) return { ...base, income: { max: Number(row.income_limit), min: null } };
    return base;
  });
  return { documents: docs, category_notes: [] };
}

// Reads from the database only. NO AI call happens here, so opening a scheme never costs tokens.
// Returns { documents, category_notes, extracted_at, source } or null when the scheme has no document text.
export async function getRequirements(slug) {
  if (memory.has(slug)) return { ...memory.get(slug), cached: true };
  const sb = getSupabaseAdmin();
  try {
    const { data, error } = await sb.from('scheme_document_requirements').select('*').eq('slug', slug).maybeSingle();
    if (error && !MISSING(error)) throw error;
    if (data) {
      const rec = { documents: data.documents || [], category_notes: data.category_notes || [], extracted_at: data.extracted_at, source: data.source || 'ai', cached: true };
      memory.set(slug, rec);
      return rec;
    }
  } catch (e) { if (!MISSING(e)) throw e; }
  const { data: row } = await sb.from('myscheme_catalogue').select('slug,documents_required,income_limit').eq('slug', slug).maybeSingle();
  if (!row) return null;
  const r = fromRules(row);
  if (!r.documents.length) return null;
  const rec = { ...r, extracted_at: null, source: 'rules', cached: false };
  memory.set(slug, rec);
  return rec;
}

// Readiness from the user's point of view. Counts only documents that are required for THIS user
// ("required"); conditional ones are listed separately, and "depends" ones are unknown until the
// profile is complete. have = uploaded or marked available. percent is null when nothing is required.
export function readinessSummary(docs) {
  const required = docs.filter((d) => d.status === 'required');
  const have = required.filter((d) => d.have === 'uploaded' || d.have === 'available');
  return {
    needed: required.length,
    have: have.length,
    percent: required.length ? Math.round((have.length / required.length) * 100) : null,
    missing: required.filter((d) => !have.includes(d)).map((d) => d.name),
    conditional: docs.filter((d) => d.status === 'conditional').length,
    unknown: docs.filter((d) => d.status === 'depends').length,
  };
}

// Which of the stored documents apply to THIS user. Unknown facts never hide a document: they make it
// "depends" so the user is told what to add to the profile.
//   profile: { category, income }
export function personalise(documents, profile) {
  const cat = profile.category || null;
  const income = profile.income === null || profile.income === undefined || profile.income === '' ? null : Number(profile.income);
  const out = [];
  for (const d of documents) {
    let status = d.required === 'conditional' ? 'conditional' : 'required';
    let reason = d.condition || null;
    const forAll = d.applies_to.includes('all');
    if (!forAll) {
      if (!cat) { status = 'depends'; reason = `Needed for ${d.applies_to.join('/').toUpperCase()} applicants — add your category to the profile.`; }
      else if (!d.applies_to.includes(cat)) { status = 'not_needed'; reason = `Only for ${d.applies_to.join('/').toUpperCase()} applicants.`; }
    }
    const { max, min } = d.income || {};
    if (status !== 'not_needed' && (max != null || min != null)) {
      if (income === null) { status = 'depends'; reason = `Depends on annual income${max != null ? ` (up to ₹${max.toLocaleString('en-IN')})` : ''} — add your income to the profile.`; }
      else if ((max != null && income > max) || (min != null && income < min)) { status = 'not_needed'; reason = 'Your annual income is outside the range this document is for.'; }
    }
    out.push({ ...d, status, reason });
  }
  return out;
}
