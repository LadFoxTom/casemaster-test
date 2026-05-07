# How we build it

The technical companion to `WHAT.md`. Decisions and conventions; not
status. Update only when an architectural choice changes.

## Tech stack

- **Runtime**: Node.js 20 (Vercel default). No React, no Next.js — we
  serve everything through Vercel's bare HTTP function signature so the
  generated HTML is identical to CaseMaster's output.
- **Language**: TypeScript, `strict: true`. Compiled with `tsc`; no
  bundler at runtime (Vercel handles esbuild itself).
- **Database**: `pg` (`node-postgres`). Connection pool sized per
  Vercel's invocation model; one pool per Node process, lazily warmed.
- **Tests**: `vitest` for unit tests (parser + interpreter); `playwright`
  for end-to-end parity tests against a running CaseMaster instance.
- **Format**: `prettier` defaults; `eslint` only on `src/cms/**`.

## Module layout

This repo is an **npm workspace** with two halves: a publishable
**runtime package** and an **example app** that depends on it. The
example also serves as the live deploy on Vercel and as the canonical
parity-test fixture.

```
cms-vercel/                              (monorepo root, npm workspace)
├── ROADMAP.md                           (single source of truth for status)
├── WHAT.md / HOW.md / UNSUPPORTED.md
├── package.json                         (workspaces: ["packages/*"])
├── packages/
│   ├── runtime/                         (the publishable npm package)
│   │   ├── package.json                 (name: cms-vercel, exports, bin)
│   │   ├── src/
│   │   │   ├── lex.ts                   (tokenizer)
│   │   │   ├── parse.ts                 (Pratt parser → AST)
│   │   │   ├── ast.ts                   (AST types)
│   │   │   ├── eval.ts                  (tree-walking interpreter)
│   │   │   ├── bo.ts                    (BO registry + iterator → SQL)
│   │   │   ├── db.ts                    (Postgres pool)
│   │   │   ├── render.ts                (page resource → HTML)
│   │   │   ├── handler.ts               (createHandler() — public API)
│   │   │   └── index.ts                 (re-exports for consumers)
│   │   ├── bin/
│   │   │   ├── cms-vercel.ts            (CLI entry: build / import / bench)
│   │   │   ├── build.ts                 (Phase 15 validator)
│   │   │   ├── import.ts                (Phase 12/14 source importer)
│   │   │   └── bench.ts                 (Phase 11 latency bench)
│   │   └── dist/                        (built output for npm publish)
│   └── create-cms-vercel/               (Phase 14 scaffold runner)
│       └── ...
├── api/index.ts                         (5 lines — uses createHandler)
├── app/                                 (this example's .cms files)
├── public/                              (this example's static assets)
├── vercel.json
└── tests/                               (parser + e2e + parity)
```

The package's public API:

```ts
// packages/runtime/src/handler.ts
import { createHandler } from 'cms-vercel';

export default createHandler({
  appDir: process.env.CMS_APP_DIR ?? './app',
  // optional knobs:
  //   onError(err, ctx)      → custom 500 page
  //   bufferingMode          → 'streaming' | 'buffered'  (default 'buffered')
  //   loaderHook(reg)        → mutate registry post-load (Phase 19+ qualifiers)
});
```

That ~5 lines lives in any consumer's `api/index.ts`. Everything else
they own is content (.cms, vercel.json).

## Distribution model (current — Path A)

We **don't publish to npm yet** (see ROADMAP for the rationale —
licensing decision pending CaseMaster vendor sign-off). Instead, the
runtime ships as part of the repo itself. Adopters either:

1. **Clone the whole repo** and edit `app/` to be their CaseMaster
   project. This is the path described in `WHAT.md` and `HOWTOLAUNCH.md`.
2. **Fork it** and pull updates from `upstream/main` whenever the
   runtime gets new features.

When/if we publish to npm (Path B), the package extraction work in
Phase 13 means the layout is already correct — `packages/runtime/`
becomes the npm artefact, the example app at the repo root becomes
the canonical example. No code reorganisation needed.

## Parser strategy

A hand-rolled lexer + Pratt parser. PEG generators (`peggy`,
`nearley`) make it tempting to skip writing a lexer, but `.cms` has
unusual lexemes (backticked multi-line strings that contain JS,
`<@qualifier …>` blocks, `[var]` substitutions) that hurt
generator-friendliness. Hand-rolled keeps debugging trivial.

- **Lex output**: a flat token stream — `IDENT`, `NUM`, `STR`,
  `TBSTR` (backticked template), `LBRACK`/`RBRACK`, `LANG`/`RANG` (for
  `<@…>`), `KW_FUNCTION`, `KW_END_FUNCTION`, etc.
