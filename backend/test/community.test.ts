import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { admin, setup } from './helpers.js';

const GOOGLE = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-secret' };
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
let googleEmail = '';
const fakeFetch = (async () => {
  const claims = { iss: 'https://accounts.google.com', aud: GOOGLE.clientId, exp: Math.floor(Date.now() / 1000) + 3600, email: googleEmail, email_verified: true };
  return new Response(JSON.stringify({ id_token: `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig` }), { status: 200 });
}) as typeof fetch;

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup({ google: GOOGLE, fetch: fakeFetch }); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });

const cookieHeader = (cookies: string[]) => cookies.map((c) => c.split(';')[0]).join('; ');

let n = 0;
/** Creates a verified member and signs them in; returns their id and a request helper. */
async function member(over: Record<string, unknown> = {}) {
  n += 1;
  const email = `m${n}@example.com`;
  const res = await t.inject({ method: 'POST', url: '/api/v1/admin/members', headers: admin, payload: {
    name: `Member ${n}`, phone: `94311${String(20000 + n).padStart(5, '0')}`, email, batch: 2010, branch: 'Electrical Engineering', degree: 'B.Tech', homeDistrict: 'Patna', ...over,
  } });
  expect(res.statusCode).toBe(201);
  const { id, name } = res.json();
  googleEmail = email;
  const start = await t.inject('/auth/google');
  const state = new URL(start.headers.location).searchParams.get('state')!;
  const back = await t.inject({ url: `/auth/google/callback?code=x&state=${encodeURIComponent(state)}`, headers: { cookie: cookieHeader(start.cookies) } });
  const cookie = cookieHeader(back.cookies.filter((c) => c.startsWith('nita_session=')));
  const req = (method: string, url: string, payload?: object) =>
    t.inject({ method, url, headers: { cookie, 'x-requested-with': 'nita-admin' }, payload });
  return { id, name, cookie, req };
}

const ist = (msFromNow: number) => new Date(Date.now() + msFromNow + 330 * 60000).toISOString().slice(0, 16);
const DAY = 24 * 3600 * 1000;

