// Reads the latest items from the nita.ac.in home page: Notice Board, Latest News and Upcoming Events.
// The page is an ASP.NET site whose repeaters give each item a stable id
// (Repeater_Announcement_…, Repeater_News_…, Repeater_Events_…), which is what this relies on.
// Each section is cut out of the page first, so the patterns only scan a few kilobytes.
import { asc, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { appState, instituteItems } from '../db/schema.js';

export const NITA_URL = 'https://nita.ac.in/';
export const PER_SECTION = 2;

export interface InstituteItem {
  section: 'notice' | 'news' | 'event';
  title: string;
  summary: string | null;
  link: string;
  /** YYYY-MM-DD, or null when the site gives no date. */
  date: string | null;
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Tags removed, entities decoded, spaces collapsed. */
export function plainText(html: string) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Absolute http(s) link, or null for anything else (javascript:, "##", mailto:). */
function absolute(href: string): string | null {
  const h = href.trim().replace(/&amp;/g, '&');
  if (!h || h.startsWith('#')) return null;
  try {
    const u = new URL(h, NITA_URL);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const isoDate = (d: string, mon: string, y: string) => {
  const m = MONTHS[mon.slice(0, 3).toLowerCase()];
  return m ? `${y}-${m}-${d.padStart(2, '0')}` : null;
};

/** The part of the page between the first marker and the next `stop`, or '' if the marker is missing. */
function slice(html: string, marker: string, stop: string, max = 40_000) {
  const i = html.indexOf(marker);
  if (i < 0) return '';
  const j = html.indexOf(stop, i + marker.length);
  return html.slice(i, j > i ? Math.min(j, i + max) : i + max);
}

function notices(html: string): InstituteItem[] {
  const part = slice(html, 'Repeater_Announcement_', 'notice-footer');
  const out: InstituteItem[] = [];
  const re = /id="[^"]*Repeater_Announcement_hyprAnnmnt_\d+"\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(part)) && out.length < PER_SECTION; ) {
    const link = absolute(m[1]);
    const title = plainText(m[2]);
    if (!link || !title) continue;
    // The board shows no dates; the file names carry one, e.g. Notice_01-10-2026_….pdf
    const d = /(\d{2})-(\d{2})-(\d{4})/.exec(m[1]);
    out.push({ section: 'notice', title, summary: null, link, date: d ? `${d[3]}-${d[2]}-${d[1]}` : null });
  }
  return out;
}

function news(html: string): InstituteItem[] {
  const out: InstituteItem[] = [];
  // Each card holds the date spans, the headline link, then a details link.
  for (const card of newsCards(html)) {
    if (out.length >= PER_SECTION) break;
    const head = /id="[^"]*Repeater_News_hyprNews_\d+"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(card);
    if (!head) continue;
    const title = plainText(head[2]);
    if (!title) continue;
    const d = /<span class="date">\s*(\d{1,2})\s*<\/span>\s*<span class="month">\s*([A-Za-z]+)\s*<\/span>\s*<span class="year">\s*(\d{4})\s*<\/span>/.exec(card);
    const at = card.search(/id="[^"]*Repeater_News_hyprDetails_\d+"/);
    const details = at >= 0 ? card.slice(card.indexOf('>', at) + 1, card.indexOf('</div>', at) > at ? card.indexOf('</div>', at) : undefined) : '';
    // Some headlines link to "##"; then the link inside the details text is the real one.
    const inner = /href="(https?:[^"]+)"/.exec(details);
    const link = absolute(head[1]) ?? (inner ? absolute(inner[1]) : null) ?? NITA_URL;
    let summary: string | null = plainText(details).replace(/[.\s]+$/, '') || null;
    if (summary && summary.toLowerCase() === title.toLowerCase()) summary = null;
    out.push({ section: 'news', title, summary, link, date: d ? isoDate(d[1], d[2], d[3]) : null });
  }
  return out;
}

/** The Latest News cards: from the card holding the first news item up to the Notice Board. */
function newsCards(html: string) {
  const first = html.indexOf('Repeater_News_hyprNews_');
  if (first < 0) return [];
  const start = html.lastIndexOf('class="news_card"', first);
  if (start < 0) return [];
  const end = html.indexOf('Notice Board', first);
  return html.slice(start, end > start ? end : start + 60_000).split('class="news_card"').filter((c) => c.trim());
}

