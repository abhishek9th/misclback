import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import userProfileService from './services/userProfileService.js';
import { translateBatch, LANG_NAMES } from './services/translationService.js';
import authRouter from './routes/auth.js';
import journeyRouter from './routes/journey.js';
import credentialsRouter from './routes/credentials.js';
import identityRouter from './routes/identity.js';
import bankAccountsRouter from './routes/bankAccounts.js';
import consentsRouter from './routes/consents.js';
import readinessRouter from './routes/readiness.js';
import partnersRouter from './routes/partners.js';
import catalogueRouter from './routes/catalogue.js';
import eligibilityRouter from './routes/eligibility.js';
import documentsRouter from './routes/documents.js';
import conflictsRouter from './routes/conflicts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // room for base64 live-photo in /api/auth/register
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Authentication: registration OTP (MSG91), user creation (Supabase Auth), login helpers.
app.use('/api/auth', authRouter);

// Guided application journey (state machine, OTP/consent pauses, status tracking).
app.use('/api/journey', journeyRouter);

// Encrypted, opt-in portal credential storage for automatic status tracking.
app.use('/api/credentials', credentialsRouter);

// Encrypted government-ID (Aadhaar/PAN) and bank-account storage, plus the
// consent audit trail — see supabase/migrations/20260915_profile_extension.sql
// and 20260916_sensitive_identity_bank.sql.
app.use('/api/identity', identityRouter);
app.use('/api/bank-accounts', bankAccountsRouter);
app.use('/api/consents', consentsRouter);

// Application Readiness & Document Checker — data-driven requirement engine
// + Groq explanation layer, and the nearby assistance-center directory.
app.use('/api/readiness', readinessRouter);
app.use('/api/partners', partnersRouter);

// Native browse/search over the full ~4,770-scheme myscheme.gov.in catalogue
// (scraped, not AI-generated — see backend/scripts/scrapeSchemeIndex.mjs).
app.use('/api/catalogue', catalogueRouter);

// Proactive eligibility engine — "what can I claim now?" for the signed-in
// user, evaluated deterministically across all curated schemes.
app.use('/api/eligibility', eligibilityRouter);

// Document vault — what the user has, what's missing, and how many schemes
// each missing document would unlock.
app.use('/api/documents', documentsRouter);

// Scheme conflict engine — official-rule-driven mutual-exclusion detection.
app.use('/api/conflicts', conflictsRouter);

// Endpoint to understand natural language or partial profile using Groq
app.post('/api/analyze-user', async (req, res) => {
  try {
    const { query, currentProfile, language } = req.body;
    
    // Validate input
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query is required and must be non-empty' });
    }
    
    if (!process.env.GROQ_API_KEY) {
      console.error('GROQ_API_KEY is not configured in environment variables');
      return res.status(503).json({ error: 'Service configuration error. Please try again later.' });
    }
    
    const profile = await userProfileService.analyzeProfile(query, currentProfile, language);
    res.json(profile);
  } catch (error) {
    console.error('Profile analysis error:', error.message);
    
    // Specific error handling
    if (error.message.includes('API key') || error.message.includes('authentication')) {
      return res.status(503).json({ error: 'Service authentication failed. Please try again.' });
    }
    
    if (error.message.includes('rate_limit')) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    
    if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
      return res.status(504).json({ error: 'Service timeout. Please try again.' });
    }
    
    res.status(500).json({ error: 'Failed to analyze user profile' });
  }
});

// Suggests real government schemes beyond SchemeSetu's own structured catalogue
// (see userProfileService.suggestAdditionalSchemes for the honesty rules —
// Groq never invents a scheme or its numbers, only names real ones it knows).
app.post('/api/schemes/suggest', async (req, res) => {
  try {
    const { criteria, language, alreadyShown } = req.body || {};
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'Service configuration error. Please try again later.' });
    }
    const suggestions = await userProfileService.suggestAdditionalSchemes(
      { ...criteria, already_shown: Array.isArray(alreadyShown) ? alreadyShown : [] },
      language
    );
    res.json({ suggestions });
  } catch (error) {
    console.error('Scheme suggestion error:', error.message);
    if (error.message?.includes('rate_limit')) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    res.status(502).json({ error: 'Could not fetch additional scheme suggestions right now.' });
  }
});

// Batch translation endpoint for on-demand UI + scheme-content localisation.
app.post('/api/translate', async (req, res) => {
  try {
    const { texts, targetLang, sourceLang } = req.body || {};

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: 'texts must be a non-empty array' });
    }
    if (texts.length > 100) {
      return res.status(400).json({ error: 'Too many texts in one request (max 100)' });
    }
    if (!targetLang || !LANG_NAMES[targetLang]) {
      return res.status(400).json({ error: 'A valid targetLang is required' });
    }
    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: 'Service configuration error.' });
    }

    const translations = await translateBatch(texts, targetLang, sourceLang || 'en');
    res.json({ translations });
  } catch (error) {
    console.error('Translation error:', error.message);
    if (error.message && error.message.includes('rate_limit')) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    res.status(502).json({ error: 'Translation unavailable' });
  }
});

// Audio stays in memory only long enough to send it to Groq Whisper.
app.post('/api/voice/transcribe', express.raw({ type: ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg'], limit: '12mb' }), async (req, res) => {
  try {
    if (!req.body?.length) return res.status(400).json({ error: 'No audio received' });
    const groq = new (await import('groq-sdk')).default({ apiKey: process.env.GROQ_API_KEY });
    const extension = req.headers['content-type']?.includes('ogg') ? 'ogg' : 'webm';
    const audioFile = new File([req.body], `schemesetu-recording.${extension}`, { type: req.headers['content-type'] || 'audio/webm' });
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3-turbo',
      response_format: 'json'
    });
    res.json({ text: transcription.text || '' });
  } catch {
    res.status(502).json({ error: 'Voice transcription unavailable' });
  }
});

// --- Serve the built frontend (single-service deployment, e.g. Render) ---
// `npm run build` outputs to ../dist. In production this server hosts both the
// static site and the /api routes on the same origin, so no CORS/proxy config
// is needed. In local dev you use Vite (port 3000) instead and this is a no-op
// when dist/ hasn't been built.
const distDir = path.resolve(__dirname, '../dist');
app.use(express.static(distDir));

// SPA fallback: any non-API GET returns index.html. (Express 5 dropped bare "*"
// route strings, so this is written as middleware.)
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next();
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Secure AI Backend API running on port ${PORT}`);
});
