import { and, desc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { eventRsvps, events, members, postInterests, postReports, posts } from '../db/schema.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, canSee, viewerFor } from '../members/service.js';
import type { EventInput, PostInput } from './schemas.js';

const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/* ---------- events ---------- */

/** Contribution owed for one RSVP: per family, or per person including guests. */
export const amountDuePaise = (e: { feePaise: number; feeBasis: 'family' | 'person' }, guests: number) =>
  e.feeBasis === 'person' ? e.feePaise * (1 + guests) : e.feePaise;

const EVENT_COLUMNS = {
  id: events.id, title: events.title, startsAt: events.startsAt, endsAt: events.endsAt, venue: events.venue,
  description: events.description, feePaise: events.feePaise, feeBasis: events.feeBasis, capacity: events.capacity,
  status: events.status, createdAt: events.createdAt,
};

async function headcounts(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, { people: number; rsvps: number }>();
  const rows = await db
    .select({ eventId: eventRsvps.eventId, people: sql<number>`sum(1 + ${eventRsvps.guests})::int`, rsvps: sql<number>`count(*)::int` })
    .from(eventRsvps)
    .where(inArray(eventRsvps.eventId, ids))
    .groupBy(eventRsvps.eventId);
  return new Map(rows.map((r) => [r.eventId, { people: r.people, rsvps: r.rsvps }]));
}

/** Events for members: upcoming first, then the most recent past ones, with the viewer's own RSVP. */
export async function listEvents(db: Db, viewerId: string) {
  const list = await db.select(EVENT_COLUMNS).from(events).orderBy(desc(events.startsAt)).limit(100);
  const counts = await headcounts(db, list.map((e) => e.id));
  const mine = list.length
    ? await db.select().from(eventRsvps).where(and(eq(eventRsvps.memberId, viewerId), inArray(eventRsvps.eventId, list.map((e) => e.id))))
    : [];
  const myBy = new Map(mine.map((r) => [r.eventId, r]));
  const now = Date.now();
  return list
    .map((e) => {
      const c = counts.get(e.id) ?? { people: 0, rsvps: 0 };
      const r = myBy.get(e.id);
      const past = (e.endsAt ?? e.startsAt).getTime() < now;
      return {
        ...e,
        past,
        people: c.people,
        rsvps: c.rsvps,
        placesLeft: e.capacity ? Math.max(0, e.capacity - c.people) : null,
        mine: r ? { guests: r.guests, duePaise: amountDuePaise(e, r.guests), paidPaise: r.paidPaise } : null,
      };
    })
    .sort((a, b) => (a.past === b.past ? (a.past ? b.startsAt.getTime() - a.startsAt.getTime() : a.startsAt.getTime() - b.startsAt.getTime()) : a.past ? 1 : -1));
}

async function getEvent(db: Db, id: string) {
  if (!isUuid(id)) throw notFound('Event not found');
  const [e] = await db.select(EVENT_COLUMNS).from(events).where(eq(events.id, id));
  if (!e) throw notFound('Event not found');
  return e;
}

export async function createEvent(db: Db, input: EventInput, actor: { id?: string; label: string }) {
  const [e] = await db
    .insert(events)
    .values({
      title: input.title, startsAt: input.startsAt, endsAt: input.endsAt ?? null, venue: input.venue,
      description: input.description ?? null, feePaise: input.feeRupees * 100, feeBasis: input.feeBasis,
      capacity: input.capacity ?? null, createdBy: actor.id ?? null,
    })
    .returning(EVENT_COLUMNS);
  await audit(db, actor.label, 'event.created', e.id, { title: e.title, startsAt: e.startsAt.toISOString(), fee: rupees(e.feePaise) });
  return e;
}

export async function updateEvent(db: Db, id: string, input: EventInput, actorLabel: string) {
  await getEvent(db, id);
  await db
    .update(events)
    .set({
      title: input.title, startsAt: input.startsAt, endsAt: input.endsAt ?? null, venue: input.venue,
      description: input.description ?? null, feePaise: input.feeRupees * 100, feeBasis: input.feeBasis,
      capacity: input.capacity ?? null, updatedAt: new Date(),
    })
    .where(eq(events.id, id));
  await audit(db, actorLabel, 'event.updated', id, { title: input.title });
  return getEvent(db, id);
}

export async function setEventStatus(db: Db, id: string, status: 'published' | 'cancelled', actorLabel: string) {
  const e = await getEvent(db, id);
  await db.update(events).set({ status, updatedAt: new Date() }).where(eq(events.id, id));
  await audit(db, actorLabel, status === 'cancelled' ? 'event.cancelled' : 'event.restored', id, { title: e.title });
  return getEvent(db, id);
}

/** RSVP or change the number of guests. Capacity is checked with the event row locked. */
export async function rsvp(db: Db, eventId: string, memberId: string, guests: number) {
  if (!isUuid(eventId)) throw notFound('Event not found');
  return db.transaction(async (tx) => {
    const [e] = await tx.select(EVENT_COLUMNS).from(events).where(eq(events.id, eventId)).for('update');
    if (!e) throw notFound('Event not found');
    if (e.status === 'cancelled') throw badRequest('This event has been cancelled');
    if ((e.endsAt ?? e.startsAt).getTime() < Date.now()) throw badRequest('This event is over');
    if (e.capacity) {
      const [{ others }] = await tx
        .select({ others: sql<number>`coalesce(sum(1 + ${eventRsvps.guests}), 0)::int` })
        .from(eventRsvps)
        .where(and(eq(eventRsvps.eventId, eventId), ne(eventRsvps.memberId, memberId)));
      const left = e.capacity - others;
      if (1 + guests > left) throw new AppError(409, 'FULL', left > 0 ? `Only ${left} place${left === 1 ? '' : 's'} left, including you` : 'This event is full');
    }
    await tx
      .insert(eventRsvps)
      .values({ eventId, memberId, guests })
      .onConflictDoUpdate({ target: [eventRsvps.eventId, eventRsvps.memberId], set: { guests, updatedAt: new Date() } });
    return { guests, duePaise: amountDuePaise(e, guests) };
  });
}

export async function cancelRsvp(db: Db, eventId: string, memberId: string) {
  if (!isUuid(eventId)) throw notFound('Event not found');
  const [r] = await db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
  if (!r) return { cancelled: false };
  if (r.paidPaise > 0) throw badRequest(`You have paid ${rupees(r.paidPaise)}. Please contact the treasurer to cancel.`);
  await db.delete(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
  return { cancelled: true };
}

/** Who is going, for members: names and batches only. */
export async function attendees(db: Db, eventId: string) {
  await getEvent(db, eventId);
  return db
    .select({ name: members.name, batch: members.batch, branch: members.branch, guests: eventRsvps.guests })
    .from(eventRsvps)
    .innerJoin(members, eq(members.id, eventRsvps.memberId))
    .where(eq(eventRsvps.eventId, eventId))
    .orderBy(members.name);
}

/** For admins: every RSVP with contact, amount due and amount paid. */
export async function eventPayments(db: Db, eventId: string) {
  const e = await getEvent(db, eventId);
  const rows = await db
    .select({
      memberId: eventRsvps.memberId, name: members.name, batch: members.batch, phone: members.phone,
      guests: eventRsvps.guests, paidPaise: eventRsvps.paidPaise, paidRecordedBy: eventRsvps.paidRecordedBy, paidAt: eventRsvps.paidAt,
    })
    .from(eventRsvps)
    .innerJoin(members, eq(members.id, eventRsvps.memberId))
    .where(eq(eventRsvps.eventId, eventId))
    .orderBy(members.name);
  const list = rows.map((r) => ({ ...r, duePaise: amountDuePaise(e, r.guests) }));
  const expected = list.reduce((s, r) => s + r.duePaise, 0);
  const collected = list.reduce((s, r) => s + r.paidPaise, 0);
  return { event: e, rows: list, people: list.reduce((s, r) => s + 1 + r.guests, 0), expectedPaise: expected, collectedPaise: collected };
}

/** The treasurer records cash or UPI received at the venue (or before). */
export async function recordPayment(db: Db, eventId: string, memberId: string, actorLabel: string) {
  const e = await getEvent(db, eventId);
  if (!isUuid(memberId)) throw notFound('RSVP not found');
  const [r] = await db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
  if (!r) throw notFound('RSVP not found');
  const due = amountDuePaise(e, r.guests);
  if (r.paidPaise >= due) return { paidPaise: r.paidPaise };
  await db
    .update(eventRsvps)
    .set({ paidPaise: due, paidRecordedBy: actorLabel, paidAt: new Date(), updatedAt: new Date() })
    .where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.memberId, memberId)));
  const [m] = await db.select({ name: members.name }).from(members).where(eq(members.id, memberId));
  await audit(db, actorLabel, 'event.payment_recorded', eventId, { event: e.title, member: m?.name, amount: rupees(due - r.paidPaise) });
  return { paidPaise: due };
}

