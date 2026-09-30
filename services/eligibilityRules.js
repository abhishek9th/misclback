// ============================================================================
// Rule-based eligibility extraction from a scheme's OFFICIAL text. Zero LLM
// tokens. Every value returned is backed by a phrase actually present in the
// text (kept as `evidence`), and anything not stated is left null / [] — which
// the matcher treats as "no restriction", never as a fabricated one.
//
// Output uses the SAME columns/vocabularies as extractCatalogueEligibility.mjs
// (income_limit, eligible_categories, eligible_genders, education_levels,
// min_age, max_age, benefit_types, audiences) so it plugs into the existing
// matcher unchanged.
// ============================================================================

const CATEGORIES = ['general', 'obc', 'sc', 'st', 'ews', 'minorities'];
const CAT_PATTERNS = {
  sc: /scheduled castes?|dalit|safai karamchari|scaveng/i,
  st: /scheduled tribes?|tribal|adivasi|denotified|nomadic/i,
  obc: /other backward|backward class(es)?/i,
  ews: /economically weaker/i,
  minorities: /minorit(y|ies)|muslim|christian|sikh|buddhist|jain\b|parsi|zoroastrian/i,
};
// Acronyms must be UPPER-CASE and not part of another token — otherwise "M.Sc." reads as SC.
const CAT_ACRONYMS = {
  sc: /(?<![A-Za-z.])SC(?![A-Za-z.])/g,
  st: /(?<![A-Za-z.\d])ST(?![A-Za-z.])/g,
  obc: /(?<![A-Za-z.])(OBC|EBC)(?![A-Za-z.])/g,
  ews: /(?<![A-Za-z.])EWS(?![A-Za-z.])/g,
};
const NEGATED =/(other than|excluding|except|not belong(?:ing)? to|apart from|excluded)\W*(?:\w+\W+){0,4}$/i;

// A category named only to receive a BONUS (relaxation, reservation, priority…) does not
// restrict the scheme to that category — treating it as a restriction would wrongly hide
// the scheme from everyone else.
const BONUS = /marks|percent|cgpa|ogpa|out of|cut-?off|score|aggregate|\d\s?%|relax|reserv|prefer|priorit|additional|extra|higher|enhanced|concession|weightage|bonus|top[- ]?up|% of (the )?(seats|posts|beneficiar)|per ?cent of|quota/i;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