async function makeEvent(over: Record<string, unknown> = {}) {
  const res = await t.inject({ method: 'POST', url: '/api/v1/admin/events', headers: admin, payload: {
    title: 'Annual alumni meet', startsAt: ist(10 * DAY), venue: 'Hotel Maurya, Patna', feeRupees: 500, feeBasis: 'family', ...over,
  } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

const post = (over: Record<string, unknown> = {}) => ({
  type: 'job', title: 'Hiring two site engineers', body: 'Two years of experience in road projects.', district: 'Patna', state: 'Bihar', ...over,
});

describe('events', () => {
  it('reads the start time as India time and lists upcoming events first', async () => {
    const e = await makeEvent({ startsAt: '2030-11-15T17:00' });
    expect(new Date(e.startsAt).toISOString()).toBe('2030-11-15T11:30:00.000Z');
    await makeEvent({ title: 'Old meet', startsAt: ist(-30 * DAY) });
    const a = await member();
    const list = (await a.req('GET', '/api/v1/events')).json();
    expect(list.map((x: { title: string; past: boolean }) => [x.title, x.past])).toEqual([['Annual alumni meet', false], ['Old meet', true]]);
  });

  it('validates event input', async () => {
    const res = await t.inject({ method: 'POST', url: '/api/v1/admin/events', headers: admin, payload: { title: 'X', startsAt: 'soon', venue: '', feeRupees: -1 } });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().fields)).toEqual(expect.arrayContaining(['title', 'startsAt', 'venue', 'feeRupees']));
    const bad = await t.inject({ method: 'POST', url: '/api/v1/admin/events', headers: admin, payload: { title: 'Meet', startsAt: '2030-01-02T10:00', endsAt: '2030-01-02T09:00', venue: 'Patna', feeRupees: 0 } });
    expect(bad.json().fields.endsAt).toBeTruthy();
  });

  it('only admins manage events; members and moderators cannot', async () => {
    const mod = await member({ role: 'moderator' });
    expect((await mod.req('POST', '/api/v1/admin/events', { title: 'Meet', startsAt: ist(DAY), venue: 'Patna', feeRupees: 0 })).statusCode).toBe(403);
    const m = await member();
    expect((await m.req('POST', '/api/v1/admin/events', { title: 'Meet', startsAt: ist(DAY), venue: 'Patna', feeRupees: 0 })).statusCode).toBe(403);
  });

  it('takes RSVPs with guests, enforces capacity and computes the contribution', async () => {
    const e = await makeEvent({ capacity: 4, feeBasis: 'person', feeRupees: 300 });
    const a = await member();
    const b = await member();
    const r1 = await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 2 });
    expect(r1.json()).toEqual({ guests: 2, duePaise: 90000 });
    const full = await b.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 1 });
    expect(full.statusCode).toBe(409);
    expect(full.json().message).toContain('Only 1 place left');
    expect((await b.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 0 })).statusCode).toBe(200);
    // Changing your own RSVP doesn't count your old places against you.
    expect((await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 2 })).statusCode).toBe(200);
    expect((await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 11 })).statusCode).toBe(400);
    const mine = (await a.req('GET', '/api/v1/events')).json()[0];
    expect(mine).toMatchObject({ people: 4, rsvps: 2, placesLeft: 0, mine: { guests: 2, duePaise: 90000, paidPaise: 0 } });
    const who = (await b.req('GET', `/api/v1/events/${e.id}/attendees`)).json();
    expect(who).toHaveLength(2);
    expect(who[0]).not.toHaveProperty('phone');
  });

  it('refuses RSVPs to cancelled or past events', async () => {
    const e = await makeEvent();
    const old = await makeEvent({ startsAt: ist(-2 * DAY) });
    const a = await member();
    expect((await t.inject({ method: 'POST', url: `/api/v1/admin/events/${e.id}/cancel`, headers: admin })).statusCode).toBe(200);
    expect((await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 0 })).json().message).toContain('cancelled');
    expect((await a.req('POST', `/api/v1/events/${old.id}/rsvp`, { guests: 0 })).json().message).toContain('over');
    await t.inject({ method: 'POST', url: `/api/v1/admin/events/${e.id}/restore`, headers: admin });
    expect((await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 0 })).statusCode).toBe(200);
  });

  it('records payments at the venue and then blocks cancelling the RSVP', async () => {
    const e = await makeEvent();
    const a = await member();
    const b = await member();
    await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 3 });
    await b.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 0 });
    const paid = await t.inject({ method: 'POST', url: `/api/v1/admin/events/${e.id}/payments/${a.id}`, headers: admin });
    expect(paid.json()).toEqual({ paidPaise: 50000 });
    const p = (await t.inject({ url: `/api/v1/admin/events/${e.id}/payments`, headers: admin })).json();
    expect(p).toMatchObject({ people: 5, expectedPaise: 100000, collectedPaise: 50000 });
    expect(p.rows.find((r: { memberId: string }) => r.memberId === a.id)).toMatchObject({ paidPaise: 50000, paidRecordedBy: 'admin:Amit Ranjan' });
    expect((await a.req('DELETE', `/api/v1/events/${e.id}/rsvp`)).statusCode).toBe(400);
    expect((await b.req('DELETE', `/api/v1/events/${e.id}/rsvp`)).json()).toEqual({ cancelled: true });
    const log = (await t.inject({ url: '/api/v1/admin/audit', headers: admin })).json();
    expect(log.map((x: { action: string }) => x.action)).toContain('event.payment_recorded');
  });
});

