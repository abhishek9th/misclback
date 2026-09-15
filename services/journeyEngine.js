// ============================================================================
// Application Journey Engine (§14) — a portal-independent state machine that
// walks an adapter's plan, auto-completing everything it safely can and pausing
// for the human on OTP / CAPTCHA / consent / missing info (§21).
//
// SECURITY INVARIANTS
//  * Secret inputs (OTP, PASSWORD, CAPTCHA, CONSENT) are used only to advance and
//    are NEVER written to form_data, the audit log, status history, or console.
//  * form_data holds only non-sensitive values, each tagged with its source (§9).
//  * All persistence is done by the caller's service-role Supabase client.
// ============================================================================
import { resolveFields, SOURCES, fieldMeta } from './fieldMapping.js';
import { getAdapter, resolveJourneyPortal } from './portals/index.js';

const STATUS_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h between automatic checks
const PENDING_TTL_MS = 10 * 60 * 1000;               // human-input request validity

// Portal statuses that are still "in flight" and worth re-checking.
const TRACKABLE = new Set(['SUBMITTED', 'UNDER_REVIEW', 'DOCUMENT_VERIFICATION', 'DOCUMENT_REQUIRED']);
// Map a portal status string onto a persistent journey state.
function stateForStatus(status) {
  switch (status) {
    case 'APPROVED': return 'APPROVED';
    case 'REJECTED': return 'REJECTED';
    case 'DOCUMENT_REQUIRED': return 'DOCUMENT_REQUIRED';
    case 'UNDER_REVIEW':
    case 'DOCUMENT_VERIFICATION': return 'UNDER_REVIEW';
    default: return 'SUBMITTED';
  }
}

// ---- input validation (never guesses / never fabricates, §10) --------------
function validateInput(step, value) {
  const type = step.input?.type;
  switch (type) {
    case 'OTP': {
      const s = String(value ?? '').trim();
      if (!/^\d{4,8}$/.test(s)) return 'Enter the numeric OTP you received.';
      return null;
    }
    case 'CONSENT':
    case 'YES_NO':
      if (value !== true && value !== 'true' && value !== 'yes') return 'Your confirmation is required to continue.';
      return null;
    case 'CAPTCHA':
      if (!String(value ?? '').trim()) return 'Complete the verification to continue.';
      return null;
    case 'NUMBER':
      if (value === '' || value === null || value === undefined || isNaN(Number(value))) return 'Enter a valid number.';
      return null;
    case 'DOCUMENT':
      if (!value) return 'Select or upload the required document.';
      return null;
    case 'PASSWORD':
      if (!String(value ?? '')) return 'Enter your password.';
      return null;
    case 'TEXT':
    default:
      if (!String(value ?? '').trim()) return 'This field is required.';
      return null;
  }
}

function isSecretStep(step) {
  const t = step.input?.type;
  return step.secret === true || t === 'OTP' || t === 'PASSWORD' || t === 'CAPTCHA';
}

// Build the non-sensitive HumanInputRequired payload the frontend renders (§11).
function buildPending(step, app) {
  const meta = step.field ? fieldMeta(step.field) : null;
  return {
    step_index: app.step_index,
    type: step.input.type,
    field: step.field || null,
    label: meta?.label || null,
    label_hi: meta?.label_hi || null,
    title: step.input.title,
    title_hi: step.input.title_hi || null,
    message: step.input.message,
    message_hi: step.input.message_hi || null,
    review: step.review === true,
    // For a review/consent step, include the assembled summary so the user can
    // check everything before authorising submission (§20).
    summary: step.review ? summarise(app) : undefined,
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
    automation_session_id: app.id,
  };
}

// A non-sensitive summary of what will be submitted.
function summarise(app) {
  return Object.entries(app.form_data)
    .filter(([, v]) => v && v.value !== undefined && v.value !== null && v.value !== '')
    .map(([key, v]) => ({ key, label: v.label || key, label_hi: v.label_hi || key, value: v.value, source: v.source }));
}

