import { and, desc, eq, gt, ilike, lt, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { auditLog, batchRecords, eventRsvps, events, members, postReports, posts } from '../db/schema.js';
import { amountDuePaise } from '../community/service.js';

/** The admin Overview tab: headline numbers and the things that need someone's attention. */
export async function adminOverview(db: Db) {
  const [m] = await db
    .select({
      verified: sql<number>`count(*) FILTER (WHERE ${members.status} = 'verified')::int`,
      pending: sql<number>`count(*) FILTER (WHERE ${members.status} = 'pending')::int`,
      admins: sql<number>`count(*) FILTER (WHERE ${members.status} = 'verified' AND ${members.role} = 'admin')::int`,
      deletionRequests: sql<number>`count(*) FILTER (WHERE ${members.deletionRequestedAt} IS NOT NULL)::int`,
    })
    .from(members);
  const [{ openPosts }] = await db
    .select({ openPosts: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.status, 'open'), gt(posts.expiresAt, sql`now()`)));
  const [{ closingSoon }] = await db
    .select({ closingSoon: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.status, 'open'), gt(posts.expiresAt, sql`now()`), lt(posts.expiresAt, sql`now() + interval '7 days'`)));
  const [{ reported }] = await db
    .select({ reported: sql<number>`count(DISTINCT ${postReports.postId})::int` })
    .from(postReports)
    .innerJoin(posts, eq(posts.id, postReports.postId))
    .where(and(eq(postReports.status, 'open'), ne(posts.status, 'removed')));

  const [next] = await db
    .select({ id: events.id, title: events.title, feePaise: events.feePaise, feeBasis: events.feeBasis, startsAt: events.startsAt })
    .from(events)
    .where(and(eq(events.status, 'published'), gt(events.startsAt, sql`now()`)))
    .orderBy(events.startsAt)
    .limit(1);
  let nextEvent: { id: string; title: string; people: number; unpaidPaise: number } | null = null;
  if (next) {
    const rsvps = await db.select({ guests: eventRsvps.guests, paidPaise: eventRsvps.paidPaise }).from(eventRsvps).where(eq(eventRsvps.eventId, next.id));
    nextEvent = {
      id: next.id,
      title: next.title,
      people: rsvps.reduce((s, r) => s + 1 + r.guests, 0),
      unpaidPaise: rsvps.reduce((s, r) => s + Math.max(0, amountDuePaise(next, r.guests) - r.paidPaise), 0),
    };
  }

  const stale = await db
    .select({ name: members.name })
    .from(members)
    .where(and(eq(members.status, 'verified'), lt(members.updatedAt, sql`now() - interval '12 months'`)))
    .orderBy(members.updatedAt)
    .limit(50);

  return {
    verified: m.verified, pending: m.pending, admins: m.admins, deletionRequests: m.deletionRequests, openPosts, closingSoon, reported, nextEvent,
    staleProfiles: { count: stale.length, names: stale.slice(0, 5).map((s) => s.name) },
  };
}

/** The Batch list tab: what is in the list, when it was last uploaded, and a lookup by roll number or name. */
export async function batchListInfo(db: Db, q?: string) {
  const [s] = await db
    .select({ count: sql<number>`count(*)::int`, minBatch: sql<number | null>`min(${batchRecords.batch})`, maxBatch: sql<number | null>`max(${batchRecords.batch})` })
    .from(batchRecords);
  const [last] = await db
    .select({ at: auditLog.createdAt, by: auditLog.actor })
    .from(auditLog)
    .where(eq(auditLog.action, 'batch_list.uploaded'))
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  const like = q ? `%${q.replace(/[%_]/g, '\\$&')}%` : null;
  const rows = await db
    .select({ rollNo: batchRecords.rollNo, name: batchRecords.name, batch: batchRecords.batch, branch: batchRecords.branch, degree: batchRecords.degree })
    .from(batchRecords)
    .where(like ? or(ilike(batchRecords.rollNo, like), ilike(batchRecords.name, like)) : undefined)
    .orderBy(batchRecords.batch, batchRecords.rollNo)
    .limit(100);
  return { count: s.count, minBatch: s.minBatch, maxBatch: s.maxBatch, lastUploadedAt: last?.at ?? null, lastUploadedBy: last?.by ?? null, rows };
}
