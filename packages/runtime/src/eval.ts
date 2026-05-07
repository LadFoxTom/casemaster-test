/**
 * Tree-walking interpreter. Phase 1 supports the subset of expressions
 * and statements that the `ping` function exercises. Each function call
 * gets its own fresh Scope; `set('x', …)` mutates the *current* scope
 * and is invisible to the caller.
 *
 * The `Ctx` carries request-wide state — the response writer and the
 * registry of loaded functions. Builtins live in a single dispatch
 * table; new ones are added as later phases need them.
 */

import * as A from './ast.js';
import { query } from './db.js';
// render.ts is imported lazily inside dispatch() so eval ↔ render don't
// form a TDZ-time circular import.
import type { Resource } from './ast.js';
import type { BOInfo } from './bo.js';

export type Value =
  | string | number | boolean | null
  | Row | RowList
  | Iter
  | Qualifier
  | { __kind: 'undefined' };

export interface Row {
  __kind: 'Row';
  data: Record<string, unknown>;
  // Tracks which BO produced the row, so future bo.attr() calls can
  // disambiguate columns vs computed attributes.
  entity?: string;
}

export interface RowList {
  __kind: 'RowList';
  rows: Row[];
}

// An iterable result yielded by `iterator.ofEntity`. The Iterate
// statement walks it row by row, binding the loop variable.
export interface Iter {
  __kind: 'Iter';
  iterName: string;          // the per-row variable name (`<@iterator/entity name:'c' …>`)
  rows: Row[];
}

export interface Qualifier {
  __kind: 'Qualifier';
  path: string[];
  props: Record<string, Value>;
}

export class Scope {
  vars: Map<string, Value> = new Map();
  constructor(public parent: Scope | null = null) {}
  get(name: string): Value {
    if (this.vars.has(name)) return this.vars.get(name)!;
    if (this.parent) return this.parent.get(name);
    return { __kind: 'undefined' };
  }
  set(name: string, v: Value) { this.vars.set(name, v); }
}

export interface Ctx {
  // Module-level registry: function name → AST. Phase 4 will add (script, fn).
  funcs:     Map<string, A.Func>;
  // Phase 2: page.get('./name') reads from this map.
  resources: Map<string, Resource>;
  // Phase 3: BO name → table + columns; iterator.ofEntity uses this.
  bos:       Map<string, BOInfo>;
  // Mutable response state, drained at the end.
  res: { contentType: string; body: string; status: number; headers: Record<string,string>; redirect?: string };
  // Request inputs.
  req: { method: string; url: string; query: Record<string,string>; body: string;
         headers?: Record<string, string|undefined> };
  // Phase 18: session payload, hydrated by qualifier.call('session/...:authenticate').
  // sessionDirty tells the route handler to write a Set-Cookie + UPSERT cms_session.
  session?: { id: string; payload: Record<string, unknown> };
  sessionDirty?: boolean;
}

export class RuntimeError extends Error {
  constructor(public loc: A.Loc, msg: string) {
    super(`${loc.file}:${loc.line}:${loc.col}: ${msg}`);
  }
}

// Public entry point: invoke a function by name. Used by the route
// handler in api/[...route].ts.
export async function callFunction(ctx: Ctx, name: string, args: Value[] = []): Promise<Value> {
  const fn = ctx.funcs.get(name);
  if (!fn) throw new Error(`function not found: ${name}`);
  const scope = new Scope();
  fn.params.forEach((p, i) => scope.set(p, args[i] ?? null));
  try {
    await execBlock(ctx, scope, fn.body);
    return null;
  } catch (e) {
    if (e instanceof ReturnSignal) return e.value;
    throw e;
  }
}

class ReturnSignal {
  constructor(public value: Value) {}
}

async function execBlock(ctx: Ctx, scope: Scope, stmts: A.Stmt[]): Promise<void> {
  for (const s of stmts) await execStmt(ctx, scope, s);
}

