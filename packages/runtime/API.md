# API reference

Every builtin the runtime currently dispatches. Anything not on this
page either doesn't work yet (see [UNSUPPORTED.md](../../UNSUPPORTED.md))
or hasn't been documented (please open an issue).

The signatures are CaseMaster `.cms` syntax. Types are CaseMaster's
mental model; the implementation is JavaScript-typed but the dispatcher
coerces at the boundary.

## Core control flow

| Call | Returns | Notes |
|---|---|---|
| `set('name', expr)` | nothing | request-scoped variable; visible via `[name]` |
| `if(cond, then, else)` | one of `then`/`else` | works as both statement and expression |
| `_onError(expr, fallback)` | `expr` if defined, else `fallback` | replaces try/catch in source |
| `isNull(v)` / `isNotNull(v)` | bool | true for `null` and the undefined sentinel |
| `not(v)` / `and(a,b,…)` / `or(a,b,…)` | bool | short-circuits |

## Comparison & arithmetic

`eq`, `ne`, `lt`, `gt`, `lte`, `gte`, `sum(a,b,…)`, `sub`, `mul`, `div`,
`mod`, `lng`, `toLong`. All numeric coerce strings.

## Strings

| Call | Notes |
|---|---|
| `concat(a, b, c, …)` | string-coerce each arg, concatenate |
| `formatString('{0} of {1}', a, b)` | classic positional template |
| `replace(s, find, replace)` | non-regex, all occurrences |
| `substring(s, start)` / `substring(s, start, length)` |  |
| `startsWith(s, prefix)` / `trim(s)` / `lCase(s)` / `uCase(s)` |  |
| `chr(n)` | `String.fromCharCode` |
| `strLength(s)` |  |

## Numbers

`random()` returns a non-cryptographic integer 0..10⁹.

## Dates

| Call | Notes |
|---|---|
| `today()` | `YYYY-MM-DD` UTC |
| `now()` | ISO 8601 UTC |
| `addDay(d, n)` / `addMonth(d, n)` | returns `YYYY-MM-DD` |
| `format(d, 'yyyy-MM-dd HH:mm', 'EN')` | tokens: `yyyy`, `MM`, `dd`, `HH`, `mm`, `ss` |

## Iterators

| Call | Returns | Notes |
|---|---|---|
| `iterator.ofEntity(<@iterator/entity entity:'…' where:'…' orderBy:'…'>)` | `Iter` | Translates to SQL via the BO registry |
| `iterator.ofPB(arrayOrObj)` | `Iter` | Yields each value as a Row |
| `iterator.ofToken(s, sep, name)` | `Iter` | `String.split`-style |

`iterate <iter>` runs the body once per row, binding the loop variable
declared by the source's `name:` (or `r` if not specified).

## Business Objects

| Call | Notes |
|---|---|
| `bo.attr(row, 'col')` | column access |
| `bo.create('qr/labelTemplate')` | empty Row, INSERT happens at persist |
| `bo.setAttr(row, 'name', value)` | mutates row in place |
| `bo.persist(row)` | INSERT (new) or UPDATE (existing); `RETURNING *` |
| `bo.delete(row)` | DELETE by primary key |

## SQL (raw)

| Call | Returns | Notes |
|---|---|---|
| `sql.execute('UPDATE …')` | nothing | escape your own values |
| `sql.fetch('SELECT …')` | `Iter` | walkable by `iterate` |

## JSON / PB

| Call | Notes |
|---|---|
| `json.parse(s)` | JS value |
| `json.json2pb(v)` | identity (PBs are plain objects in this runtime) |
| `json.pb2json(v, formatted: true)` | string |
| `pb.get(o, 'k')` / `pb.set(o, 'k', v)` |  |

## Pages

| Call | Notes |
|---|---|
| `page.get('./resourceName')` | evaluate a `protected resource …` body |
| `page.render(value)` | walk to HTML and write to response |
| `page.call('./fn', a, b)` | invoke another function |
| `resolveTemplate(\`… {{ expr }} …\`)` | `{{…}}` substituted via expression evaluator |

## Function calls

| Call | Notes |
|---|---|
| `script.call('./fn', a, b)` | same-file or cross-file resolution |
| `script.get('./main')` | evaluate the resource named `main` (BO files use this) |

## Response

| Call | Notes |
|---|---|
| `response.setContentType(s)` |  |
| `response.write(s)` | append |
| `response.flush()` / `response.end()` | no-ops on Vercel |
| `response.clearContent()` | reset body buffer |
| `response.redirect(url)` | sets status 302 + Location |

## Request

| Call | Notes |
|---|---|
| `request.body()` | raw POST body string |
| `request.isPOST()` / `isGET()` |  |
| `request.isSameOrigin()` | Referer host vs request host |
| `request.url` | full URL string |
| `qs.getUntrusted('name')` | reads query OR form-urlencoded body |
| `qs.isTrusted()` | always `false` (CSRF deferred) |

## HTTP

| Call | Notes |
|---|---|
| `httpRequest.create(url, {method, headers, body})` | fires immediately, returns handle |
| `httpRequest.responseBody(handle)` | string |
| `httpRequest.responseStatus(handle)` | number |

## Auth

| Call | Notes |
|---|---|
| `qualifier.call('session/cookie:authenticate')` | bool; hydrates `ctx.session` |
| `session.get('key')` / `session.set('key', v)` | reads/writes session payload (cookie + DB) |

## Page qualifiers (renderable)

`page/container`, `page/content`, `page/title`, `page/html`,
`page/data/table`, `page/form`, `page/form/control`, `page/form/row`,
`page/form/col`, `page/input/{text, number, date, checkbox, select}`,
`page/button/submit`, `page/sidebar`, `page/sidebar/link`,
`page/sidebar/dropdown`, `page/sidebar/dropdown/link`, `page/icon`,
`page/table/link`, `<@url>`.

Anything else renders as `<!-- TODO render: <@…> -->` so the gap is
visible in the page source.
