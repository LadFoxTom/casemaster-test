# How to launch a CaseMaster app on Vercel

Step-by-step guide for shipping a CaseMaster `.cms` application as
serverless functions on Vercel. Aimed at developers who already have
some CaseMaster source they want to deploy — or who are starting from
scratch and want a Vercel-native CaseMaster project.

## Prerequisites

| Tool         | Why you need it                              | Check                  |
|--------------|----------------------------------------------|------------------------|
| **Node 20+** | Runtime requires native ESM + `import.meta`. | `node --version`       |
| **Git**      | The project is distributed via a clone.      | `git --version`        |
| **Postgres** | The runtime stores all state in Postgres.    | A connection string    |
| **Vercel account** | Production hosting.                    | Free Hobby tier works  |
| **GitHub or Bitbucket** | For Vercel's auto-deploy on push. | Any repo will do       |

A managed Postgres works fine — the runtime is tested against
[Neon](https://neon.tech)'s free tier. Self-hosted is also fine; the
only requirement is that the database is reachable from Vercel's
function regions.

## 1. Scaffold the project

```bash
git clone https://github.com/LadFoxTom/Casemaster-Vercel my-cms-app
cd my-cms-app
```

Detach from upstream so this becomes *your* repo:

**macOS / Linux / Git Bash:**
```bash
rm -rf .git && git init
```

**Windows PowerShell:**
```powershell
Remove-Item -Recurse -Force .git ; git init
```

Then:
```bash
npm install
```

`npm install` triggers a `postinstall` hook that runs `tsc -p packages/runtime`
to build the runtime's compiled JS into `packages/runtime/dist/`. If you
ever skip this build (rare), the `cms-vercel-build` validator will tell
you what to do.

This gives you a working cms-vercel project. The runtime lives under
`packages/runtime/`; everything you'll edit lives under `app/`,
`public/`, and the project's root config files.

## 2. Configure the database

```bash
cp .env.example .env.local
```

Open `.env.local` and set `DATABASE_URL`:

```
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
```

This is the same connection-string format the official CaseMaster
runtime uses. Both runtimes can read and write the same database
concurrently while you migrate.

## 3. (Optional) Import an existing CaseMaster runtime

If you already have a CaseMaster app you want to bring over, point the
import tool at its runtime directory. **Replace the example path** with
your actual location:

```bash
# Linux / macOS / Git Bash
node packages/runtime/bin/import.mjs --from ~/work/my-casemaster-runtime

# Windows PowerShell
node packages/runtime/bin/import.mjs --from C:\work\my-casemaster-runtime
```

Add `--dry-run` first to see what would be copied without writing
anything:

```bash
node packages/runtime/bin/import.mjs --from C:\work\my-casemaster-runtime --dry-run
```

This copies `bo/`, `page/`, `script/`, and `qualifier/` from the
runtime tree into `app/`. It does not copy the framework's own files
(only the project-specific ones), and it does not copy any database.

## 4. Run locally

```bash
npx vercel dev
```

> **Why `npx vercel dev` and not `npm run dev`?**
> Vercel CLI v50+ inspects `package.json`'s `dev` script for the
> "Development Command." If that script is itself `vercel dev`, you get
> infinite recursion: `Error: vercel dev must not recursively invoke
> itself`. The repo intentionally has **no** `dev` npm script for this
> reason — invoke the Vercel CLI directly.

Vercel's local emulator starts on `http://localhost:3000`. Same
routing, same `.cms` files, same DB connection — only the binding
differs from production. Edit `.cms` files and refresh; changes pick
up on the next request.

The first time you run it, `vercel` may ask you to log in and link the
project. You can skip both prompts (press <kbd>n</kbd>) for purely
local dev — the link is only needed when deploying or pulling envs
from a remote Vercel project.

The default scaffold serves these routes out of the box:

| URL                          | What                                   |
|------------------------------|----------------------------------------|
| `/`                          | Landing page (edit `public/index.html`)|
| `/page/foo/f/hello`          | Demo page (edit `app/page/hello.cms`)  |
| `/page/foo/f/ping`           | DB connectivity check                  |
| `/api?diag=1`                | Registry health, app dir, env vars     |
| `/api?stats=1`               | Function/resource/BO counts            |

If you've imported an existing CaseMaster app, your URLs follow the
same `/page/<script>/f/<function>` and `/maintenance/<bo>` patterns
the official runtime uses.

## 5. Validate before deploying

```bash
node packages/runtime/bin/build.mjs --app ./app
```

The validator walks every `.cms` file and reports:

- **Errors**: parse failures (file:line:col) — fix before deploying.
- **Warnings**: calls or qualifiers the runtime doesn't yet implement.
  These won't block the build; the page using them will fault at
  request time.

Add `--strict` to promote warnings to errors when wiring CI.

## 6. Push to GitHub or Bitbucket

```bash
git add .
git commit -m "init my CaseMaster app"
git remote add origin git@github.com:<you>/<your-repo>.git
git push -u origin main
```

## 7. Connect Vercel

1. **vercel.com → Add New → Project → Import** the repo.
2. **Settings → Environment Variables → Add new**
   - Key: `DATABASE_URL`
   - Value: your Postgres connection string
   - Environments: ✓ Production ✓ Preview ✓ Development
3. **Settings → Deployment Protection** → set to **Disabled** (or
   "Only Preview Deployments" if you want previews behind auth).
   Without this step, every URL returns `401 Authentication Required`.
4. **Deployments → Redeploy** to apply the env var.

After the first deploy:

- `https://<your-project>-<your-team>.vercel.app` is your production URL.
- `https://<your-project>-git-<branch>-<your-team>.vercel.app` is the
  per-branch preview URL.
- Every `git push origin main` auto-deploys.

## Project layout

| Path                          | Description                                   | You edit it? |
|-------------------------------|-----------------------------------------------|:------------:|
| `app/page/*.cms`              | Page handlers (your URLs)                     | ✓            |
| `app/bo/**/*.cms`             | Business Object declarations (DB tables)      | ✓            |
| `app/script/**/*.cms`         | Reusable scripts                              | ✓            |
| `api/index.ts`                | 5-line Vercel-Function entrypoint             | rarely       |
| `public/`                     | Static assets, served at `/static/*`          | ✓            |
| `vercel.json`                 | Routing, cron, build configuration            | rarely       |
| `package.json`                | npm metadata + scripts                        | ✓            |
| `packages/runtime/`           | The interpreter — leave alone unless upgrading the runtime | × |
| `private-app/` (if present)   | Project-specific source kept out of the public deploy | ✓ |

The contract is simple: you own `app/`, `public/`, `vercel.json`, and
`package.json`. Everything under `packages/runtime/` is "the
framework" — touch it only when you intentionally want to upgrade or
extend it.

## Updating the runtime

When the upstream runtime adds new builtins or qualifiers:

```bash
git remote add upstream https://github.com/LadFoxTom/Casemaster-Vercel.git
git fetch upstream
git merge upstream/main
npm install
git push
```

You should rarely see conflicts because the only files you own
(`app/`, `public/`, `vercel.json`, `.env.local`, `package.json`) are
disjoint from the runtime's. Vercel rebuilds, you're on the new
runtime.

## Common issues

| Symptom                                    | Fix                                           |
|--------------------------------------------|-----------------------------------------------|
| `401 Authentication Required` from Vercel  | Disable Deployment Protection (Settings → Deployment Protection). |
| `500 FUNCTION_INVOCATION_FAILED`           | Hit `/api?diag=1` for the underlying error. Usually `DATABASE_URL` not set or app dir not found. |
| `unimplemented call: bo.X`                 | Run `cms-vercel-build` to find every unsupported builtin in your app. See `UNSUPPORTED.md`. |
| Page is blank with `<!-- TODO render: <@page/...> -->` | The renderer doesn't yet handle that qualifier. Either skip the page or add a renderer in `packages/runtime/src/render.ts`. |
| `Failed to connect to … 5432`              | Postgres compute is suspended (Neon free tier). Wait ~10 seconds and retry, or run a keepalive cron. |
| `npm install` fails                        | Verify `node --version` is 20 or higher. Older Node doesn't support all the `import.meta` features the runtime relies on. |
| `vercel dev` says **"must not recursively invoke itself"** | You ran `npm run dev` which calls `vercel dev`, which sees `dev` script and calls itself. Run `npx vercel dev` directly — the repo has no `dev` script for exactly this reason. |
| `Cannot find module '…/packages/runtime/dist/index.js'` from `cms-vercel-build` or anything importing `cms-vercel` | The runtime hasn't been compiled. Run `npm run build`. Normally `npm install` runs this automatically via `postinstall`; if it didn't, your install probably had `--ignore-scripts`. |
| `rm: cannot remove '.git'` or `Remove-Item: A parameter cannot be found that matches parameter name 'rf'` | You're in PowerShell. Use `Remove-Item -Recurse -Force .git` instead of `rm -rf .git`. |
| Imported a CaseMaster runtime path that doesn't exist (`Error: ENOENT … scandir 'C:\path\to\…'`) | Replace the example placeholder with the **actual path** to your CaseMaster runtime, e.g. `C:\work\my-runtime` not `C:\path\to\casemaster-runtime`. |

## Going further

- **`UNSUPPORTED.md`** — what doesn't work yet. The validator
  (`cms-vercel-build`) reports all of these in your specific app.
- **`packages/runtime/API.md`** — every supported builtin, with
  signatures and notes.
- **`packages/runtime/MIGRATION.md`** — porting a real CaseMaster
  app to Vercel.
- **`ROADMAP.md`** — what's planned next, what's deferred.