async function execStmt(ctx: Ctx, scope: Scope, s: A.Stmt): Promise<void> {
  switch (s.kind) {
    case 'Set': {
      const v = await evalExpr(ctx, scope, s.value);
      scope.set(s.name, v);
      return;
    }
    case 'If': {
      if (truthy(await evalExpr(ctx, scope, s.cond))) {
        return execBlock(ctx, scope, s.then);
      }
      for (const e of s.elseIfs) {
        if (truthy(await evalExpr(ctx, scope, e.cond))) {
          return execBlock(ctx, scope, e.body);
        }
      }
      if (s.else_) return execBlock(ctx, scope, s.else_);
      return;
    }
    case 'Iterate': {
      const it = await evalExpr(ctx, scope, s.source);
      if (!isIter(it)) throw new RuntimeError(s.loc, `iterate target is not an iterator`);
      for (const row of it.rows) {
        scope.set(it.iterName, row);
        await execBlock(ctx, scope, s.body);
      }
      return;
    }
    case 'Return': {
      const v = s.value ? await evalExpr(ctx, scope, s.value) : null;
      throw new ReturnSignal(v);
    }
    case 'Raise': {
      const msg = String(await evalExpr(ctx, scope, s.message));
      throw new RuntimeError(s.loc, msg);
    }
    case 'ExprStmt': {
      await evalExpr(ctx, scope, s.expr);
      return;
    }
  }
}

export async function evalExpr(ctx: Ctx, scope: Scope, e: A.Expr): Promise<Value> {
  switch (e.kind) {
    case 'StrLit':  return e.value;
    case 'NumLit':  return e.value;
    case 'BoolLit': return e.value;
    case 'NullLit': return null;
    case 'VarRef':  return scope.get(e.name);
    case 'Ident':   return scope.get(e.name);

    case 'MemberAcc': {
      const obj = await evalExpr(ctx, scope, e.object);
      // Most member access in .cms is at the head of a Call (e.g.
      // `bo.attr(...)`, `iterator.ofEntity(...)`); the Call evaluator
      // handles those. Bare member access on rows reads a column.
      if (isRow(obj)) return (obj.data[e.member] ?? null) as Value;
      return { __kind: 'undefined' };
    }

    case 'Qualifier': {
      const props: Record<string, Value> = {};
      for (const k of Object.keys(e.props)) {
        props[k] = await evalExpr(ctx, scope, e.props[k]!);
      }
      return { __kind: 'Qualifier', path: e.path, props } as Qualifier;
    }

    case 'NamedArg':
      return await evalExpr(ctx, scope, e.value);

    case 'Call': {
      // Resolve the callee shape: bare ident, dotted, or qualifier.
      const callee = e.callee;
      const argVals: Value[] = [];
      const namedArgs: Record<string, Value> = {};
      for (const a of e.args) {
        if (a.kind === 'NamedArg') {
          namedArgs[a.name] = await evalExpr(ctx, scope, a.value);
        } else {
          argVals.push(await evalExpr(ctx, scope, a));
        }
      }
      return await dispatch(ctx, scope, callee, argVals, namedArgs, e.loc);
    }
  }
}

