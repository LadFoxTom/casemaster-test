# Migrating a CaseMaster app to Vercel

Step-by-step for porting an existing CaseMaster runtime layout to a
cms-vercel deployment.

## 1. Scaffold

```bash
npm create cms-vercel my-app -- --from /path/to/casemaster-runtime
cd my-app
npm install
```

The `--from` flag invokes `cms-vercel-import` which copies `bo/`,
`page/`, `script/`, and `qualifier/` from the runtime tree into
`my-app/app/`. Nothing else from the runtime is copied; the `.exe`,
the framework's own `.cms` files, and any local SQLite database are
all left behind.

## 2. Validate

```bash
npx cms-vercel-build --app ./app
```

Reports unknown calls and unknown qualifiers with `file:line:col`.
Anything `unimplemented call: …` will fault at request time, so fix
or feature-flag those before deploying.

Common cases:

| Validator says | What it usually means |
|---|---|
| `unknown call: bo.persist` | Pre-Phase-16 CaseMaster file written before the runtime supported writes — works now. |
| `unknown call: <expr>` | Inline boolean function (`true()` / `false()`) in a BO file — harmless. |
| `unknown qualifier: <@page/data/inlineMaintenance>` | The official runtime ships more `<@page/...>` qualifiers than we render. Move those pages to a different layout, or contribute the renderer. |

## 3. Database

Set `DATABASE_URL` in `.env.local`:

```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

The same string the official runtime's `incPostgres.cms` uses works
unchanged. Both runtimes can read/write the same database
concurrently while you migrate.

If your app uses SQLite (the framework's default), you'll need to
move the schema to Postgres first. The cms-vercel runtime does not
ship a SQLite adapter.

## 4. Authentication

The official runtime has a built-in login page; cms-vercel does not
yet (Phase 18 ships the primitives, the page is left to userspace).

For demo deploys, follow the same pattern Axylog Integration uses —
patch `runtime/script/web/router/page.cms`'s `authenticate` function
to whitelist your app's script names. In cms-vercel that whitelist
moves into the `loaderHook` you pass to `createHandler`.

## 5. Static assets

`public/` is the static-asset root. Anything you reference as
`/static/foo.css` resolves to `public/foo.css` via the `vercel.json`
rewrite. If your app pulls in bootstrap, font-awesome, fullcalendar,
etc., copy those bundles from `runtime/static/lib/` into
`public/lib/` once.

## 6. Deploy

```bash
git init && git add . && git commit -m 'init'
git push -u origin main
```

Then on Vercel: New Project → import the repo → set `DATABASE_URL`
→ disable Deployment Protection → done. Every push to `main`
auto-deploys.

## What won't migrate cleanly

See [`UNSUPPORTED.md`](../../UNSUPPORTED.md) for the full list. Most
common gotchas:

- **Long-running scripts** — Vercel Hobby caps function duration at
  10s. The Axylog ingester routinely runs longer; either upgrade
  to Pro (60s) / Enterprise (900s), or move ingest to an external
  scheduled job that calls the API.
- **WebSocket / SSE** — Vercel functions are request-bound; no
  server-pushed updates.
- **Filesystem writes at request time** — Vercel functions have a
  read-only filesystem outside `/tmp`.

## When to keep using the official runtime

`CaseMaster.Web.exe` is still the better choice when:

- You want the visual `.cms` editor / Monaco / VS Code language layer.
- You need SQLite, MS SQL, Oracle, or any non-Postgres database.
- You need the framework's full BO maintenance UI (datatables,
  inline editing, complex filters) — cms-vercel ships a basic
  alternative; the framework's is richer.

Many teams deploy both: the official runtime for development +
admin dashboards, cms-vercel for public-facing pages and APIs.
