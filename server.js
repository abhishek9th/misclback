import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import userProfileService from './services/userProfileService.js';
import { translateBatch, LANG_NAMES } from './services/translationService.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Simple health check / landing route.
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'schemesetu-backend', endpoints: ['/api/analyze-user', '/api/translate', '/api/voice/transcribe'] });
});

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`SchemeSetu backend API running on port ${PORT}`);
});
