// ============================================================================
// Advisor explanation layer. A language model turns the ALREADY-DECIDED
// recommendation into plain language — it never picks the scheme, never does
// arithmetic, never quotes a rule. Two independent safeguards:
//   1. The prompt forbids adding numbers/rules that aren't in the given data.
//   2. validateNumbers() then rejects any figure in the model's text that the
//      engine did not compute; on any violation (or if the model is
//      unavailable) we fall back to a deterministic template with the same facts.
// The provider is Groq, matching groqReadinessExplainer.js.
// ============================================================================
import Groq from 'groq-sdk';
import { collectAllowedNumbers } from './advisorEngine.js';

const rupee = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// ---- reason / flag codes → sentences (used by the template AND the UI) -------
const T = {
  not_eligible: { en: (d) => `You do not meet a basic eligibility rule${d ? ` (${d})` : ''}.`, hi: (d) => `आप एक बुनियादी पात्रता शर्त पूरी नहीं करते${d ? ` (${d})` : ''}।` },
  conflicts_with_your_applications: { en: () => 'It conflicts with a scheme you have already applied to.', hi: () => 'यह आपके पहले से आवेदन की गई योजना से टकराती है।' },
  sector_not_covered: { en: () => 'It does not cover your business sector.', hi: () => 'यह आपके व्यवसाय क्षेत्र को कवर नहीं करती।' },
  only_for_existing_businesses: { en: () => 'It is only for existing businesses.', hi: () => 'यह केवल मौजूदा व्यवसायों के लिए है।' },
  only_for_new_businesses: { en: () => 'It is only for new businesses.', hi: () => 'यह केवल नए व्यवसायों के लिए है।' },
  below_minimum_size: { en: (d) => `Your project cost is below the scheme minimum of ${rupee(d)}.`, hi: (d) => `आपकी परियोजना लागत योजना की न्यूनतम सीमा ${rupee(d)} से कम है।` },
  own_funds_short: { en: (d) => `You would need ${rupee(d)} more of your own money.`, hi: (d) => `आपको अपने पास से ${rupee(d)} और चाहिए होंगे।` },
  emi_risky: { en: (d) => `The EMI would take about ${d}% of your income — too risky.`, hi: (d) => `ईएमआई आपकी आय का लगभग ${d}% ले लेगी — यह जोखिम भरा है।` },
  emi_too_high_any_rate: { en: (d) => `Even at 0% interest the repayments would be more than the ${rupee(d)} a month that is comfortable for you.`, hi: (d) => `0% ब्याज पर भी किस्तें आपके लिए सुविधाजनक ${rupee(d)} प्रति माह से अधिक होंगी।` },
  emi_unaffordable: { en: () => 'The EMI would leave you with no cash after expenses.', hi: () => 'ईएमआई के बाद खर्चों के लिए नकद नहीं बचेगा।' },
  // flags
  rate_unknown: { en: () => 'The interest rate is set by the bank, so SchemeSetu cannot calculate the EMI. Enter the rate your bank quotes to see it.', hi: () => 'ब्याज दर बैंक तय करता है, इसलिए ईएमआई की गणना नहीं हो सकती। बैंक द्वारा बताई गई दर डालकर देखें।' },
  rate_estimated: { en: () => 'The rate shown is an estimate from the scheme\'s published range; the lender sets the final rate.', hi: () => 'दिखाई गई दर योजना की प्रकाशित सीमा से अनुमान है; अंतिम दर ऋणदाता तय करता है।' },
  tenure_assumed: { en: () => 'The repayment period is an assumption — change it above to see other EMIs.', hi: () => 'चुकौती अवधि एक मान्यता है — अन्य ईएमआई देखने के लिए इसे बदलें।' },
  grant_back_ended: { en: () => 'The subsidy is paid later, not upfront, so it is not deducted from your EMI.', hi: () => 'सब्सिडी बाद में मिलती है, शुरुआत में नहीं, इसलिए ईएमआई से घटाई नहीं गई है।' },
  grant_in_kind: { en: () => 'This support is given as tools/equipment, not cash.', hi: () => 'यह सहायता नकद नहीं, औज़ार/उपकरण के रूप में मिलती है।' },
  grant_timing_unknown: { en: () => 'When the subsidy is paid is not specified, so it is not deducted from your loan.', hi: () => 'सब्सिडी कब मिलेगी यह निर्दिष्ट नहीं है, इसलिए ऋण से घटाई नहीं गई।' },
  grant_is_ceiling: { en: () => 'The subsidy shown is the maximum; the actual amount may be lower.', hi: () => 'दिखाई गई सब्सिडी अधिकतम है; वास्तविक राशि कम हो सकती है।' },
  partial_cover: { en: () => 'Your project cost is above what this scheme can finance; you must fund the rest yourself.', hi: () => 'आपकी परियोजना लागत इस योजना की सीमा से अधिक है; शेष राशि आपको स्वयं जुटानी होगी।' },
  own_contribution_unspecified: { en: () => 'The bank may still ask for some contribution from you (margin money) — this is not specified in the scheme.', hi: () => 'बैंक आपसे कुछ अंशदान (मार्जिन मनी) माँग सकता है — यह योजना में निर्दिष्ट नहीं है।' },
  eligibility_unconfirmed: { en: () => 'Some of your profile details are missing, so your eligibility is not confirmed yet — complete your profile for a firmer answer.', hi: () => 'आपकी प्रोफ़ाइल की कुछ जानकारी अधूरी है, इसलिए पात्रता अभी पुष्ट नहीं है — पक्के उत्तर के लिए प्रोफ़ाइल पूरी करें।' },
  confirm_trade_eligibility: { en: () => 'This scheme is only for traditional artisans in the notified trades — SchemeSetu cannot check that, so confirm it before relying on this option.', hi: () => 'यह योजना केवल अधिसूचित व्यवसायों के पारंपरिक कारीगरों के लिए है — SchemeSetu यह जाँच नहीं सकता, इसलिए भरोसा करने से पहले पुष्टि करें।' },
  verify_terms: { en: () => 'Some terms come from scheme guidelines — confirm them with the bank or the official portal before committing.', hi: () => 'कुछ शर्तें योजना दिशानिर्देशों से ली गई हैं — प्रतिबद्ध होने से पहले बैंक/आधिकारिक पोर्टल से पुष्टि करें।' },
  // assumptions
  income_not_projected: { en: () => 'Affordability is checked against your CURRENT income only; we do not assume any future business income.', hi: () => 'वहन-क्षमता केवल आपकी वर्तमान आय से जाँची गई है; भविष्य की व्यवसाय आय नहीं मानी गई।' },
  terms_can_change: { en: () => 'Scheme terms change — always confirm on the official portal.', hi: () => 'योजना की शर्तें बदलती रहती हैं — हमेशा आधिकारिक पोर्टल पर पुष्टि करें।' },
  lender_decides_final: { en: () => 'Eligibility here is a guide; the bank and the government department make the final decision.', hi: () => 'यहाँ की पात्रता एक मार्गदर्शन है; अंतिम निर्णय बैंक और सरकारी विभाग का होता है।' },
  rate_estimated_assumption: { en: () => '', hi: () => '' },
};

