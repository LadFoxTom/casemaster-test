# {{name}}

A CaseMaster `.cms` application running on Vercel via the
[`cms-vercel`](https://www.npmjs.com/package/cms-vercel) package.

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL
npm run dev                       # http://localhost:3000

curl http://localhost:3000/page/foo/f/hello
```

## Deploy

1. Push this repo to GitHub or Bitbucket.
2. On Vercel: New Project → import the repo.
3. Set `DATABASE_URL` in *Settings → Environment Variables*.
4. *Settings → Deployment Protection* → Disabled (or "Only Preview").
5. Every push to `main` auto-deploys.

## Layout

| Path           | What                                      |
|----------------|-------------------------------------------|
| `app/page/`    | Page handlers (functions + resources)     |
| `app/bo/`      | Business Object declarations              |
| `app/script/`  | Reusable scripts                           |
| `api/index.ts` | The 5-line Vercel function entrypoint     |
| `public/`      | Static assets, served at `/static/*`      |
| `vercel.json`  | Routing + cron + build configuration      |
