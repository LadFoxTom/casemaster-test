# Examples

Working `.cms` apps on cms-vercel. Useful as both reference and as
fixtures the parity suite can run against.

## basic-hello (canonical)

The repo root **is** the canonical example. It contains:

- `app/page/ping.cms`  — DB read + plain-text response.
- `app/page/hello.cms` — full HTML page rendered through the
  `<@page/container>` / `<@page/content>` / `resolveTemplate` path,
  styled via `/static/css/app.css`.
- `app/bo/qr/{labelTemplate,job,code}.cms` — three real BOs that
  populate the registry; `/maintenance/qr/labelTemplate` renders a
  CRUD UI for them with no extra code.

Live URL:

```
https://casemaster-vercel-toms-projects-6d758fc9.vercel.app/page/foo/f/hello
https://casemaster-vercel-toms-projects-6d758fc9.vercel.app/maintenance/qr/labelTemplate
```

## Adding a new example

1. `mkdir examples/<name>`
2. Drop `package.json`, `vercel.json`, `api/index.ts`, `app/`, `public/`.
3. Add an entry here and link the live URL once deployed.

Examples are *not* npm-workspaced — each is its own self-contained
project. The runtime is consumed via `"cms-vercel": "^0.1.0"` from
the published package, exactly the way real users will.