/* ---------- jobs & help board ---------- */

const POST_COLUMNS = {
  id: posts.id, type: posts.type, title: posts.title, body: posts.body, organisation: posts.organisation,
  district: posts.district, state: posts.state, applyLink: posts.applyLink, status: posts.status,
  expiresAt: posts.expiresAt, authorId: posts.authorId, createdAt: posts.createdAt,
  authorName: members.name, authorBatch: members.batch, authorBranch: members.branch,
  authorPhone: members.phone, authorEmail: members.email, authorPhoneVisibility: members.phoneVisibility,
  authorEmailVisibility: members.emailVisibility,
};

export async function listPosts(db: Db, viewerId: string, f: { type?: string; state?: string; mine?: boolean; closed?: boolean }) {
  const viewer = await viewerFor(db, viewerId);
  if (!viewer) throw notFound('Member not found');
  const where: SQL[] = [ne(posts.status, 'removed')];
  if (!f.closed) where.push(eq(posts.status, 'open'), gt(posts.expiresAt, sql`now()`));
  if (f.type) where.push(eq(posts.type, f.type as 'job'));
  if (f.state) where.push(eq(posts.state, f.state));
  if (f.mine) where.push(eq(posts.authorId, viewerId));
  const rows = await db
    .select({
      ...POST_COLUMNS,
      interested: sql<number>`(SELECT count(*)::int FROM post_interests pi WHERE pi.post_id = ${posts.id})`,
      iAmInterested: sql<boolean>`EXISTS (SELECT 1 FROM post_interests pi WHERE pi.post_id = ${posts.id} AND pi.member_id = ${viewerId})`,
      iReported: sql<boolean>`EXISTS (SELECT 1 FROM post_reports pr WHERE pr.post_id = ${posts.id} AND pr.member_id = ${viewerId})`,
    })
    .from(posts)
    .innerJoin(members, eq(members.id, posts.authorId))
    .where(and(...where))
    .orderBy(desc(posts.createdAt))
    .limit(200);
  const now = Date.now();
  return rows.map(({ authorPhone, authorEmail, authorPhoneVisibility, authorEmailVisibility, ...p }) => {
    const owner = { id: p.authorId, batch: p.authorBatch };
    return {
      ...p,
      state: p.state,
      expired: p.status === 'open' && p.expiresAt.getTime() < now,
      isMine: p.authorId === viewerId,
      canManage: p.authorId === viewerId || viewer.role === 'admin' || viewer.role === 'moderator',
      authorPhone: canSee(authorPhoneVisibility, viewer, owner) ? authorPhone : null,
      authorEmail: canSee(authorEmailVisibility, viewer, owner) ? authorEmail : null,
    };
  });
}