// ---- the core walk ---------------------------------------------------------
// Mutates `app` in place; returns { app, events, statusHistory } to persist.
// `findDocument(type)` -> a user_documents row or null.
async function walk(app, { scheme, profile, findDocument }) {
  const adapter = getAdapter(app.portal_id) || resolveJourneyPortal(scheme);
  const plan = adapter.buildPlan({ scheme });
  const events = [];
  const statusHistory = [];
  const log = (event, detail) => events.push({ event, detail: detail || null });

  app.pending_input = null;

  while (app.step_index < plan.length) {
    const step = plan[app.step_index];

    if (step.type === 'AUTO') {
      app.state = step.state;
      log(step.event, step.detail);
      app.step_index += 1;
      continue;
    }

    if (step.type === 'AUTOFILL') {
      app.state = step.state;
      const { filled } = resolveFields(step.fields, { profile, formData: app.form_data });
      for (const f of filled) {
        app.form_data[f.key] = { value: f.value, source: f.source, label: f.label, label_hi: f.label_hi };
      }
      log(step.event, step.detail);
      app.step_index += 1;
      continue;
    }

    if (step.type === 'HUMAN_INPUT') {
      // Ask only for what we don't already have (§10, §21).
      if (step.field && app.form_data[step.field]?.value) {
        app.step_index += 1;
        continue;
      }
      app.state = step.state;
      app.pending_input = buildPending(step, app);
      log(step.event, step.review ? 'Application ready for review' : `Requested: ${step.input.type}`);
      return { app, events, statusHistory, paused: true };
    }

    if (step.type === 'DOCUMENT') {
      const meta = fieldMeta('doc_' + step.documentType);
      const doc = await findDocument(step.documentType);
      if (doc) {
        app.state = 'DOCUMENT_UPLOADING';
        app.form_data['doc_' + step.documentType] = {
          value: doc.file_name || step.documentType,
          source: SOURCES.DOCUMENT,
          documentId: doc.id,
          label: `Document: ${step.documentType}`,
          label_hi: `दस्तावेज़: ${step.documentType}`,
        };
        log(step.event, `Attached document: ${step.documentType}`);
        app.step_index += 1;
        continue;
      }
      // None on file — pause and ask the user to select/upload (§13).
      app.state = step.state;
      app.pending_input = {
        step_index: app.step_index,
        type: 'DOCUMENT',
        documentType: step.documentType,
        title: 'Document required',
        title_hi: 'दस्तावेज़ आवश्यक',
        message: `Attach your ${step.documentType.replace(/_/g, ' ')} to continue.`,
        message_hi: 'आगे बढ़ने के लिए आवश्यक दस्तावेज़ संलग्न करें।',
        expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
        automation_session_id: app.id,
      };
      log('DOCUMENT_REQUESTED', `Requested document: ${step.documentType}`);
      return { app, events, statusHistory, paused: true };
    }

    if (step.type === 'SUBMIT') {
      app.state = 'SUBMITTING';
      log('SUBMITTING', 'Submitting application to portal');
      const ref = adapter.makeReference ? adapter.makeReference() : `REF-${Date.now()}`;
      const now = new Date();
      app.reference_number = ref;
      app.submitted_at = now.toISOString();
      app.state = 'SUBMITTED';
      app.current_status = 'SUBMITTED';
      app.last_status_check = now.toISOString();
      app.next_status_check = new Date(now.getTime() + STATUS_CHECK_INTERVAL_MS).toISOString();
      log(step.event, `Application submitted. Reference: ${ref}`);
      statusHistory.push({ from_status: null, to_status: 'SUBMITTED', source: 'AUTO' });
      app.step_index += 1;
      continue;
    }

    // Unknown step type — fail safe.
    app.state = 'FAILED';
    log('FAILED', 'Unrecognised automation step');
    return { app, events, statusHistory, paused: true };
  }

  return { app, events, statusHistory, paused: false }; // reached terminal (SUBMITTED)
}

// Apply a user-provided value to the currently-pending step, then continue.
// Returns the same shape as walk(). Throws { code:'INVALID_INPUT', message } on
// validation failure or if there is nothing pending.
async function applyInput(app, value, ctx) {
  const adapter = getAdapter(app.portal_id) || resolveJourneyPortal(ctx.scheme);
  const plan = adapter.buildPlan({ scheme: ctx.scheme });
  const step = plan[app.step_index];

  if (!app.pending_input || !step) {
    const err = new Error('There is no pending step to answer.');
    err.code = 'NO_PENDING';
    throw err;
  }

  if (step.type === 'DOCUMENT') {
    if (!value) { const e = new Error('Select or upload the required document.'); e.code = 'INVALID_INPUT'; throw e; }
    // `value` is a documentId from the user's vault (non-secret) or 'uploaded'.
    app.form_data['doc_' + step.documentType] = {
      value: 'attached', source: SOURCES.DOCUMENT,
      documentId: typeof value === 'string' ? value : null,
      label: `Document: ${step.documentType}`, label_hi: `दस्तावेज़: ${step.documentType}`,
    };
    app.step_index += 1;
    const res = await walk(app, ctx);
    res.events.unshift({ event: 'DOCUMENT_ATTACHED', detail: `Attached document: ${step.documentType}` });
    return res;
  }

  const problem = validateInput(step, value);
  if (problem) { const e = new Error(problem); e.code = 'INVALID_INPUT'; throw e; }

  const secret = isSecretStep(step);
  // Persist ONLY non-secret field values (§18). OTP/password/captcha/consent are
  // used purely to advance and are dropped here — never stored or logged.
  if (!secret && step.field) {
    app.form_data[step.field] = {
      value: String(value).trim(),
      source: SOURCES.USER_INPUT,
      label: fieldMeta(step.field).label,
      label_hi: fieldMeta(step.field).label_hi,
    };
  }

  const leadingEvents = [];
  if (step.onComplete) leadingEvents.push({ event: step.onComplete.event, detail: step.onComplete.detail });

  app.step_index += 1;
  const res = await walk(app, ctx);
  res.events = [...leadingEvents, ...res.events];
  return res;
}

// ---- automatic status checking (§7) ---------------------------------------
async function runStatusCheck(app) {
  const adapter = getAdapter(app.portal_id);
  if (!adapter || !adapter.supported) {
    const e = new Error('Status checking is not supported for this portal.');
    e.code = 'STATUS_NOT_SUPPORTED';
    throw e;
  }
  if (!TRACKABLE.has(app.current_status)) {
    return { app, events: [], statusHistory: [], changed: false };
  }
  const now = new Date();
  const result = await adapter.getApplicationStatus(app);
  app.last_status_check = now.toISOString();
  app.next_status_check = new Date(now.getTime() + STATUS_CHECK_INTERVAL_MS).toISOString();

  if (!result.changed) return { app, events: [], statusHistory: [], changed: false };

  const from = app.current_status;
  app.current_status = result.status;
  app.state = stateForStatus(result.status);
  return {
    app,
    changed: true,
    events: [{ event: 'STATUS_CHANGED', detail: `Status changed: ${from} → ${result.status}` }],
    statusHistory: [{ from_status: from, to_status: result.status, source: 'AUTO' }],
  };
}

export const engine = {
  STATUS_CHECK_INTERVAL_MS,
  TRACKABLE,
  walk,
  applyInput,
  runStatusCheck,
  summarise,
};
