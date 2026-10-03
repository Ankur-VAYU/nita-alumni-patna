// Cloudflare Workers entry. Static files (join.css, join.js, emblem.svg, robots.txt) are served
// by Cloudflare from public/ before this code runs; everything else comes here.
// The database is reached through Hyperdrive, which keeps connections to the Neon database warm.
import { connectOnce } from './db/index.js';
import { createHttpApp } from './http/app.js';

interface Env {
  HYPERDRIVE: { connectionString: string };
  ADMIN_API_KEY?: string;
}

let app: ReturnType<typeof createHttpApp> | undefined;

export default {
  fetch(request: Request, env: Env, ctx: unknown) {
    app ??= createHttpApp({
      adminKey: env.ADMIN_API_KEY,
      openDb: () => connectOnce(env.HYPERDRIVE.connectionString),
    });
    return app.fetch(request, env, ctx as never);
  },
};