describe('jobs & help board', () => {
  it('posts, validates and filters by type and state', async () => {
    const a = await member();
    expect((await a.req('POST', '/api/v1/posts', post())).statusCode).toBe(201);
    expect((await a.req('POST', '/api/v1/posts', post({ type: 'mentor', title: 'Mentoring for GATE aspirants', state: 'Karnataka', district: 'Bengaluru' }))).statusCode).toBe(201);
    const bad = await a.req('POST', '/api/v1/posts', post({ type: 'ad', title: 'x', state: 'Atlantis', applyLink: 'javascript:alert(1)' }));
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().fields)).toEqual(expect.arrayContaining(['type', 'title', 'state', 'applyLink']));
    const b = await member();
    expect((await b.req('GET', '/api/v1/posts')).json()).toHaveLength(2);
    expect((await b.req('GET', '/api/v1/posts?type=mentor')).json()).toHaveLength(1);
    expect((await b.req('GET', '/api/v1/posts?state=Bihar')).json()[0].title).toBe('Hiring two site engineers');
    expect((await b.req('GET', '/api/v1/posts?mine=true')).json()).toHaveLength(0);
  });

  it('limits members to 5 posts a day', async () => {
    const a = await member();
    for (let i = 0; i < 5; i++) expect((await a.req('POST', '/api/v1/posts', post({ title: `Vacancy number ${i}` }))).statusCode).toBe(201);
    expect((await a.req('POST', '/api/v1/posts', post())).statusCode).toBe(429);
  });

  it('shows author contact only as the author chose', async () => {
    const a = await member({ phoneVisibility: 'admins', emailVisibility: 'members' });
    await a.req('POST', '/api/v1/posts', post());
    const b = await member();
    const [p] = (await b.req('GET', '/api/v1/posts')).json();
    expect(p.authorPhone).toBeNull();
    expect(p.authorEmail).toBe(`m${n - 1}@example.com`);
    expect(p).not.toHaveProperty('authorPhoneVisibility');
  });

  it('lets only the author or staff change the status; closed posts drop off the board', async () => {
    const a = await member();
    const b = await member();
    const mod = await member({ role: 'moderator' });
    const { id } = (await a.req('POST', '/api/v1/posts', post())).json();
    expect((await b.req('POST', `/api/v1/posts/${id}/status`, { status: 'closed' })).statusCode).toBe(403);
    expect((await a.req('POST', `/api/v1/posts/${id}/status`, { status: 'filled' })).statusCode).toBe(200);
    expect((await b.req('GET', '/api/v1/posts')).json()).toHaveLength(0);
    expect((await b.req('GET', '/api/v1/posts?closed=true')).json()[0].status).toBe('filled');
    expect((await mod.req('POST', `/api/v1/posts/${id}/status`, { status: 'open' })).statusCode).toBe(200);
    expect((await b.req('GET', '/api/v1/posts')).json()).toHaveLength(1);
  });

  it('toggles interest; only the author sees who responded', async () => {
    const a = await member();
    const b = await member({ phoneVisibility: 'members' });
    const c = await member();
    const { id } = (await a.req('POST', '/api/v1/posts', post())).json();
    expect((await a.req('POST', `/api/v1/posts/${id}/interest`)).statusCode).toBe(400);
    expect((await b.req('POST', `/api/v1/posts/${id}/interest`)).json()).toEqual({ interested: true });
    const [p] = (await b.req('GET', '/api/v1/posts')).json();
    expect(p).toMatchObject({ interested: 1, iAmInterested: true });
    expect((await c.req('GET', `/api/v1/posts/${id}/interested`)).statusCode).toBe(403);
    const list = (await a.req('GET', `/api/v1/posts/${id}/interested`)).json();
    expect(list).toEqual([expect.objectContaining({ name: b.name, phone: expect.any(String) })]);
    expect((await b.req('POST', `/api/v1/posts/${id}/interest`)).json()).toEqual({ interested: false });
  });

  it('accepts one report per member; moderators remove or dismiss', async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const mod = await member({ role: 'moderator' });
    const p1 = (await a.req('POST', '/api/v1/posts', post())).json();
    const p2 = (await a.req('POST', '/api/v1/posts', post({ title: 'Need help with a transfer' }))).json();
    expect((await b.req('POST', `/api/v1/posts/${p1.id}/report`, { reason: 'Asks for money or a fee' })).statusCode).toBe(200);
    expect((await b.req('POST', `/api/v1/posts/${p1.id}/report`, { reason: 'Asks for money or a fee' })).statusCode).toBe(409);
    await c.req('POST', `/api/v1/posts/${p1.id}/report`, { reason: 'Paid placement agency' });
    await c.req('POST', `/api/v1/posts/${p2.id}/report`, { reason: 'Promotional, not relevant' });
    expect((await b.req('GET', '/api/v1/admin/reports')).statusCode).toBe(403);
    const reports = (await mod.req('GET', '/api/v1/admin/reports')).json();
    expect(reports.find((r: { postId: string }) => r.postId === p1.id)).toMatchObject({ count: 2, reasons: ['Paid placement agency', 'Asks for money or a fee'] });
    expect((await mod.req('POST', `/api/v1/admin/posts/${p1.id}/remove`)).statusCode).toBe(200);
    expect((await mod.req('POST', `/api/v1/admin/posts/${p2.id}/dismiss`)).statusCode).toBe(200);
    expect((await mod.req('GET', '/api/v1/admin/reports')).json()).toHaveLength(0);
    const board = (await b.req('GET', '/api/v1/posts?closed=true')).json();
    expect(board.map((x: { id: string }) => x.id)).toEqual([p2.id]);
  });
});

