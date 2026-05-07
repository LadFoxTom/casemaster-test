# cms-vercel

Run CaseMaster `.cms` applications on Vercel.

This repo is the parallel experiment described in `WHAT.md` and `HOW.md`,
tracked phase-by-phase in `ROADMAP.md`. The existing CaseMaster runtime
in `..\casemaster-runtime\` is **not modified** — both runtimes can read
the same `.cms` files and the same Postgres database concurrently.

## Status

Phases 1–10 landed; see `ROADMAP.md` for granular boxes. Two deployed
routes prove the loop:

- `/page/foo/f/ping`  — Phase 1, returns `ok N` from the live Neon DB.
- `/page/foo/f/hello` — Phase 2 + 8, full HTML page styled via
  `/static/css/app.css`.

```
$ npm install
$ DATABASE_URL=postgresql://… npm test
✓ 13 unit + 1 e2e = 14 tests
```

## Layout

| Path           | What                                                     |
|----------------|----------------------------------------------------------|
| `ROADMAP.md`   | Single source of truth for status (update this)          |
| `WHAT.md`      | Project description, architecture, scope                 |
| `HOW.md`       | Tech stack + design decisions                            |
| `api/`         | Vercel function (catch-all router)                       |
| `src/cms/`     | Lexer, parser, AST, interpreter, BO/SQL, Postgres pool   |
| `app/`         | The `.cms` application — copy from CaseMaster, untouched |
| `tests/`       | Vitest unit + e2e suites                                 |

## Local dev

```bash
cp .env.example .env.local      # set DATABASE_URL
npm install
npm test                        # parser + e2e
npm run dev                     # vercel dev — http://localhost:3000
curl http://localhost:3000/page/foo/f/ping
# → ok 2
```

## Deploy

A push to `main` is the entire deploy. Vercel's Git integration picks up
each commit, runs the build, and updates the production URL. CI in the
repo runs in parallel on the same commit (`.github/workflows/ci.yml` for
GitHub, `bitbucket-pipelines.yml` for Bitbucket) so a failing test is
visible without waiting for Vercel.

| Command            | What                                              |
|--------------------|---------------------------------------------------|
| `npm run dev`      | Vercel dev server (warm-reload on `.cms` edits)   |
| `npm run typecheck`| `tsc --noEmit` — runs in CI on every push         |
| `npm test`         | Vitest unit + (gated) live-DB suite               |
| `npm run deploy`   | One-shot prod deploy (skips git; useful for hotfix) |
| `npm run deploy:preview` | Per-branch preview without merging          |

### Vercel project settings to know

- **Environment variables** — `DATABASE_URL` (Neon) is the only required
  one. Set it in *Settings → Environment Variables* (Production +
  Preview + Development).
- **Deployment protection** — *Settings → Deployment Protection*. Set to
  *Disabled* or *"Only Preview Deployments"* for the production URL to
  be publicly reachable.
- **Cron schedule** — `vercel.json` declares one cron hitting `/page/foo/f/ping`
  daily at 06:00 UTC (Hobby-tier-compatible). Pro/Enterprise plans can
  raise the cadence to `*/4 * * * *` if you want continuous keep-alive.

## What works in Phase 1

- `function … end-function` declarations
- `set('var', expr)` / `[var]` substitution
- `if/else-if/else/end-if`, `iterate iterator.ofEntity(…) end-iterate`
- `eq`, `ne`, `and`, `or`, `not`, `lt`, `gt`, `lte`, `gte`, `sum`, `sub`,
  `mul`, `div`, `mod`, `lng`, `if(cond, then, else)`
- `concat`, `formatString`, `replace`, `startsWith`, `trim`, `chr`
- `_onError`, `isNull`, `isNotNull`
- `iterator.ofEntity(<@iterator/entity name:'…' entity:'qr/labelTemplate'
  where:'…' orderBy:'…'>)` → SELECT against the mapped Postgres table
- `bo.attr([row], 'col')`
- `response.setContentType / write / flush / end / clearContent / redirect`

## What's coming

`ROADMAP.md` Phases 2–12.

## Why this exists

CaseMaster ships a closed-source .NET runtime that needs a long-running
Windows host. Vercel runs ephemeral Linux serverless functions. This
project bridges the two so a CaseMaster app can be pushed to GitHub or
Bitbucket and live-deployed via Vercel's standard CI.