async function getPost(db: Db, id: string) {
  if (!isUuid(id)) throw notFound('Post not found');
  const [p] = await db.select().from(posts).where(eq(posts.id, id));
  if (!p || p.status === 'removed') throw notFound('Post not found');
  return p;
}

export async function createPost(db: Db, authorId: string, input: PostInput) {
  // A simple brake on spam: at most 5 posts a day per member.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.authorId, authorId), gt(posts.createdAt, sql`now() - interval '1 day'`)));
  if (n >= 5) throw new AppError(429, 'RATE_LIMITED', 'You can post up to 5 times a day. Please try again tomorrow.');
  const [p] = await db
    .insert(posts)
    .values({
      type: input.type, title: input.title, body: input.body, organisation: input.organisation ?? null,
      district: input.district, state: input.state, applyLink: input.applyLink ?? null, authorId,
      expiresAt: new Date(Date.now() + input.expiresInDays * 24 * 3600 * 1000),
    })
    .returning({ id: posts.id, title: posts.title, expiresAt: posts.expiresAt });
  return p;
}

/** The author (or a moderator or admin) marks a post filled, closed, or reopens it for 30 days. */
export async function setPostStatus(db: Db, id: string, status: 'open' | 'filled' | 'closed', actor: { id: string; role: string; label: string }) {
  const p = await getPost(db, id);
  const staff = actor.role === 'admin' || actor.role === 'moderator';
  if (p.authorId !== actor.id && !staff) throw forbidden('Only the author can change this post');
  const set: Partial<typeof posts.$inferInsert> = { status, updatedAt: new Date() };
  if (status === 'open') set.expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  await db.update(posts).set(set).where(eq(posts.id, id));
  if (p.authorId !== actor.id) await audit(db, actor.label, 'post.status_changed', id, { title: p.title, status });
  return { status };
}