describe('news', () => {
  const chapter = (over: Record<string, unknown> = {}) => ({ kind: 'chapter', title: 'Volunteers needed for the meet', body: 'Six volunteers for registration.', ...over });

  it('lets admins and moderators post; members only read', async () => {
    const mod = await member({ role: 'moderator' });
    const m = await member();
    expect((await mod.req('POST', '/api/v1/admin/news', chapter({ pinned: true }))).statusCode).toBe(201);
    expect((await m.req('POST', '/api/v1/admin/news', chapter())).statusCode).toBe(403);
    const list = (await m.req('GET', '/api/v1/news')).json();
    expect(list[0]).toMatchObject({ kind: 'chapter', pinned: true, createdByLabel: `member:${mod.name}` });
    expect((await t.inject('/api/v1/news')).statusCode).toBe(401);
  });

  it('validates by kind and shows pinned announcements and updates on the home page', async () => {
    const bad = await t.inject({ method: 'POST', url: '/api/v1/admin/news', headers: admin, payload: { kind: 'institute', title: 'Convocation notice' } });
    expect(bad.json().fields.link).toBeTruthy();
    const js = await t.inject({ method: 'POST', url: '/api/v1/admin/news', headers: admin, payload: { kind: 'institute', title: 'Convocation notice', link: 'javascript:alert(1)' } });
    expect(js.statusCode).toBe(400);
    expect((await t.inject({ method: 'POST', url: '/api/v1/admin/news', headers: admin, payload: chapter({ body: '' }) })).json().fields.body).toBeTruthy();
    await t.inject({ method: 'POST', url: '/api/v1/admin/news', headers: admin, payload: { kind: 'institute', tag: 'Notice', title: 'Convocation registration open', link: 'https://www.nita.ac.in/notice', publishedOn: '2026-09-18' } });
    const a = (await t.inject({ method: 'POST', url: '/api/v1/admin/news', headers: admin, payload: chapter({ pinned: true }) })).json();
    const m = await member();
    const home = await t.inject({ url: '/home', headers: { cookie: m.cookie } });
    expect(home.body).toContain('Volunteers needed for the meet');
    expect(home.body).toContain('Convocation registration open');
    expect(home.body).toContain('href="https://www.nita.ac.in/notice"');
    const upd = await t.inject({ method: 'PUT', url: `/api/v1/admin/news/${a.id}`, headers: admin, payload: chapter({ title: 'Volunteers still needed' }) });
    expect(upd.json()).toMatchObject({ title: 'Volunteers still needed', pinned: false });
    expect((await t.inject({ method: 'DELETE', url: `/api/v1/admin/news/${a.id}`, headers: admin })).json()).toEqual({ deleted: true });
    expect((await t.inject({ url: '/news', headers: { cookie: m.cookie } })).body).not.toContain('Volunteers still needed');
  });
});

describe('admin overview and batch list', () => {
  it('counts what needs attention', async () => {
    await member({ role: 'admin' });
    const e = await makeEvent({ feeRupees: 200 });
    const a = await member();
    await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 1 });
    await t.inject({ method: 'POST', url: '/api/v1/join', payload: { ...(await import('./helpers.js')).validJoin({ email: 'waiting@example.com', phone: '9000099999' }) } });
    const o = (await t.inject({ url: '/api/v1/admin/overview', headers: admin })).json();
    expect(o).toMatchObject({ pending: 1, admins: 1, nextEvent: { people: 2, unpaidPaise: 20000 } });
  });

  it('shows batch-list stats and finds graduates by roll number or name', async () => {
    await t.inject({ method: 'POST', url: '/api/v1/admin/batch-list', headers: { ...admin, 'content-type': 'text/csv' },
      payload: 'roll_no,name,batch,branch,degree\n19PCS011,Kumar Gaurav,2021,Computer Science & Engineering,M.Tech\n08UCE021,Rohit Kumar,2012,Civil Engineering,B.Tech\n' });
    const all = (await t.inject({ url: '/api/v1/admin/batch-list', headers: admin })).json();
    expect(all).toMatchObject({ count: 2, minBatch: 2012, maxBatch: 2021, lastUploadedBy: 'admin:Amit Ranjan' });
    expect((await t.inject({ url: '/api/v1/admin/batch-list?q=gaurav', headers: admin })).json().rows).toEqual([expect.objectContaining({ rollNo: '19PCS011' })]);
  });
});