// ─── Builtin dispatch ──────────────────────────────────────────────
async function dispatch(
  ctx: Ctx, scope: Scope, callee: A.Expr,
  args: Value[], named: Record<string, Value>, loc: A.Loc
): Promise<Value> {
  const path = calleePath(callee);   // e.g. ['set'] or ['response','write'] or ['iterator','ofEntity']
  const key = path.join('.');

  switch (key) {
    case 'set': {
      // already lifted to A.Set in the parser, but still callable as an
      // expression (some .cms uses `set('x', y)` mid-expression)
      if (args.length !== 2 || typeof args[0] !== 'string') {
        throw new RuntimeError(loc, `set expects (name, value)`);
      }
      scope.set(args[0], args[1] ?? null);
      return null;
    }

    case 'concat': return args.map(a => stringify(a)).join('');
    case 'eq':     return args[0] === args[1] || stringify(args[0] ?? null) === stringify(args[1] ?? null);
    case 'ne':     return !(args[0] === args[1] || stringify(args[0] ?? null) === stringify(args[1] ?? null));
    case 'and':    return args.every(truthy);
    case 'or':     return args.some(truthy);
    case 'not':    return !truthy(args[0] ?? null);
    case 'lt':     return num(args[0]!) <  num(args[1]!);
    case 'gt':     return num(args[0]!) >  num(args[1]!);
    case 'lte':    return num(args[0]!) <= num(args[1]!);
    case 'gte':    return num(args[0]!) >= num(args[1]!);
    case 'sum':    return args.reduce((a: number, b) => a + num(b!), 0);
    case 'sub':    return num(args[0]!) - num(args[1]!);
    case 'mul':    return num(args[0]!) * num(args[1]!);
    case 'div':    return num(args[0]!) / num(args[1]!);
    case 'mod':    return num(args[0]!) % num(args[1]!);
    case 'lng':    return Math.trunc(num(args[0]!));

    case 'if':     return truthy(args[0]!) ? args[1]! : args[2]!;

    case '_onError': {
      // CaseMaster's _onError(expr, fallback) — if `expr` is undefined
      // (or a runtime threw), use fallback. The interpreter doesn't
      // bubble "undefined" through naturally, so we treat the {undefined}
      // sentinel + null as triggers.
      const v = args[0]!;
      if (v === null || (typeof v === 'object' && v && (v as any).__kind === 'undefined')) {
        return args[1] ?? null;
      }
      return v;
    }

    case 'isNull':    return args[0] === null || (typeof args[0] === 'object' && args[0] !== null && (args[0] as any).__kind === 'undefined');
    case 'isNotNull': return !(args[0] === null || (typeof args[0] === 'object' && args[0] !== null && (args[0] as any).__kind === 'undefined'));

    case 'chr':            return String.fromCharCode(num(args[0]!));
    case 'formatString': {
      const fmt = String(args[0] ?? '');
      return fmt.replace(/\{(\d+)\}/g, (_, i) => stringify(args[parseInt(i, 10) + 1] ?? ''));
    }
    case 'replace': {
      const s = String(args[0] ?? '');
      const find = String(args[1] ?? '');
      const repl = String(args[2] ?? '');
      return s.split(find).join(repl);
    }
    case 'startsWith':  return String(args[0] ?? '').startsWith(String(args[1] ?? ''));
    case 'trim':        return String(args[0] ?? '').trim();

    case 'iterator.ofEntity': {
      // The single positional arg is the qualifier list (`entities: <…>`).
      // CaseMaster supplies `entities`, `where`, `orderBy`, `rows`, `start`
      // as named args. Phase 1 reads `entities[0]` only.
      const ents = (named.entities as Qualifier | Value | undefined);
      if (!ents) throw new RuntimeError(loc, `iterator.ofEntity needs entities:`);
      // The lexer's `<...>` literal isn't fully parsed in Phase 1; we
      // accept the simpler form where the qualifier is a single
      // `<@iterator/entity name:'…' entity:'…' where:'…' orderBy:'…'>`
      // passed positionally.
      const entQ = pickEntityQualifier(ents);
      if (!entQ) throw new RuntimeError(loc, `iterator.ofEntity: cannot read entity qualifier`);
      const entityName  = String(entQ.props.entity  ?? '');
      const iterName    = String(entQ.props.name    ?? 'r');
      const whereClause = entQ.props.where ? String(entQ.props.where) : '';
      const orderByCol  = entQ.props.orderBy ? String(entQ.props.orderBy) : '';
      const rowsLimit   = num(named.rows ?? 1000);

      const tbl = entityToTable(ctx, entityName);
      let sql = `SELECT * FROM ${tbl}`;
      if (whereClause) sql += ` WHERE ${compileWhere(whereClause)}`;
      if (orderByCol) {
        const desc = orderByCol.startsWith('-');
        sql += ` ORDER BY ${desc ? orderByCol.slice(1) : orderByCol} ${desc ? 'DESC' : 'ASC'}`;
      }
      sql += ` LIMIT ${rowsLimit}`;
      const rows = await query(sql);
      const out: Iter = {
        __kind: 'Iter',
        iterName,
        rows: rows.map(r => ({ __kind: 'Row', data: r as any, entity: entityName })),
      };
      return out;
    }

    case 'bo.attr': {
      const row = args[0] as Row | undefined;
      const col = String(args[1] ?? '');
      if (!isRow(row)) return null;
      return (row.data[col] ?? null) as Value;
    }

    case 'response.setContentType': {
      ctx.res.contentType = String(args[0] ?? 'text/plain');
      return null;
    }
    case 'response.write': {
      ctx.res.body += stringify(args[0] ?? '');
      return null;
    }
    case 'response.flush':       return null;
    case 'response.end':         return null;
    case 'response.clearContent':{ ctx.res.body = ''; return null; }
    case 'response.redirect': {
      ctx.res.redirect = String(args[0] ?? '');
      ctx.res.status = 302;
      return null;
    }

    case 'page.get': {
      // page.get('./resourceName') — looks up `resource <name> … end-resource`
      // and evaluates its body in a fresh scope (so variables set inside don't
      // leak). Resources are values; the caller decides what to do with them
      // (typically `set('main', page.get('./fooBody'))`).
      const ref = String(args[0] ?? '');
      const name = ref.startsWith('./') ? ref.slice(2) : ref;
      const r = ctx.resources.get(name);
      if (!r) throw new RuntimeError(loc, `page.get: resource not found: ${ref}`);
      // Resources see the caller's scope so they can read [main], [tabActive], etc.
      return await evalExpr(ctx, scope, r.body);
    }

    case 'page.render': {
      // page.render(rootValue) — render the value to HTML and write it as
      // the response body. The .cms convention is that this is the last
      // call in a function; nothing meaningful happens after it.
      const { renderValue } = await import('./render.js');
      const html = await renderValue(ctx, scope, args[0] ?? null);
      ctx.res.contentType = 'text/html; charset=utf-8';
      ctx.res.body = html;
      return null;
    }

    case 'resolveTemplate': {
      // resolveTemplate(`…{{ expr }}…`) — substitute each {{…}} chunk.
      const { resolveTemplate } = await import('./render.js');
      return await resolveTemplate(ctx, scope, String(args[0] ?? ''));
    }

    // ─── Phase 4: function calls ────────────────────────────────────
    case 'script.call': {
      // `script.call('./fn', a, b)` or `script.call('script/path:fn', …)`
      const ref = String(args[0] ?? '');
      const fnName = ref.includes(':') ? ref.split(':')[1]! : ref.replace(/^\.\//, '');
      const fn = ctx.funcs.get(fnName);
      if (!fn) throw new RuntimeError(loc, `script.call: function not found: ${ref}`);
      return await callFunction(ctx, fnName, args.slice(1));
    }
    case 'page.call': {
      // page.call('./fn', a, b) — same dispatch as script.call for now.
      const ref = String(args[0] ?? '');
      const fnName = ref.includes(':') ? ref.split(':')[1]! : ref.replace(/^\.\//, '');
      const fn = ctx.funcs.get(fnName);
      if (!fn) throw new RuntimeError(loc, `page.call: function not found: ${ref}`);
      return await callFunction(ctx, fnName, args.slice(1));
    }
    case 'script.get': {
      // script.get('./main') — used by BO files to look up the resource
      // named `main`. Returns the resource's evaluated body.
      const ref = String(args[0] ?? '');
      const name = ref.startsWith('./') ? ref.slice(2) : ref;
      const r = ctx.resources.get(name);
      if (!r) return null;
      return await evalExpr(ctx, scope, r.body);
    }
    case 'true':  return true;
    case 'false': return false;

    // ─── Phase 5: standard library ──────────────────────────────────
    case 'today':       return new Date().toISOString().slice(0, 10);
    case 'now':         return new Date().toISOString();
    case 'addDay': {
      const d = new Date(stringify(args[0] ?? '') || Date.now());
      d.setUTCDate(d.getUTCDate() + num(args[1]!));
      return d.toISOString().slice(0, 10);
    }
    case 'addMonth': {
      const d = new Date(stringify(args[0] ?? '') || Date.now());
      d.setUTCMonth(d.getUTCMonth() + num(args[1]!));
      return d.toISOString().slice(0, 10);
    }
    case 'format': {
      // format(date, 'yyyy-MM-dd HH:mm', 'EN') — minimal token set covering
      // patterns used in the existing app. Not a full strftime port.
      const v = args[0];
      const fmt = String(args[1] ?? 'yyyy-MM-dd');
      const d = (v instanceof Date) ? v
              : v === null || v === undefined ? new Date()
              : new Date(stringify(v));
      const Y = d.getUTCFullYear();
      const M = String(d.getUTCMonth() + 1).padStart(2, '0');
      const D = String(d.getUTCDate()).padStart(2, '0');
      const h = String(d.getUTCHours()).padStart(2, '0');
      const m = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      return fmt
        .replace(/yyyy/g, String(Y))
        .replace(/MM/g, M)
        .replace(/dd/g, D)
        .replace(/HH/g, h)
        .replace(/mm/g, m)
        .replace(/ss/g, s);
    }
    case 'substring': {
      const s = String(args[0] ?? '');
      const start = num(args[1] ?? 0);
      // Two-arg form (start) or three-arg (start, length) — match CMS lite.
      if (args.length >= 3) return s.substr(start, num(args[2]!));
      return s.slice(start);
    }
    case 'lCase':       return String(args[0] ?? '').toLowerCase();
    case 'uCase':       return String(args[0] ?? '').toUpperCase();
    case 'strLength':   return String(args[0] ?? '').length;
    case 'random':      return Math.floor(Math.random() * 1_000_000_000);
    case 'toLong':      return Math.trunc(num(args[0]!));

    // ─── Phase 5: JSON + PB ─────────────────────────────────────────
    case 'json.parse': {
      try { return JSON.parse(String(args[0] ?? '')) as Value; }
      catch { return null; }
    }
    case 'json.json2pb': {
      // Our PBs are plain JS objects — json.parse already returned that
      // shape. json2pb is a no-op identity; kept for source compat.
      return args[0] ?? null;
    }
    case 'json.pb2json': {
      const formatted = (named.formatted as boolean | undefined) ?? false;
      return formatted ? JSON.stringify(args[0] ?? null, null, 2) : JSON.stringify(args[0] ?? null);
    }
    case 'pb.get': {
      const obj = args[0] as any;
      if (obj === null || typeof obj !== 'object') return null;
      const k = String(args[1] ?? '');
      return (obj[k] ?? null) as Value;
    }
    case 'pb.set': {
      const obj = args[0] as any;
      if (obj === null || typeof obj !== 'object') return args[0] ?? null;
      obj[String(args[1] ?? '')] = args[2] ?? null;
      return obj;
    }
    case 'iterator.ofPB': {
      // Iterates an array (or object's values) — yielded as Iter for the
      // `iterate` statement.
      const src = args[0];
      const iterName = String(args[1] ?? 'r');
      const items: Row[] = [];
      if (Array.isArray(src)) {
        for (const x of src) items.push({ __kind: 'Row', data: x as any });
      } else if (src && typeof src === 'object') {
        for (const x of Object.values(src as object)) items.push({ __kind: 'Row', data: x as any });
      }
      return { __kind: 'Iter', iterName, rows: items } as Iter;
    }
    case 'iterator.ofToken': {
      // iterator.ofToken('a,b,c', ',', 'tk') → Iter of strings as rows.
      const src = String(args[0] ?? '');
      const sep = String(args[1] ?? ',');
      const iterName = String(args[2] ?? 'tk');
      const parts = src.split(sep);
      return { __kind: 'Iter', iterName,
        rows: parts.map(p => ({ __kind: 'Row', data: { _value: p } })) } as Iter;
    }

    // ─── Phase 6: request introspection ─────────────────────────────
    case 'request.body':         return ctx.req.body ?? '';
    case 'request.isPOST':       return (ctx.req.method ?? '').toUpperCase() === 'POST';
    case 'request.isGET':        return (ctx.req.method ?? '').toUpperCase() === 'GET';
    case 'request.isSameOrigin': {
      const ref = ctx.req.headers?.referer ?? '';
      const host = ctx.req.headers?.host ?? '';
      if (!ref || !host) return false;
      try { return new URL(ref).host === host; } catch { return false; }
    }
    case 'request.url':           return ctx.req.url;
    case 'qs.getUntrusted':       return ctx.req.query[String(args[0] ?? '')] ?? '';
    case 'qs.isTrusted':          return false; // CSRF: deferred to Phase 7+

    // ─── Phase 16: writer-side BO + raw SQL ─────────────────────────
    case 'sql.execute': {
      // sql.execute('INSERT … VALUES (…)') — write-only SQL. The .cms app
      // is responsible for escaping; we don't do interpolation here.
      await query(String(args[0] ?? ''));
      return null;
    }
    case 'sql.fetch': {
      // sql.fetch('SELECT id, name FROM x') — returns an Iter walkable
      // by `iterate`. Rows are plain objects, identical shape to bo.attr.
      const rows = await query(String(args[0] ?? ''));
      const out: Iter = {
        __kind: 'Iter', iterName: 'r',
        rows: rows.map(r => ({ __kind: 'Row', data: r as any })),
      };
      return out;
    }
    case 'bo.create': {
      // Returns an empty Row that the caller mutates with bo.setAttr /
      // bo.persist. INSERT happens at persist time, not here.
      const entityName = String(args[0] ?? '');
      return { __kind: 'Row', data: { __new: true } as any, entity: entityName } as Row;
    }
    case 'bo.setAttr': {
      const row = args[0] as Row | undefined;
      if (!isRow(row)) throw new RuntimeError(loc, 'bo.setAttr: first arg must be a row');
      row.data[String(args[1] ?? '')] = args[2] ?? null;
      return row;
    }
    case 'bo.persist': {
      const row = args[0] as Row | undefined;
      if (!isRow(row)) throw new RuntimeError(loc, 'bo.persist: first arg must be a row');
      const info = row.entity ? ctx.bos.get(row.entity) : undefined;
      const tbl  = info?.table ?? entityToTable(ctx, row.entity ?? '');
      const pk   = info?.primaryKey ?? 'id';
      const isNew = (row.data as any).__new === true;
      delete (row.data as any).__new;
      const cols = Object.keys(row.data).filter(c => c !== pk || !isNew);
      const vals = cols.map(c => row.data[c]);
      if (isNew) {
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${tbl} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`;
        const r = await query(sql, vals as unknown[]);
        if (r[0]) row.data = r[0] as any;
      } else {
        const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        vals.push(row.data[pk]);
        const sql = `UPDATE ${tbl} SET ${setClauses} WHERE ${pk} = $${cols.length + 1} RETURNING *`;
        const r = await query(sql, vals as unknown[]);
        if (r[0]) row.data = r[0] as any;
      }
      return row;
    }
    case 'bo.delete': {
      const row = args[0] as Row | undefined;
      if (!isRow(row)) throw new RuntimeError(loc, 'bo.delete: first arg must be a row');
      const info = row.entity ? ctx.bos.get(row.entity) : undefined;
      const tbl  = info?.table ?? entityToTable(ctx, row.entity ?? '');
      const pk   = info?.primaryKey ?? 'id';
      await query(`DELETE FROM ${tbl} WHERE ${pk} = $1`, [row.data[pk]]);
      return null;
    }

    // ─── Phase 17: outbound HTTP ────────────────────────────────────
    case 'httpRequest.create': {
      const url = String(args[0] ?? '');
      const opts = (args[1] as any) ?? {};
      const headers: Record<string, string> = {};
      if (opts.headers && typeof opts.headers === 'object') {
        for (const [k, v] of Object.entries(opts.headers)) headers[k] = String(v);
      }
      const init: RequestInit = { method: String(opts.method ?? 'GET'), headers };
      if (opts.body !== undefined && opts.body !== null) {
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }
      const res = await fetch(url, init);
      const body = await res.text();
      return {
        __kind: 'HttpReq', url, status: res.status, body,
        headers: Object.fromEntries(res.headers.entries()),
      } as any;
    }
    case 'httpRequest.responseBody': {
      const h = args[0] as any;
      return (h && h.__kind === 'HttpReq') ? String(h.body ?? '') : '';
    }
    case 'httpRequest.responseStatus': {
      const h = args[0] as any;
      return (h && h.__kind === 'HttpReq') ? (h.status as number) : 0;
    }

    // ─── Phase 18: real auth + sessions ─────────────────────────────
    case 'qualifier.call': {
      // qualifier.call('session/cookie:authenticate') validates the
      // session cookie against cms_session. Returns true if a
      // non-expired session exists; populates ctx.session for
      // downstream session.get / session.set calls.
      const ref = String(args[0] ?? '');
      if (ref.endsWith(':authenticate')) return await authenticateSession(ctx);
      return null;
    }
    case 'session.get': {
      const k = String(args[0] ?? '');
      return (ctx.session?.payload?.[k] ?? null) as Value;
    }
    case 'session.set': {
      const k = String(args[0] ?? '');
      ctx.session = ctx.session ?? { id: '', payload: {} };
      ctx.session.payload[k] = args[1] ?? null;
      ctx.sessionDirty = true;
      return null;
    }

    default:
      throw new RuntimeError(loc, `unimplemented call: ${key}`);
  }
}

async function authenticateSession(ctx: Ctx): Promise<boolean> {
  const cookie = String(ctx.req.headers?.cookie ?? '');
  const m = cookie.match(/(?:^|;\s*)cmsv_sid=([^;]+)/);
  if (!m) return false;
  const sid = decodeURIComponent(m[1]!);
  try {
    const rows = await query(
      `SELECT payload FROM cms_session WHERE id = $1 AND expires_at > now()`,
      [sid]
    );
    if (!rows[0]) return false;
    ctx.session = { id: sid, payload: rows[0].payload as Record<string, unknown> };
    return true;
  } catch {
    // Table might not exist yet — treat as unauthenticated.
    return false;
  }
}

// BO path → Postgres table. Phase 3 reads from the BO registry built at
// load time (`<@bo table: '…'>`); falls back to a snake_case best-guess
// for entities that haven't been declared yet so dev iteration isn't
// blocked when a BO file is missing.
function entityToTable(ctx: Ctx, entity: string): string {
  const info = ctx.bos.get(entity);
  if (info) return info.table;
  return entity.replace(/\//g, '_').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

// CaseMaster's `where:` mini-language uses `=` for equality, `&` for AND,
// `>=`, `<=`, etc. Phase 1 supports just enough to translate the strings
// the ping function would never produce — but the same compiler will
// power Phase 2+. Values come pre-substituted from .cms (`concat('id=', [id])`).
function compileWhere(w: string): string {
  return w
    .replace(/\s*&\s*/g, ' AND ')
    // `name="value"` is already valid SQL; pass through.
    ;
}

function pickEntityQualifier(v: Value): Qualifier | null {
  // The `entities:` arg can be either a single qualifier or a `_list`
  // qualifier wrapping one (or more) `<@iterator/entity …>` entries.
  if (typeof v === 'object' && v && (v as any).__kind === 'Qualifier') {
    const q = v as Qualifier;
    if (q.path[0] === '_list') {
      // Take the first positional entry.
      const first = q.props['0'];
      if (first && typeof first === 'object' && (first as any).__kind === 'Qualifier') return first as Qualifier;
    }
    return q;
  }
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && (v[0] as any).__kind === 'Qualifier') return v[0] as Qualifier;
  return null;
}

function calleePath(callee: A.Expr): string[] {
  if (callee.kind === 'Ident') return [callee.name];
  if (callee.kind === 'MemberAcc') return [...calleePath(callee.object), callee.member];
  throw new Error('unrecognised call target');
}

function truthy(v: Value): boolean {
  if (v === null || v === false) return false;
  if (typeof v === 'object' && v && (v as any).__kind === 'undefined') return false;
  if (v === 0 || v === '') return false;
  return true;
}
function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return 0;
}
function stringify(v: Value): string {
  if (v === null) return '';
  if (typeof v === 'object' && v && (v as any).__kind === 'undefined') return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function isIter(v: Value): v is Iter { return typeof v === 'object' && v !== null && (v as any).__kind === 'Iter'; }
function isRow(v: Value | undefined): v is Row { return typeof v === 'object' && v !== null && (v as any).__kind === 'Row'; }
