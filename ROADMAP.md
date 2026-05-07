# Roadmap — CaseMaster on Vercel

The single source of truth for this work. Update statuses here as work
progresses; no other doc tracks completion.

## Vision

A **standard, packaged way** to take any CaseMaster `.cms` application,
push it to GitHub or Bitbucket, and have Vercel build and serve it as
serverless functions — no long-running .NET host, no Windows-only
binaries, no `CaseMaster.Web.exe`. The artefact is an npm package
(`cms-vercel`) plus a scaffold (`npm create cms-vercel`), not a
one-off integration.

## Two tracks

The roadmap has two phases of work. **Track 1 (Phases 1–12)** built the
proof of concept: a working slice that proved the architecture is
feasible — a real `.cms` page renders on Vercel against the same Neon
DB. **Track 2 (Phases 13–22)** is the productisation track: turn the
PoC into a reusable package with adoption tooling so any CaseMaster
project can use it.

Track 1 is closed. Track 2 is the active work.

## Status legend

- `[ ]` todo
- `[~]` in progress
- `[x]` done
- `[-]` cancelled / superseded

---

## Phase 0 — Discovery (done)

- [x] Confirm CaseMaster's runtime model (interpreted .cms, in-process)
- [x] Confirm Vercel's serverless model (ephemeral functions, no resident process)
- [x] Survey alternatives: Vercel-as-frontend / transpile / containerize / rewrite
- [x] Pick "transpile / interpret in JS" as the path to investigate
- [x] Decide on parallel directory (`cms-vercel/`), don't touch existing code

## Phase 1 — Proof of concept: ping on Vercel

The smallest end-to-end slice. Hits Neon, returns text, deploys.

- [x] Project scaffold (`package.json`, `tsconfig.json`, `vercel.json`)
- [x] Hand-rolled `.cms` lexer + parser → AST
- [x] Interpreter for: `function`, `set`, `[var]`, `if/else`, `eq`/`ne`/`and`/`or`/`not`, `concat`, `formatString`, `_onError`, `chr`, `sum`
- [x] `iterate iterator.ofEntity(<@iterator/entity ...>)` → `SELECT … FROM … WHERE … ORDER BY …`
- [x] `bo.attr([row], 'col')` reads a column from a row
- [x] `response.setContentType / write / flush / end`
- [x] Postgres pool (`pg`), shared at module scope
- [x] Vercel catch-all route `api/[...route].ts` resolves URL → `.cms` function and runs it
- [x] Copy `ping` function to `app/page/ping.cms`
- [x] e2e test passes against live Neon (`vitest run` → 6/6)
- [x] Push to GitHub (`LadFoxTom/Casemaster-Vercel`)
- [x] Vercel build succeeds (commit `7d93041`)
- [x] Set `DATABASE_URL` in Vercel env
- [x] Disable Vercel deployment-protection on production
- [x] Live URL returns `ok N` (commit `0e641be` — `/page/foo/f/ping` → `ok 1`)

### Phase 1 lessons (worth carrying into Phase 2)

- Vercel rewrites need explicit path forwarding via a query param —
  `req.url` after a rewrite points at the destination, not the source.
- `[...slug].ts` brackets are a Next.js convention; bare Vercel
  Functions need `api/index.ts` + a rewrite.
- `includeFiles` in `vercel.json` is mandatory for any non-imported
  files (.cms, JSON fixtures, etc.) — they're stripped otherwise.
- TS `module: ESNext` requires `"type": "module"` in package.json or
  Vercel's runtime fails at module load (FUNCTION_INVOCATION_FAILED).
- `import.meta.url` should not be relied on without ESM-mode confirmed.

## Phase 2 — Page rendering + resolveTemplate

Visual pages: list, detail, form. Required to do anything user-visible.

- [x] `<@page/container>`, `<@page/content>`, `<@page/title>`, `<@page/html>`
- [x] `resolveTemplate(\`{{ … }}\`)` substitution with expression evaluator
      inside `{{}}` (re-lexes + parseExpression + evalExpr)
- [x] `protected resource …` definitions and `page.get('./resourceName')`
- [x] `page.render(...)` writes HTML to the response
- [x] Qualifier values inside `{{…}}` render recursively (so `{{[main]}}`
      embeds a page body in a shell)
- [x] Static `<style>` + inline `<script>` survive intact (passed through
      via `<@page/html>` positional)
- [x] First visible page (`hello.cms`) live on Vercel — commit `0624a52`
- [ ] Port one existing visual page (`qrTemplates`) — gated on Phase 3
      (BO `<@bo>` declarations, since templates iterate qr_label_template)
