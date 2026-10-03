// Node.js entry: for running on your own server (docker-compose) or locally with `npm run dev`.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { loadConfig, type Config } from './config.js';
import { createDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { createHttpApp } from './http/app.js';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const { db, pool } = createDb(config.DATABASE_URL);
await runMigrations(pool, (m) => console.log(m));

const app = new Hono();
app.use('/*', serveStatic({ root: './public' }));
app.route(
  '/',
  createHttpApp({
    adminKey: config.ADMIN_API_KEY,
    google: config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } : undefined,
    sessionSecret: config.SESSION_SECRET,
    contactEmail: config.CONTACT_EMAIL,
    openDb: async () => ({ db, release: async () => {} }),
  }),
);

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) =>
  console.log(`Server listening on http://${info.address}:${info.port}`),
);

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
