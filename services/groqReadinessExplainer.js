// ============================================================================
// Application Readiness — Groq explanation layer.
//
// Reuses the SAME Groq integration as backend/services/userProfileService.js
// (no second AI provider). Groq is given ONLY the already-computed,
// structured requirement results from requirementEngine.js — it explains them
// in plain language, it does NOT decide eligibility, the readiness score, or
// any risk level. The system prompt explicitly forbids inventing government
// rules and requires the "could not determine" fallback for UNKNOWN items.
//
// Data minimization: callers must pass only the minimal profile fields
// requirementEngine.js actually needed (category, gender, disability flag,
// age, etc.) — never Aadhaar/PAN/full bank numbers. See readiness.js route.
// ============================================================================
import Groq from 'groq-sdk';

const getGroqClient = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are SchemeSetu's Application Readiness explainer for Indian government scheme applications.

You will be given, as JSON:
- scheme: { id, name }
- eligibility: the ALREADY-DECIDED eligibility verdict (ELIGIBLE | NOT_ELIGIBLE | UNKNOWN) and which checks failed, if any
- readiness: { score, ready: [...], missing: [...] } — the ALREADY-CALCULATED readiness score and item lists
- requirement_results: every requirement considered, with its applicability, status, and risk levels

STRICT RULES — you must follow every one of these:
1. NEVER invent, assume, or restate a government rule that is not present in the given data. If a requirement's description doesn't say something, do not add it.
2. NEVER change, recalculate, or contradict the given eligibility verdict or readiness score. Only explain them.
3. For any requirement with status "UNKNOWN", your explanation MUST be exactly: "SchemeSetu could not determine this from the available information." (translated naturally if asked in Hindi, but never replaced with a guess).
4. Do not use "AI", "the AI", or similar language. Write as SchemeSetu, a factual assistance service — plain, professional, government-portal tone. No hype, no emoji beyond simple ✓/⚠/✗ symbols if useful, no exclamation-heavy language.
5. For each item in requirement_results that applies to the user, produce: a one-sentence "why" (grounded strictly in its description field), and a one-sentence "next_action" telling the user concretely what to do (e.g. "Obtain an income certificate from your local tehsil/SDM office.") — but only if the requirement_type/description gives you enough basis; otherwise use the fallback sentence from rule 3.
6. If category-specific requirements exist (requirement_type = 'category_specific' or 'disability_specific' or 'gender_specific' or 'occupation_specific') and at least one applies to this user, add a short one-paragraph "category_note" explaining that these are checked because of their specific profile attribute (e.g. "Because your profile indicates SC category, SchemeSetu additionally checked SC-specific requirements."). If none apply, omit category_note entirely (do not say "no category requirements").
7. Provide one short "summary" (2-3 sentences) covering: whether they appear eligible, their readiness percentage, and how many items need attention — using ONLY the given numbers.
8. Provide a "next_steps" array of concise, ordered, actionable strings (max 6) derived only from the missing/incomplete requirements given.

Return ONLY this JSON shape:
{
  "summary": string,
  "category_note": string | null,
  "item_explanations": { [requirement_key]: { "why": string, "next_action": string } },
  "next_steps": [string]
}`;

// results: output of requirementEngine.evaluateRequirements()
// eligibility: output of computeEligibility()
// readiness: output of computeReadinessScore()
export async function explainReadiness({ scheme, profile, results, eligibility, readiness, language = 'hi' }) {
  if (!process.env.GROQ_API_KEY) {
    const err = new Error('AI explanation service is not configured');
    err.code = 'GROQ_NOT_CONFIGURED';
    throw err;
  }

  const groq = getGroqClient();
  const applicableResults = results.filter((r) => r.applies);

  const payload = {
    scheme: { id: scheme.id, name: scheme.name },
    language,
    eligibility,
    readiness: {
      score: readiness.score,
      ready: readiness.ready.map((r) => r.requirement_key),
      missing: readiness.missing.map((r) => r.requirement_key),
    },
    requirement_results: applicableResults.map((r) => ({
      requirement_key: r.requirement_key,
      requirement_name: r.requirement_name,
      description: r.description,
      requirement_type: r.requirement_type,
      status: r.status,
      required: r.required,
      delay_risk: r.delay_risk,
      rejection_risk: r.rejection_risk,
    })),
  };

  // The structured readiness report (eligibility, score, checklist) is already
  // computed locally by the route — this Groq call only adds plain-language
  // explanation. Bound it so a slow/hanging AI call degrades to "explanation
  // unavailable" instead of blocking the whole response past the client's 30s
  // abort. On timeout the SDK throws, the route catches it, and the structured
  // report still returns.
  const response = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(payload) },
    ],
    model: 'openai/gpt-oss-120b',
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }, { timeout: 20000, maxRetries: 0 });

  const raw = response.choices[0].message.content;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid response format from AI explanation service');
  }

  return {
    summary: parsed.summary || '',
    category_note: parsed.category_note || null,
    item_explanations: parsed.item_explanations || {},
    next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.slice(0, 6) : [],
  };
}
