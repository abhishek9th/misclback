import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { LANG_NAMES } from './translationService.js';
dotenv.config();

const getGroqClient = () => {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
};

const userProfileService = {
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

ALWAYS write "answer" in ${replyLanguage}. Keep it concise (2-5 short sentences), simple enough for a first-time user, and end with one short follow-up question ONLY if more detail is genuinely needed to help.

Return ONLY this valid JSON shape:
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
        temperature: 0.3,
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
