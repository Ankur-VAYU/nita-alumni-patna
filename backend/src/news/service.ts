import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { announcements } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { audit } from '../members/service.js';
import type { NewsInput } from './schemas.js';

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

const COLUMNS = {
  id: announcements.id, kind: announcements.kind, tag: announcements.tag, title: announcements.title, body: announcements.body,
  link: announcements.link, pinned: announcements.pinned, publishedOn: announcements.publishedOn,
  createdByLabel: announcements.createdByLabel, createdAt: announcements.createdAt,
};

/** Pinned first, then newest. */
export async function listNews(db: Db, f: { kind?: 'chapter' | 'institute'; limit?: number } = {}) {
  const where: SQL[] = [];
  if (f.kind) where.push(eq(announcements.kind, f.kind));
  return db
    .select(COLUMNS)
    .from(announcements)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(announcements.pinned), desc(announcements.publishedOn), desc(announcements.createdAt))
    .limit(f.limit ?? 100);
}

const values = (input: NewsInput) => ({
  kind: input.kind, tag: input.kind === 'institute' ? input.tag ?? null : null, title: input.title, body: input.body ?? null, link: input.link ?? null,
  pinned: input.pinned, publishedOn: input.publishedOn ?? todayIST(),
});

export async function createNews(db: Db, input: NewsInput, actor: { id?: string; label: string }) {
  const [n] = await db.insert(announcements).values({ ...values(input), createdBy: actor.id ?? null, createdByLabel: actor.label }).returning(COLUMNS);
  await audit(db, actor.label, 'news.created', n.id, { kind: n.kind, title: n.title });
  return n;
}

export async function updateNews(db: Db, id: string, input: NewsInput, actorLabel: string) {
  if (!isUuid(id)) throw notFound('Item not found');
  const [n] = await db.update(announcements).set({ ...values(input), updatedAt: new Date() }).where(eq(announcements.id, id)).returning(COLUMNS);
  if (!n) throw notFound('Item not found');
  await audit(db, actorLabel, 'news.updated', id, { title: n.title });
  return n;
}

export async function deleteNews(db: Db, id: string, actorLabel: string) {
  if (!isUuid(id)) throw notFound('Item not found');
  const [n] = await db.delete(announcements).where(eq(announcements.id, id)).returning({ title: announcements.title });
  if (!n) throw notFound('Item not found');
  await audit(db, actorLabel, 'news.deleted', id, { title: n.title });
  return { deleted: true };
}

/** For the home page: pinned chapter announcements (or the latest one) and the latest institute updates. */
export async function newsHighlights(db: Db) {
  const chapter = await db
    .select(COLUMNS)
    .from(announcements)
    .where(eq(announcements.kind, 'chapter'))
    .orderBy(desc(announcements.pinned), desc(announcements.publishedOn), desc(announcements.createdAt))
    .limit(3);
  const pinned = chapter.filter((n) => n.pinned);
  const institute = await listNews(db, { kind: 'institute', limit: 3 });
  return { announcements: pinned.length ? pinned : chapter.slice(0, 1), institute };
}
