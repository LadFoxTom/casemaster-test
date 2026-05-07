/**
 * Phase 20 — auto-generated BO maintenance pages.
 *
 * Routes:
 *   /maintenance/<bo>                — list view (paginated)
 *   /maintenance/<bo>/edit?id=<id>   — edit form for a row
 *   /maintenance/<bo>/new            — create form
 *   /maintenance/<bo>/save           — POST: insert or update via bo.persist
 *   /maintenance/<bo>/delete         — POST: delete a row
 *
 * The handler intercepts these before the normal /page/<script>/f/<fn>
 * dispatch. Returns null when the path doesn't match any maintenance
 * route, letting the main router continue.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { query } from './db.js';
import { BOInfo } from './bo.js';

const PAGE_SIZE = 50;

export interface MaintenanceContext {
  bos: Map<string, BOInfo>;
}

/**
 * Try to handle a /maintenance/* request. Returns true if a response was
 * written; false if the URL doesn't match any maintenance route.
 */
export async function handleMaintenance(
  ctx: MaintenanceContext,
  req: VercelRequest,
  res: VercelResponse,
  pathname: string,
  query_: Record<string, string>,
  body: string,
): Promise<boolean> {
  // Match /maintenance/<bo>(/<action>)?  — bo can contain slashes
  // (e.g. qr/labelTemplate).
  const m = pathname.match(/^\/maintenance\/(.+?)(?:\/(list|edit|new|save|delete))?\/?$/);
  if (!m) return false;

  const boName = m[1]!;
  const action = m[2] ?? 'list';
  const info = ctx.bos.get(boName);
  if (!info) {
    res.status(404).setHeader('Content-Type', 'text/plain')
       .send(`maintenance: BO not found: ${boName}`);
    return true;
  }

  const isPost = (req.method ?? 'GET').toUpperCase() === 'POST';
  // Form-encoded body is already merged into query at the route layer,
  // but maintenance flows accept both interchangeably.
  const params = query_;

  switch (action) {
    case 'list': {
      const html = await renderList(info, params);
      writeHtml(res, html);
      return true;
    }
    case 'edit': {
      const id = params.id ?? '';
      if (!id) { res.status(400).send('edit: ?id= required'); return true; }
      const html = await renderEdit(info, id);
      writeHtml(res, html);
      return true;
    }
    case 'new': {
      const html = renderForm(info, null, /*isNew*/ true);
      writeHtml(res, renderShell(info, 'New ' + info.name, html));
      return true;
    }
    case 'save': {
      if (!isPost) { res.status(405).send('save: POST only'); return true; }
      const id = params.id ?? '';
      const cols = [...info.attributes.entries()].filter(([n]) => n !== info.primaryKey);
      if (id) {
        // UPDATE
        const sets = cols.map(([_, a], i) => `${a.column} = $${i + 1}`).join(', ');
        const vals = cols.map(([n]) => coerce(params[n] ?? null));
        vals.push(id);
        await query(
          `UPDATE ${info.table} SET ${sets} WHERE ${info.primaryKey} = $${cols.length + 1}`,
          vals as unknown[]
        );
      } else {
        // INSERT
        const colNames = cols.map(([_, a]) => a.column).join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const vals = cols.map(([n]) => coerce(params[n] ?? null));
        await query(
          `INSERT INTO ${info.table} (${colNames}) VALUES (${placeholders})`,
          vals as unknown[]
        );
      }
      res.status(302).setHeader('Location', `/maintenance/${boName}`).send('');
      return true;
    }
    case 'delete': {
      if (!isPost) { res.status(405).send('delete: POST only'); return true; }
      const id = params.id ?? '';
      if (!id) { res.status(400).send('delete: ?id= required'); return true; }
      await query(`DELETE FROM ${info.table} WHERE ${info.primaryKey} = $1`, [id]);
      res.status(302).setHeader('Location', `/maintenance/${boName}`).send('');
      return true;
    }
    default:
      res.status(404).send(`unknown maintenance action: ${action}`);
      return true;
  }
}