- **Parse output**: an AST where each `function` is a top-level node
  containing a `Block` of statements. Statements: `Set`, `If`,
  `Iterate`, `Return`, `Raise`, `ExprStmt`. Expressions: `Call`,
  `Var`, `Lit`, `Concat`, `If` (the function form), `Qualifier`.
- **Resources** (`resource name <@page/... >`) parse as a single
  expression assigned to `name`, evaluated at render time.

## Interpreter design

- **Scope**: one request-scoped variable map (used by `set` / `[var]`).
  Function calls open a fresh map; arguments are bound by position;
  `set` inside a function does not leak out.
- **Evaluation**: tree-walking. No JIT. Performance work goes into
  *parser caching* (Phase 11), not interpreter cleverness.
- **Errors**: every error carries `(file, line, column)`. Surfaced to
  the response body in dev as a CaseMaster-styled error block; in
  production they go through Vercel logs and a generic 500 page.

## BO → SQL

`<@bo>` declarations register at module load: name → table, attribute
list, FK targets. `iterator.ofEntity({entity: 'qr/labelTemplate',
where: 'id=1', orderBy: 'id'})` translates to
`SELECT id, name, … FROM qr_label_template WHERE id=1 ORDER BY id ASC`
with the WHERE clause compiled from the BO's mini-language (`&` →
`AND`, `=` → `=`, `>=` → `>=`, etc.). Values that look like `[var]`
are substituted before the where-clause compile pass.

`bo.attr(row, 'name')` is a column lookup on the row object emitted by
the iterator — same shape `pg` already returns.

`bo.persist`, `bo.create`, etc. are scheduled for Phase 5 once enough
read paths work to justify them.

## Page rendering

`<@page/container>` and friends are *constructors*: they return a
typed AST node that `render.ts` turns into HTML at the end of the
request. The render is intentionally pure — given the same inputs,
same output bytes — so Phase 12's parity tests can byte-compare.

`resolveTemplate(\`...{{ expr }}...\`)` runs each `{{…}}` through the
expression evaluator with the current scope, then concatenates the
parts. Template literals are *not* re-evaluated after substitution
(unlike `{{[var]}}` which CaseMaster does single-pass — we match).

## Routing

Vercel routes everything to `api/[...route].ts`. That file does:

1. Take `/page/<script>/f/<fn>` → look up `app/page/<script>.cms` →
   call function `<fn>`.
2. Take `/maintenance/<bo>` → call the auto-generated maintenance
   function for `<bo>`.
3. Anything else → 404.

URL conventions match CaseMaster's exactly so links render under both
runtimes without rewriting.

## Local dev

```bash
git clone …
npm install
cp .env.example .env       # fill DATABASE_URL
npx cmsv dev               # http://localhost:3000
```

`cmsv dev` runs Vercel's local emulator (`vercel dev`) under the hood,
plus a file-watcher that invalidates the parser cache when `.cms`
files change.

## Deploy workflow (the goal)

```bash
git push origin main
# GitHub Actions / Bitbucket Pipelines:
#   1. npm ci
#   2. cmsv build         (sanity-parse all .cms; fail on syntax errors)
#   3. vercel --prod --token $VERCEL_TOKEN
```

`vercel.json` declares the catch-all route and any cron jobs derived
from `@schedule`-annotated functions. No further runtime config needed
— the secrets (`DATABASE_URL`, etc.) live in Vercel's environment
variables panel.

## Testing strategy

- **Unit**: parse a representative library of `.cms` snippets; assert
  AST shapes and round-trip via the interpreter on stub inputs.
- **Integration**: spin up Postgres (the same Neon DB), run the small
  apps in `tests/fixtures/*`, hit them via `vercel dev`, snapshot HTTP
  responses.
- **Parity**: keep `CaseMaster.Web.exe` running on `localhost:5050`,
  point a Playwright runner at both URLs in turn, byte-compare bodies
  modulo timestamps and CSRF tokens.

## Conventions

- **Errors** thrown inside `eval.ts` always wrap the underlying error
  with `{file, line, col}`; never raise a bare `Error`.
- **Builtins** in `builtins.ts` are pure where possible. Effects
  (database, response) live in dedicated modules so the interpreter
  itself stays mockable.
- **One BO per file**, mirroring CaseMaster's convention.
- **Generated files** never go in `app/` — they live under `.cmsv/`
  and are gitignored.
- **Snake-case in SQL, camelCase in TypeScript, kebab-case in URLs.**