export function sentence(code, detail, lang = 'en') {
  const t = T[code];
  if (!t) return '';
  return (t[lang === 'hi' ? 'hi' : 'en'])(detail);
}

// ---- deterministic fallback --------------------------------------------------
export function templateExplanation(advice, lang = 'en') {
  const hi = lang === 'hi';
  const r = advice.recommended;
  if (!r) {
    return {
      source: 'template',
      headline: hi ? 'अभी कोई योजना आपकी स्थिति में सुरक्षित रूप से फिट नहीं बैठती' : 'No scheme fits your current situation safely yet',
      why_this_scheme: hi ? 'नीचे बताया गया है कि हर योजना में क्या बाधा है और क्या बदलने से बात बन सकती है।' : 'Below is what blocks each scheme and what could change that.',
      plan_walkthrough: '',
      cautions: advice.assumptions.map((c) => sentence(c, null, lang)).filter(Boolean),
      next_steps: [hi ? 'परियोजना लागत घटाने, अपनी बचत बढ़ाने या चरणों में शुरू करने पर विचार करें और फिर दोबारा जाँचें।' : 'Consider a smaller first phase, more own funds, or a lower project cost — then check again.'],
    };
  }
  const f = r.funding;
  const parts = [];
  parts.push(hi ? `${r.name_hi} के तहत ${rupee(f.coveredByScheme)} तक की सहायता मिल सकती है।` : `${r.name} can support up to ${rupee(f.coveredByScheme)} of your ${rupee(f.projectCost)} project.`);
  if (f.grant) parts.push(hi ? `सरकारी अनुदान/सब्सिडी: ${rupee(f.grant.amount)}।` : `Government subsidy/grant: ${rupee(f.grant.amount)}.`);
  if (f.loanPrincipal > 0) parts.push(hi ? `ऋण: ${rupee(f.loanPrincipal)}।` : `Loan: ${rupee(f.loanPrincipal)}.`);
  if (r.loan?.emi != null) parts.push(hi ? `${r.loan.tenureMonths} महीनों के लिए मासिक ईएमआई लगभग ${rupee(r.loan.emi)} (दर ${r.loan.rate.label})।` : `Monthly EMI about ${rupee(r.loan.emi)} over ${r.loan.tenureMonths} months (rate ${r.loan.rate.label}).`);
  if (f.ownFundsNeeded > 0) parts.push(hi ? `आपको अपने पास से ${rupee(f.ownFundsNeeded)} लगाने होंगे।` : `You would put in ${rupee(f.ownFundsNeeded)} of your own money.`);
  const cautions = [...new Set([...r.flags, ...advice.assumptions])].map((c) => sentence(c, null, lang)).filter(Boolean);
  const steps = [];
  if (r.missing_documents?.length) steps.push(hi ? `ये दस्तावेज़ जुटाएँ: ${r.missing_documents.join(', ')}।` : `Get these documents ready: ${r.missing_documents.join(', ')}.`);
  steps.push(hi ? 'आधिकारिक पोर्टल/बैंक शाखा पर शर्तों की पुष्टि करें, फिर आवेदन करें।' : 'Confirm the terms on the official portal or at the bank branch, then apply.');
  return {
    source: 'template',
    headline: hi ? `सुझाई गई योजना: ${r.name_hi}` : `Recommended: ${r.name}`,
    why_this_scheme: hi ? 'आपकी पात्रता, धन-सीमा और चुकौती क्षमता को देखते हुए यह सबसे अधिक सरकारी सहायता देने वाला सुरक्षित विकल्प है।' : 'Among the schemes you qualify for and can afford, it gives the most government support.',
    plan_walkthrough: parts.join(' '),
    cautions,
    next_steps: steps,
  };
}

