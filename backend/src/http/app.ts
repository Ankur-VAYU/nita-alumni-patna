import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { authorizationUrl, exchangeCode, randomToken, type GoogleConfig } from '../auth/google.js';
import { AppError, badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { BIHAR_DISTRICTS, BRANCHES, DEGREES, FIRST_BATCH_YEAR, TITLES, WORK_STATES } from '../lib/reference.js';
import { adminCreateInput, directoryQuery, fieldErrors, joinInput, profileUpdateInput, rejectInput, roleInput } from '../members/schemas.js';
import {
  approveMember, createByAdmin, exportMembersCsv, getFile, getMember, importBatchList, importMembers,
  chapterStats, findMemberByEmail, getDirectoryPhoto, getSessionMember, listAudit, listDirectory, listMembers, recordSignIn, registerFromForm,
  rejectMember, setRole, setStatus, updateOwnProfile,
} from '../members/service.js';
import { adminPage, alumniPage, boardPage, editProfilePage, eventsPage, homePage, loginPage, mePage, privacyPage } from './pages.js';
import { eventInput, postInput, postListQuery, postStatusInput, reportInput, rsvpInput } from '../community/schemas.js';
import {
  attendees, cancelRsvp, createEvent, createPost, dismissReports, eventPayments, homeHighlights, interestedIn, listEvents,
  listPosts, listReports, recordPayment, removePost, reportPost, rsvp, setEventStatus, setPostStatus, toggleInterest, updateEvent,
} from '../community/service.js';
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
  /** Google OAuth client. Without it, only the admin key can sign in. */
  google?: GoogleConfig;
  /** Secret for signing session cookies. Defaults to one derived from the admin key. */
  sessionSecret?: string;
  /** Shown on the privacy notice as the address for data requests. */
  contactEmail?: string;
  /** For tests: replaces the call to Google's token endpoint. */
  fetch?: typeof fetch;
}

/** Who is making the request: a signed-in member, a session opened with the admin key, or the x-admin-key header. */
export interface Actor {
  kind: 'member' | 'key-session' | 'key-header';
  id?: string;
  name: string;
  role: 'admin' | 'moderator' | 'member';
  /** How the actor appears in the activity log. */
  label: string;
}

type Env = { Variables: { db: Db; actor: Actor } };

const SESSION_COOKIE = 'nita_session';
const OAUTH_COOKIE = 'nita_oauth';
const MEMBER_SESSION_DAYS = 30;
const KEY_SESSION_HOURS = 12;
// Non-GET admin requests made with the session cookie must carry this header. Browsers cannot
// add it to cross-site requests without a CORS preflight, which this app never allows.
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'nita-admin';

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

/** Who did it, for the activity log. */
const actorOf = (c: Context<Env>) => c.var.actor.label;

const isStaff = (role: string) => role === 'admin' || role === 'moderator';

