# 🔥 The Burn-Down Engine

A daily-driven GTD intelligence layer for Todoist. Turns messy captures into perfectly prioritized, "just execute" action lists — with a persistent AI brain that learns how you work.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up authentication (interactive — prompts for password)
npm run setup

# 3. Fill in API keys in .env.local
# Open .env.local and add your keys for Todoist, Gemini, Anthropic, OpenAI

# 4. Set up the database
# Install Turso CLI: https://docs.turso.tech/cli/installation
turso db create burn-down-engine
turso db show burn-down-engine --url    # → TURSO_DATABASE_URL
turso db tokens create burn-down-engine  # → TURSO_AUTH_TOKEN

# 5. Push database schema
npm run db:push

# 6. Bootstrap your knowledge base (optional but recommended)
cp seed.example.json seed.json
# Edit seed.json with YOUR people, role, preferences, etc.
npm run db:seed

# 7. Run dev server
npm run dev
```

## Architecture

```
Todoist (capture) → Inbox → Clarify → Organize → Engage → Reflect
                              ↕           ↕          ↕         ↕
                          Knowledge Base (learns from everything)
```

**Tech Stack:** Next.js 14 · Turso (SQLite) · Drizzle ORM · Gemini Flash · Claude Opus · Whisper · Tailwind · shadcn/ui

## Pages

| Page | Purpose | LLM Model |
|------|---------|-----------|
| **Inbox** | Unprocessed captures + voice dump | Whisper (voice) |
| **Clarify** | Transform tasks into GTD next actions | Gemini Flash |
| **Organize** | Project health audit + task filing | Claude Opus (audit), Flash (filing) |
| **Engage** | Ranked execution list with fire protocol | Gemini Flash (ranking) |
| **Reflect** | Daily close-out + weekly review | Flash (daily), Opus (weekly) |
| **Knowledge** | Transparent, editable system memory | — |
| **Settings** | API keys, sync, preferences | — |

## Environment Variables

See `.env.example` for all required variables. You need API keys for:

- **Todoist** — task management backbone
- **Google Gemini** — primary LLM (fast + embeddings)
- **Anthropic Claude** — heavy reasoning (audits, reviews)
- **OpenAI** — Whisper voice transcription
- **Turso** — database

## Estimated Costs

~$2/month total. Gemini Flash handles 90% of operations cheaply. Claude Opus only runs for weekly reviews and project audits.

## Development

```bash
npm run dev          # Start dev server
npm run db:push      # Push schema changes
npm run db:seed      # Seed knowledge base from seed.json
npm run db:studio    # Open Drizzle Studio (DB browser)
npm run build        # Production build
```

## Knowledge Base

The AI's effectiveness depends on personal context — who you work with, your priorities, energy patterns, etc. This data lives in the database (never in source code), and is populated three ways:

1. **Seed file** — Copy `seed.example.json` → `seed.json`, add your info, run `npm run db:seed`
2. **Knowledge page** — Add/edit entries directly in the UI
3. **Auto-extraction** — The system learns from every task interaction over time

`seed.json` is gitignored so your personal data stays local.

## License

[MIT](LICENSE)
