/**
 * Scheme conflict rules — authoritative, versioned reference data (like
 * schemes.js). A conflict is NEVER inferred from "same category / both give
 * money" (§47); every BLOCKING rule cites an official source (§44). The
 * conflict ENGINE (conflictEngine.js) evaluates these rules against the user's
 * real application/benefit status from public.scheme_applications — the
 * frontend never decides conflicts (§39).
 *
 * Two things live here:
 *   SCHEME_META    — benefit_type + conflict_group per curated scheme (§9).
 *                    Contextual only; a group alone never creates a conflict.
 *   CONFLICT_RULES — the actual rules. Each guards a TARGET scheme (or group)
 *                    and names what conflicts with it, the trigger (applied vs
 *                    receiving vs previously-received), which existing-scheme
 *                    statuses make it BLOCKING vs a POSSIBLE warning, and the
 *                    official source.
 */

// benefit_type: SCHOLARSHIP | SUBSIDY | LOAN | INTEREST_SUBSIDY | TRAINING | ...
// group: a coarse family used for group-level exclusion rules (§8).
export const SCHEME_META = {
  scheme_pmegp: { benefit_type: 'SUBSIDY', group: 'SELF_EMPLOYMENT_CREDIT' },
  scheme_mudra_shishu: { benefit_type: 'LOAN', group: 'SELF_EMPLOYMENT_CREDIT' },
  scheme_mudra_kishore: { benefit_type: 'LOAN', group: 'SELF_EMPLOYMENT_CREDIT' },
  scheme_standup_india: { benefit_type: 'LOAN', group: 'SELF_EMPLOYMENT_CREDIT' },
  scheme_pmfme: { benefit_type: 'SUBSIDY', group: 'SELF_EMPLOYMENT_CREDIT' },
  scheme_pm_vishwakarma: { benefit_type: 'LOAN', group: 'SELF_EMPLOYMENT_CREDIT' },

  scheme_csss_scholarship: { benefit_type: 'SCHOLARSHIP', group: 'SCHOLARSHIP' },
  scheme_post_matric_scholarship: { benefit_type: 'SCHOLARSHIP', group: 'SCHOLARSHIP' },
  scheme_pm_yasasvi: { benefit_type: 'SCHOLARSHIP', group: 'SCHOLARSHIP' },
  scheme_pragati_girls: { benefit_type: 'SCHOLARSHIP', group: 'SCHOLARSHIP' },
  scheme_post_matric_disability_scholarship: { benefit_type: 'SCHOLARSHIP', group: 'SCHOLARSHIP' },
  scheme_national_overseas: { benefit_type: 'SCHOLARSHIP', group: 'SCHOLARSHIP' },
  scheme_vidya_lakshmi: { benefit_type: 'LOAN', group: 'EDUCATION_LOAN' },
};

// trigger — what activity in the CONFLICTING scheme the rule is about:
//   RECEIVING           : the user is currently getting the other benefit
//   PREVIOUSLY_RECEIVED : the user got the other benefit before (history)
//   APPLIED             : the user merely applied for the other scheme
// blocking_statuses / possible_statuses — the CONFLICTING application's status
// (canonicalised, see conflictEngine.STATUS_MAP) that makes the rule BLOCKING
// vs merely a POSSIBLE_CONFLICT warning. Anything else => no conflict from it.
export const CONFLICT_RULES = [
  {
    id: 'pmv_no_prior_selfemp_credit',
    target: { scheme_id: 'scheme_pm_vishwakarma' },
    conflicts_with: { scheme_ids: ['scheme_pmegp', 'scheme_mudra_shishu', 'scheme_mudra_kishore', 'scheme_standup_india', 'scheme_pmfme'] },
    conflict_type: 'PREVIOUS_BENEFICIARY_EXCLUSION',
    trigger: 'PREVIOUSLY_RECEIVED',
    blocking_statuses: ['APPROVED', 'BENEFIT_ACTIVE', 'BENEFIT_RECEIVED', 'COMPLETED'],
    possible_statuses: ['SUBMITTED', 'UNDER_REVIEW'],
    severity_default: 'BLOCKING',
    description_en: 'PM Vishwakarma applicants must not have availed a loan under a similar central/state self-employment credit scheme (e.g. PMEGP, PM SVANidhi, Mudra) in the last 5 years.',
    description_hi: 'PM विश्वकर्मा के आवेदक ने पिछले 5 वर्षों में किसी समान केंद्रीय/राज्य स्व-रोज़गार ऋण योजना (जैसे PMEGP, PM SVANidhi, Mudra) का लाभ नहीं लिया होना चाहिए।',
    source_url: 'https://www.myscheme.gov.in/schemes/pmv',
    source_title: 'PM Vishwakarma — Eligibility (Ministry of MSME)',
    verification_status: 'verified',
    last_verified_at: '2026-09-13',
  },
  {
    id: 'pmegp_new_units_only',
    target: { scheme_id: 'scheme_pmegp' },
    conflicts_with: { scheme_ids: ['scheme_pmegp', 'scheme_pmfme', 'scheme_standup_india'] },
    conflict_type: 'PREVIOUS_BENEFICIARY_EXCLUSION',
    trigger: 'PREVIOUSLY_RECEIVED',
    blocking_statuses: ['APPROVED', 'BENEFIT_ACTIVE', 'BENEFIT_RECEIVED', 'COMPLETED'],
    possible_statuses: [],
    severity_default: 'BLOCKING',
    description_en: 'PMEGP funds only NEW units. Existing units already assisted under PMEGP/REGP or another government subsidy scheme are not eligible.',
    description_hi: 'PMEGP केवल नई इकाइयों को वित्तपोषित करता है। PMEGP/REGP या किसी अन्य सरकारी सब्सिडी योजना से पहले सहायता प्राप्त इकाइयाँ पात्र नहीं हैं।',
    source_url: 'https://www.kviconline.gov.in/pmegpeportal/pmegphome/index.jsp',
    source_title: 'PMEGP Guidelines — KVIC',
    verification_status: 'verified',
    last_verified_at: '2026-09-13',
  },
  {
    id: 'scholarship_no_double',
    target: { group: 'SCHOLARSHIP' },
    conflicts_with: { group: 'SCHOLARSHIP' },
    conflict_type: 'SCHOLARSHIP_EXCLUSION',
    trigger: 'RECEIVING',
    blocking_statuses: ['APPROVED', 'BENEFIT_ACTIVE', 'BENEFIT_RECEIVED'],
    // "receiving another scholarship" — an in-review application is not yet
    // "receiving", so it is only a POSSIBLE conflict pending confirmation (§48).
    possible_statuses: ['SUBMITTED', 'UNDER_REVIEW'],
    severity_default: 'BLOCKING',
    description_en: 'Most government scholarships do not allow a student to receive another scholarship at the same time.',
    description_hi: 'अधिकांश सरकारी छात्रवृत्तियाँ किसी छात्र को एक साथ दूसरी छात्रवृत्ति प्राप्त करने की अनुमति नहीं देतीं।',
    source_url: 'https://scholarships.gov.in/',
    source_title: 'National Scholarship Portal — General conditions',
    // Generic scholarship rule, not tied to one scheme's exact wording -> the
    // engine treats an in-review overlap as POSSIBLE, not an outright block.
    verification_status: 'unverified',
    last_verified_at: '2026-09-13',
  },
];