- [ ] Sidebar/navbar shell from the official runtime — gated on Phase 4
      (script.call, since the shell uses cross-file resource composition)

## Phase 3 — BO definitions + table mapping

Model layer. Required for anything beyond hand-coded SQL.

- [x] Parse `<@bo …>` blocks from `bo/**/*.cms`
- [x] Map BO name (`qr/labelTemplate`) → table (`qr_label_template`)
- [x] Attribute → column mapping captured (dataType + foreignKey)
- [x] `attributeGroups.list` captured (used by Phase 12 list pages)
- [-] `foreignKey` resolution — captured, not yet eager-loaded
- [-] Auto-generated maintenance page route — moved to Phase 12

## Phase 4 — Function calls

Cross-file plumbing.

- [x] Same-file `function name(args)` declaration + `return`
- [x] `script.call('./fn', args...)` resolves same-file functions
- [x] `script.call('script/path:fn', args...)` resolves by fn name
- [x] `page.call('./fn', args...)` (same dispatch as script.call for now)
- [x] Argument passing by position
- [x] Function-local variable scope vs request-scoped `set`
- [-] Cross-file path-based dispatch — uses single global registry; later
      phase keys by file when fn-name collisions appear

## Phase 5 — Standard library

Built-in functions used pervasively.

- [x] `json.parse`, `json.json2pb` (identity), `json.pb2json` (`formatted:`)
- [x] `pb.get`, `pb.set`, `iterator.ofPB`, `iterator.ofToken`
- [x] Dates: `today()`, `now()`, `addDay`, `addMonth`, `format(d, 'yyyy-MM-dd HH:mm')`
- [x] Strings: `replace`, `substring`, `startsWith`, `trim`, `lCase`, `uCase`, `chr`, `formatString`, `strLength`
- [x] Numbers: `lng`, `mul`, `div`, `sub`, `sum`, `mod`, `lt`, `gt`, `lte`, `gte`, `toLong`, `random`
- [x] `if(cond, then, else)` accepted as an *expression*

## Phase 6 — POST body, forms, file upload

Mutating routes.

- [x] `request.body()` returns raw POST body
- [x] `request.isPOST()`, `request.isGET()`, `request.isSameOrigin()`
- [x] `qs.getUntrusted(name)` works for both query and form-urlencoded body
- [x] `response.redirect(url)` writes 302 + Location
- [-] Multipart parsing for file uploads — deferred (the existing app
      uses base64-in-form-fields for images, no multipart needed yet)

## Phase 7 — Auth + sessions

The bit you can never skip in production.

- [x] `qualifier.call('session/cookie:authenticate')` stub (returns true)
- [-] Cookie-based session storage — deferred (single-builtin swap)
- [-] Login page + login handler — deferred
- [-] `[//route.trusted]` flag — deferred
- [-] CSRF token machinery — deferred

## Phase 8 — Static assets

CSS, JS, images, fonts.

- [x] `public/` directory served by Vercel's static-asset support
- [x] `/static/:path*` rewrite preserves CaseMaster's URL convention
- [x] `public/css/app.css` shipped; `hello.cms` consumes it via
      `<link rel="stylesheet" href="/static/css/app.css?v=…">`
- [x] Per-page `<style>` blocks still survive (Phase 2 path)
- [-] Bundling bootstrap / font-awesome / cmPre.js — copy verbatim from
      the runtime when needed; no work required from this project

## Phase 9 — Cron / scheduled tasks

The keepalive ping is the smallest example; bigger apps will have more.

- [x] `vercel.json` `crons:` entry hits `/page/foo/f/ping` once daily
      (Hobby-tier compatible: Pro+ can raise to every 4 min)
- [x] Documented in README the plan-vs-cadence trade-off
- [-] `@schedule` annotation parser — defer; the `vercel.json` entry is
      the same source-of-truth Vercel itself reads

## Phase 10 — CLI + deploy workflow

The "git push and it works" part.

- [x] `npm run dev` — Vercel dev server with hot-reload
- [x] `npm run typecheck` — `tsc --noEmit`, runs in CI
- [x] `npm test` — Vitest suite (live-DB skipped without env)
- [x] `npm run deploy` / `deploy:preview` — Vercel CLI passthroughs
- [x] `.github/workflows/ci.yml` — type-check + tests on push/PR
- [x] `bitbucket-pipelines.yml` — same checks for Bitbucket-hosted repos
- [x] `.env.example` documents `DATABASE_URL` + `CMS_APP_DIR`
- [x] README "Deploy" section walks through the env-var, deployment
      protection, and cron-schedule settings on the Vercel dashboard