// ---- number guard ------------------------------------------------------------
export function validateNumbers(texts, allowed) {
  const pool = new Set(allowed);
  for (const a of allowed) { pool.add(a / 12); }
  const ok = (n) => {
    if (Number.isInteger(n) && n >= 0 && n <= 12) return true; // step numbers, months, years
    for (const a of pool) {
      if (Math.abs(a - n) <= 0.51) return true; // rounding
      if (a >= 1e5 && Math.abs(a / 1e5 - n) <= 0.011) return true; // "₹5 lakh"
      if (a >= 1e7 && Math.abs(a / 1e7 - n) <= 0.011) return true; // "₹1 crore"
    }
    return false;
  };
  const bad = [];
  for (const t of texts) {
    for (const m of String(t || '').matchAll(/\d[\d,]*\.?\d*/g)) {
      const n = parseFloat(m[0].replace(/,/g, ''));
      if (Number.isFinite(n) && !ok(n)) bad.push(m[0]);
    }
  }
  return bad;
}

const SYSTEM_PROMPT = `You are SchemeSetu's financial explainer for Indian government funding schemes.
You are given a JSON object containing a recommendation that has ALREADY been decided and fully calculated by SchemeSetu's engine.

STRICT RULES:
1. Do NOT change the recommendation, pick another scheme, or recalculate anything. Only explain it.
2. Use ONLY numbers that appear in the given JSON. Never invent, round to a different value, estimate, or add any new figure, rate, date, limit or rule.
3. If a value is null/missing, say it is not known or not specified — never fill it in.
4. Mention every item in "cautions" that is relevant; never hide a caution. Do not promise approval or guaranteed outcomes.
5. Plain, calm, professional tone in the requested language ("en" or "hi"). No hype, no emoji, no "AI" wording.
6. Keep it short: the user is a small business owner reading on a phone.

Return ONLY this JSON:
{ "headline": string, "why_this_scheme": string (2-3 sentences), "plan_walkthrough": string (3-5 sentences covering own funds, subsidy, loan, EMI), "cautions": [string], "next_steps": [string] }`;