export async function toggleInterest(db: Db, postId: string, memberId: string) {
  const p = await getPost(db, postId);
  if (p.authorId === memberId) throw badRequest('This is your own post');
  const deleted = await db
    .delete(postInterests)
    .where(and(eq(postInterests.postId, postId), eq(postInterests.memberId, memberId)))
    .returning({ postId: postInterests.postId });
  if (deleted.length) return { interested: false };
  await db.insert(postInterests).values({ postId, memberId }).onConflictDoNothing();
  return { interested: true };
}

/** Who responded, for the author and staff. Contact details follow each responder's privacy choice. */
export async function interestedIn(db: Db, postId: string, viewerId: string) {
  const p = await getPost(db, postId);
  const viewer = await viewerFor(db, viewerId);
  if (!viewer) throw notFound('Member not found');
  if (p.authorId !== viewerId && viewer.role !== 'admin' && viewer.role !== 'moderator') throw forbidden('Only the author can see who is interested');
  const rows = await db
    .select({
      id: members.id, name: members.name, batch: members.batch, branch: members.branch, phone: members.phone, email: members.email,
      phoneVisibility: members.phoneVisibility, emailVisibility: members.emailVisibility, at: postInterests.createdAt,
    })
    .from(postInterests)
    .innerJoin(members, eq(members.id, postInterests.memberId))
    .where(eq(postInterests.postId, postId))
    .orderBy(postInterests.createdAt);
  return rows.map(({ phoneVisibility, emailVisibility, phone, email, ...r }) => ({
    ...r,
    phone: canSee(phoneVisibility, viewer, r) ? phone : null,
    email: canSee(emailVisibility, viewer, r) ? email : null,
  }));
}

export async function reportPost(db: Db, postId: string, memberId: string, reason: string) {
  const p = await getPost(db, postId);
  if (p.authorId === memberId) throw badRequest('This is your own post');
  const inserted = await db.insert(postReports).values({ postId, memberId, reason }).onConflictDoNothing().returning({ id: postReports.id });
  if (!inserted.length) throw conflict('You have already reported this post');
  return { reported: true };
}

