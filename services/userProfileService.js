import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { LANG_NAMES } from './translationService.js';
dotenv.config();

const getGroqClient = () => {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
};

const userProfileService = {
  // Suggests ADDITIONAL real, well-known Indian government schemes beyond
  // SchemeSetu's small structured catalogue (src/data/schemes.js has ~20
  // verified entries — most real users' profiles narrow down to the same
  // 2-3 generic ones there). Groq draws on its general knowledge of widely
  // published schemes (PMEGP, PM Mudra, PM SVANidhi, Stand-Up India, NSP,
  // state scholarships, PMKVY, PM-KISAN, Ayushman Bharat, etc.) — it is
  // NEVER treated as the source of truth for eligibility rules or numbers;
  // every suggestion is clearly labelled "verify on the official portal"
  // and the model is explicitly forbidden from inventing specific figures
  // it isn't confident about (same discipline as analyzeProfile's chatbot).
  suggestAdditionalSchemes: async (criteria = {}, language = 'hi') => {
    const groq = getGroqClient();
    const replyLanguage = LANG_NAMES[language] || 'simple English';

    const response = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are SchemeSetu's scheme-discovery assistant. SchemeSetu's own verified database only has a small number of structured schemes, so the user may be missing other REAL, well-known Indian government schemes (central or state) that could match their profile.

Given the user's profile/criteria as JSON, suggest up to 6 REAL Indian government schemes (central or the relevant state) that plausibly match, which are NOT already in the "already_shown" list.

STRICT RULES:
1. Only name schemes you are confident actually exist (e.g. PM-KISAN, PM SVANidhi, Ayushman Bharat, Atal Pension Yojana, PMAY, PM Vishwakarma, National Livestock Mission, Startup India, state-specific self-employment/scholarship schemes, etc.). Never invent a scheme name.
2. For each, give a one-sentence reason it may match THIS profile — grounded in what you actually know about that scheme's general purpose, not invented specifics.
3. Do NOT state exact benefit amounts, subsidy percentages, or income ceilings unless you are highly confident they are correct and current. If unsure, omit the figure rather than guess — say "check the official portal for current amounts" instead.
4. Never claim the user IS eligible — only that the scheme "may be worth checking" against their profile.
5. If you cannot confidently think of any additional real scheme beyond what's already shown, return an empty list — do not pad with guesses.
6. Write "reason" in ${replyLanguage}.

Return ONLY this JSON shape:
{ "suggestions": [ { "name": string, "reason": string, "category": "central" | "state" | "unknown" } ] }`,
        },
        { role: 'user', content: JSON.stringify({ profile: criteria }) },
      ],
      model: 'openai/gpt-oss-120b',
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Invalid response format from AI service');
    }
    return Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 6) : [];
  },

  analyzeProfile: async (queryText, currentProfile = {}, language = 'hi') => {
    try {
      const groq = getGroqClient();
      
      if (!queryText || queryText.trim().length === 0) {
        throw new Error('Query cannot be empty');
      }
      
      const replyLanguage = LANG_NAMES[language] || 'simple English';

      const response = await groq.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are SchemeSetu's helpful assistant for Indian Government welfare schemes (business, student/education, and skill/employment support).

Your job has TWO parts on every turn:
1. Directly ANSWER the citizen's typed question in a warm, clear, accurate way. If they ask what a scheme is, who is eligible, how to apply, what documents are needed, or which scheme fits their situation, answer it helpfully using well-known facts about Indian government schemes (PMEGP, PM Mudra, PM SVANidhi, Stand-Up India, National/Post-Matric Scholarships, PM Vishwakarma, PMKVY, etc.). If you are unsure of an exact figure, say so briefly and suggest checking the official portal — never invent specific numbers.
2. QUIETLY extract any profile facts the citizen states (do not invent them).

ALWAYS write "answer" in ${replyLanguage}. This applies EVEN IF the citizen's own message is typed in Romanized/Latin script (e.g. "Hinglish" — "mujhe loan chahiye") — you must still reply in ${replyLanguage}'s native script, never mirror the user's Romanized spelling back. Keep it concise (2-5 short sentences), simple enough for a first-time user, and end with one short follow-up question ONLY if more detail is genuinely needed to help.

Return ONLY this valid JSON shape (reminder: "answer" must be in ${replyLanguage}'s native script, not Romanized, no matter what script the citizen used):
{
  "answer": string,
  "extractedData": {
    "category": "business" | "student" | "skill_employment" | null,
    "businessField": "agriculture_allied" | "manufacturing" | "retail_trading" | "food_processing" | "tech_it" | "transport" | "tourism" | "handicrafts" | "healthcare" | "services" | null,
    "businessSubField": string | null,
    "state": string | null,
    "annualFamilyIncome": number | null,
    "fundingRequirement": number | null,
    "businessStatus": "new" | "existing" | "expansion" | null,
    "gender": "male" | "female" | "other" | null,
    "socialCategory": "general" | "obc" | "sc" | "st" | "minorities" | "ews" | null,
    "studentType": "scholarship" | "education_loan" | "coaching_support" | "hostel_support" | "overseas" | null,
    "educationLevel": "school" | "class_10_12" | "undergraduate" | "postgraduate" | "professional" | "phd" | "overseas" | null,
    "course": "engineering" | "medical" | "management" | "arts" | "science" | "law" | "agriculture" | "other" | null
  },
  "newInformationFound": [string],
  "missingInformation": [string],
  "nextQuestion": string,
  "shouldFilterSchemes": boolean
}

Merge new facts with currentProfile, preserving known values unless the citizen corrects them. Set shouldFilterSchemes true once the category is known (for business, also know the field; for student, also know the studentType) so the app can show matching schemes. "nextQuestion" may repeat the follow-up question you placed at the end of "answer" (or be empty). Current profile: ${JSON.stringify(currentProfile)}`
          },
          { role: "user", content: queryText }
        ],
        model: "openai/gpt-oss-120b",
        // Lower than the scheme-suggestion call above: this reply's script/
        // language-fidelity instruction needs to hold reliably turn after turn,
        // not vary creatively.
        temperature: 0.15,
        response_format: { type: "json_object" }
      });

      const responseText = response.choices[0].message.content;
      
      // Validate response is JSON
      try {
        const parsed = JSON.parse(responseText);
        
        // Ensure required fields exist
        return {
          answer: parsed.answer || parsed.nextQuestion || '',
          extractedData: parsed.extractedData || {},
          newInformationFound: parsed.newInformationFound || [],
          missingInformation: parsed.missingInformation || [],
          nextQuestion: parsed.nextQuestion || (language === 'en' ? 'Please tell me more.' : 'कृपया अधिक जानकारी दें।'),
          shouldFilterSchemes: Boolean(parsed.shouldFilterSchemes)
        };
      } catch (parseError) {
        console.error('Failed to parse Groq response as JSON. Raw response:', responseText);
        throw new Error('Invalid response format from AI service');
      }
    } catch (error) {
      console.error('Error in analyzeProfile:', error);
      
      // Re-throw with more context
      if (error.message.includes('API key')) {
        throw new Error('API key error - service not properly configured');
      }
      if (error.message.includes('rate_limit') || error.status === 429) {
        throw new Error('rate_limit - too many requests');
      }
      if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
        throw new Error('timeout - request took too long');
      }
      
      throw error;
    }
  }
};

export default userProfileService;
