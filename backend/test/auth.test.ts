import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_KEY, JPEG, admin, setup, validJoin } from './helpers.js';

const GOOGLE = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' };
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Pretends to be Google's token endpoint: returns an ID token for whichever email the test sets.
let googleEmail = '';
let googleClaims: Record<string, unknown> = {};
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  expect(String(url)).toBe('https://oauth2.googleapis.com/token');
  const form = new URLSearchParams(String(init?.body));
  expect(form.get('client_secret')).toBe(GOOGLE.clientSecret);
  expect(form.get('code_verifier')).toBeTruthy();
  const claims = { iss: 'https://accounts.google.com', aud: GOOGLE.clientId, exp: Math.floor(Date.now() / 1000) + 3600, email: googleEmail, email_verified: true, name: 'Test', ...googleClaims };
  return new Response(JSON.stringify({ id_token: `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig` }), { status: 200 });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup({ google: GOOGLE, fetch: fakeFetch }); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); googleClaims = {}; });

const cookieHeader = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ');

/** Runs the whole Google sign-in for `email` and returns the session cookie and where it landed. */
async function googleSignIn(email: string) {
  googleEmail = email;
  const start = await t.inject('/auth/google');
  expect(start.statusCode).toBe(302);
  const to = new URL(start.headers.location);
  expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(to.searchParams.get('client_id')).toBe(GOOGLE.clientId);
  expect(to.searchParams.get('code_challenge_method')).toBe('S256');
  expect(to.searchParams.get('redirect_uri')).toBe('http://localhost/auth/google/callback');
  const back = await t.inject({
    url: `/auth/google/callback?code=abc&state=${encodeURIComponent(to.searchParams.get('state')!)}`,
    headers: { cookie: cookieHeader(start.cookies) },
  });
  const session = back.cookies.find((c) => c.startsWith('nita_session='));
  return { location: back.headers.location, cookie: session ? cookieHeader([session]) : '' };
}

async function makeMember(over: Record<string, unknown> = {}) {
  const res = await t.inject({ method: 'POST', url: '/api/v1/admin/members', headers: admin, payload: { name: 'Amit Ranjan', phone: '9431120457', email: 'Amit.Ranjan@Example.com', batch: 2008, branch: 'Electrical Engineering', degree: 'B.Tech', homeDistrict: 'Bhagalpur', ...over } });
  expect(res.statusCode).toBe(201);
  return res.json();
}

describe('sign-in page', () => {
  it('offers Google and the admin-key fallback', async () => {
    const res = await t.inject('/login');
    expect(res.body).toContain('Sign in with Google');
    expect(res.body).toContain('/auth/key');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });
});

describe('Sign in with Google', () => {
  it('signs in an admin by the email in their profile (any case) and opens the admin page', async () => {
    const m = await makeMember({ role: 'admin', title: 'President' });
    const s = await googleSignIn('amit.ranjan@example.com');
    expect(s.location).toBe('/admin');
    expect(s.cookie).toContain('nita_session=');
    const page = await t.inject({ url: '/admin', headers: { cookie: s.cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('/admin.js');
    const me = (await t.inject({ url: '/api/v1/me', headers: { cookie: s.cookie } })).json();
    expect(me).toMatchObject({ name: 'Amit Ranjan', role: 'admin', id: m.id });
    const log = (await t.inject({ url: '/api/v1/admin/audit', headers: admin })).json();
    expect(log[0]).toMatchObject({ action: 'member.signed_in', actor: 'member:Amit Ranjan' });
  });

  it('sends ordinary members to their profile, not the admin page', async () => {
    await makeMember();
    const s = await googleSignIn('amit.ranjan@example.com');
    expect(s.location).toBe('/me');
    const me = await t.inject({ url: '/me', headers: { cookie: s.cookie } });
    expect(me.body).toContain('Amit Ranjan');
    expect((await t.inject({ url: '/admin', headers: { cookie: s.cookie } })).headers.location).toBe('/me');
    expect((await t.inject({ url: '/api/v1/admin/members', headers: { cookie: s.cookie } })).statusCode).toBe(403);
  });

  it('explains why someone cannot sign in', async () => {
    expect((await googleSignIn('stranger@example.com')).location).toBe('/login?m=not_member&email=stranger%40example.com');
    await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ email: 'kumar@example.com' }) });
    expect((await googleSignIn('kumar@example.com')).location).toBe('/login?m=pending');
  });

  it('refuses a tampered state, an ID token for another app, and unverified emails', async () => {
    await makeMember();
    googleEmail = 'amit.ranjan@example.com';
    const start = await t.inject('/auth/google');
    const bad = await t.inject({ url: '/auth/google/callback?code=abc&state=wrong', headers: { cookie: cookieHeader(start.cookies) } });
    expect(bad.headers.location).toBe('/login?m=state');
    googleClaims = { aud: 'someone-else' };
    expect((await googleSignIn('amit.ranjan@example.com')).location).toBe('/login?m=google');
    googleClaims = { email_verified: false };
    expect((await googleSignIn('amit.ranjan@example.com')).location).toBe('/login?m=google');
  });

  it('ends access as soon as a member is suspended', async () => {
    const m = await makeMember({ role: 'admin' });
    const s = await googleSignIn('amit.ranjan@example.com');
    await t.inject({ method: 'POST', url: `/api/v1/admin/members/${m.id}/suspend`, headers: admin });
    expect((await t.inject({ url: '/admin', headers: { cookie: s.cookie } })).headers.location).toBe('/login?m=need');
  });

  it('rejects a forged session cookie', async () => {
    await makeMember({ role: 'admin' });
    const forged = `nita_session=${encodeURIComponent(JSON.stringify({ s: 'key', e: Date.now() + 1e9 }))}.AAAA`;
    expect((await t.inject({ url: '/admin', headers: { cookie: forged } })).headers.location).toBe('/login?m=need');
  });
});

