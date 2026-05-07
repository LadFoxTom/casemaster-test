# Unsupported features

Living list of CaseMaster features that the cms-vercel runtime doesn't
implement (yet). The compiler/interpreter doesn't validate against this
list — a `.cms` file using one of these features will either fault at
runtime with `unimplemented call: <name>` or silently no-op. Phase 12+
adds a build-time validator.

Update this file whenever you add or remove a builtin. Group by phase
so it's clear which deferred work would unblock which.

## Currently runtime-faulting

These will throw `unimplemented call: …` at request time:

- `bo.persist`, `bo.create`, `bo.delete`, `bo.setAttr` — write-side BO
  ops. Read-side (`bo.attr`, `iterator.ofEntity`) works.
- `qs.getTrusted` — only the untrusted form is wired.
- `httpRequest.create` / `.responseBody` — outbound HTTP is unimplemented;
  the existing axylog ingester won't run on Vercel until this lands.
- `sql.execute` — write-only SQL (no rows returned). Add when needed.
- `request.headers.get(name)` style accessors — we only expose
  `request.body / isPOST / isGET / isSameOrigin / url`.
- Anything inside `<@page/...>` qualifier we haven't added a renderer
  for. See `src/cms/render.ts` — unknown tags emit
  `<!-- TODO render: <@…> -->`. Currently rendered: container, content,
  title, html.

## Silently no-op or partial

These parse and don't throw, but behave differently from the official
runtime:

- `qualifier.call('session/cookie:authenticate')` — Phase 7 stub returns
  true. Cookie-based session storage isn't implemented.
- `request.isSameOrigin()` — uses the Referer header, doesn't match the
  framework's stricter same-site check.
- `qs.isTrusted()` — always returns false (no CSRF token machinery).
- `_pb` PB literals — parsed but treated as opaque values; mutating PBs
  via `pb.set` works for plain JS objects only.
- `<@bo>` `foreignKey` — captured in the registry but not eager-loaded
  by the iterator (no JOIN'ing across BOs).

## Multipart / file uploads

`request.body()` returns the raw POST body. Form-urlencoded is parsed
into the query map. Multipart isn't parsed yet — file uploads should
go through a base64 hidden field for now (the existing QR-label
designer does this).

## Static assets

`/static/:path*` is rewritten to `/:path*` in vercel.json so URL
conventions match. The runtime's `runtime/static/` directory is *not*
auto-copied — drop the bits you need (bootstrap, font-awesome, …) into
`public/lib/...` manually.

## Cron limits

Vercel Hobby allows daily cron entries only. Pro raises the cadence to
`*/4 * * * *`. The single cron in `vercel.json` is set to daily so the
default account works.

## Why a feature might be here forever

Some CaseMaster features don't translate to Vercel's serverless model
and won't be implemented:

- WebSocket / Server-Sent Events — Vercel functions are request-bound.
- Filesystem writes at request time (`fileSystem.writeFile`) — Vercel
  functions have a read-only filesystem.
- The CaseMaster IDE / Monaco / VS Code language layer — that's a
  developer tool, not a runtime feature.