- [-] Dedicated `cmsv` CLI binary — npm scripts cover it; ship a real
      binary later when migration tooling (Phase 12) demands it

## Phase 11 — Performance

After Phase 1 it works; this makes it fast.

- [x] AST cache: registry built once per warm instance (was already
      true; Phase 11 made it observable)
- [x] `/api?stats=1` reports registry warmth, fn/resource/BO counts,
      and request total ms — distinguishes real slowness from cold start
- [x] `tools/bench.mjs` standalone latency harness (min/p50/p95/max).
      First run on live URL: cold ~1071ms, p50 warm ~289ms.
- [x] Postgres pool sized for Vercel's invocation model (`db.ts`)
- [-] AOT compile to `.ts` — deferred; AST cache covers the hot path
- [-] Edge runtime — deferred; `pg` doesn't run on edge today

## Phase 12 — Migration tooling + parity tests

How a CaseMaster owner brings their app over.

- [x] `tools/import.mjs --from <runtime-dir>` copies bo/, page/,
      script/, qualifier/ trees into `app/`. `--dry-run` prints the
      plan. Tested: 86 .cms / 23 dirs / 863 KB from real Axylog runtime.
- [x] `tests/parity/ping.spec.ts` compares both runtimes when both
      URLs are configured (env-gated)
- [x] `UNSUPPORTED.md` catalogues runtime-faulting, partial, and
      never-going-to features
- [-] Playwright parity suite — deferred until enough pages are ported
      that visual diffs are meaningful

---

# Track 2 — Productisation

Turning the PoC into a reusable package + scaffold so any CaseMaster
project can deploy to Vercel without forking this repo.

## Phase 13 — Package extraction

Make the runtime importable as `cms-vercel` from any project.

- [x] npm workspace at the repo root (`packages/*` + the example app)
- [x] `packages/runtime/` ships the lexer / parser / interpreter /
      renderer / BO registry / Postgres pool
- [x] Public API: `createHandler({ appDir })` returns a Vercel-compatible
      function. Plus typed exports for advanced consumers (`Ctx`,
      `Value`, `loadApp`, `callFunction`)
- [x] The existing live deploy survived the refactor — both URLs and
      the diag/stats probes still respond
- [x] `tools/bench.mjs` and `tools/import.mjs` moved into the package's
      `bin/` directory; declared in `package.json` `bin:` so they're
      available as `npx cms-vercel-bench` / `npx cms-vercel-import`
      once published
- [-] `packages/runtime/dist/` and `npm publish` — gated on Phase 22
      release decision (private scope or public)

## Phase 14 — Scaffold tool

`npm create cms-vercel my-app` is how a new user starts.

- [x] `packages/create-cms-vercel/` — the scaffold runner
- [x] Lays out `package.json`, `vercel.json`, `api/index.ts` (5 lines),
      `app/page/hello.cms`, `public/css/app.css`, `.env.example`,
      `.gitignore`, `README.md`
- [x] CLI substitutes `{{name}}` placeholder in package.json + README
- [x] `--from <runtime-dir>` flag chains into `cms-vercel-import`

## Phase 15 — Build-time validator

Tell the user what *won't* work *before* they deploy.

- [x] `cms-vercel-build` walks every `.cms` and parses
- [x] Reports unknown calls and unknown `<@page/...>` qualifiers with
      `file:line:col`
- [x] Exits non-zero on parse errors; warnings allow build by default
- [x] `--strict` flag promotes warnings to errors
- [-] Auto-include in CI templates — pending Phase 22 release polish

## Phase 16 — Close the writer gap

Read-only is fine for demos; real apps mutate.

- [x] `bo.create`, `bo.setAttr`, `bo.persist`, `bo.delete`
- [x] `sql.execute` (raw SQL)
- [x] `sql.fetch` returns rows as an `Iter`
- [-] Transactions: implicit per-request only; explicit `sql.transaction`
      deferred until a real app needs it

## Phase 17 — Outbound HTTP

The Axylog ingester is the canonical example.

- [x] `httpRequest.create(url, {method, headers, body})` fires + returns handle
- [x] `httpRequest.responseBody(req)` and `responseStatus(req)`
- [x] JSON bodies auto-stringified; arbitrary headers passthrough
- [x] Documented Vercel duration limits (10/60/900s per plan tier)

## Phase 18 — Real auth + sessions

Replaces the Phase 7 stub.

