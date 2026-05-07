/**
 * Single Postgres pool, lazily warmed. One pool per Node process; Vercel's
 * runtime model means each warm function instance gets its own. Tuned with
 * the same conservative defaults the official runtime uses for Neon's
 * suspend behaviour.
 */

import { Pool } from 'pg';

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  _pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 5,                    // keep small — many Vercel instances share Neon
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 30_000,
    statement_timeout: 60_000
  });
  return _pool;
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool().connect();
  try {
    const r = await c.query(sql, params);
    return r.rows as T[];
  } finally {
    c.release();
  }
}
