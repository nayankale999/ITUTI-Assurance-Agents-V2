import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson, refreshIncidentCount } from '@/lib/api';
import { incidentPatchSchema } from '@/lib/validate';
import { audit } from '@/lib/audit';
import { giveOwnerTasks, closeOwnerTask } from '@/lib/plan';

type Ctx = { params: Promise<{ id: string }> };

async function load(req: Request, id: string) {
  const bad = sameOriginJson(req); if (bad) return { error: err(400, bad) };
  const v = await apiViewer(); if (!v) return { error: err(401, 'Sign in again.') };
  const inc = await db.incidents.first({ id });
  if (!inc) return { error: err(404, 'Not found.') };
  const a = await loadSystem(v, inc.systemId);
  if (!a) return { error: err(404, 'Not found.') };
  const scope = inc.kind === 'gap' ? 'plan' : 'monitor';
  if (!a.canEdit && !a.scopes?.includes(scope)) return { error: err(403, inc.kind === 'gap' ? 'You cannot change gap actions for this system.' : 'You cannot change incidents for this system.') };
  return { v, inc, a };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await load(req, id); if ('error' in r) return r.error;
  const parsed = incidentPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, 'Invalid change.');
  const { status, ...rest } = parsed.data;
  if (r.inc.kind !== 'gap' && Object.keys(rest).length) return err(400, 'Only gap actions have an owner, department and due date.');
  if (rest.ownerId) {
    const m = await db.memberships.first({ orgId: r.a.org.id, userId: rest.ownerId });
    if (!m) return err(400, 'The owner must be a member of this organisation, or enter a name instead.');
  }
  if (rest.ownerId) { const u = await db.users.first({ id: rest.ownerId }); if (u) rest.ownerName = u.name || u.email; }
  await db.incidents.update({ id }, { ...rest, ...(status ? { status } : {}), updatedAt: new Date() });
  if (r.inc.kind === 'gap') {
    const ownerChanged = rest.ownerId !== undefined && rest.ownerId !== r.inc.ownerId;
    const finished = status === 'resolved' || status === 'closed';
    // The owner's task stays open until the gap is closed in the assessment, even once the action is resolved,
    // so the owner sees it through; it moves to the new owner if the action is reassigned.
    if (ownerChanged) await closeOwnerTask(r.inc.systemId, r.inc.ownerId, r.inc.gapRef);
    const newOwner = ownerChanged ? rest.ownerId : r.inc.ownerId;
    const reopened = status && !finished && ['resolved', 'closed'].includes(r.inc.status);
    if (newOwner && r.inc.gapRef && (ownerChanged || reopened)) await giveOwnerTasks({ orgId: r.a.org.id, systemId: r.inc.systemId, ownerId: newOwner, gapRefs: [r.inc.gapRef], due: rest.due ?? r.inc.due, by: r.v.id });
  }
  const open = await refreshIncidentCount(r.inc.systemId);
  await audit({ orgId: r.a.system.orgId, systemId: r.inc.systemId, userId: r.v.id, action: 'incident.updated', detail: { title: r.inc.title, status: status || 'details' } });
  return json({ ok: true, open });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await load(req, id); if ('error' in r) return r.error;
  await db.incidents.remove({ id });
  const open = await refreshIncidentCount(r.inc.systemId);
  await audit({ orgId: r.a.system.orgId, systemId: r.inc.systemId, userId: r.v.id, action: 'incident.deleted', detail: { title: r.inc.title } });
  return json({ ok: true, open });
}
