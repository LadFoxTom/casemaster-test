# What we're building

## In one sentence

A self-contained GitHub repository (`LadFoxTom/Casemaster-Vercel`) that
lets any CaseMaster `.cms` application deploy to Vercel as serverless
functions — no long-running .NET host, no Windows-only binaries, no
`CaseMaster.Web.exe`.

## In one minute

CaseMaster ships a closed-source .NET runtime that interprets `.cms`
script files at request time. That binary needs a long-running Windows
host, which excludes Vercel and most modern serverless platforms. This
project re-implements *only* the surface area an app actually depends
on — page routing, BO definitions, iterators, expressions, the standard
library — in TypeScript, packaged as a reusable runtime + scaffold
template. Same `.cms` files, same Postgres, same URLs.

## How a user adopts it (Path A — internal / pre-publish)

```bash
git clone https://github.com/LadFoxTom/Casemaster-Vercel my-app
cd my-app
rm -rf .git                                       # break ties to upstream
git init && git remote add origin <your-repo>    # become your repo
npm install
node packages/runtime/bin/import.mjs --from /path/to/casemaster-runtime
npm run dev                                       # http://localhost:3000
git push -u origin main                           # Vercel auto-deploys
```

The user owns `app/**.cms`, `vercel.json`, `.env`; the runtime lives
inside the cloned tree under `packages/runtime/` and gets upgraded by
`git pull upstream main` (after wiring `upstream` once). When the
project hits npm publish (Path B / Path C — see ROADMAP), the install
flow shrinks to `npm create cms-vercel my-app` and the runtime moves
to `node_modules`.

## Architecture

```
┌──────────────────────┐                ┌──────────────────────┐
│   Existing dev loop  │                │      New target      │
│                      │                │                      │
│  *.cms ─► CaseMaster │                │  *.cms ─► cms-vercel │
│          .Web.exe    │                │           runtime    │
│            │         │                │             │        │
│            ▼         │                │             ▼        │
│       Kestrel :5050  │                │    Vercel Function   │
│            │         │                │             │        │
└────────────┼─────────┘                └─────────────┼────────┘
             │                                        │
             └──────────► Same Neon Postgres ◄────────┘
```

Both paths read the same `.cms` files and the same database, so an app
can be developed locally with the official runtime and deployed via
Vercel without source-code changes (or with a small `.cms` migration if
we use a feature `cms-vercel` doesn't yet support).

## What's in scope

- **Distribution**: an npm package (`cms-vercel`), a scaffold
  (`create-cms-vercel`), and a CLI (`npx cms-vercel <cmd>`) for build,
  validate, import, and bench.
- **Routing**: URLs of the form `/page/<script>/f/<function>` and
  `/maintenance/<bo>` resolve to the matching `.cms` function.
- **Pages**: `<@page/...>` resources render to HTML; `resolveTemplate`
  expands `{{ … }}` expressions.
- **Business Objects**: `<@bo …>` declarations map to Postgres tables;
  `iterator.ofEntity` runs `SELECT`s; `bo.attr` reads columns;
  `bo.persist` / `sql.execute` writes go through a connection pool.
- **Standard library**: the functions used pervasively in real `.cms`
  code (`concat`, `if`, `eq`, `format`, `today`, `addDay`, `replace`,
  `json.parse`, `pb.get`, …).
- **Auth**: real cookie sessions backed by Postgres, login page,
  CSRF tokens.
- **Build & deploy**: `npx cms-vercel build` validates source,
  `vercel deploy` (or git push) ships; CI templates for GitHub
  Actions and Bitbucket Pipelines are included in the scaffold.

## What's out of scope (today)

- The CaseMaster IDE / Monaco editor / VS Code language layer — keep
  using those locally; they don't run on Vercel and don't need to.
- Real-time features (WebSockets, SSE) — Vercel's serverless model is
  a poor fit. Add later via Vercel's edge runtime if a real need shows up.
- Authoring tools to *create* `.cms` files programmatically — the
  artifact layer stays exactly compatible with CaseMaster's.
- Drop-in support for *every* CaseMaster feature on day one — the
  Roadmap is explicit about which subset Phase N covers.

## Compatibility goals

- **Source compatibility, not binary**: a `.cms` file that uses only
  supported features behaves identically on both runtimes. Where it
  doesn't, a build-time validator flags the unsupported call.
- **Database compatibility**: identical SQL emitted; no schema changes
  on switching runtimes; the existing connection-string conventions
  carry over.
- **URL compatibility**: same routes, same query-string conventions, so
  bookmarks and external integrations keep working.

## Non-goals

- Faster than CaseMaster on a long-lived host — we trade per-request
  latency for elastic scale-to-zero. A lukewarm Vercel function is
  ~50–200 ms slower on cold start than a warm `CaseMaster.Web.exe`, and
  that's an acceptable cost for the deployment story.
- A GUI for managing the deployment — `vercel deploy` and the dashboard
  do that. We don't reinvent.
- Replacing CaseMaster's local development experience — the official
  runtime keeps being the best place to author and debug. This project
  takes the *output* of that work and makes it deployable elsewhere.

## Success criteria

- **0.1.0 release**: `npm install cms-vercel` works from a fresh
  Vercel project; `npm create cms-vercel my-app` scaffolds a working
  template; `vercel deploy` produces a live URL.
- **Migration path**: a real CaseMaster app's read-only pages (list,
  detail, search) run on Vercel without source changes after Phase 19.
  The Axylog Integration app is the canonical test case.
- **Time-to-Hello-World**: a new developer who's never seen CaseMaster
  goes from `npm create` to a public Vercel URL in under 15 minutes,
  working only from the package README and the in-package CLI help.
- **Build-time visibility**: `npx cms-vercel build` reports every
  unsupported feature in their app before they deploy, with file:line:col.