describe('admin pages with a session', () => {
  it('requires the CSRF header for changes made with the cookie', async () => {
    await makeMember({ role: 'admin' });
    const pending = (await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin() })).json();
    const { cookie } = await googleSignIn('amit.ranjan@example.com');
    expect((await t.inject({ url: '/api/v1/admin/members?status=pending', headers: { cookie } })).json()).toHaveLength(1);
    const noHeader = await t.inject({ method: 'POST', url: `/api/v1/admin/members/${pending.id}/approve`, headers: { cookie } });
    expect(noHeader.statusCode).toBe(403);
    const ok = await t.inject({ method: 'POST', url: `/api/v1/admin/members/${pending.id}/approve`, headers: { cookie, 'x-requested-with': 'nita-admin' } });
    expect(ok.json()).toMatchObject({ status: 'verified', decidedBy: 'member:Amit Ranjan' });
  });

  it('lets moderators review registrations but not change roles, import or export', async () => {
    await makeMember({ role: 'moderator' });
    const pending = (await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin() })).json();
    const { cookie, location } = await googleSignIn('amit.ranjan@example.com');
    expect(location).toBe('/admin');
    const h = { cookie, 'x-requested-with': 'nita-admin' };
    expect((await t.inject({ method: 'POST', url: `/api/v1/admin/members/${pending.id}/reject`, headers: h, payload: { reason: 'Proof document unclear or missing' } })).statusCode).toBe(200);
    expect((await t.inject({ method: 'POST', url: `/api/v1/admin/members/${pending.id}/role`, headers: h, payload: { role: 'admin' } })).statusCode).toBe(403);
    expect((await t.inject({ url: '/api/v1/admin/members.csv', headers: { cookie } })).statusCode).toBe(403);
    expect((await t.inject({ method: 'POST', url: '/api/v1/admin/members', headers: h, payload: {} })).statusCode).toBe(403);
  });

  it('lets the admin key open the admin pages, so the first admin can set things up', async () => {
    const wrong = await t.inject({ method: 'POST', url: '/auth/key', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'key=nope' });
    expect(wrong.headers.location).toBe('/login?m=key');
    const ok = await t.inject({ method: 'POST', url: '/auth/key', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `key=${ADMIN_KEY}` });
    expect(ok.headers.location).toBe('/admin');
    const cookie = cookieHeader(ok.cookies.filter((c) => c.startsWith('nita_session=')));
    expect((await t.inject({ url: '/admin', headers: { cookie } })).statusCode).toBe(200);
    const created = await t.inject({ method: 'POST', url: '/api/v1/admin/members', headers: { cookie, 'x-requested-with': 'nita-admin' }, payload: { name: 'First Admin', phone: '9000000001', email: 'first@example.com', batch: 2010, branch: 'Civil Engineering', degree: 'B.Tech', homeDistrict: 'Patna', role: 'admin', title: 'President' } });
    expect(created.json()).toMatchObject({ role: 'admin', status: 'verified' });
    const out = await t.inject({ url: '/logout', headers: { cookie } });
    expect(out.cookies.join()).toContain('nita_session=;');
  });
});

describe('email for sign-in', () => {
  it('is required on the join form and unique across members', async () => {
    const noEmail = await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ email: '' }) });
    expect(noEmail.json().fields.email).toMatch(/sign in with Google/);
    await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin() });
    const dup = await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ phone: '9876500000', rollNo: 'OTHER1', email: 'KUMAR.GAURAV@example.com' }) });
    expect(dup.json().error).toBe('DUPLICATE_EMAIL');
  });
});