// "2.5 lakh" / "2,50,000" / "1 crore" / "Rs. 3,00,000" -> rupees
function toRupees(numStr, unit) {
  const n = parseFloat(String(numStr).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (unit || '').toLowerCase();
  if (/crore|cr\b/.test(u)) return Math.round(n * 1e7);
  if (/lakh|lac|lakhs/.test(u)) return Math.round(n * 1e5);
  if (/thousand|k\b/.test(u)) return Math.round(n * 1e3);
  return Math.round(n);
}

function extractIncome(text, evidence) {
  const caps = [];
  // "annual/family/household income ... not exceed / less than / below / up to ... Rs X lakh"
  const re = /(?:annual|family|household|yearly|parental|per annum|total)?\s*income[^.;]{0,90}?(?:not (?:exceed|more than|be more than|be above|above)|(?:less|lower) than|below|under|up ?to|upto|within|maximum(?: of)?|limit(?: of)?|ceiling(?: of)?|does not exceed|shall not exceed|≤|<)[^\d₹]{0,25}(?:rs\.?|inr|₹)?\s*([\d][\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand)?/gi;
  for (const m of text.matchAll(re)) {
    const v = toRupees(m[1], m[2]);
    // ignore tiny numbers that are almost certainly not rupee caps ("income up to 2 members")
    if (v && v >= 10000 && v <= 5e7) { caps.push(v); evidence.income_limit = evidence.income_limit || clip(m[0], 160); }
  }
  // "income of Rs 2,50,000 or less"
  const re2 = /income[^.;]{0,60}?(?:rs\.?|inr|₹)\s*([\d][\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|thousand)?[^.;]{0,25}or (?:less|below)/gi;
  for (const m of text.matchAll(re2)) {
    const v = toRupees(m[1], m[2]);
    if (v && v >= 10000 && v <= 5e7) { caps.push(v); evidence.income_limit = evidence.income_limit || clip(m[0], 160); }
  }
  if (!caps.length) return null;
  // Different caps usually mean different categories/regions — take the most
  // permissive so nobody is wrongly excluded (matcher shows "confirm on portal").
  return Math.max(...caps);
}

function extractCategories(text, evidence) {
  const found = [];
  for (const [cat, re] of Object.entries(CAT_PATTERNS)) {
    const patterns = [new RegExp(re.source, 'gi')];
    if (CAT_ACRONYMS[cat]) patterns.push(new RegExp(CAT_ACRONYMS[cat].source, 'g'));
    for (const g of patterns) {
      let m;
      while ((m = g.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 60), m.index);
        if (NEGATED.test(before)) continue; // "other than SC/ST" is not an eligibility grant
        if (BONUS.test(text.slice(Math.max(0, m.index - 90), m.index + 90))) continue; // relaxation/cut-off/reservation, not a restriction
        if (!found.includes(cat)) { found.push(cat); evidence[`category_${cat}`] = clip(text.slice(Math.max(0, m.index - 30), m.index + 50), 100); }
        break;
      }
    }
  }
  // If the text explicitly opens the scheme to General too, it isn't category-restricted.
  if (/\bgeneral (category|caste)|all (categories|castes|communities)|irrespective of (caste|category)|without (any )?(caste|category)/i.test(text)) return [];
  return found.filter((c) => CATEGORIES.includes(c));
}

function extractGenders(text, evidence, head = '') {
  // 'female' only when the scheme is clearly FOR women: the title/description says so, or the
  // eligibility text states it as a requirement — not a stray "girl child" / "widow" mention.
  const strong = /(only|exclusively|solely)\s+(for\s+)?(women|woman|female|girls?)|(women|woman|female|girl)s?\s+(applicants?|candidates?|beneficiar(y|ies)|entrepreneurs?|farmers?|students?|artisans?|workers?)|(applicant|beneficiary|candidate)\s+(must|should|has to|shall)\s+be\s+(a\s+)?(woman|female|girl)|for\s+(women|woman|girls?|widows?)\b|women[- ](headed|led|owned)|mahila/i;
  const headWomen = /\b(women|woman|girls?|widows?|mahila|beti|ladli|kanya)\b/i.test(head);
  // "…tenant farmers and women farmers" / "including women" names women as ONE of several
  // groups — that is not a restriction to women.
  const inclusive = /(,|\band\b|\bor\b|including|as well as|along with)\s+(women|woman|female|girls?)\b/i.test(text) && !/(only|exclusively|solely)/i.test(text);
  const women = (headWomen || (strong.test(text) && !inclusive))
    ? (strong.exec(text) || /\b(women|woman|girls?|widows?|mahila)\b/i.exec(head))
    : null;
  const men = /\b(men|male|boys?)\b(?!\s*(?:and|or|&|\/)\s*(?:women|female))/i.test(text.replace(/\b(women|female)\b/gi, ' '));
  const both = /(men and women|women and men|male and female|female and male|both (men|male|genders?|sexes)|irrespective of (gender|sex)|all genders|men\/women|women\/men|male\/female)/i.test(text);
  const out = [];
  if (both) return [];
  if (women && !men) { out.push('female'); evidence.gender = clip(text.slice(Math.max(0, women.index - 30), women.index + 50), 100); }
  const tg = /transgender/i.exec(head) || /transgender (persons?|individuals?|applicants?|candidates?)/i.exec(text);
  if (tg && !BONUS.test(text.slice(Math.max(0, tg.index - 90), tg.index + 90))) { out.push('other'); evidence.gender_other = clip(text.slice(Math.max(0, tg.index - 30), tg.index + 50), 100); }
  return [...new Set(out)];
}

function extractAge(text, evidence) {
  let min = null, max = null;
  const ok = (n) => Number.isFinite(n) && n >= 0 && n <= 100;
  // "between the age of 18 and 35", "aged 18-35 years", "age group of 18 to 40", "18 to 35 years of age"
  const range = /(?:age(?:d)?(?: group)?(?: of| between)?|between(?: the)? ages? of|aged between|in the age group(?: of)?)[^\d]{0,20}(\d{1,2})\s*(?:years?)?\s*(?:-|–|to|and)\s*(\d{1,2})\s*(?:years?|yrs)?/i.exec(text)
    || /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*years?(?: of age| old)/i.exec(text);
  if (range) {
    const a = Number(range[1]), b = Number(range[2]);
    if (ok(a) && ok(b) && a < b) { min = a; max = b; evidence.age = clip(range[0], 100); }
  }
  if (min === null) {
    const mn = /(?:minimum age|at least|not less than|completed|attained|above|over|from)[^\d.]{0,20}(\d{1,2})\s*years?(?:[^.;]{0,15}(?:of age|old|age))|(\d{1,2})\s*years?\s*(?:of age )?(?:and above|or above|or older|and older|and more)/i.exec(text);
    if (mn) { const v = Number(mn[1] || mn[2]); if (ok(v) && v >= 5) { min = v; evidence.min_age = clip(mn[0], 100); } }
  }
  if (max === null) {
    const mx = /(?:maximum age|not (?:more|older) than|not exceed(?:ing)?|below|under|up ?to|less than|upper age limit(?: of)?|age limit(?: of)?)[^\d.]{0,20}(\d{1,2})\s*years?(?:[^.;]{0,15}(?:of age|old|age))?/i.exec(text);
    // require an "age" context so loan tenures ("up to 5 years") are not misread
    if (mx && /age|aged|old/i.test(text.slice(Math.max(0, mx.index - 40), mx.index + mx[0].length + 25))) {
      const v = Number(mx[1]); if (ok(v) && v >= 10) { max = v; evidence.max_age = clip(mx[0], 100); }
    }
  }
  if (min !== null && max !== null && min >= max) { min = null; max = null; }
  return { min, max };
}

const EDU = [
  ['10th', /\b10th\b|class (10|x)\b|matric(ulation)?\b|secondary (school|education)|\bssc\b/i],
  ['12th', /\b12th\b|class (12|xii)\b|higher secondary|intermediate|\bhsc\b|plus two|\+2\b/i],
  ['diploma', /diploma|polytechnic|\biti\b/i],
  ['undergraduate', /(?<!post[- ]?)(?<!post )graduat(e|ion)|bachelor|b\.?\s?tech|b\.?\s?e\b|\bb\.?sc\b|\bb\.?a\b|\bb\.?com\b|degree course|under[- ]?graduate|\bug\b/i],
  ['postgraduate', /post[- ]?graduat|master'?s|m\.?\s?tech|\bm\.?sc\b|\bm\.?a\b|\bmba\b|\bpg\b/i],
  ['phd', /ph\.?\s?d|doctora(l|te)/i],
  ['vocational', /vocational|skill (training|course)|\bnsqf\b/i],
];
function extractEducation(text, evidence) {
  // only when the text talks about qualification/study, not merely mentions a word
  if (!/(qualif|pass(ed)?|studying|enrol|admitted|admission|pursuing|course|educat|scholar|student)/i.test(text)) return [];
  const out = [];
  for (const [lvl, re] of EDU) {
    const m = re.exec(text);
    if (m) { out.push(lvl); evidence[`edu_${lvl}`] = clip(text.slice(Math.max(0, m.index - 25), m.index + 45), 80); }
  }
  return out;
}

const BENEFITS = [
  ['scholarship', /scholarship/i], ['loan', /\bloans?\b|credit facility|term loan|working capital/i],
  ['subsidy', /subsid(y|ies)|margin money|interest subvention/i], ['grant', /\bgrants?\b|grant-in-aid|financial assistance|one[- ]time (assistance|payment)/i],
  ['training', /\btraining\b|skill development|upskill|coaching/i], ['pension', /pension/i],
  ['insurance', /insurance|health cover|life cover/i], ['housing', /\bhousing\b|house construction|pucca house/i],
  ['equipment', /equipment|tool ?kit|machinery|appliance|aids? and appliances|bicycle|sewing machine|laptop/i],
  ['stipend', /stipend|monthly allowance/i], ['fellowship', /fellowship/i],
];

const AUD = [
  ['entrepreneur', /entrepreneur|self[- ]?employ|new (business|enterprise|unit|venture)|set(ting)? up (a |an |their )?(business|enterprise|unit)|business (loan|activity|venture)/i],
  ['msme', /\bmsmes?\b|micro,? small|micro enterprise|small enterprise|medium enterprise/i],
  ['startup', /start-?ups?/i],
  ['student', /student|scholar(ship)?|studying|pursuing|school|college|university/i],
  ['researcher', /research (scholar|fellow)|ph\.?\s?d|fellowship/i],
  ['farmer', /farmer|agricultur(e|ist)|cultivat|kisan|crop|horticulture|dairy|fisher(y|ies|men)|livestock/i],
  ['woman', /\b(women|woman|female|widow|mahila|girls?)\b/i],
  ['worker', /worker|labou?r(er)?|unorgani[sz]ed|construction|\bbocw\b|employee/i],
  ['senior_citizen', /senior citizen|old age|aged (60|65)|60 years and above|elderly/i],
  ['disabled', /divyang|disab(led|ility|ilities)|handicapped|persons? with disabilit|\bpwd\b|blind|deaf|locomotor/i],
  ['minority', /minorit(y|ies)|muslim|christian|sikh|buddhist|jain\b|parsi/i],
  ['artisan', /artisan|weaver|handloom|handicraft|craftsm|karigar|potter|cobbler|blacksmith|tailor|traditional (trade|skill)/i],
  ['child', /\bchild(ren)?\b|orphan|minor\b|infant|adolescent/i],
  ['unemployed', /unemploy|jobless|job seeker/i],
  ['sportsperson', /sportsperson|sports person|athlete|\bplayers?\b|olympic/i],
];

// name + short description are the strongest audience signal; eligibility prose is secondary.
export function extractEligibility({ name = '', short_description = '', eligibility_text = '', benefits_text = '' }) {
  const evidence = {};
  const elig = String(eligibility_text || '');
  const head = `${name} ${short_description || ''}`;
  const all = `${head}. ${elig}`;

  const income_limit = extractIncome(elig, evidence);
  const eligible_categories = extractCategories(elig || head, evidence);
  const eligible_genders = extractGenders(elig, evidence, head);
  const { min, max } = extractAge(elig, evidence);
  const education_levels = extractEducation(elig, evidence);

  const benefitText = `${head} ${benefits_text || ''}`;
  const benefit_types = BENEFITS.filter(([, re]) => re.test(benefitText)).map(([k]) => k);
  const audiences = AUD.filter(([k, re]) => {
    // audiences from the title/description count fully; from the long eligibility text only for the sharp ones
    if (re.test(head)) return true;
    if (['woman', 'student', 'child', 'worker', 'farmer'].includes(k)) return false; // too broad in prose
    return re.test(elig);
  }).map(([k]) => k);
  // A category or gender restriction implies the matching audience.
  if (eligible_genders.includes('female') && !audiences.includes('woman')) audiences.push('woman');
  if (eligible_categories.includes('minorities') && !audiences.includes('minority')) audiences.push('minority');

  return {
    income_limit,
    eligible_categories,
    eligible_genders,
    education_levels,
    min_age: min,
    max_age: max,
    benefit_types,
    audiences,
    _evidence: evidence,
  };
}

// How many of the eligibility dimensions the rules actually found something for.
export function signalCount(x) {
  return [x.income_limit != null, x.eligible_categories.length > 0, x.eligible_genders.length > 0,
    x.education_levels.length > 0, x.min_age != null || x.max_age != null, x.audiences.length > 0].filter(Boolean).length;
}
