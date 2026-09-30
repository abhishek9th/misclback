import { SCHEMES } from '../data/schemes.js';
import { getSupabaseAdmin } from './supabaseAdmin.js';

// Grounds the chatbot in real scheme data. Before the LLM answers, we look up
// schemes relevant to the citizen's message — first in SchemeSetu's curated
// catalogue, then in the scraped myscheme.gov.in catalogue — so it can name
// them (with real figures) instead of answering only from model memory.

// Everyday phrasings (English / Hinglish / Hindi) -> terms that actually appear
// in scheme names and descriptions. Keeps niche schemes findable, e.g. a
// "medical store" question reaching Jan Aushadhi.
const SYNONYMS = [
  { match: /medical store|medical shop|pharmacy|pharmacist|chemist|medicine|dawai|dawa|generic drug|मेडिकल|फार्मेसी|दवा|दवाई|केमिस्ट/i,
    terms: ['aushadhi', 'janaushadhi', 'pharma', 'medicine', 'औषधि', 'फार्मा', 'दवा'] },
  { match: /dairy|cow|buffalo|milk|डेयरी|गाय|भैंस|दूध/i, terms: ['dairy', 'milk', 'डेयरी', 'दूध'] },
  { match: /tailor|sewing|silai|सिलाई|दर्जी/i, terms: ['sewing', 'tailor', 'vishwakarma', 'सिलाई'] },
  { match: /street vendor|thela|rehri|ठेला|रेहड़ी/i, terms: ['svanidhi', 'street vendor', 'स्ट्रीट'] },
  { match: /solar|rooftop/i, terms: ['solar', 'rooftop', 'सोलर'] },
];

const STOPWORDS = new Set([
  'scheme', 'schemes', 'government', 'looking', 'want', 'need', 'open', 'start', 'starting', 'about',
  'which', 'what', 'apply', 'help', 'please', 'tell', 'with', 'from', 'that', 'this', 'have', 'loan',
  'yojana', 'sarkari', 'chahiye', 'mujhe', 'kholna', 'khulna',
]);

function searchTerms(query) {
  const terms = new Set();
  for (const s of SYNONYMS) if (s.match.test(query)) s.terms.forEach((t) => terms.add(t));
  if (terms.size === 0) {
    (query.toLowerCase().match(/[a-z0-9]{5,}/g) || [])
      .filter((w) => !STOPWORDS.has(w))
      .forEach((w) => terms.add(w));
  }
  return [...terms].slice(0, 8);
}

function curatedMatches(terms, limit) {
  if (!terms.length) return [];
  return SCHEMES
    .map((s) => {
      const hay = [s.name, s.name_hi, s.description_hi, ...(s.fields || [])].join(' ').toLowerCase();
      const score = terms.reduce((n, t) => n + (hay.includes(t.toLowerCase()) ? 1 : 0), 0);
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ s }) => {
      const lakh = (n) => (n ? `₹${n.toLocaleString('en-IN')}` : null);
      const amount = s.min_financial_assistance || s.max_financial_assistance
        ? `Assistance: ${[lakh(s.min_financial_assistance), lakh(s.max_financial_assistance)].filter(Boolean).join(' to ')}`
        : null;
      return [
        `- ${s.name}${s.scope ? ` (${s.scope})` : ''}`,
        s.description_hi && `  ${s.description_hi}`,
        s.subsidy_percentage && `  Subsidy/incentive: ${s.subsidy_percentage}`,
        amount && `  ${amount}`,
        s.benefits_hi?.length && `  Benefits: ${s.benefits_hi.join('; ')}`,
        s.required_documents_hi?.length && `  Documents: ${s.required_documents_hi.join('; ')}`,
        s.official_link && `  Official: ${s.official_link}`,
      ].filter(Boolean).join('\n');
    });
}

async function catalogueMatches(terms, limit) {
  const clean = terms.map((t) => t.replace(/[^\p{L}\p{N} ]/gu, '').trim()).filter((t) => t.length >= 3);
  if (!clean.length) return [];
  const supabase = getSupabaseAdmin();
  const filter = clean.flatMap((t) => [`name.ilike.%${t}%`, `short_description.ilike.%${t}%`]).join(',');
  const { data, error } = await supabase
    .from('myscheme_catalogue')
    .select('name, slug, short_description, ministries, states')
    .or(filter)
    .limit(40);
  if (error) throw error;
  return (data || [])
    .map((r) => {
      const hay = `${r.name} ${r.short_description || ''}`.toLowerCase();
      const nameHits = clean.filter((t) => r.name.toLowerCase().includes(t.toLowerCase())).length;
      return { r, score: clean.reduce((n, t) => n + (hay.includes(t.toLowerCase()) ? 1 : 0), 0) + nameHits };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ r }) => [
      `- ${r.name}${r.ministries?.length ? ` — ${r.ministries[0]}` : ''}`,
      r.short_description && `  ${r.short_description.slice(0, 300)}`,
      `  Official: https://www.myscheme.gov.in/schemes/${r.slug}`,
    ].filter(Boolean).join('\n'));
}

// Returns a prompt-ready block, or '' when nothing relevant is found or the
// catalogue is unreachable (the chatbot must still work without it).
export async function buildSchemeContext(query) {
  const terms = searchTerms(String(query || ''));
  if (!terms.length) return '';
  const curated = curatedMatches(terms, 3);
  let catalogue = [];
  try {
    catalogue = await catalogueMatches(terms, 4);
  } catch (err) {
    console.warn('Scheme context: catalogue lookup skipped:', err.message);
  }
  if (!curated.length && !catalogue.length) return '';
  return [
    curated.length && `VERIFIED SchemeSetu schemes:\n${curated.join('\n')}`,
    catalogue.length && `Other schemes from myscheme.gov.in (details unverified — say to confirm on the portal):\n${catalogue.join('\n')}`,
  ].filter(Boolean).join('\n\n');
}
