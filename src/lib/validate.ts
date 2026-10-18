import { z } from 'zod';

const str = (n: number) => z.string().max(n);
const statusEnum = z.enum(['met', 'partial', 'gap', 'na']);

export const assessmentSchema = z.object({
  profile: z.record(z.union([str(5000), z.array(str(40)).max(20)])).optional(),
  cls: z.record(z.union([str(20), z.record(z.boolean())])).optional(),
  ctrl: z.record(z.object({ s: statusEnum.optional().nullable(), e: str(5000).optional() })).optional(),
  card: z.record(str(5000)).optional(),
  metrics: z.array(z.object({
    id: str(40), name: str(200), kind: str(40).optional(), threshold: z.union([str(40), z.number()]).optional().nullable(),
    dir: z.enum(['above', 'below']).optional(),
    readings: z.array(z.object({ d: str(10), v: z.number().finite() })).max(120).optional(),
  })).max(50).optional(),
  aiReview: z.object({ at: str(40), items: z.record(z.object({ v: str(20), n: str(400) })) }).optional(),
  prov: z.record(z.object({ p: str(40), at: str(40), u: str(40), v: str(6000) })).optional(),
}).strict();

export const incidentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  category: z.string().max(80),
  serious: z.boolean().default(false),
  notes: z.string().max(5000).default(''),
});

export const incidentPatchSchema = z.object({ status: z.enum(['open', 'investigating', 'mitigated', 'closed']) });
