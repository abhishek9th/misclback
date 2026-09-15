// ============================================================================
// Field-mapping engine (§9).
// Maps government-portal field labels -> a known SchemeSetu source value.
// Every auto-filled field carries its provenance (source), so the UI/audit can
// always explain WHERE a value came from. AI may later help resolve unfamiliar
// labels, but this engine never invents a value: an unmapped or empty field is
// returned as "missing" so the journey pauses and asks the user (§10).
// ============================================================================

export const SOURCES = Object.freeze({
  PROFILE: 'PROFILE',
  APPLICATION_DATA: 'APPLICATION_DATA',
  DOCUMENT: 'DOCUMENT',
  USER_INPUT: 'USER_INPUT',
  DERIVED_VALUE: 'DERIVED_VALUE',
});

// Canonical field keys the portal adapters request, each resolvable from the
// user's profile. Labels (en/hi) are for display only.
const PROFILE_FIELDS = {
  full_name:        { source: SOURCES.PROFILE, get: (p) => p.full_name, label: 'Applicant Full Name', label_hi: 'आवेदक का पूरा नाम' },
  email:            { source: SOURCES.PROFILE, get: (p) => p.email, label: 'Email', label_hi: 'ईमेल' },
  phone:            { source: SOURCES.PROFILE, get: (p) => p.phone, label: 'Mobile Number', label_hi: 'मोबाइल नंबर' },
  date_of_birth:    { source: SOURCES.PROFILE, get: (p) => p.date_of_birth, label: 'Date of Birth', label_hi: 'जन्म तिथि' },
  gender:           { source: SOURCES.PROFILE, get: (p) => p.gender, label: 'Gender', label_hi: 'लिंग' },
  social_category:  { source: SOURCES.PROFILE, get: (p) => p.social_category, label: 'Social Category', label_hi: 'सामाजिक श्रेणी' },
  annual_income:    { source: SOURCES.PROFILE, get: (p) => p.annual_income, label: 'Annual Family Income', label_hi: 'वार्षिक पारिवारिक आय' },
  state:            { source: SOURCES.PROFILE, get: (p) => p.state, label: 'State', label_hi: 'राज्य' },
  district:         { source: SOURCES.PROFILE, get: (p) => p.district, label: 'District', label_hi: 'ज़िला' },
  education_level:  { source: SOURCES.PROFILE, get: (p) => p.education_level, label: 'Education Level', label_hi: 'शिक्षा स्तर' },
  occupation:      { source: SOURCES.PROFILE, get: (p) => p.occupation, label: 'Occupation', label_hi: 'व्यवसाय' },
  aadhaar_number:  { source: SOURCES.PROFILE, get: (p) => p.aadhaar_number, label: 'Aadhaar Number', label_hi: 'आधार संख्या' },
};

// Fields the profile can't supply: the journey must collect them from the user
// (never guessed). Adapters reference these by key.
const USER_INPUT_FIELDS = {
  father_name:     { label: 'Father\'s Full Name', label_hi: 'पिता का पूरा नाम', type: 'TEXT' },
  mother_name:     { label: 'Mother\'s Full Name', label_hi: 'माता का पूरा नाम', type: 'TEXT' },
  bank_account:    { label: 'Bank Account Number', label_hi: 'बैंक खाता संख्या', type: 'TEXT' },
  ifsc:            { label: 'Bank IFSC Code', label_hi: 'बैंक IFSC कोड', type: 'TEXT' },
  institution_name:{ label: 'Institution / College Name', label_hi: 'संस्थान / कॉलेज का नाम', type: 'TEXT' },
};

export function fieldMeta(key) {
  return PROFILE_FIELDS[key] || USER_INPUT_FIELDS[key] || { label: key, label_hi: key, type: 'TEXT' };
}

// Resolve a single requested field for a user.
//  order: already-collected form_data (USER_INPUT) -> profile -> missing.
// Returns { key, value, source } when resolvable, or { key, missing:true, ... }.
export function resolveField(key, { profile = {}, formData = {} } = {}) {
  const meta = fieldMeta(key);

  // 1. Previously collected this journey (user input or earlier fill).
  if (formData[key] && formData[key].value !== undefined && formData[key].value !== null && formData[key].value !== '') {
    return { key, value: formData[key].value, source: formData[key].source || SOURCES.USER_INPUT, label: meta.label, label_hi: meta.label_hi };
  }

  // 2. Profile-backed field.
  const pf = PROFILE_FIELDS[key];
  if (pf) {
    const value = pf.get(profile);
    if (value !== undefined && value !== null && value !== '') {
      return { key, value, source: pf.source, label: meta.label, label_hi: meta.label_hi };
    }
  }

  // 3. Not known — must ask the user. Never fabricate.
  return {
    key,
    missing: true,
    label: meta.label,
    label_hi: meta.label_hi,
    type: meta.type || 'TEXT',
  };
}

// Resolve a list of requested field keys. Returns { filled: [...], missing: [...] }.
export function resolveFields(keys, ctx) {
  const filled = [];
  const missing = [];
  for (const key of keys) {
    const r = resolveField(key, ctx);
    if (r.missing) missing.push(r);
    else filled.push(r);
  }
  return { filled, missing };
}
