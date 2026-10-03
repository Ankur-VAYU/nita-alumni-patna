import { sql } from 'drizzle-orm';
import { createDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createHttpApp } from '../src/http/app.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/nita_test';
export const ADMIN_KEY = 'test-admin-key-test-admin-key-1234567890';
export const admin = { 'x-admin-key': ADMIN_KEY, 'x-admin-name': 'Amit Ranjan' };

export async function setup(extra: Partial<Parameters<typeof createHttpApp>[0]> = {}) {
  const { db, pool } = createDb(TEST_DATABASE_URL);
  await runMigrations(pool);
  const app = createHttpApp({ adminKey: ADMIN_KEY, rateLimit: false, openDb: async () => ({ db, release: async () => {} }), ...extra });
  const reset = () => db.execute(sql`TRUNCATE members, batch_records, audit_log, events, event_rsvps, posts, post_interests, post_reports RESTART IDENTITY CASCADE`);
  const close = () => pool.end();
  return { app, db, pool, reset, close, inject: (o: InjectOptions | string) => inject(app, o) };
}

export interface InjectOptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  payload?: string | object;
}

/** Sends a request to the app in memory and returns status, headers and body. */
export async function inject(app: ReturnType<typeof createHttpApp>, o: InjectOptions | string) {
  const opts = typeof o === 'string' ? { url: o } : o;
  const headers = new Headers(opts.headers);
  let body: string | undefined;
  if (typeof opts.payload === 'string') body = opts.payload;
  else if (opts.payload !== undefined) {
    body = JSON.stringify(opts.payload);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }
  const res = await app.request(`http://localhost${opts.url}`, { method: opts.method ?? 'GET', headers, body });
  const text = await res.text();
  return {
    cookies: res.headers.getSetCookie(),
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: text,
    json: () => JSON.parse(text),
  };
}

// Smallest files whose first bytes identify them as JPEG and PDF.
export const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]).toString('base64')}`;
export const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%test\n').toString('base64')}`;

export const validJoin = (over: Record<string, unknown> = {}) => ({
  name: 'Kumar Gaurav',
  phone: '90310 66284',
  email: 'kumar.gaurav@example.com',
  rollNo: '19pcs011',
  degree: 'M.Tech',
  batch: '2021',
  branch: 'Computer Science & Engineering',
  position: 'Data Analyst',
  organisation: 'Bihar State Electronics Dev. Corp.',
  workDistrict: 'Patna',
  workState: 'Bihar',
  homeDistrict: 'Saran',
  linkedin: '',
  skills: 'SQL, Python',
  openToMentor: false,
  phoneVisibility: 'members',
  emailVisibility: 'batch',
  vouchedBy: 'Priya Sinha, 2015',
  consent: true,
  website: '',
  ...over,
});
