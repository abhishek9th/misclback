// ============================================================================
// Portal registry (§15). Maps portal ids -> adapter instances and resolves the
// portal to use for a given scheme.
// ============================================================================
import { MockPortalAdapter } from './MockPortalAdapter.js';
import { NSPAdapter, StateScholarshipAdapter, PMKisanAdapter } from './RealPortalAdapters.js';

const ADAPTERS = new Map();
function register(adapter) { ADAPTERS.set(adapter.id, adapter); }

register(new MockPortalAdapter());
register(new NSPAdapter());
register(new StateScholarshipAdapter());
register(new PMKisanAdapter());

export function getAdapter(portalId) {
  return ADAPTERS.get(portalId) || null;
}

export function listAdapters() {
  return [...ADAPTERS.values()].map((a) => ({
    id: a.id, name: a.name, authType: a.authType,
    integrationMode: a.integrationMode, officialUrl: a.officialUrl,
    statusLookup: a.statusLookup, supported: a.supported,
  }));
}

// Which portal drives a scheme's guided journey.
//
// Real portals aren't automatable yet (§22), so the *guided* journey uses the
// clearly-labelled MOCK portal for every scheme — that's the honest way to let
// users experience the end-to-end flow without faking a government integration.
// `realPortalFor` (below) reports the actual portal so the UI can also link out
// to the official site and state that live automation isn't available yet.
export function resolveJourneyPortal(_scheme) {
  return getAdapter('mock_scholarship');
}

// The real portal a scheme actually belongs to (for honest UI labelling / links).
export function realPortalFor(scheme) {
  if (!scheme) return getAdapter('nsp');
  if (scheme.type === 'student' || scheme.student_type) return getAdapter('nsp');
  if (/kisan|farmer|agri/i.test(scheme.id || '')) return getAdapter('pmkisan');
  return getAdapter('state_scholarship');
}