- [x] Postgres-backed `cms_session` table (lazy-created)
- [x] `cmsv_sid` cookie: HttpOnly, SameSite=Lax, 14-day expiry
- [x] `qualifier.call('session/cookie:authenticate')` validates + hydrates
- [x] `session.get(key)` / `session.set(key, value)` builtins
- [x] Session writeback in `createHandler` when `sessionDirty=true`
- [x] `csrfToken` / `csrfMatches` helpers in `session.ts`
- [-] Login page + handler — left to userspace (the package provides primitives)
- [-] `[//route.trusted]` flag — deferred (use opts.loaderHook)

## Phase 19 — More page qualifiers

Real pages need more than `container/content/title/html`.

- [x] `<@page/data/table iterator: …>` from an Iter
- [x] `<@page/form>` + `<@page/form/control>` + `<@page/form/row>` + col
- [x] `<@page/input/{text,number,date,checkbox,select}>`
- [x] `<@page/button/submit>`
- [x] `<@page/sidebar>` + `<@page/sidebar/link>` (with active state) +
      `<@page/sidebar/dropdown>` + dropdown/link
- [x] `<@page/icon name: '…'>` emits font-awesome class
- [x] `<@url address: 'fnName', qs: <id: 1>>` synthesises relative URLs
- [-] Pagination / sorting on tables — defer to Phase 20 (BO maintenance)
- [-] select2 + datepicker integration — defer (CSS-and-JS, not runtime)

## Phase 20 — Auto BO maintenance

`/maintenance/<bo>` becomes the standard CRUD surface.

- [x] List page paginated 50/page; columns from `attributeGroups.list`
      (falls back to all attrs)
- [x] Edit form for an existing row (`?id=`)
- [x] Create form (`/new`)
- [x] Save handler INSERTs or UPDATEs based on presence of `id`
- [x] Delete handler (POST)
- [x] Form fields auto-pick input type from the BO's `dataType`
- [-] Search / sort / multi-column filters — defer until a real app
      needs them; the v1 list keeps the surface area small

## Phase 21 — Parity CI

Catch regressions automatically when the official runtime is the
ground truth.

- [x] `.github/workflows/parity.yml` — `workflow_dispatch`-triggered
      so it runs only when you intentionally compare runtimes
- [x] Stages CaseMaster runtime from a `CASEMASTER_RUNTIME_B64`
      secret (base64 zip), spins up `CaseMaster.Web.exe` on the
      windows-latest runner
- [x] Existing `tests/parity/ping.spec.ts` runs both `CMS_OFFICIAL_URL`
      and `CMS_VERCEL_URL` URL lists, asserts response shape
- [-] Visual / interaction parity (Playwright) — deferred until a
      real app's pages are ported; HTTP-body comparison is the v1 line

## Phase 22 — Docs + 0.1.0 release

Make it adoptable.

- [x] `packages/runtime/README.md` — package-level overview and CLI
- [x] `packages/runtime/API.md` — every builtin with signature + notes
- [x] `packages/runtime/MIGRATION.md` — port-an-existing-app guide
- [x] `examples/README.md` — gallery, with the repo root as the
      canonical "basic" example
- [x] `CHANGELOG.md` — 0.1.0 entry, SemVer policy, every phase linked
- [x] Package metadata: `homepage`, `repository`, `bugs`, `keywords`,
      `prepublishOnly: build`, `files: [dist, bin, src, docs]`
- [x] Version bump 0.0.1 → 0.1.0 across both packages
- [x] `HOWTOLAUNCH.md` — quickstart for the GitHub-clone install path
- [-] `npm publish` — **deliberately deferred** pending CaseMaster
      2.0 vendor (9 Knots) sign-off on whether we can distribute a
      reimplementation of their runtime publicly. Until then we use
      Path A: clone-the-repo distribution. The publish command stays
      one line away (`cd packages/runtime && npm publish`).

---

## Distribution paths (decision tree)

```
Will external developers use this?
├─ no, internal only
│  └─ Path A: GitHub-clone distribution (current)
└─ yes
   ├─ free, open source
   │  └─ Path B: public npm + MIT license
   └─ paid product
      └─ Path C: scoped private npm + proprietary license
```

The runtime is **structurally publish-ready** — Path B/C are one-line
commands away. We're on Path A because the licensing decision needs
9 Knots' input.

---

## Out of scope (intentionally never on this roadmap)

- A visual `.cms` editor — keep using the existing CaseMaster IDE / VS Code layer
- Full BarTender feature parity — that's a different product
- Replacing Postgres with another database — Postgres only
- Windows-only deployment paths — the whole point is Linux serverless
- Real-time / WebSocket support — Vercel's model fights it; out unless explicit need
