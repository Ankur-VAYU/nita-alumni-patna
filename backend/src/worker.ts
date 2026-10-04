// Cloudflare Workers entry. Static files (site.css, the page scripts, emblem.svg, robots.txt) are served
// by Cloudflare from public/ before this code runs; everything else comes here.
// The database is reached through Hyperdrive, which keeps connections to the Neon database warm.
import pg from 'pg';
import { connectOnce } from './db/index.js';
import { applyMigrations } from './db/migrate.js';
import { createHttpApp } from './http/app.js';
import { refreshNita } from './news/nita.js';

interface Env {
  HYPERDRIVE: { connectionString: string };
  ADMIN_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  CONTACT_EMAIL?: string;
}

let app: ReturnType<typeof createHttpApp> | undefined;
// Set once this Worker instance has checked the database. Each request that finds it unset runs
// the (quick, locked) check itself: Workers must not await I/O started by another request.
let migrated = false;

/** Brings the database up to date once per Worker instance, so no one has to run migrations by hand. */
async function migrate(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await applyMigrations(client, (m) => console.log(m));
  } finally {
    await client.end();
  }
}

/** Runs the migration check once per instance; false if the database could not be brought up to date. */
async function ensureMigrated(env: Env) {
  if (migrated) return true;
  try {
    try {
      await migrate(env.HYPERDRIVE.connectionString);
    } catch {
      // Usually another instance updating the database at the same moment: wait and check again.
      await new Promise((r) => setTimeout(r, 500));
      await migrate(env.HYPERDRIVE.connectionString);
    }
    migrated = true;
    return true;
  } catch (err) {
    console.error('Database migration failed:', err);
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: unknown) {
    if (!(await ensureMigrated(env))) {
      return new Response('The site is starting up. Please try again in a minute.', { status: 503 });
    }
    app ??= createHttpApp({
      adminKey: env.ADMIN_API_KEY,
      google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : undefined,
      sessionSecret: env.SESSION_SECRET,
      contactEmail: env.CONTACT_EMAIL,
      openDb: () => connectOnce(env.HYPERDRIVE.connectionString),
    });
    return app.fetch(request, env, ctx as never);
  },

  /** Every 6 hours (see "triggers" in wrangler.jsonc): read the latest notices, news and events from nita.ac.in. */
  async scheduled(_event: unknown, env: Env) {
    if (!(await ensureMigrated(env))) return;
    const { db, release } = await connectOnce(env.HYPERDRIVE.connectionString);
    try {
      const s = await refreshNita(db);
      if (s.lastError) console.error('nita.ac.in check failed:', s.lastError);
      else console.log('nita.ac.in checked:', JSON.stringify(s.counts));
    } finally {
      await release();
    }
  },
};
