import { z } from 'zod';
import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { validateValue, applyValue } from '@/lib/agent/fields';
import { summarise } from '@/lib/summary';
import { audit } from '@/lib/audit';
import { recordChanges } from '@/lib/history';
import type { AssessmentData } from '@/lib/assurance';

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({
  action: z.enum(['accept', 'reject']),
  ids: z.array(z.string().max(40)).min(1).max(200),
  version: z.number().int(),
  value: z.unknown().optional(), // an edited value, only with a single id
});

/** Accepts or rejects proposals. Accepting writes the values into the assessment in the same transaction. */
export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You cannot change this system.');
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, 'Invalid request.');
  const { action, ids, version } = parsed.data;
  const edited = parsed.data.value !== undefined;
  if (edited && ids.length !== 1) return err(400, 'Edit one proposal at a time.');

  let before: AssessmentData | null = null;
  type Out = { conflict: { data: unknown; version: number } } | { error: string } | { data: AssessmentData; version: number; count: number };
  const out: Out = await db.tx(async t => {
    const sys = await t.aiSystems.first({ id }, { forUpdate: true });
    if (!sys) return { error: 'Not found.' };
    if (sys.version !== version) return { conflict: { data: sys.data, version: sys.version } };
    const props = await t.proposals.find({ id: ids, systemId: id, status: 'pending' }, { forUpdate: true });
    if (!props.length) return { error: 'These proposals were already dealt with. Refresh to see the latest.' };
    const now = new Date();
    if (action === 'reject') {
      await t.proposals.update({ id: props.map(p => p.id) }, { status: 'rejected', decidedById: v.id, decidedAt: now });
      return { data: sys.data as AssessmentData, version: sys.version, count: props.length };
    }
    let data = sys.data as AssessmentData;
    before = data;
    const prov = { ...(data.prov || {}) };
    for (const p of props) {
      let value = p.value;
      if (edited) {
        const ok = validateValue(p.path, parsed.data.value);
        if (!ok.ok) return { error: ok.error };
        value = ok.value;
      }
      data = applyValue(data, p.path, value);
      prov[p.path] = { p: p.id, at: now.toISOString(), u: v.id, v: JSON.stringify(value).slice(0, 6000) };
      if (edited) await t.proposals.update({ id: p.id }, { value });
    }
    data = { ...data, prov };
    const patch = { data, ...summarise(data), version: sys.version + 1, updatedById: v.id, updatedAt: now };
    await t.aiSystems.update({ id }, patch);
    await t.proposals.update({ id: props.map(p => p.id) }, { status: 'accepted', decidedById: v.id, decidedAt: now });
    return { data, version: patch.version, count: props.length };
  });
  if ('conflict' in out) return json({ error: 'The system changed since you loaded it. Refresh and try again.', current: out.conflict }, 409);
  if ('error' in out) return err(400, out.error);
  await audit({ orgId: a.system.orgId, systemId: id, userId: v.id, action: action === 'accept' ? 'proposals.accepted' : 'proposals.rejected', detail: { count: out.count, edited } });
  if (action === 'accept' && before) await recordChanges({ orgId: a.system.orgId, systemId: id, userId: v.id, via: 'agent', before, after: out.data });
  return json(out);
}
