# SchemeSetu Backend

Express + Groq API for the SchemeSetu portal. Provides:

- `POST /api/analyze-user` — chatbot: answers scheme questions and extracts a profile.
- `POST /api/translate` — batch runtime translation for the multilingual UI/content.
- `POST /api/voice/transcribe` — Groq Whisper speech-to-text.
- `GET /` — health check.

## Run locally

```bash
npm install
cp .env.example .env   # then put your real GROQ_API_KEY in .env
npm start              # http://localhost:3001
```

## Deploy on Render

1. Push this repo to GitHub.
2. On Render: **New → Web Service**, connect this repo (it auto-detects `render.yaml`).
3. In **Environment**, add `GROQ_API_KEY` with your real key. Do **not** commit the key.
4. Deploy. Render sets `PORT` automatically.

## Connect the frontend

The frontend calls `/api/*`. Point it at this service's URL, e.g. set the frontend's
API base to `https://<your-service>.onrender.com` (or proxy `/api` there).

Requires a Groq API key with access to `openai/gpt-oss-120b` and `whisper-large-v3-turbo`.
