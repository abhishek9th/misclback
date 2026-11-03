// Recommendation engine settings. Weights must sum to 1 (they are normalised anyway) and
// can be overridden without a code change:  RECOMMENDER_WEIGHTS='{"purpose":0.4,"location":0.1}'
const DEFAULT_WEIGHTS = {
  purpose: 0.30,      // does the scheme's purpose/activity match what the user wants (crop, trade ...)
  beneficiary: 0.20,  // is the scheme aimed at this kind of person (farmer, student, woman ...)
  eligibility: 0.20,  // how many of the scheme's stated criteria the known facts satisfy
  location: 0.15,     // central, or the user's state
  assistance: 0.10,   // loan / subsidy / insurance ... type asked for
  semantic: 0.05,     // how close the scheme's text is to the request (AI judge, or keyword proxy)
};

function loadWeights() {
  try {
    const over = process.env.RECOMMENDER_WEIGHTS ? JSON.parse(process.env.RECOMMENDER_WEIGHTS) : {};
    const w = { ...DEFAULT_WEIGHTS };
    for (const k of Object.keys(w)) if (typeof over[k] === 'number' && over[k] >= 0) w[k] = over[k];
    const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    for (const k of Object.keys(w)) w[k] /= sum;
    return w;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export const WEIGHTS = loadWeights();

// Relevance bands (score 0-100). Anything below `hide` is not shown as a recommendation.
export const BANDS = { highly: 80, relevant: 60, potential: 40, hide: 40 };

export function bandOf(score) {
  if (score >= BANDS.highly) return 'highly_relevant';
  if (score >= BANDS.relevant) return 'relevant';
  if (score >= BANDS.potential) return 'potentially_relevant';
  return 'not_relevant';
}
