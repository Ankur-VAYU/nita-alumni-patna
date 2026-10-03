import { z } from 'zod';
import { WORK_STATES, matchOption } from '../lib/reference.js';

const blankToUndefined = (v: unknown) => (v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

/** "2026-11-15T17:00" entered in India time becomes a real point in time (IST is UTC+05:30, no DST). */
const istDateTime = (label: string) =>
  z.string().trim().transform((v, ctx) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
      ctx.addIssue({ code: 'custom', message: `${label}: choose a date and time` });
      return z.NEVER;
    }
    const d = new Date(`${v}:00+05:30`);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: `${label}: not a valid date` });
      return z.NEVER;
    }
    return d;
  });

export const eventInput = z
  .object({
    title: z.string().trim().min(3, 'Give the event a title').max(120),
    startsAt: istDateTime('Starts'),
    endsAt: optional(istDateTime('Ends')),
    venue: z.string().trim().min(2, 'Enter the venue').max(200),
    description: optional(z.string().trim().max(2000)),
    feeRupees: z.coerce.number({ message: 'Enter 0 if free' }).int('Whole rupees only').min(0).max(100000),
    feeBasis: z.enum(['family', 'person']).default('family'),
    capacity: optional(z.coerce.number().int().min(1, 'At least 1').max(5000)),
  })
  .refine((e) => !e.endsAt || e.endsAt > e.startsAt, { message: 'The end must be after the start', path: ['endsAt'] });
export type EventInput = z.output<typeof eventInput>;

export const rsvpInput = z.object({ guests: z.coerce.number().int().min(0).max(10, 'At most 10 guests') });

export const POST_TYPES = ['job', 'referral', 'help', 'offer', 'mentor'] as const;
export const REPORT_REASONS = [
  'Asks for money or a fee',
  'Paid placement agency',
  'Wrong or misleading information',
  'Promotional, not relevant',
  'Inappropriate content',
] as const;

export const postInput = z.object({
  type: z.enum(POST_TYPES, { message: 'Choose what you are posting' }),
  title: z.string().trim().min(5, 'Write a short title').max(120),
  body: z.string().trim().min(10, 'Add a few details').max(2000),
  organisation: optional(z.string().trim().max(160)),
  district: z.string().trim().min(2, 'Enter the city or district').max(80),
  state: z.string().trim().transform((v, ctx) => {
    const m = matchOption(WORK_STATES, v);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: 'Choose a state' });
      return z.NEVER;
    }
    return m;
  }),
  applyLink: optional(z.url({ protocol: /^https?$/, message: 'Enter a full link starting with https://' }).max(300)),
  expiresInDays: z.coerce.number().refine((n) => [15, 30, 60].includes(n), 'Choose 15, 30 or 60 days').default(30),
});
export type PostInput = z.output<typeof postInput>;

export const postStatusInput = z.object({ status: z.enum(['open', 'filled', 'closed']) });
export const reportInput = z.object({ reason: z.enum(REPORT_REASONS, { message: 'Choose a reason' }) });
export const postListQuery = z.object({
  type: optional(z.enum(POST_TYPES)),
  state: optional(z.string().max(60)),
  mine: optional(z.enum(['true', 'false'])).transform((v) => v === 'true'),
  closed: optional(z.enum(['true', 'false'])).transform((v) => v === 'true'),
});
