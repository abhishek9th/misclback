// ============================================================================
// Journey orchestrator — glues the (pure) journey engine to Supabase
// persistence. Loads profile + documents, runs the engine, and writes the
// portal_applications row + non-sensitive audit/status rows using the
// service-role client.
// ============================================================================
import { getSupabaseAdmin } from './supabaseAdmin.js';
import { engine } from './journeyEngine.js';
import { getAdapter, resolveJourneyPortal, realPortalFor } from './portals/index.js';

function db() { return getSupabaseAdmin(); }

async function loadProfile(userId) {
  const { data } = await db().from('profiles').select('*').eq('id', userId).maybeSingle();
  return data || {};
}

// Returns async (documentType) -> a matching user_documents row (verified first) or null.
function documentFinder(userId) {
  return async (documentType) => {
    const { data } = await db()
      .from('user_documents')
      .select('id, file_name, verification_status')
      .eq('user_id', userId)
      .eq('document_type', documentType)
      .order('verification_status', { ascending: true }) // 'verified' < ... alphabetically not ideal; filter below
      .limit(5);
    if (!data || !data.length) return null;
    return data.find((d) => d.verification_status === 'verified') || data[0];
  };
}

// Reconstruct the minimal scheme object the engine needs from a stored row.
function schemeFromRow(row) {
  return { id: row.scheme_id, name: row.scheme_name, type: row.scheme_type };
}

// Shape returned to the client (no secrets; pending_input is already non-secret).
function toClient(row) {
  return {
    id: row.id,
    scheme_id: row.scheme_id,
    scheme_name: row.scheme_name,
    portal_id: row.portal_id,
    integration_mode: row.integration_mode,
    state: row.state,
    form_data: row.form_data,
    pending_input: row.pending_input,
    reference_number: row.reference_number,
    submitted_at: row.submitted_at,
    current_status: row.current_status,
    last_status_check: row.last_status_check,
    next_status_check: row.next_status_check,
  };
}

// Persist a mutated app plus any new audit events / status-history rows.
async function persist(userId, app, events = [], statusHistory = []) {
  const supabase = db();
  const { data: saved, error } = await supabase
    .from('portal_applications')
    .update({
      state: app.state,
      step_index: app.step_index,
      form_data: app.form_data,
      pending_input: app.pending_input,
      reference_number: app.reference_number,
      submitted_at: app.submitted_at,
      current_status: app.current_status,
      last_status_check: app.last_status_check,
      next_status_check: app.next_status_check,
    })
    .eq('id', app.id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;

  if (events.length) {
    await supabase.from('application_events').insert(
      events.map((e) => ({ application_id: app.id, user_id: userId, event: e.event, detail: e.detail }))
    );
  }
  if (statusHistory.length) {
    await supabase.from('application_status_history').insert(
      statusHistory.map((s) => ({
        application_id: app.id, user_id: userId,
        from_status: s.from_status, to_status: s.to_status, source: s.source || 'AUTO',
      }))
    );
  }
  return saved;
}

// Start a new guided journey (or return the existing one for this scheme).
export async function startJourney(userId, scheme) {
  const supabase = db();
  const adapter = resolveJourneyPortal(scheme);

  // Existing journey for this scheme+portal?
  const { data: existing } = await supabase
    .from('portal_applications')
    .select('*')
    .eq('user_id', userId).eq('scheme_id', scheme.id).eq('portal_id', adapter.id)
    .maybeSingle();

  const real = realPortalFor(scheme);
  const meta = { real_portal: real ? { id: real.id, name: real.name, official_url: real.officialUrl, supported: real.supported } : null };

  if (existing) {
    return { application: toClient(existing), meta };
  }

  // Create the row, then run the engine to the first pause.
  const { data: created, error } = await supabase
    .from('portal_applications')
    .insert({
      user_id: userId,
      scheme_id: scheme.id,
      scheme_name: scheme.name || scheme.name_hi || scheme.id,
      scheme_type: scheme.type || (scheme.student_type ? 'student' : null),
      portal_id: adapter.id,
      integration_mode: adapter.integrationMode,
      state: 'DISCOVERED',
      step_index: 0,
      form_data: {},
    })
    .select().single();
  if (error) throw error;

  await supabase.from('application_events').insert({
    application_id: created.id, user_id: userId,
    event: 'APPLICATION_STARTED', detail: `Guided application started (${adapter.name})`,
  });

  const app = { ...created };
  const profile = await loadProfile(userId);
  const res = await engine.walk(app, { scheme, profile, findDocument: documentFinder(userId) });
  const saved = await persist(userId, res.app, res.events, res.statusHistory);
  return { application: toClient(saved), meta };
}

export async function getJourney(userId, applicationId) {
  const { data, error } = await db()
    .from('portal_applications').select('*')
    .eq('id', applicationId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toClient(data);
}

export async function listJourneys(userId) {
  const { data } = await db()
    .from('portal_applications').select('*')
    .eq('user_id', userId).order('updated_at', { ascending: false });
  return (data || []).map(toClient);
}

export async function getEvents(userId, applicationId) {
  const { data } = await db()
    .from('application_events').select('event, detail, created_at')
    .eq('application_id', applicationId).eq('user_id', userId)
    .order('created_at', { ascending: true });
  return data || [];
}

// Provide the value for the currently pending human-input step.
export async function provideInput(userId, applicationId, value) {
  const supabase = db();
  const { data: row, error } = await supabase
    .from('portal_applications').select('*')
    .eq('id', applicationId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) { const e = new Error('Application not found'); e.code = 'NOT_FOUND'; throw e; }

  const scheme = schemeFromRow(row);
  const app = { ...row };
  const res = await engine.applyInput(app, value, {
    scheme, profile: await loadProfile(userId), findDocument: documentFinder(userId),
  });
  const saved = await persist(userId, res.app, res.events, res.statusHistory);
  return toClient(saved);
}

// Run an on-demand status check for a submitted application (§7).
export async function checkStatus(userId, applicationId) {
  const supabase = db();
  const { data: row, error } = await supabase
    .from('portal_applications').select('*')
    .eq('id', applicationId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!row) { const e = new Error('Application not found'); e.code = 'NOT_FOUND'; throw e; }

  const app = { ...row };
  const res = await engine.runStatusCheck(app);
  const saved = await persist(userId, res.app, res.events, res.statusHistory);
  return { application: toClient(saved), changed: res.changed };
}

// Cancel / delete a journey (user-initiated).
export async function deleteJourney(userId, applicationId) {
  await db().from('portal_applications').delete().eq('id', applicationId).eq('user_id', userId);
}

export const _internal = { getAdapter };