async function renderList(info: BOInfo, params: Record<string, string>): Promise<string> {
  const page = Math.max(1, parseInt(params.page ?? '1', 10));
  const offset = (page - 1) * PAGE_SIZE;

  // Columns to display: attributeGroups.list if available, else all.
  const columns = info.listGroup.length > 0
    ? info.listGroup
    : [...info.attributes.keys()];

  const pkAttr = info.primaryKey;
  const cols = [pkAttr, ...columns.filter(c => c !== pkAttr)]
    .map(c => info.attributes.get(c)?.column ?? c);

  const orderBy = info.primaryKey;
  const rows = await query(
    `SELECT ${cols.join(', ')} FROM ${info.table} ORDER BY ${orderBy} ASC LIMIT $1 OFFSET $2`,
    [PAGE_SIZE, offset]
  );
  const totalRow = await query(`SELECT count(*)::int AS n FROM ${info.table}`);
  const total = (totalRow[0]?.n as number) ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  let html = `<div class="cms-actions">
    <a class="cms-btn-primary" href="/maintenance/${esc(info.name)}/new">+ New</a>
  </div>`;
  html += '<table class="cms-table"><thead><tr>';
  for (const c of cols) html += `<th>${esc(c)}</th>`;
  html += '<th></th></tr></thead><tbody>';
  for (const r of rows) {
    html += '<tr>';
    for (const c of cols) html += `<td>${esc(String((r as any)[c] ?? ''))}</td>`;
    html += `<td>
      <a href="/maintenance/${esc(info.name)}/edit?id=${esc(String((r as any)[info.primaryKey] ?? ''))}">edit</a>
      <form method="POST" action="/maintenance/${esc(info.name)}/delete" style="display:inline">
        <input type="hidden" name="id" value="${esc(String((r as any)[info.primaryKey] ?? ''))}">
        <button type="submit" class="cms-btn-danger" onclick="return confirm('Delete this row?')">delete</button>
      </form>
    </td></tr>`;
  }
  html += '</tbody></table>';
  if (pages > 1) {
    html += `<div class="cms-pagination">page ${page} of ${pages}: `;
    if (page > 1)     html += `<a href="?page=${page - 1}">‹ prev</a> `;
    if (page < pages) html += `<a href="?page=${page + 1}">next ›</a>`;
    html += '</div>';
  }

  return renderShell(info, info.name, html);
}

async function renderEdit(info: BOInfo, id: string): Promise<string> {
  const rows = await query(
    `SELECT * FROM ${info.table} WHERE ${info.primaryKey} = $1`,
    [id]
  );
  const row = rows[0];
  if (!row) return renderShell(info, 'Not found', '<p>row not found</p>');
  const html = renderForm(info, row as Record<string, unknown>, /*isNew*/ false);
  return renderShell(info, `Edit ${info.name}#${id}`, html);
}

function renderForm(info: BOInfo, row: Record<string, unknown> | null, isNew: boolean): string {
  let html = `<form method="POST" action="/maintenance/${esc(info.name)}/save" class="cms-form">`;
  if (!isNew && row) {
    html += `<input type="hidden" name="id" value="${esc(String(row[info.primaryKey] ?? ''))}">`;
  }
  for (const [name, attr] of info.attributes.entries()) {
    if (name === info.primaryKey) continue;
    const value = row ? String(row[attr.column] ?? '') : '';
    const type = inputTypeFor(attr.dataType);
    html += `<label class="cms-control">
      <span>${esc(name)}</span>
      ${type === 'checkbox'
        ? `<input type="checkbox" name="${esc(name)}" value="true"${value === 'true' ? ' checked' : ''}>`
        : type === 'textarea'
        ? `<textarea name="${esc(name)}">${esc(value)}</textarea>`
        : `<input type="${type}" name="${esc(name)}" value="${esc(value)}">`
      }
    </label>`;
  }
  html += `<button type="submit" class="cms-btn-primary">${isNew ? 'Create' : 'Save'}</button>
    <a href="/maintenance/${esc(info.name)}" class="cms-btn-secondary">Cancel</a>
  </form>`;
  return html;
}

function inputTypeFor(dataType?: string): 'text' | 'number' | 'date' | 'checkbox' | 'textarea' {
  switch (dataType) {
    case 'dataType.Long':
    case 'dataType.Decimal':  return 'number';
    case 'dataType.Date':
    case 'dataType.Timestamp': return 'date';
    case 'dataType.Boolean':  return 'checkbox';
    default:                  return 'text';
  }
}

function coerce(v: string | null): unknown {
  if (v === null || v === '') return null;
  if (v === 'true')  return true;
  if (v === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function renderShell(_info: BOInfo, title: string, body: string): string {
  return `<!doctype html><html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · cms-vercel</title>
<link rel="stylesheet" href="/static/css/app.css">
<style>
  body { font-family: system-ui; padding: 1rem 2rem; }
  .cms-table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  .cms-table th, .cms-table td { padding: 6px 10px; border-bottom: 1px solid #e1e8ed; text-align: left; font-size: 13px; }
  .cms-table th { font-weight: 600; color: #475569; }
  .cms-actions { margin: 1rem 0; }
  .cms-btn-primary { background: #3b82f6; color: #fff; border: none; padding: 6px 14px; border-radius: 5px; text-decoration: none; cursor: pointer; }
  .cms-btn-secondary { background: #fff; border: 1px solid #cbd5e1; padding: 6px 14px; border-radius: 5px; text-decoration: none; color: #1f2937; margin-left: 8px; }
  .cms-btn-danger { background: #fee2e2; color: #7f1d1d; border: 1px solid #dc2626; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .cms-form { display: flex; flex-direction: column; gap: 12px; max-width: 560px; }
  .cms-control { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #475569; }
  .cms-control input, .cms-control textarea, .cms-control select { padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 5px; font-size: 13px; }
  .cms-pagination { margin-top: 1rem; color: #475569; font-size: 12px; }
</style></head>
<body><h1>${esc(title)}</h1>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
}

function writeHtml(res: VercelResponse, body: string) {
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(body);
}
