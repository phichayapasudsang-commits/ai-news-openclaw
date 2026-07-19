# ai-news-agent

Daily AI news digest pipeline. Scrapes sources, dedupes, summarizes via
LLM, and writes articles into Supabase.

Two modes:

- **Local**: `npm run digest` — runs the full pipeline once, writes to
  Supabase. Driven by Windows Task Scheduler on the dev machine
  (MON-FRI 10:00 Asia/Bangkok).
- **Server**: `docker compose up -d` — runs the same digest on a free VM
  (Oracle Cloud Always Free, Hetzner, etc.) on a cron schedule. See
  [`docker/README.md`](docker/README.md) for the deploy guide.

## Quickstart

```bash
cp .env.example .env       # then fill in API keys
npm install
npm run digest             # one full pipeline pass
```

## Scripts

| Command                          | What it does                                    |
|----------------------------------|-------------------------------------------------|
| `npm run digest`                 | Run one full pipeline pass and exit.            |
| `npm run typecheck`              | `tsc --noEmit` — type-check without output.     |
| `npm run build`                  | Compile TS → `dist/` for `node dist/digest.js`. |
| `npm run smoke`                  | Run 28 self-contained JSON-extractor tests.     |
| `npx tsx src/digest.ts`          | Run digest directly from TypeScript.            |

## Docker deployment

```bash
docker compose --profile cron build
docker compose --profile cron up -d
```

See [`docker/README.md`](docker/README.md) for the full guide, env vars,
and troubleshooting.

## Project layout

```
ai-news-agent/
├── src/                  TypeScript source (digest, agents, tools)
├── scripts/              Shell + .bat utilities (Windows cron, helpers)
├── docker/               Dockerfile assets (crontab, entrypoint, README)
├── logs/                 Output (gitignored) — one file per digest run
├── .env                  API keys (gitignored)
├── .env.example          Template
├── Dockerfile            Multi-stage: builder → runtime
├── docker-compose.yml    cron + oneshot profiles
└── package.json
```

## License

Private project — no license granted.
