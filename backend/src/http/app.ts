import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { BIHAR_DISTRICTS, BRANCHES, DEGREES, FIRST_BATCH_YEAR, WORK_STATES } from '../lib/reference.js';
import { adminCreateInput, fieldErrors, joinInput, rejectInput, roleInput } from '../members/schemas.js';
import {
  approveMember, createByAdmin, exportMembersCsv, getFile, getMember, importBatchList, importMembers,
  listAudit, listMembers, registerFromForm, rejectMember, setRole, setStatus,
} from '../members/service.js';
import joinTemplate from './join-template.js';

export interface DbSession {
  db: Db;
  release: () => Promise<void>;
}

export interface HttpOptions {
  adminKey: string | undefined;
  /** Opens a database connection for one request. */
  openDb: () => Promise<DbSession>;
  rateLimit?: boolean;
}

type Env = { Variables: { db: Db } };

// The join form posts photo (≤300 KB) + proof (≤500 KB) as base64 JSON, about 1.1 MB at most.
const JOIN_BODY_LIMIT = 1.2 * 1024 * 1024;
const CSV_BODY_LIMIT = 10 * 1024 * 1024;

const FORM_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const options = (list: readonly (string | number)[]) => list.map((v) => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');

function renderJoinPage() {
  const years: number[] = [];
  for (let y = new Date().getFullYear(); y >= FIRST_BATCH_YEAR; y--) years.push(y);
  return joinTemplate
    .replace('{{DEGREES}}', options(DEGREES))
    .replace('{{BRANCHES}}', options(BRANCHES))
    .replace('{{YEARS}}', options(years))
    .replace('{{DISTRICTS}}', options(BIHAR_DISTRICTS))
    .replace('{{STATES}}', options(WORK_STATES));
}

/** Small fixed-window limiter. Per server instance: on Cloudflare add a WAF rate-limit rule as well. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; until: number }>();
  return (key: string) => {
    const now = Date.now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.until < now) {
      hits.set(key, { n: 1, until: now + windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
}

const clientIp = (c: Context) =>
  c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

async function readBody(c: Context, limit: number) {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > limit) throw new AppError(413, 'TOO_LARGE', 'The upload is too large. Use a smaller photo or document.');
  const text = await c.req.text();
  if (text.length > limit) throw new AppError(413, 'TOO_LARGE', 'The upload is too large. Use a smaller photo or document.');
  return text;
}

async function readJson(c: Context, limit = 1024 * 1024): Promise<unknown> {
  const text = await readBody(c, limit);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('The request body is not valid JSON');
  }
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Some details need fixing', { fields: fieldErrors(r.error) });
  return r.data;
}

const listQuery = z.object({
  status: z.enum(['pending', 'verified', 'rejected', 'suspended']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const importQuery = z.object({
  dryRun: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  status: z.enum(['pending', 'verified']).default('verified'),
});

/** Who did it, for the audit log. Admin sign-in will replace this header later. */
const actorOf = (c: Context) => {
  const name = (c.req.header('x-admin-name') ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 60);
  return name ? `admin:${name}` : 'admin-api';
};

export function createHttpApp(opts: HttpOptions) {
  const app = new Hono<Env>();
  const joinLimit = limiter(10, 60 * 60 * 1000);
  const adminFailLimit = limiter(20, 10 * 60 * 1000);
  const page = renderJoinPage();
  const adminDigest = opts.adminKey && opts.adminKey.length >= 32 ? createHash('sha256').update(opts.adminKey).digest() : null;

  app.use(secureHeaders());

  app.onError((err, c) => {
    if (err instanceof AppError) {
      const details = (err.details ?? {}) as Record<string, unknown>;
      return c.json({ error: err.code, message: err.message, ...details }, err.statusCode as 400);
    }
    console.error(err);
    return c.json({ error: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' }, 500);
  });
  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'NOT_FOUND', message: 'Not found' }, 404) : c.text('Not found', 404)));

  const withDb = createMiddleware<Env>(async (c, next) => {
    const s = await opts.openDb();
    c.set('db', s.db);
    try {
      await next();
    } finally {
      await s.release().catch((e) => console.error('Closing the database connection failed', e));
    }
  });

  /* ---------- public ---------- */

  app.get('/', (c) => c.redirect('/join'));
  app.get('/join', (c) => {
    c.header('content-security-policy', FORM_CSP);
    c.header('cache-control', 'no-cache');
    return c.html(page);
  });

  app.get('/health', withDb, async (c) => {
    await c.var.db.execute(sql`SELECT 1`);
    return c.json({ ok: true });
  });

  app.get('/api/v1/reference', (c) =>
    c.json({ degrees: DEGREES, branches: BRANCHES, homeDistricts: BIHAR_DISTRICTS, workStates: WORK_STATES, firstBatchYear: FIRST_BATCH_YEAR }),
  );

  app.post('/api/v1/join', async (c, next) => {
    if (opts.rateLimit !== false && !joinLimit(clientIp(c)))
      throw new AppError(429, 'RATE_LIMITED', 'Too many attempts from this connection. Please try again in an hour.');
    await next();
  }, withDb, async (c) => {
    const input = parse(joinInput, await readJson(c, JOIN_BODY_LIMIT));
    const m = await registerFromForm(c.var.db, input);
    return c.json({ id: m.id, name: m.name, status: m.status }, 201);
  });

  /* ---------- admin ---------- */

  const admin = new Hono<Env>();
  admin.use(async (c, next) => {
    if (!adminDigest) throw new AppError(503, 'NOT_CONFIGURED', 'The admin key is not set on the server (ADMIN_API_KEY, at least 32 characters).');
    const given = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? c.req.header('x-admin-key') ?? '';
    if (!given || !timingSafeEqual(createHash('sha256').update(given).digest(), adminDigest)) {
      if (opts.rateLimit !== false && !adminFailLimit(clientIp(c)))
        throw new AppError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again later.');
      throw unauthorized('A valid admin key is required');
    }
    await next();
  });
  admin.use(withDb);

  const csvBody = async (c: Context) => {
    const text = await readBody(c, CSV_BODY_LIMIT);
    if (!text.trim()) throw badRequest('Send the CSV file as the request body with Content-Type: text/csv');
    return text;
  };
  const id = (c: Context) => c.req.param('id') ?? '';

  admin.get('/members', async (c) => c.json(await listMembers(c.var.db, parse(listQuery, c.req.query()))));
  admin.get('/members.csv', async (c) => {
    const { status } = parse(listQuery, c.req.query());
    const csv = await exportMembersCsv(c.var.db, status);
    c.header('content-disposition', `attachment; filename="members${status ? '-' + status : ''}.csv"`);
    return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8' });
  });
  admin.post('/members', async (c) => c.json(await createByAdmin(c.var.db, parse(adminCreateInput, await readJson(c)), actorOf(c)), 201));
  admin.post('/members/import', async (c) => {
    const q = parse(importQuery, c.req.query());
    return c.json(await importMembers(c.var.db, await csvBody(c), { ...q, actor: actorOf(c) }));
  });
  admin.get('/members/:id', async (c) => c.json(await getMember(c.var.db, id(c))));
  for (const kind of ['photo', 'proof'] as const) {
    admin.get(`/members/:id/${kind}`, async (c) => {
      const f = await getFile(c.var.db, id(c), kind);
      return c.body(new Uint8Array(f.data), 200, { 'content-type': f.type, 'cache-control': 'private, no-store', 'content-disposition': 'inline' });
    });
  }
  admin.post('/members/:id/approve', async (c) => c.json(await approveMember(c.var.db, id(c), actorOf(c))));
  admin.post('/members/:id/reject', async (c) => c.json(await rejectMember(c.var.db, id(c), parse(rejectInput, await readJson(c)).reason, actorOf(c))));
  admin.post('/members/:id/suspend', async (c) => c.json(await setStatus(c.var.db, id(c), 'suspended', actorOf(c))));
  admin.post('/members/:id/reinstate', async (c) => c.json(await setStatus(c.var.db, id(c), 'verified', actorOf(c))));
  admin.post('/members/:id/role', async (c) => {
    const { role, title } = parse(roleInput, await readJson(c));
    return c.json(await setRole(c.var.db, id(c), role, title, actorOf(c)));
  });
  admin.post('/batch-list', async (c) => c.json(await importBatchList(c.var.db, await csvBody(c), actorOf(c))));
  admin.get('/audit', async (c) =>
    c.json(await listAudit(c.var.db, parse(z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }), c.req.query()).limit)),
  );

  app.route('/api/v1/admin', admin);
  return app;
}
