import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson, refreshIncidentCount } from '@/lib/api';
import { incidentPatchSchema } from '@/lib/validate';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

async function load(req: Request, id: string) {
  const bad = sameOriginJson(req); if (bad) return { error: err(400, bad) };
  const v = await apiViewer(); if (!v) return { error: err(401, 'Sign in again.') };
  const inc = await db.incidents.first({ id });
  if (!inc) return { error: err(404, 'Not found.') };
  const a = await loadSystem(v, inc.systemId);
  if (!a) return { error: err(404, 'Not found.') };
  if (!a.canEdit && !a.scopes?.includes('monitor')) return { error: err(403, 'You cannot change incidents for this system.') };
  return { v, inc, a };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await load(req, id); if ('error' in r) return r.error;
  const parsed = incidentPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, 'Invalid status.');
  await db.incidents.update({ id }, { status: parsed.data.status, updatedAt: new Date() });
  const open = await refreshIncidentCount(r.inc.systemId);
  await audit({ orgId: r.a.system.orgId, systemId: r.inc.systemId, userId: r.v.id, action: 'incident.updated', detail: { title: r.inc.title, status: parsed.data.status } });
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
