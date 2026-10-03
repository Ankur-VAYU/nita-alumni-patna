import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

/** A connection pool, for the Node server and the command line. */
export function createDb(connectionString: string, { max = 10 }: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max });
  const db: Db = drizzle(pool, { schema });
  return { db, pool };
}

/** One connection for one request, for Cloudflare Workers (connections cannot outlive a request). */
export async function connectOnce(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const db: Db = drizzle(client, { schema });
  return { db, release: () => client.end() };
}
