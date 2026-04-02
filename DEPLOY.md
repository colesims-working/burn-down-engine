# Hosting & Deployment

## Architecture

```
Production:  master branch → Vercel (auto-deploy) → burn-down-engine.vercel.app
Preview:     any branch push → Vercel preview URL (auto-generated)
Database:    Turso (libSQL) — single DB for both (your personal data)
```

## Setup

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Link project
```bash
cd burn-down-engine
vercel link
```

### 3. Set environment variables
Go to your Vercel project dashboard → Settings → Environment Variables.

Add these (copy values from `.env.local`):

| Variable | Scope |
|---|---|
| `APP_PASSWORD_HASH` | Production + Preview |
| `SESSION_SECRET` | Production + Preview |
| `TODOIST_API_TOKEN` | Production + Preview |
| `GEMINI_API_KEY` | Production + Preview |
| `ANTHROPIC_API_KEY` | Production + Preview |
| `OPENAI_API_KEY` | Production + Preview |
| `TURSO_DATABASE_URL` | Production + Preview |
| `TURSO_AUTH_TOKEN` | Production + Preview |
| `LANGFUSE_SECRET_KEY` | Production + Preview |
| `LANGFUSE_PUBLIC_KEY` | Production + Preview |
| `LANGFUSE_BASE_URL` | Production + Preview |

### 4. Deploy
```bash
vercel              # Preview deploy (get a unique URL)
vercel --prod       # Production deploy
```

Or just push to `master` — Vercel auto-deploys.

## Workflow

- **Stable version**: Push to `master` → auto-deploys to production URL
- **Dev version**: Push to any other branch → Vercel creates a preview URL
- **Local dev**: `npm run dev` as usual

## Custom Domain (Optional)

In Vercel dashboard → Settings → Domains:
- Add your domain (e.g., `gtd.yourdomain.com`)
- Vercel handles SSL automatically

## Notes

- Both production and preview share the same Turso database (this is fine — it's your personal data)
- Vercel's Edge Functions work with Turso's libSQL client over HTTP
- The iron-session cookies use `secure: true` in production (handled by the existing middleware)
- Voice uploads (Whisper API) work via Vercel's body size limit (configured in next.config.js)
