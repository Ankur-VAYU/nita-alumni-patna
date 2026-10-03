import type pg from 'pg';
import { MIGRATIONS } from './migrations.generated.js';

interface Queryable {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * Applies every migration not yet recorded, all in one transaction. The table lock makes
 * concurrent starts wait instead of applying twice. Works through Cloudflare Hyperdrive,
 * which keeps a transaction on one database connection (session locks would not be safe there).
 */
export async function applyMigrations(client: Queryable, log: (msg: string) => void = () => {}) {
  // Quick path, used by almost every start: nothing to do, no lock taken.
  const exists = (await client.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0]?.t;
  if (exists) {
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => String(r.name)));
    if (MIGRATIONS.every((m) => done.has(m.name))) return;
  } else {
    try {
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    } catch (err) {
      // Another instance created it at the same moment.
      if (!['23505', '42P07'].includes((err as { code?: string }).code ?? '')) throw err;
    }
  }
  await client.query('BEGIN');
  try {
    await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => String(r.name)));
    for (const m of MIGRATIONS) {
      if (done.has(m.name)) continue;
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
      log(`Applied ${m.name}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

export async function runMigrations(pool: pg.Pool, log: (msg: string) => void = () => {}) {
  const client = await pool.connect();
  try {
    await applyMigrations(client, log);
  } finally {
    client.release();
  }
}