function events(html: string): InstituteItem[] {
  // Start a little before the first event's date line (it sits just above the month label).
  const first = html.indexOf('Repeater_Events_lblMonth_');
  if (first < 0) return [];
  const from = html.lastIndexOf('<p class="mb-0">', first);
  const part = html.slice(from >= 0 ? from : first, (from >= 0 ? from : first) + 40_000);
  const out: InstituteItem[] = [];
  const re = /<p class="mb-0">\s*(\d{1,2})\s*<span id="[^"]*Repeater_Events_lblMonth_\d+">\s*([A-Za-z]+)\s*<\/span>\s*(\d{4})\s*<\/p>[\s\S]*?id="[^"]*Repeater_Events_EvnthlALb1_\d+"\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m; (m = re.exec(part)) && out.length < PER_SECTION; ) {
    const title = plainText(m[5]);
    if (!title) continue;
    out.push({ section: 'event', title, summary: null, link: absolute(m[4]) ?? NITA_URL, date: isoDate(m[1], m[2], m[3]) });
  }
  return out;
}

/** The latest items from each section of the nita.ac.in home page. */
export function parseNitaHome(html: string) {
  return { notice: notices(html), news: news(html), event: events(html) };
}

/* ---------- fetching and saving ---------- */


export interface FeedStatus { lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null; counts: Record<string, number> }

const STATUS_KEY = 'nita_feed';

export async function feedStatus(db: Db): Promise<FeedStatus> {
  const [row] = await db.select({ value: appState.value }).from(appState).where(sql`${appState.key} = ${STATUS_KEY}`);
  return (row?.value as FeedStatus | undefined) ?? { lastAttemptAt: null, lastSuccessAt: null, lastError: null, counts: {} };
}

async function saveStatus(db: Db, s: FeedStatus) {
  await db.insert(appState).values({ key: STATUS_KEY, value: s }).onConflictDoUpdate({ target: appState.key, set: { value: s, updatedAt: new Date() } });
}

/**
 * Downloads the nita.ac.in home page and replaces the saved items. If the site cannot be reached, or
 * none of the three sections can be read (for example after a redesign), the last good items stay.
 */
export async function refreshNita(db: Db, fetchImpl: typeof fetch = fetch): Promise<FeedStatus> {
  const before = await feedStatus(db);
  const now = new Date().toISOString();
  let error: string | null = null;
  let found: ReturnType<typeof parseNitaHome> | null = null;
  try {
    const res = await fetchImpl(NITA_URL, {
      headers: { 'user-agent': 'NITA-Alumni-Patna-Chapter/1.0 (reads headlines 4 times a day)', accept: 'text/html' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`nita.ac.in answered ${res.status}`);
    found = parseNitaHome(await res.text());
    if (!found.notice.length && !found.news.length && !found.event.length) {
      found = null;
      throw new Error('No items found on the page. The website layout may have changed.');
    }
  } catch (e) {
    error = e instanceof Error ? (e.name === 'TimeoutError' ? 'nita.ac.in did not answer within 15 seconds' : e.message) : String(e);
  }
  if (found) {
    const rows = (['notice', 'news', 'event'] as const).flatMap((section) =>
      found![section].map((it, position) => ({
        section, position, title: it.title.slice(0, 400), summary: it.summary?.slice(0, 600) ?? null, link: it.link.slice(0, 600), itemDate: it.date,
      })),
    );
    await db.transaction(async (tx) => {
      // A section that came back empty keeps its previous items.
      for (const section of ['notice', 'news', 'event'] as const) {
        if (!found![section].length) continue;
        await tx.delete(instituteItems).where(sql`${instituteItems.section} = ${section}`);
      }
      if (rows.length) await tx.insert(instituteItems).values(rows);
    });
  }
  const status: FeedStatus = {
    lastAttemptAt: now,
    lastSuccessAt: found ? now : before.lastSuccessAt,
    lastError: error,
    counts: found ? { notice: found.notice.length, news: found.news.length, event: found.event.length } : before.counts,
  };
  await saveStatus(db, status);
  return status;
}

/** Saved items grouped by section, for the Home and welcome pages. */
export async function instituteFeed(db: Db) {
  const rows = await db.select().from(instituteItems).orderBy(asc(instituteItems.section), asc(instituteItems.position));
  const pick = (s: string) => rows.filter((r) => r.section === s).map(({ title, summary, link, itemDate }) => ({ title, summary, link, date: itemDate }));
  const status = await feedStatus(db);
  return { notice: pick('notice'), news: pick('news'), event: pick('event'), lastSuccessAt: status.lastSuccessAt };
}
