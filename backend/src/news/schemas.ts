import { z } from 'zod';

const blankToUndefined = (v: unknown) => (v == null || (typeof v === 'string' && v.trim() === '') ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

export const NEWS_KINDS = ['chapter', 'institute'] as const;
export const UPDATE_TAGS = ['Admission', 'Notice', 'Result', 'Tender', 'Event', 'News'] as const;

export const newsInput = z
  .object({
    kind: z.enum(NEWS_KINDS, { message: 'Choose chapter or NIT Agartala' }),
    tag: optional(z.enum(UPDATE_TAGS, { message: 'Choose a label' })),
    title: z.string().trim().min(5, 'Write a short headline').max(160),
    body: optional(z.string().trim().max(4000)),
    link: optional(z.url({ protocol: /^https?$/, message: 'Enter a full link starting with https://' }).max(500)),
    pinned: z.preprocess((v) => v === true || v === 'true' || v === 'on', z.boolean()).default(false),
    // The date shown with the item, e.g. the date on an institute notice. Defaults to today.
    publishedOn: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')),
  })
  .refine((n) => n.kind !== 'chapter' || n.body, { message: 'Write the announcement', path: ['body'] })
  .refine((n) => n.kind !== 'institute' || n.body || n.link, { message: 'Add a link to the notice or a short summary', path: ['link'] });
export type NewsInput = z.output<typeof newsInput>;

export const newsQuery = z.object({ kind: optional(z.enum(NEWS_KINDS)) });
