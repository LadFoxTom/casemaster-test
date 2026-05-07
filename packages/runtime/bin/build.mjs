#!/usr/bin/env node
/**
 * Phase 15 — build-time validator.
 *
 * Walks every `.cms` file under app/, parses it, and reports:
 *   - Calls to built-ins / functions that the runtime doesn't implement
 *   - <@page/...> qualifiers without a registered renderer
 *   - Lex / parse errors (file:line:col)
 *
 * Returns non-zero on errors, zero on warnings only — so CI gates on
 * structural failures but tolerates known-incomplete features.
 *
 * Usage:
 *   node packages/runtime/bin/build.mjs               # walks ./app
 *   node packages/runtime/bin/build.mjs --app ./app
 *   node packages/runtime/bin/build.mjs --strict      # warnings → errors
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const APP_DIR = String(flag('app') ?? join(process.cwd(), 'app'));
const STRICT  = Boolean(flag('strict'));

if (!existsSync(APP_DIR)) {
  console.error(`app dir not found: ${APP_DIR}`);
  process.exit(1);
}

// Resolve the runtime via its package name. The build script is bundled
// inside the package, so this works in both the workspace and a real
// node_modules install. We don't import .ts directly — Node can't load
// it without a loader.
let cms;
try {
  cms = await import('cms-vercel');
} catch (e) {
  if (e?.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('cms-vercel-build: runtime not built (packages/runtime/dist/ missing).');
    console.error('Fix:  npm run build');
    process.exit(2);
  }
  throw e;
}
const { lex, parse } = cms;
// Suppress unused-var linter warning for the file-URL import fallback.
fileURLToPath; dirname;

// Hand-maintained list of supported builtins. Keep in sync with eval.ts
// dispatch table. Anything that isn't here becomes a warning. The list
// is the contract between the runtime and userspace .cms — diffing the
// two is exactly what this validator does.
const KNOWN = new Set([
  // core
  'set', 'concat', 'eq', 'ne', 'and', 'or', 'not',
  'lt', 'gt', 'lte', 'gte', 'sum', 'sub', 'mul', 'div', 'mod', 'lng',
  'if', '_onError', 'isNull', 'isNotNull', 'chr', 'formatString',
  'replace', 'startsWith', 'trim', 'lCase', 'uCase', 'strLength',
  'random', 'toLong',
  // dates
  'today', 'now', 'addDay', 'addMonth', 'format',
  // iteration / data
  'iterator.ofEntity', 'iterator.ofPB', 'iterator.ofToken',
  'bo.attr', 'bo.persist', 'bo.create', 'bo.delete', 'bo.setAttr',
  'sql.execute', 'sql.fetch',
  // json
  'json.parse', 'json.json2pb', 'json.pb2json',
  'pb.get', 'pb.set',
  // page / response
  'page.get', 'page.render', 'page.call',
  'response.setContentType', 'response.write', 'response.flush',
  'response.end', 'response.clearContent', 'response.redirect',
  'resolveTemplate',
  // request / qs
  'request.body', 'request.isPOST', 'request.isGET',
  'request.isSameOrigin', 'request.url',
  'qs.getUntrusted', 'qs.isTrusted',
  // call dispatch
  'script.call', 'script.get', 'true', 'false',
  // http
  'httpRequest.create', 'httpRequest.responseBody',
  // auth (Phase 18)
  'qualifier.call', 'session.get', 'session.set',
]);

const KNOWN_QUALIFIERS = new Set([
  'page/container', 'page/content', 'page/title', 'page/html',
  'page/data/table', 'page/form', 'page/form/control', 'page/form/row', 'page/form/col',
  'page/input/text', 'page/input/number', 'page/input/select', 'page/input/checkbox',
  'page/input/date', 'page/sidebar', 'page/sidebar/link', 'page/sidebar/dropdown',
  'page/sidebar/dropdown/link', 'page/icon', 'page/button/submit', 'page/table/link',
  'iterator/entity', 'bo', 'bo/attribute', 'configuration', 'configuration/dataSources',
  'url',
]);

const errors = [];
const warns  = [];
let scanned = 0;

for (const f of walk(APP_DIR)) {
  if (!f.endsWith('.cms')) continue;
  scanned++;
  const rel = relative(APP_DIR, f).split('\\').join('/');
  const src = readFileSync(f, 'utf8');
  let toks;
  try { toks = lex(src, rel); }
  catch (e) { errors.push(`${rel}: ${e.message}`); continue; }
  let parsed;
  try { parsed = parse(toks, rel); }
  catch (e) { errors.push(`${rel}: ${e.message}`); continue; }

  // Build a per-file set of locally-defined function names so calls to
  // them don't get flagged as unknown.
  const localFns = new Set(parsed.funcs.map(fn => fn.name));

  for (const fn of parsed.funcs) walkStmts(fn.body, rel, localFns);
  for (const r  of parsed.resources) walkExpr(r.body, rel, localFns);
}

console.log(`scanned: ${scanned} .cms files`);
console.log(`errors:  ${errors.length}`);
console.log(`warns:   ${warns.length}`);
if (errors.length || (STRICT && warns.length)) {
  for (const e of errors) console.error(`E ${e}`);
  for (const w of warns)  console.warn (`W ${w}`);
  process.exit(1);
}
for (const w of warns) console.warn(`W ${w}`);
console.log('build: ok');

// ─── walkers ──────────────────────────────────────────────────────
function walkStmts(stmts, file, localFns) {
  for (const s of stmts) {
    switch (s.kind) {
      case 'Set':      walkExpr(s.value, file, localFns); break;
      case 'If':
        walkExpr(s.cond, file, localFns);
        walkStmts(s.then, file, localFns);
        for (const e of s.elseIfs) { walkExpr(e.cond, file, localFns); walkStmts(e.body, file, localFns); }
        if (s.else_) walkStmts(s.else_, file, localFns);
        break;
      case 'Iterate':  walkExpr(s.source, file, localFns); walkStmts(s.body, file, localFns); break;
      case 'Return':   if (s.value) walkExpr(s.value, file, localFns); break;
      case 'Raise':    walkExpr(s.exType, file, localFns); walkExpr(s.message, file, localFns); break;
      case 'ExprStmt': walkExpr(s.expr, file, localFns); break;
    }
  }
}
function walkExpr(e, file, localFns) {
  if (!e) return;
  switch (e.kind) {
    case 'Call': {
      const path = calleePath(e.callee);
      const key = path.join('.');
      // User-defined function in the same file? Skip.
      if (path.length === 1 && localFns.has(path[0])) {
        for (const a of e.args) walkExpr(a, file, localFns);
        return;
      }
      // Unknown builtin?
      if (!KNOWN.has(key)) {
        warns.push(`${file}:${e.loc.line}:${e.loc.col}: unknown call: ${key}`);
      }
      for (const a of e.args) walkExpr(a, file, localFns);
      return;
    }
    case 'Qualifier': {
      const p = e.path.join('/');
      // Synthetic path emitted by the parser for `< … >` literals — skip.
      if (p === '_list' || p === '_pb') {
        for (const k of Object.keys(e.props)) walkExpr(e.props[k], file, localFns);
        return;
      }
      if (!KNOWN_QUALIFIERS.has(p)) {
        warns.push(`${file}:${e.loc.line}:${e.loc.col}: unknown qualifier: <@${p}>`);
      }
      for (const k of Object.keys(e.props)) walkExpr(e.props[k], file, localFns);
      return;
    }
    case 'MemberAcc': walkExpr(e.object, file, localFns); return;
    case 'NamedArg':  walkExpr(e.value,  file, localFns); return;
  }
}
function calleePath(c) {
  if (c.kind === 'Ident') return [c.name];
  if (c.kind === 'MemberAcc') return [...calleePath(c.object), c.member];
  return ['<expr>'];
}
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
