# cms-vercel

Run CaseMaster `.cms` applications on Vercel.

```bash
npm create cms-vercel my-app
cd my-app
npm install
cp .env.example .env.local        # set DATABASE_URL
npm run dev                       # http://localhost:3000
```

Then push to GitHub and connect Vercel — every `git push` auto-deploys.

## What it is

A reimplementation of just enough of CaseMaster's `.cms` runtime to
serve real apps on Vercel's serverless platform. The lexer, parser,
interpreter, BO registry, page renderer, and Postgres pool all live in
this package; you provide `.cms` files and `vercel.json`.

## Programmatic use

```ts
// api/index.ts
import { createHandler } from 'cms-vercel';

export default createHandler({
  appDir: process.env.CMS_APP_DIR ?? './app',

  // Optional plugin hook to extend the registry post-load.
  loaderHook(reg) {
    reg.funcs.set('myCustomBuiltin', /* ... */);
  },

  // Optional custom 500 page.
  onError(err, req, res) { res.status(500).send('oops'); },
});
```

## CLI

| Command                  | What                                          |
|--------------------------|-----------------------------------------------|
| `cms-vercel-build`       | Validate every `.cms` (unknown calls + qualifiers) |
| `cms-vercel-import`      | Copy `.cms` from a CaseMaster runtime tree    |
| `cms-vercel-bench`       | Latency benchmark for a URL                   |

## Routes

URLs match the official CaseMaster runtime's:

| URL                                  | What                          |
|--------------------------------------|-------------------------------|
| `/page/<script>/f/<fn>`              | Run a page function           |
| `/maintenance/<bo>`                  | Auto-generated CRUD list page |
| `/maintenance/<bo>/edit?id=<id>`     | Edit form                     |
| `/maintenance/<bo>/new`              | Create form                   |
| `/maintenance/<bo>/save`   (POST)    | Insert / update               |
| `/maintenance/<bo>/delete` (POST)    | Delete                        |
| `/static/<path>`                     | Files from `public/`          |
| `/api?diag=1`                        | Diagnostic JSON               |
| `/api?stats=1`                       | Registry warmth + counts      |

## Documentation

- [`API.md`](./API.md) — every supported builtin, with signatures.
- [`MIGRATION.md`](./MIGRATION.md) — porting a real CaseMaster app.
- [`UNSUPPORTED.md`](../../UNSUPPORTED.md) — what doesn't work yet.
- [`ROADMAP.md`](../../ROADMAP.md) — phase status.

## License

UNLICENSED — internal experiment. Public licensing decision lands with
the 0.1.0 npm publish.