describe('directory summary', () => {
  it('counts members by work city and home district, and filters by city', async () => {
    await member({ workDistrict: 'Patna', homeDistrict: 'Saran' });
    await member({ workDistrict: ' patna ', homeDistrict: 'Saran' });
    const c = await member({ workDistrict: 'Bengaluru', workState: 'Karnataka', homeDistrict: 'Gaya' });
    const s = (await c.req('GET', '/api/v1/members/summary')).json();
    expect(s.total).toBe(3);
    expect(s.work[0]).toEqual({ place: 'Patna', n: 2 });
    expect(s.home[0]).toEqual({ place: 'Saran', n: 2 });
    expect(s.me).toMatchObject({ homeDistrict: 'Gaya' });
    expect((await c.req('GET', '/api/v1/members?workDistrict=Patna')).json().items).toHaveLength(2);
  });
});

describe('visitor pages', () => {
  it('shows the welcome page with the next event, institute updates and the titled committee only', async () => {
    await makeEvent({ title: 'Annual alumni meet' });
    await member({ name: 'Ankur President', title: 'President', role: 'admin', phone: '9431100001' });
    await member({ name: 'Secret Person', phone: '9431100002' });
    await t.inject({ method: 'POST', url: '/api/v1/admin/news', headers: admin, payload: { kind: 'institute', tag: 'Notice', title: 'Convocation registration open', link: 'https://www.nita.ac.in/notice' } });
    const res = await t.inject('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.body).toContain('wherever they work.');
    expect(res.body).toContain('Annual alumni meet');
    expect(res.body).toContain('Sign in to RSVP');
    expect(res.body).toContain('Convocation registration open');
    expect(res.body).toContain('Ankur President');
    expect(res.body).toContain('President · Electrical Engineering 2010');
    expect(res.body).not.toContain('Secret Person');
    expect(res.body).not.toContain('9431100001');
    expect(res.body).not.toContain('@example.com');
  });

  it('lists event details for visitors without who is going', async () => {
    const e = await makeEvent({ capacity: 50 });
    await makeEvent({ title: 'Cancelled meet' }).then((x) => t.inject({ method: 'POST', url: `/api/v1/admin/events/${x.id}/cancel`, headers: admin }));
    const a = await member();
    await a.req('POST', `/api/v1/events/${e.id}/rsvp`, { guests: 1 });
    const list = (await t.inject('/api/v1/public/events')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Annual alumni meet', people: 2, placesLeft: 48 });
    expect(JSON.stringify(list)).not.toContain(a.name);
    expect((await t.inject('/events')).statusCode).toBe(200);
    expect((await t.inject(`/api/v1/events/${e.id}/attendees`)).statusCode).toBe(401);
  });
});

describe('member pages', () => {
  it('shows the next event and latest posts on the home page', async () => {
    await makeEvent({ title: 'Chhath get-together' });
    const a = await member();
    await a.req('POST', '/api/v1/posts', post({ title: 'Referral at a Patna bank' }));
    const home = await t.inject({ url: '/home', headers: { cookie: a.cookie } });
    expect(home.body).toContain('Chhath get-together');
    expect(home.body).toContain('Referral at a Patna bank');
    for (const page of ['/events', '/board']) {
      const res = await t.inject({ url: page, headers: { cookie: a.cookie } });
      expect(res.statusCode).toBe(200);
    }
    expect((await t.inject('/board')).statusCode).toBe(302);
    expect((await t.inject('/alumni')).statusCode).toBe(302);
    expect((await t.inject('/api/v1/posts')).statusCode).toBe(401);
  });
});
