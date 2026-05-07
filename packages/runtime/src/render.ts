/**
 * HTML renderer for `<@page/...>` qualifier values, plus the
 * resolveTemplate(`…{{ expr }}…`) string interpolator.
 *
 * Phase 2 covers the bare minimum to render one visible page:
 *   page/container, page/content, page/title, page/html
 * Plus the `_list` synthetic qualifier that the parser emits for `< … >`
 * literals (we walk children in order).
 *
 * Anything not yet implemented falls through to a comment marker so the
 * page renders something visible and we can grep the HTML for missing
 * qualifiers when porting more pages.
 */

import { Value, Qualifier, Scope, Ctx } from './eval.js';
import { evalExpr } from './eval.js';
import { lex } from './lex.js';
import { parseExpression } from './parse.js';

export async function renderValue(ctx: Ctx, scope: Scope, v: Value): Promise<string> {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && (v as any).__kind === 'undefined') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isQualifier(v)) return await renderQualifier(ctx, scope, v as Qualifier);
  // Rows / iterators don't render directly — caller's mistake; leave a marker.
  return `<!-- unrenderable ${(v as any).__kind ?? typeof v} -->`;
}

async function renderQualifier(ctx: Ctx, scope: Scope, q: Qualifier): Promise<string> {
  const path = q.path.join('/');

  // Synthetic list qualifier from `< a, b, c >` literals — render children in order.
  if (path === '_list') {
    const keys = Object.keys(q.props).sort((a, b) => Number(a) - Number(b));
    let out = '';
    for (const k of keys) out += await renderValue(ctx, scope, q.props[k]!);
    return out;
  }

  switch (path) {
    case 'page/container': {
      const inner = await renderValue(ctx, scope, q.props.content ?? null);
      return `<div class="container">${inner}</div>`;
    }
    case 'page/content': {
      const title = q.props.title  ? await renderValue(ctx, scope, q.props.title)  : '';
      const intro = q.props.intro  ? await renderValue(ctx, scope, q.props.intro)  : '';
      const body  = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      return `${title}${intro}${body}`;
    }
    case 'page/title': {
      const label = q.props.label ? await renderValue(ctx, scope, q.props.label) : '';
      return `<h1>${label}</h1>`;
    }
    case 'page/html': {
      // The first positional or the `_value` slot — `<@page/html '...html...'>`
      // passes the literal as a positional. We emit it raw.
      const positional = q.props['0'] ?? q.props._value ?? null;
      if (positional !== null) return await renderValue(ctx, scope, positional);
      return '';
    }

    // ─── Phase 19: form + table + sidebar + icon ────────────────────
    case 'page/data/table': {
      const it = q.props.iterator ?? null;
      const rows = (it && (it as any).__kind === 'Iter') ? (it as any).rows : [];
      if (!rows.length) {
        return `<table class="cms-table"><tbody><tr><td class="empty">no rows</td></tr></tbody></table>`;
      }
      const cols = Object.keys((rows[0] as any).data ?? {});
      let html = '<table class="cms-table"><thead><tr>';
      for (const c of cols) html += `<th>${esc(c)}</th>`;
      html += '</tr></thead><tbody>';
      for (const r of rows) {
        html += '<tr>';
        for (const c of cols) html += `<td>${esc(String((r as any).data[c] ?? ''))}</td>`;
        html += '</tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    case 'page/form': {
      const method = q.props.method ? String(q.props.method) : 'GET';
      const action = q.props.action ? String(q.props.action) : '';
      const name   = q.props.name   ? String(q.props.name)   : '';
      const inner  = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      const positionals = await renderPositionals(ctx, scope, q);
      const nameAttr = name ? ` name="${esc(name)}" id="${esc(name)}"` : '';
      return `<form method="${esc(method)}" action="${esc(action)}"${nameAttr}>${inner}${positionals}</form>`;
    }

    case 'page/form/row': {
      const inner = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      return `<div class="cms-row">${inner}${await renderPositionals(ctx, scope, q)}</div>`;
    }

    case 'page/form/col': {
      const cls   = q.props.class   ? String(q.props.class) : '';
      const inner = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      return `<div class="cms-col ${esc(cls)}">${inner}${await renderPositionals(ctx, scope, q)}</div>`;
    }

    case 'page/form/control': {
      const label = q.props.label ? String(q.props.label) : '';
      const input = q.props.input ? await renderValue(ctx, scope, q.props.input) : '';
      return `<label class="cms-control"><span>${esc(label)}</span>${input}</label>`;
    }

    case 'page/input/text':     return renderInput(q, 'text');
    case 'page/input/number':   return renderInput(q, 'number');
    case 'page/input/date':     return renderInput(q, 'date');
    case 'page/input/checkbox': return renderInput(q, 'checkbox');

    case 'page/input/select': {
      const name    = q.props.name    ? String(q.props.name)    : '';
      const options = q.props.options ?? null;
      let opts = '';
      if (options && (options as any).__kind === 'Qualifier') {
        const oQ = options as Qualifier;
        for (const k of Object.keys(oQ.props)) {
          const v = await renderValue(ctx, scope, oQ.props[k]!);
          opts += `<option value="${esc(k)}">${esc(v)}</option>`;
        }
      }
      return `<select name="${esc(name)}">${opts}</select>`;
    }

    case 'page/button/submit': {
      const label = q.props.label ? String(q.props.label) : 'Submit';
      return `<button type="submit" class="cms-btn-primary">${esc(label)}</button>`;
    }

    case 'page/sidebar': {
      const inner = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      return `<nav class="cms-sidebar">${inner}${await renderPositionals(ctx, scope, q)}</nav>`;
    }

    case 'page/sidebar/link': {
      const label  = q.props.label  ? String(q.props.label) : '';
      const url    = q.props.url    ? String(q.props.url)   : '#';
      const active = !!q.props.active && truthyValue(q.props.active);
      const icon   = q.props.icon   ? await renderValue(ctx, scope, q.props.icon) : '';
      const cls    = active ? 'cms-sidebar-link active' : 'cms-sidebar-link';
      return `<a class="${cls}" href="${esc(url)}">${icon}${esc(label)}</a>`;
    }

    case 'page/sidebar/dropdown': {
      const label = q.props.label   ? String(q.props.label) : '';
      const icon  = q.props.icon    ? await renderValue(ctx, scope, q.props.icon) : '';
      const inner = q.props.content ? await renderValue(ctx, scope, q.props.content) : '';
      return `<details class="cms-sidebar-dropdown"><summary>${icon}${esc(label)}</summary>${inner}</details>`;
    }

    case 'page/sidebar/dropdown/link': {
      const label = q.props.label ? String(q.props.label) : '';
      const url   = q.props.url   ? String(q.props.url)   : '#';
      return `<a class="cms-sidebar-sublink" href="${esc(url)}">${esc(label)}</a>`;
    }

    case 'page/icon': {
      const name = q.props.name  ? String(q.props.name)  : '';
      const cls  = q.props.class ? String(q.props.class) : '';
      return `<i class="fa fa-${esc(name)} ${esc(cls)}"></i>`;
    }

    case 'page/table/link': {
      const url = q.props.url ? String(q.props.url) : '#';
      return `<a class="cms-row-link" href="${esc(url)}"></a>`;
    }

    case 'url': {
      // <@url address: 'fnName', qs: <id: 1>> — relative URL to /page/foo/f/<fn>
      const addr = q.props.address ? String(q.props.address) : '';
      const qsObj = q.props.qs;
      let qs = '';
      if (qsObj && (qsObj as any).__kind === 'Qualifier') {
        const params: string[] = [];
        const props = (qsObj as Qualifier).props;
        for (const k of Object.keys(props)) {
          if (/^\d+$/.test(k)) continue;
          params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(props[k] ?? ''))}`);
        }
        if (params.length) qs = '?' + params.join('&');
      }
      return `/page/foo/f/${encodeURIComponent(addr)}${qs}`;
    }
  }

  // Fallback: render any nested children we can find, plus a marker.
  let out = `<!-- TODO render: <@${path}> -->`;
  for (const k of Object.keys(q.props)) {
    out += await renderValue(ctx, scope, q.props[k]!);
  }
  return out;
}

async function renderPositionals(ctx: Ctx, scope: Scope, q: Qualifier): Promise<string> {
  let out = '';
  for (const k of Object.keys(q.props).filter(k => /^\d+$/.test(k))) {
    out += await renderValue(ctx, scope, q.props[k]!);
  }
  return out;
}
function renderInput(q: Qualifier, type: string): string {
  const name = q.props.name  ? String(q.props.name)  : '';
  const v    = q.props.value ? String(q.props.value) : '';
  const cls  = q.props.class ? String(q.props.class) : '';
  const placeholder = q.props.placeholder ? ` placeholder="${esc(String(q.props.placeholder))}"` : '';
  const valueAttr   = type === 'checkbox' ? '' : ` value="${esc(v)}"`;
  return `<input type="${type}" name="${esc(name)}" class="${esc(cls)}"${valueAttr}${placeholder}>`;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
}
function truthyValue(v: any): boolean {
  if (v === null || v === false || v === 0 || v === '') return false;
  if (typeof v === 'object' && v && (v as any).__kind === 'undefined') return false;
  return true;
}

/**
 * resolveTemplate("…{{ expr }}…") — substitutes each `{{…}}` block with
 * the eval'd expression. The expression is parsed and evaluated using the
 * current request scope.
 */
export async function resolveTemplate(ctx: Ctx, scope: Scope, tpl: string): Promise<string> {
  let out = '';
  let i = 0;
  while (i < tpl.length) {
    const open = tpl.indexOf('{{', i);
    if (open === -1) { out += tpl.slice(i); break; }
    out += tpl.slice(i, open);
    const close = tpl.indexOf('}}', open + 2);
    if (close === -1) throw new Error(`resolveTemplate: unmatched '{{' starting at ${open}`);
    const exprSrc = tpl.slice(open + 2, close);
    try {
      const tokens = lex(exprSrc, '<template>');
      const ast    = parseExpression(tokens, '<template>');
      const v      = await evalExpr(ctx, scope, ast);
      // Qualifier values inside {{…}} are rendered recursively. This is
      // how `{{[main]}}` in a shell substitutes the inner page body.
      if (isQualifier(v)) out += await renderValue(ctx, scope, v);
      else                out += stringifyForTemplate(v);
    } catch (e: any) {
      out += `<!-- template error: ${e?.message ?? String(e)} -->`;
    }
    i = close + 2;
  }
  return out;
}

function stringifyForTemplate(v: Value): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && (v as any).__kind === 'undefined') return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isQualifier(v)) {
    // We can't synchronously render a qualifier from inside a sync template;
    // the rendered top-level path is async. For Phase 2 we ignore — most
    // {{…}} inside templates returns scalars (var refs, formatString, etc.)
    return '';
  }
  return '';
}

function isQualifier(v: Value): v is Qualifier {
  return typeof v === 'object' && v !== null && (v as any).__kind === 'Qualifier';
}