/** Open reports for moderators, grouped by post. */
export async function listReports(db: Db) {
  const rows = await db
    .select({
      postId: posts.id, title: posts.title, body: posts.body, type: posts.type, authorName: members.name,
      reason: postReports.reason, reportedAt: postReports.createdAt,
    })
    .from(postReports)
    .innerJoin(posts, eq(posts.id, postReports.postId))
    .innerJoin(members, eq(members.id, posts.authorId))
    .where(and(eq(postReports.status, 'open'), ne(posts.status, 'removed')))
    .orderBy(desc(postReports.createdAt));
  const by = new Map<string, { postId: string; title: string; body: string; type: string; authorName: string; reasons: string[]; count: number; latest: Date }>();
  for (const r of rows) {
    const g = by.get(r.postId) ?? { postId: r.postId, title: r.title, body: r.body, type: r.type, authorName: r.authorName, reasons: [], count: 0, latest: r.reportedAt };
    g.count += 1;
    if (!g.reasons.includes(r.reason)) g.reasons.push(r.reason);
    by.set(r.postId, g);
  }
  return [...by.values()];
}

export async function removePost(db: Db, postId: string, actorLabel: string) {
  const p = await getPost(db, postId);
  await db.update(posts).set({ status: 'removed', updatedAt: new Date() }).where(eq(posts.id, postId));
  await db.update(postReports).set({ status: 'actioned' }).where(and(eq(postReports.postId, postId), eq(postReports.status, 'open')));
  await audit(db, actorLabel, 'post.removed', postId, { title: p.title });
  return { removed: true };
}

export async function dismissReports(db: Db, postId: string, actorLabel: string) {
  const p = await getPost(db, postId);
  await db.update(postReports).set({ status: 'dismissed' }).where(and(eq(postReports.postId, postId), eq(postReports.status, 'open')));
  await audit(db, actorLabel, 'post.reports_dismissed', postId, { title: p.title });
  return { dismissed: true };
}

/** For the home page: the next upcoming event and the newest open posts. */
export async function homeHighlights(db: Db, viewerId: string) {
  const [next] = await db
    .select(EVENT_COLUMNS)
    .from(events)
    .where(and(eq(events.status, 'published'), gt(events.startsAt, sql`now()`)))
    .orderBy(events.startsAt)
    .limit(1);
  const latest = await db
    .select({ id: posts.id, type: posts.type, title: posts.title, district: posts.district, state: posts.state, authorName: members.name })
    .from(posts)
    .innerJoin(members, eq(members.id, posts.authorId))
    .where(and(eq(posts.status, 'open'), gt(posts.expiresAt, sql`now()`)))
    .orderBy(desc(posts.createdAt))
    .limit(4);
  const people = next ? (await headcounts(db, [next.id])).get(next.id)?.people ?? 0 : 0;
  const [mine] = next ? await db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, next.id), eq(eventRsvps.memberId, viewerId))) : [];
  const [{ openJobs }] = await db
    .select({ openJobs: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.status, 'open'), gt(posts.expiresAt, sql`now()`), inArray(posts.type, ['job', 'referral'])));
  return {
    nextEvent: next ? { ...next, people, mine: mine ? { guests: mine.guests, duePaise: amountDuePaise(next, mine.guests), paidPaise: mine.paidPaise } : null } : null,
    latestPosts: latest,
    openJobs,
  };
}

/** For the Admin link in the sidebar: registrations waiting plus posts with open reports. */
export async function staffBadge(db: Db) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members).where(eq(members.status, 'pending'));
  const [{ r }] = await db
    .select({ r: sql<number>`count(DISTINCT ${postReports.postId})::int` })
    .from(postReports)
    .innerJoin(posts, eq(posts.id, postReports.postId))
    .where(and(eq(postReports.status, 'open'), ne(posts.status, 'removed')));
  return n + r;
}
