// ============================================================================
// GovernmentPortalAdapter — the interface every portal integration implements
// (§15). The Application Journey Engine talks ONLY to this interface and never
// to a specific portal, so portals are pluggable.
//
// A concrete adapter describes the journey as an ordered *plan* of steps
// (buildPlan) plus a status-check implementation (getApplicationStatus). The
// engine walks the plan, auto-completing everything it safely can and pausing
// for the user on OTP / CAPTCHA / consent / missing info (§21).
//
// Step shapes the engine understands (see MockPortalAdapter for examples):
//   { type:'AUTO',        state, event, detail }
//   { type:'AUTOFILL',    state, fields:[...profile keys], event, detail }
//   { type:'HUMAN_INPUT', state, field?, input:{ type,title,message,... },
//                         secret?:bool, review?:bool, event, onComplete:{event,detail} }
//   { type:'DOCUMENT',    state, documentType, event }
//   { type:'SUBMIT',      state, event }
//
// integration_mode is authoritative (§22): a NOT_SUPPORTED adapter must NOT
// pretend to register/submit/track — its buildPlan throws NOT_SUPPORTED.
// ============================================================================

export const HUMAN_INPUT_TYPES = Object.freeze([
  'OTP', 'TEXT', 'NUMBER', 'DATE', 'SELECT', 'YES_NO',
  'DOCUMENT', 'CAPTCHA', 'CONSENT', 'PASSWORD',
]);

export class PortalAdapter {
  constructor(meta) {
    this.id = meta.id;
    this.name = meta.name;
    this.authType = meta.authType || 'LOGIN_REQUIRED';
    this.integrationMode = meta.integrationMode || 'NOT_SUPPORTED'; // REAL | MOCK | NOT_SUPPORTED
    this.officialUrl = meta.officialUrl || null;
    this.statusLookup = meta.statusLookup || 'NONE';
  }

  // Whether real automation is available for this portal.
  get supported() {
    return this.integrationMode === 'REAL' || this.integrationMode === 'MOCK';
  }

  // Detect what the portal requires for this user/scheme. Default returns the
  // adapter's declared authType; adapters may override with live detection.
  detectAccountState() {
    return this.authType;
  }

  // Return the ordered step plan for a scheme+user. Must throw for unsupported
  // portals so nothing is ever faked.
  // eslint-disable-next-line no-unused-vars
  buildPlan(_ctx) {
    const err = new Error(`Automation for "${this.name}" is not supported yet`);
    err.code = 'PORTAL_NOT_SUPPORTED';
    throw err;
  }

  // Return the current application status from the portal (§7). Priority order
  // (official API > status endpoint > authenticated automation > manual) is the
  // adapter's responsibility. Must return { status, changed?, detail? } or throw.
  // eslint-disable-next-line no-unused-vars
  async getApplicationStatus(_app) {
    const err = new Error('Status checking is not supported for this portal');
    err.code = 'STATUS_NOT_SUPPORTED';
    throw err;
  }
}