function payloadFor(advice, lang) {
  const slim = (p) => p && ({
    name: lang === 'hi' ? p.name_hi : p.name,
    eligibility_status: p.eligibility_status, eligibility_uncertain: p.eligibility_uncertain,
    funding: p.funding, loan: p.loan && { ...p.loan, rate: p.loan.rate && { label: p.loan.rate.label, basis: p.loan.rate.basis, isEstimate: p.loan.rate.isEstimate } },
    affordability: p.affordability, government_benefit: p.governmentBenefit,
    missing_documents: p.missing_documents, cautions: p.flags,
  });
  return {
    language: lang,
    situation: advice.situation,
    recommended: slim(advice.recommended),
    alternatives: advice.alternatives.map((a) => ({ name: lang === 'hi' ? a.name_hi : a.name, why_not_top: a.whyNotTop, government_benefit: a.governmentBenefit })),
    blocked: advice.blocked.map((b) => ({ name: b.name, problems: b.problems })),
    enablers: advice.enablers.map((e) => e.text),
    assumptions: advice.assumptions,
  };
}

export async function explainAdvice(advice, lang = 'en') {
  const fallback = () => templateExplanation(advice, lang);
  if (!advice.recommended || !process.env.GROQ_API_KEY) return fallback();
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const res = await groq.chat.completions.create({
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(payloadFor(advice, lang)) }],
      model: 'openai/gpt-oss-20b', temperature: 0.2, reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    }, { timeout: 15000, maxRetries: 0 });
    const parsed = JSON.parse(res.choices[0].message.content);
    const out = {
      headline: String(parsed.headline || ''),
      why_this_scheme: String(parsed.why_this_scheme || ''),
      plan_walkthrough: String(parsed.plan_walkthrough || ''),
      cautions: Array.isArray(parsed.cautions) ? parsed.cautions.map(String).slice(0, 8) : [],
      next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map(String).slice(0, 6) : [],
    };
    if (!out.headline || !out.plan_walkthrough) return fallback();
    const bad = validateNumbers([out.headline, out.why_this_scheme, out.plan_walkthrough, ...out.cautions, ...out.next_steps], collectAllowedNumbers(advice));
    if (bad.length) {
      console.warn('advisor explainer: rejected model text containing ungrounded numbers:', bad.slice(0, 5).join(', '));
      if (process.env.ADVISOR_DEBUG) console.warn('advisor explainer [debug] rejected text:', JSON.stringify(out));
      return fallback();
    }
    // The deterministic cautions are authoritative: always include them so the
    // model can never silently drop a warning.
    const must = [...new Set([...advice.recommended.flags, ...advice.assumptions])].map((c) => sentence(c, null, lang)).filter(Boolean);
    return { source: 'ai', ...out, cautions: must };
  } catch (err) {
    console.warn('advisor explainer unavailable:', err.message);
    return fallback();
  }
}
