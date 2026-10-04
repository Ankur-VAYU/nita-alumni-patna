import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseNitaHome, refreshNita } from '../src/news/nita.js';
import { admin, setup } from './helpers.js';

// Trimmed from the nita.ac.in home page as saved on 4 Oct 2026.
const PAGE = readFileSync(new URL('./fixtures/nita-home.html', import.meta.url), 'utf8');

let reply: () => Response = () => new Response(PAGE, { status: 200 });
let calls = 0;
const fakeFetch = (async (url: string | URL) => {
  calls += 1;
  expect(String(url)).toBe('https://nita.ac.in/');
  return reply();
}) as typeof fetch;

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup({ fetch: fakeFetch }); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); reply = () => new Response(PAGE, { status: 200 }); calls = 0; });

describe('reading the nita.ac.in home page', () => {
  it('takes the latest 2 from the Notice Board, Latest News and Upcoming Events', () => {
    const r = parseNitaHome(PAGE);
    expect(r.notice).toEqual([
      { section: 'notice', title: 'Notification regarding advertisement for the Post Doctoral Fellow (PDF) under Visvesvaraya scheme at NIT Agartala.', summary: null, link: 'https://nita.ac.in/Notice_01-10-2026_PDF-VisvesvarayaScheme-Oct26_admin.pdf', date: '2026-10-01' },
      { section: 'notice', title: 'Notice regarding result for recruitment to the post of Professor & Associate Professor.', summary: null, link: 'https://nita.ac.in/Notice_30-09-2026_Result-Intv-Prof-AssoProf-Sept2026_admin.pdf', date: '2026-09-30' },
    ]);
    expect(r.news).toEqual([
      { section: 'news', title: 'Revised Examination Schedule', summary: 'Revised Examination Schedule for Mid Term Examination of Odd Semester - AY 2026-27', link: 'https://nita.ac.in/News_23-09-2026_RevisedRoutine-Odd-Midterm-Sept26_admin.pdf', date: '2026-09-23' },
      // The headline links to "##"; the real link is inside the details.
      { section: 'news', title: 'Online Link', summary: 'Live link for applying the Group B and Group C Technical vacant posts at NIT Agartala', link: 'https://test.cbexams.com/EDPSU/NIT/Registration/Regstep', date: '2026-09-20' },
    ]);
    expect(r.event.map((e) => [e.date, e.link])).toEqual([['2026-11-13', 'https://scrs.in/conference/iti2026'], ['2027-02-19', 'https://www.icetme2027.com/']]);
    expect(r.event[0].title).toMatch(/^3rd International Conference on Information Technology and Intelligence \(ITI 2026\)/);
  });

  it('never keeps javascript: links and copes with a page without the sections', () => {
    const evil = PAGE.replace('href="Notice_01-10-2026_PDF-VisvesvarayaScheme-Oct26_admin.pdf"', 'href="javascript:alert(1)"');
    expect(parseNitaHome(evil).notice[0].link).toMatch(/^https:\/\/nita\.ac\.in\/Notice_30-09-2026/);
    expect(parseNitaHome('<html><body>Maintenance</body></html>')).toEqual({ notice: [], news: [], event: [] });
  });
});

describe('saving and showing the headlines', () => {
  it('saves them, shows them on the welcome and home pages, and keeps them when a check fails', async () => {
    const ok = await refreshNita(t.db, fakeFetch);
    expect(ok).toMatchObject({ lastError: null, counts: { notice: 2, news: 2, event: 2 } });
    const welcome = (await t.inject('/')).body;
    expect(welcome).toContain('Revised Examination Schedule');
    expect(welcome).toContain('href="https://scrs.in/conference/iti2026"');
    expect(welcome).toContain('last checked');

    reply = () => new Response('busy', { status: 503 });
    const bad = await refreshNita(t.db, fakeFetch);
    expect(bad.lastError).toBe('nita.ac.in answered 503');
    expect(bad.lastSuccessAt).toBe(ok.lastSuccessAt);
    expect((await t.inject('/')).body).toContain('Revised Examination Schedule');

    reply = () => new Response('<html>New design</html>', { status: 200 });
    expect((await refreshNita(t.db, fakeFetch)).lastError).toMatch(/layout may have changed/);
    expect((await t.inject('/')).body).toContain('Revised Examination Schedule');
  });

  it('lets staff check now, at most once a minute', async () => {
    const r = await t.inject({ method: 'POST', url: '/api/v1/admin/nita/refresh', headers: admin });
    expect(r.json()).toMatchObject({ lastError: null });
    expect(calls).toBe(1);
    expect((await t.inject({ method: 'POST', url: '/api/v1/admin/nita/refresh', headers: admin })).statusCode).toBe(429);
    expect(calls).toBe(1);
    expect((await t.inject({ url: '/api/v1/admin/nita', headers: admin })).json().counts).toEqual({ notice: 2, news: 2, event: 2 });
    expect((await t.inject({ method: 'POST', url: '/api/v1/admin/nita/refresh' })).statusCode).toBe(401);
  });
});