export function createHttpApp(opts: HttpOptions) {
  const app = new Hono<Env>();
  const joinLimit = limiter(10, 60 * 60 * 1000);
  const adminFailLimit = limiter(20, 10 * 60 * 1000);
  const page = renderJoinPage();
  const adminDigest = opts.adminKey && opts.adminKey.length >= 32 ? createHash('sha256').update(opts.adminKey).digest() : null;
  const keyMatches = (given: string) => !!adminDigest && !!given && timingSafeEqual(createHash('sha256').update(given).digest(), adminDigest);
  const sessionSecret =
    opts.sessionSecret && opts.sessionSecret.length >= 32
      ? opts.sessionSecret
      : opts.adminKey && opts.adminKey.length >= 32
        ? createHash('sha256').update(`nita-session:${opts.adminKey}`).digest('hex')
        : null;
  const google = opts.google?.clientId && opts.google?.clientSecret ? opts.google : undefined;
  const signInLimit = limiter(30, 10 * 60 * 1000);

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
    c.json({ degrees: DEGREES, branches: BRANCHES, homeDistricts: BIHAR_DISTRICTS, workStates: WORK_STATES, titles: TITLES, firstBatchYear: FIRST_BATCH_YEAR }),
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

  /* ---------- sign-in and sessions ---------- */

  const secureCookie = (c: Context) => new URL(c.req.url).protocol === 'https:';
  const origin = (c: Context) => new URL(c.req.url).origin;

  async function startSession(c: Context, sub: string, maxAgeSeconds: number) {
    if (!sessionSecret) throw new AppError(503, 'NOT_CONFIGURED', 'Sign-in is not configured on the server.');
    const value = JSON.stringify({ s: sub, e: Date.now() + maxAgeSeconds * 1000 });
    await setSignedCookie(c, SESSION_COOKIE, value, sessionSecret, {
      path: '/', httpOnly: true, secure: secureCookie(c), sameSite: 'Lax', maxAge: maxAgeSeconds,
    });
  }

  /** The signed-in person, re-checked against the database on every request. */
  async function currentActor(c: Context<Env>): Promise<Actor | null> {
    if (!sessionSecret) return null;
    const raw = await getSignedCookie(c, sessionSecret, SESSION_COOKIE);
    if (!raw) return null;
    let payload: { s?: string; e?: number };
    try {
      payload = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!payload.s || !payload.e || payload.e < Date.now()) return null;
    if (payload.s === 'key') return { kind: 'key-session', name: 'Admin key', role: 'admin', label: 'admin-key' };
    const m = await getSessionMember(c.var.db, payload.s);
    if (!m || m.status !== 'verified') return null;
    return { kind: 'member', id: m.id, name: m.name, role: m.role, label: `member:${m.name}` };
  }

  const toLogin = (c: Context, code: string, extra: Record<string, string> = {}) =>
    c.redirect(`/login?${new URLSearchParams({ m: code, ...extra }).toString()}`);

  const pageHeaders = (c: Context) => {
    c.header('content-security-policy', FORM_CSP);
    c.header('cache-control', 'no-store');
  };

  app.get('/privacy', (c) => {
    c.header('content-security-policy', FORM_CSP);
    c.header('cache-control', 'public, max-age=3600');
    return c.html(privacyPage(opts.contactEmail));
  });

  app.get('/login', (c) => {
    pageHeaders(c);
    return c.html(loginPage(c.req.query('m'), c.req.query('email'), !!google));
  });

  app.get('/auth/google', async (c) => {
    if (!google || !sessionSecret) return toLogin(c, 'google_off');
    const state = randomToken();
    const verifier = randomToken(48);
    await setSignedCookie(c, OAUTH_COOKIE, JSON.stringify({ state, verifier, e: Date.now() + 10 * 60 * 1000 }), sessionSecret, {
      path: '/auth', httpOnly: true, secure: secureCookie(c), sameSite: 'Lax', maxAge: 600,
    });
    return c.redirect(authorizationUrl(google, `${origin(c)}/auth/google/callback`, state, verifier));
  });

  app.get('/auth/google/callback', withDb, async (c) => {
    if (!google || !sessionSecret) return toLogin(c, 'google_off');
    if (opts.rateLimit !== false && !signInLimit(clientIp(c))) return toLogin(c, 'limited');
    const raw = await getSignedCookie(c, sessionSecret, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: '/auth' });
    if (c.req.query('error')) return toLogin(c, 'cancelled');
    let saved: { state?: string; verifier?: string; e?: number } = {};
    try {
      saved = raw ? JSON.parse(raw) : {};
    } catch {
      saved = {};
    }
    const code = c.req.query('code');
    if (!code || !saved.state || !saved.verifier || saved.state !== c.req.query('state') || !saved.e || saved.e < Date.now()) {
      return toLogin(c, 'state');
    }
    let identity;
    try {
      identity = await exchangeCode(google, code, `${origin(c)}/auth/google/callback`, saved.verifier, opts.fetch);
    } catch (err) {
      console.error('Google sign-in failed:', (err as Error).message);
      return toLogin(c, 'google');
    }
    const m = await findMemberByEmail(c.var.db, identity.email);
    if (!m) return toLogin(c, 'not_member', { email: identity.email });
    if (m.status !== 'verified') return toLogin(c, m.status);
    await startSession(c, m.id, MEMBER_SESSION_DAYS * 24 * 3600);
    await recordSignIn(c.var.db, m, 'google');
    return c.redirect(isStaff(m.role) ? '/admin' : '/me');
  });

  app.post('/auth/key', async (c) => {
    if (opts.rateLimit !== false && !signInLimit(clientIp(c))) return toLogin(c, 'limited');
    const form = await c.req.parseBody();
    const given = typeof form.key === 'string' ? form.key.trim() : '';
    if (!sessionSecret || !keyMatches(given)) return toLogin(c, 'key');
    await startSession(c, 'key', KEY_SESSION_HOURS * 3600);
    return c.redirect('/admin');
  });

  app.get('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return toLogin(c, 'signed_out');
  });

  app.get('/', withDb, async (c) => c.redirect((await currentActor(c)) ? '/home' : '/join'));

  /** Pages for signed-in members. A session opened with the admin key has no member profile. */
  async function memberPage(c: Context<Env>) {
    const who = await currentActor(c);
    if (!who) return { redirect: toLogin(c, 'need') };
    if (who.kind !== 'member' || !who.id) return { redirect: c.redirect('/admin') };
    pageHeaders(c);
    return { who: who as Actor & { id: string } };
  }

  app.get('/home', withDb, async (c) => {
    const r = await memberPage(c);
    if (r.redirect) return r.redirect;
    const m = await getMember(c.var.db, r.who.id);
    const missing = [
      !m.hasPhoto && 'photo', !m.position && 'position', !m.organisation && 'organisation',
      !m.workDistrict && 'work city', !m.linkedin && 'LinkedIn', !m.skills && 'skills',
    ].filter(Boolean) as string[];
    return c.html(homePage(r.who, await chapterStats(c.var.db), missing, await homeHighlights(c.var.db)));
  });

  app.get('/alumni', withDb, async (c) => {
    const r = await memberPage(c);
    return r.redirect ?? c.html(alumniPage(r.who));
  });

  app.get('/events', withDb, async (c) => {
    const r = await memberPage(c);
    return r.redirect ?? c.html(eventsPage(r.who));
  });

  app.get('/board', withDb, async (c) => {
    const r = await memberPage(c);
    return r.redirect ?? c.html(boardPage(r.who));
  });

  app.get('/me/edit', withDb, async (c) => {
    const r = await memberPage(c);
    return r.redirect ?? c.html(editProfilePage(r.who));
  });

  /* ---------- member API (signed-in, verified members) ---------- */

  // Applied route by route: a middleware on the whole /api/v1 prefix would also catch the join form and admin API.
  const requireMember = createMiddleware<Env>(async (c, next) => {
    const who = await currentActor(c);
    if (!who || who.kind !== 'member' || !who.id) throw unauthorized('Please sign in again');
    if (c.req.method !== 'GET' && c.req.header(CSRF_HEADER) !== CSRF_VALUE) throw forbidden('Missing request header');
    c.set('actor', who);
    await next();
  });
  app.get('/api/v1/members', withDb, requireMember, async (c) => c.json(await listDirectory(c.var.db, c.var.actor.id!, parse(directoryQuery, c.req.query()))));
  app.get('/api/v1/members/:id/photo', withDb, requireMember, async (c) => {
    const f = await getDirectoryPhoto(c.var.db, c.req.param('id'));
    return c.body(new Uint8Array(f.data), 200, { 'content-type': f.type, 'cache-control': 'private, max-age=300' });
  });
  app.get('/api/v1/stats', withDb, requireMember, async (c) => c.json(await chapterStats(c.var.db)));
  app.get('/api/v1/me/profile', withDb, requireMember, async (c) => c.json(await getMember(c.var.db, c.var.actor.id!)));
  const me = (c: Context<Env>) => c.var.actor.id!;
  const pid = (c: Context<Env>) => c.req.param('id') ?? '';

  app.get('/api/v1/events', withDb, requireMember, async (c) => c.json(await listEvents(c.var.db, me(c))));
  app.post('/api/v1/events/:id/rsvp', withDb, requireMember, async (c) =>
    c.json(await rsvp(c.var.db, pid(c), me(c), parse(rsvpInput, await readJson(c)).guests)));
  app.delete('/api/v1/events/:id/rsvp', withDb, requireMember, async (c) => c.json(await cancelRsvp(c.var.db, pid(c), me(c))));
  app.get('/api/v1/events/:id/attendees', withDb, requireMember, async (c) => c.json(await attendees(c.var.db, pid(c))));

  app.get('/api/v1/posts', withDb, requireMember, async (c) => c.json(await listPosts(c.var.db, me(c), parse(postListQuery, c.req.query()))));
  app.post('/api/v1/posts', withDb, requireMember, async (c) => c.json(await createPost(c.var.db, me(c), parse(postInput, await readJson(c))), 201));
  app.post('/api/v1/posts/:id/status', withDb, requireMember, async (c) =>
    c.json(await setPostStatus(c.var.db, pid(c), parse(postStatusInput, await readJson(c)).status, { id: me(c), role: c.var.actor.role, label: c.var.actor.label })));
  app.post('/api/v1/posts/:id/interest', withDb, requireMember, async (c) => c.json(await toggleInterest(c.var.db, pid(c), me(c))));
  app.get('/api/v1/posts/:id/interested', withDb, requireMember, async (c) => c.json(await interestedIn(c.var.db, pid(c), me(c))));
  app.post('/api/v1/posts/:id/report', withDb, requireMember, async (c) =>
    c.json(await reportPost(c.var.db, pid(c), me(c), parse(reportInput, await readJson(c)).reason)));

  app.put('/api/v1/me/profile', withDb, requireMember, async (c) => {
    const input = parse(profileUpdateInput, await readJson(c, 600 * 1024));
    return c.json(await updateOwnProfile(c.var.db, c.var.actor.id!, input));
  });

  app.get('/me', withDb, async (c) => {
    const who = await currentActor(c);
    if (!who) return toLogin(c, 'need');
    if (who.kind !== 'member' || !who.id) return c.redirect('/admin');
    pageHeaders(c);
    return c.html(mePage(await getMember(c.var.db, who.id), who));
  });

  app.get('/admin', withDb, async (c) => {
    const who = await currentActor(c);
    if (!who) return toLogin(c, 'need');
    if (!isStaff(who.role)) return c.redirect('/me');
    pageHeaders(c);
    return c.html(adminPage(who));
  });

  app.get('/api/v1/me', withDb, async (c) => {
    const who = await currentActor(c);
    if (!who) throw unauthorized('Not signed in');
    return c.json({ name: who.name, role: who.role, kind: who.kind, id: who.id ?? null });
  });

  /* ---------- admin ---------- */

  const admin = new Hono<Env>();
  admin.use(withDb);
  admin.use(async (c, next) => {
    // 1) Tools and scripts: the admin key in a header.
    const headerKey = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? c.req.header('x-admin-key');
    if (headerKey !== undefined) {
      if (!adminDigest) throw new AppError(503, 'NOT_CONFIGURED', 'The admin key is not set on the server (ADMIN_API_KEY, at least 32 characters).');
      if (!keyMatches(headerKey)) {
        if (opts.rateLimit !== false && !adminFailLimit(clientIp(c))) throw new AppError(429, 'RATE_LIMITED', 'Too many failed attempts. Try again later.');
        throw unauthorized('A valid admin key is required');
      }
      const name = (c.req.header('x-admin-name') ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 60);
      c.set('actor', { kind: 'key-header', name: name || 'Admin key', role: 'admin', label: name ? `admin:${name}` : 'admin-api' });
      return next();
    }
    // 2) The admin pages: a signed-in admin or moderator.
    const who = await currentActor(c);
    if (!who) throw unauthorized('Please sign in again');
    if (!isStaff(who.role)) throw forbidden('Only chapter admins and moderators can do this');
    if (c.req.method !== 'GET' && c.req.header(CSRF_HEADER) !== CSRF_VALUE) throw forbidden('Missing request header');
    c.set('actor', who);
    await next();
  });
  /** Moderators may review registrations; everything else needs an admin. */
  const adminOnly = createMiddleware<Env>(async (c, next) => {
    if (c.var.actor.role !== 'admin') throw forbidden('Only chapter admins can do this');
    await next();
  });

  const csvBody = async (c: Context) => {
    const text = await readBody(c, CSV_BODY_LIMIT);
    if (!text.trim()) throw badRequest('Send the CSV file as the request body with Content-Type: text/csv');
    return text;
  };
  const id = (c: Context) => c.req.param('id') ?? '';

  admin.get('/members', async (c) => c.json(await listMembers(c.var.db, parse(listQuery, c.req.query()))));
  admin.get('/members.csv', adminOnly, async (c) => {
    const { status } = parse(listQuery, c.req.query());
    const csv = await exportMembersCsv(c.var.db, status);
    c.header('content-disposition', `attachment; filename="members${status ? '-' + status : ''}.csv"`);
    return c.body(csv, 200, { 'content-type': 'text/csv; charset=utf-8' });
  });
  admin.post('/members', adminOnly, async (c) => c.json(await createByAdmin(c.var.db, parse(adminCreateInput, await readJson(c)), actorOf(c)), 201));
  admin.post('/members/import', adminOnly, async (c) => {
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
  admin.post('/members/:id/suspend', adminOnly, async (c) => c.json(await setStatus(c.var.db, id(c), 'suspended', actorOf(c))));
  admin.post('/members/:id/reinstate', adminOnly, async (c) => c.json(await setStatus(c.var.db, id(c), 'verified', actorOf(c))));
  admin.post('/members/:id/role', adminOnly, async (c) => {
    const { role, title } = parse(roleInput, await readJson(c));
    return c.json(await setRole(c.var.db, id(c), role, title, actorOf(c)));
  });
  // Events: admins only. Reported posts: admins and moderators.
  admin.get('/events', adminOnly, async (c) => c.json(await listEvents(c.var.db, c.var.actor.id ?? '00000000-0000-0000-0000-000000000000')));
  admin.post('/events', adminOnly, async (c) => c.json(await createEvent(c.var.db, parse(eventInput, await readJson(c)), { id: c.var.actor.id, label: actorOf(c) }), 201));
  admin.put('/events/:id', adminOnly, async (c) => c.json(await updateEvent(c.var.db, id(c), parse(eventInput, await readJson(c)), actorOf(c))));
  admin.post('/events/:id/cancel', adminOnly, async (c) => c.json(await setEventStatus(c.var.db, id(c), 'cancelled', actorOf(c))));
  admin.post('/events/:id/restore', adminOnly, async (c) => c.json(await setEventStatus(c.var.db, id(c), 'published', actorOf(c))));
  admin.get('/events/:id/payments', adminOnly, async (c) => c.json(await eventPayments(c.var.db, id(c))));
  admin.post('/events/:id/payments/:memberId', adminOnly, async (c) => c.json(await recordPayment(c.var.db, id(c), c.req.param('memberId'), actorOf(c))));
  admin.get('/reports', async (c) => c.json(await listReports(c.var.db)));
  admin.post('/posts/:id/remove', async (c) => c.json(await removePost(c.var.db, id(c), actorOf(c))));
  admin.post('/posts/:id/dismiss', async (c) => c.json(await dismissReports(c.var.db, id(c), actorOf(c))));

  admin.post('/batch-list', adminOnly, async (c) => c.json(await importBatchList(c.var.db, await csvBody(c), actorOf(c))));
  admin.get('/audit', async (c) =>
    c.json(await listAudit(c.var.db, parse(z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }), c.req.query()).limit)),
  );

  app.route('/api/v1/admin', admin);
  return app;
}