describe('member area', () => {
  const add = (over: Record<string, unknown>) =>
    t.inject({ method: 'POST', url: '/api/v1/admin/members', headers: admin, payload: { batch: 2015, branch: 'Civil Engineering', degree: 'B.Tech', homeDistrict: 'Patna', ...over } });

  it('shows the directory with phone and email filtered by each person\'s privacy choice', async () => {
    await add({ name: 'Batch Mate', phone: '9000000002', email: 'mate@example.com', phoneVisibility: 'batch' });
    await add({ name: 'Private Person', phone: '9000000003', email: 'private@example.com', phoneVisibility: 'admins', emailVisibility: 'admins' });
    await add({ name: 'Older Batch', phone: '9000000004', email: 'older@example.com', batch: 2008, phoneVisibility: 'batch' });
    await add({ name: 'Me Myself', phone: '9000000005', email: 'me@example.com' });
    await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ email: 'pending@example.com' }) });
    const { cookie, location } = await googleSignIn('me@example.com');
    expect(location).toBe('/me');
    const { items } = (await t.inject({ url: '/api/v1/members', headers: { cookie } })).json();
    const by = Object.fromEntries(items.map((m: { name: string }) => [m.name, m]));
    expect(Object.keys(by).sort()).toEqual(['Batch Mate', 'Me Myself', 'Older Batch', 'Private Person']);
    expect(by['Batch Mate'].phone).toBe('+919000000002');
    expect(by['Older Batch'].phone).toBeNull();
    expect(by['Private Person'].phone).toBeNull();
    expect(by['Private Person'].email).toBeNull();
    expect(by['Me Myself'].isMe).toBe(true);
    const filtered = (await t.inject({ url: '/api/v1/members?batch=2008', headers: { cookie } })).json();
    expect(filtered.items.map((m: { name: string }) => m.name)).toEqual(['Older Batch']);
    // Admins see everything.
    await add({ name: 'Chapter Admin', phone: '9000000006', email: 'boss@example.com', role: 'admin' });
    const a = await googleSignIn('boss@example.com');
    const all = (await t.inject({ url: '/api/v1/members', headers: { cookie: a.cookie } })).json().items;
    expect(all.find((m: { name: string }) => m.name === 'Private Person').phone).toBe('+919000000003');
  });

  it('lets members edit their own details and photo, but not their identity', async () => {
    await add({ name: 'Me Myself', phone: '9000000005', email: 'me@example.com' });
    const { cookie } = await googleSignIn('me@example.com');
    const body = { phone: '9000000005', homeDistrict: 'Gaya', position: 'Engineer', organisation: 'NTPC', workDistrict: 'Pune', workState: 'Maharashtra', openToMentor: true, phoneVisibility: 'batch', emailVisibility: 'members', email: 'hijack@example.com', batch: 1999, photo: JPEG };
    expect((await t.inject({ method: 'PUT', url: '/api/v1/me/profile', headers: { cookie }, payload: body })).statusCode).toBe(403);
    const res = await t.inject({ method: 'PUT', url: '/api/v1/me/profile', headers: { cookie, 'x-requested-with': 'nita-admin' }, payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ homeDistrict: 'Gaya', position: 'Engineer', workState: 'Maharashtra', openToMentor: true, phoneVisibility: 'batch', email: 'me@example.com', batch: 2015, hasPhoto: true });
    const photo = await t.inject({ url: `/api/v1/members/${res.json().id}/photo`, headers: { cookie } });
    expect(photo.headers['content-type']).toBe('image/jpeg');
    const bad = await t.inject({ method: 'PUT', url: '/api/v1/me/profile', headers: { cookie, 'x-requested-with': 'nita-admin' }, payload: { ...body, homeDistrict: 'Kolkata', photo: undefined } });
    expect(bad.json().fields.homeDistrict).toMatch(/Bihar/);
    const log = (await t.inject({ url: '/api/v1/admin/audit', headers: admin })).json();
    expect(log[0]).toMatchObject({ action: 'member.profile_updated', actor: 'member:Me Myself' });
  });

  it('serves the member pages only to signed-in members', async () => {
    expect((await t.inject('/')).headers.location).toBe('/join');
    expect((await t.inject('/alumni')).headers.location).toBe('/login?m=need');
    expect((await t.inject('/api/v1/members')).statusCode).toBe(401);
    await add({ name: 'Me Myself', phone: '9000000005', email: 'me@example.com' });
    const { cookie } = await googleSignIn('me@example.com');
    expect((await t.inject({ url: '/', headers: { cookie } })).headers.location).toBe('/home');
    const home = await t.inject({ url: '/home', headers: { cookie } });
    expect(home.body).toContain('Namaste, Me');
    expect(home.body).toContain('verified alumni');
    for (const p of ['/alumni', '/me']) expect((await t.inject({ url: p, headers: { cookie } })).statusCode).toBe(200);
    // Editing now happens on My profile itself.
    expect((await t.inject({ url: '/me/edit', headers: { cookie } })).headers.location).toBe('/me');
    // The join form and admin API are not affected by the member check.
    expect((await t.inject({ method: 'POST', url: '/api/v1/join', payload: validJoin({ email: 'new@example.com' }) })).statusCode).toBe(201);
    expect((await t.inject({ url: '/api/v1/admin/members', headers: admin })).statusCode).toBe(200);
  });
});
