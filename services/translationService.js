import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const getGroqClient = () => new Groq({ apiKey: process.env.GROQ_API_KEY });

// Human-readable names so the model knows exactly which script/language to use.
const LANG_NAMES = {
  en: 'English',
  hi: 'Hindi (Devanagari script)',
  pa: 'Punjabi (Gurmukhi script)',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  mr: 'Marathi (Devanagari script)',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  or: 'Odia',
  ur: 'Urdu (Nastaliq script)'
};

/**
 * Translate an array of short UI/content strings into a single target language.
 * Returns an array of the same length, in the same order.
 * The model is told to preserve numbers, ₹ amounts, %, emoji, English acronyms
 * (PMEGP, EMI, PM, AI, WhatsApp, etc.) and to translate nothing that is already
 * a proper noun / brand.
 */
export async function translateBatch(texts, targetLang, sourceLang = 'auto') {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const target = LANG_NAMES[targetLang];
  if (!target) throw new Error(`Unsupported target language: ${targetLang}`);

  // Nothing to do when source == target.
  if (targetLang === sourceLang) return texts.map(String);

  const source = LANG_NAMES[sourceLang] || 'the given source language';

  const groq = getGroqClient();

  const numbered = texts.map((t, i) => ({ id: i, text: String(t ?? '') }));

  const response = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `You are a professional translator for an official Government of India welfare-scheme portal. Translate each item from ${source} into ${target}.

STRICT RULES:
- Translate meaning naturally and formally, as a government portal would read in ${target}.
- Keep it concise; do NOT add explanations or extra words.
- Preserve exactly, without translating: numbers, digits, ₹ amounts, percentages, dates, emoji, URLs, and well-known acronyms/brand names such as PMEGP, PM, EMI, AI, PIB, KVIC, SC, ST, OBC, EWS, PwD, LGBTQ+, UPSC, NEET, WhatsApp, SchemeSetu.
- Do NOT translate text that is already in ${target}.
- Return the SAME number of items, in the SAME order, matched by id.

Return ONLY valid JSON of this exact shape:
{ "items": [ { "id": number, "t": "translated string" } ] }`
      },
      { role: 'user', content: JSON.stringify({ items: numbered }) }
    ],
    model: 'openai/gpt-oss-120b',
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Translation model returned invalid JSON');
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const byId = new Map(items.map((it) => [Number(it.id), it.t]));

  // Rebuild in original order; fall back to source text if a slot is missing.
  return texts.map((t, i) => {
    const v = byId.get(i);
    return typeof v === 'string' && v.length > 0 ? v : String(t ?? '');
  });
}

export { LANG_NAMES };
