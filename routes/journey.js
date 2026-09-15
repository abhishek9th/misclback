import express from 'express';
import { requireUser } from '../services/requireUser.js';
import {
  startJourney, getJourney, listJourneys, getEvents,
  provideInput, checkStatus, deleteJourney,
} from '../services/journeyOrchestrator.js';
import { listAdapters } from '../services/portals/index.js';

const router = express.Router();

function fail(res, err, fallback = 'Something went wrong', status = 500) {
  const code = err?.code;
  if (code === 'NOT_FOUND') return res.status(404).json({ error: 'Application not found', code });
  if (code === 'INVALID_INPUT' || code === 'NO_PENDING') return res.status(400).json({ error: err.message, code });
  if (code === 'PORTAL_NOT_SUPPORTED' || code === 'STATUS_NOT_SUPPORTED')
    return res.status(409).json({ error: err.message, code });
  console.error('journey route error:', err?.message);
  return res.status(status).json({ error: fallback, code: code || 'JOURNEY_ERROR' });
}

// Public-ish: the portal catalogue with integration honesty (§22). Requires auth
// so it's scoped to signed-in users, but returns no user data.
router.get('/portals', requireUser, (_req, res) => {
  res.json({ portals: listAdapters() });
});

// Start (or resume) a guided application for a scheme.
// body: { scheme: { id, name, type, student_type? } }
router.post('/start', requireUser, async (req, res) => {
  const scheme = req.body?.scheme;
  if (!scheme || !scheme.id) return res.status(400).json({ error: 'A scheme is required', code: 'INVALID_INPUT' });
  try {
    const result = await startJourney(req.user.id, {
      id: String(scheme.id),
      name: scheme.name || null,
      type: scheme.type || null,
      student_type: scheme.student_type || null,
    });
    res.json(result);
  } catch (err) { fail(res, err, 'Could not start the application'); }
});

router.get('/list', requireUser, async (req, res) => {
  try { res.json({ applications: await listJourneys(req.user.id) }); }
  catch (err) { fail(res, err, 'Could not load your applications'); }
});

router.get('/:id', requireUser, async (req, res) => {
  try {
    const app = await getJourney(req.user.id, req.params.id);
    if (!app) return res.status(404).json({ error: 'Application not found', code: 'NOT_FOUND' });
    res.json({ application: app });
  } catch (err) { fail(res, err, 'Could not load the application'); }
});

router.get('/:id/events', requireUser, async (req, res) => {
  try { res.json({ events: await getEvents(req.user.id, req.params.id) }); }
  catch (err) { fail(res, err, 'Could not load the activity log'); }
});

// Answer the current pending human-input step (OTP / info / consent / document).
// body: { value }  — the raw value is used only to advance; secrets are not stored.
router.post('/:id/input', requireUser, async (req, res) => {
  if (!('value' in (req.body || {}))) return res.status(400).json({ error: 'A value is required', code: 'INVALID_INPUT' });
  try {
    const app = await provideInput(req.user.id, req.params.id, req.body.value);
    res.json({ application: app });
  } catch (err) { fail(res, err, 'Could not continue the application'); }
});

// On-demand status check for a submitted application.
router.post('/:id/check-status', requireUser, async (req, res) => {
  try { res.json(await checkStatus(req.user.id, req.params.id)); }
  catch (err) { fail(res, err, 'Could not check the status'); }
});

router.delete('/:id', requireUser, async (req, res) => {
  try { await deleteJourney(req.user.id, req.params.id); res.json({ ok: true }); }
  catch (err) { fail(res, err, 'Could not remove the application'); }
});

export default router;
