/**
 * Phase 18 — session storage.
 *
 * Sessions are a Postgres row keyed by a random id; the cookie carries
 * the id. Schema is created lazily on first write so a fresh deploy
 * doesn't need a manual migration step.
 */

import { query } from './db.js';
import { randomBytes } from 'node:crypto';

let schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS cms_session (
      id         TEXT        PRIMARY KEY,
      payload    JSONB       NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  schemaEnsured = true;
}

export function newSessionId(): string {
  return randomBytes(24).toString('hex');
}

export async function persistSession(
  id: string,
  payload: Record<string, unknown>,
  ttlSeconds = 60 * 60 * 24 * 14, // 14 days
): Promise<void> {
  await ensureSchema();
  await query(
    `INSERT INTO cms_session (id, payload, expires_at)
     VALUES ($1, $2::jsonb, now() + ($3 || ' seconds')::interval)
     ON CONFLICT (id) DO UPDATE SET
       payload    = EXCLUDED.payload,
       expires_at = EXCLUDED.expires_at`,
    [id, JSON.stringify(payload), String(ttlSeconds)]
  );
}

export async function deleteSession(id: string): Promise<void> {
  try { await query(`DELETE FROM cms_session WHERE id = $1`, [id]); }
  catch { /* table may not exist; no-op */ }
}

/** Build a `Set-Cookie` value for the given session id. */
export function buildCookie(id: string, ttlSeconds = 60 * 60 * 24 * 14): string {
  return `cmsv_sid=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}`;
}

/**
 * CSRF token derived from the session id. Doesn't add server state — the
 * token is `sha256(sessionId + secret)` and is verified the same way.
 * Phase 18 minimum: a no-secret HMAC since we don't have a secret store
 * yet; will swap to env-var-backed secret in a follow-up.
 */
import { createHash } from 'node:crypto';
export function csrfToken(sid: string): string {
  return createHash('sha256').update(`csrf:${sid}`).digest('hex').slice(0, 16);
}
export function csrfMatches(sid: string, candidate: string): boolean {
  if (!sid || !candidate) return false;
  return csrfToken(sid) === candidate;
}
