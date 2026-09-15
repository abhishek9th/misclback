// ============================================================================
// Real-portal adapters — interface stubs only (§15, §22).
//
// These represent real government portals. NONE of them is automated yet: they
// expose the adapter interface but inherit the base buildPlan/getApplicationStatus
// which THROW a NOT_SUPPORTED error. This is deliberate — we never fake a
// registration, submission, or status for a real portal. When a portal gains a
// legitimate official API / OAuth / OTR mechanism, implement buildPlan here.
// ============================================================================
import { PortalAdapter } from './PortalAdapter.js';

export class NSPAdapter extends PortalAdapter {
  constructor() {
    super({
      id: 'nsp',
      name: 'National Scholarship Portal (NSP)',
      authType: 'OTR_REQUIRED',           // NSP now uses a One-Time Registration (OTR) / Aadhaar flow
      integrationMode: 'NOT_SUPPORTED',
      officialUrl: 'https://scholarships.gov.in',
      statusLookup: 'LOGIN_REQUIRED',
    });
  }
}

export class StateScholarshipAdapter extends PortalAdapter {
  constructor() {
    super({
      id: 'state_scholarship',
      name: 'State Scholarship Portal',
      authType: 'LOGIN_REQUIRED',
      integrationMode: 'NOT_SUPPORTED',
      statusLookup: 'LOGIN_REQUIRED',
    });
  }
}

export class PMKisanAdapter extends PortalAdapter {
  constructor() {
    super({
      id: 'pmkisan',
      name: 'PM-KISAN',
      authType: 'AADHAAR_REQUIRED',
      integrationMode: 'NOT_SUPPORTED',
      officialUrl: 'https://pmkisan.gov.in',
      // PM-KISAN does expose a public "Know Your Status" by Aadhaar/mobile, but it
      // is CAPTCHA-protected and not an official third-party API — so no automated
      // status either, until an official mechanism is available.
      statusLookup: 'REFERENCE_LOOKUP',
    });
  }
}
