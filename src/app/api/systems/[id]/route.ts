import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { assessmentSchema } from '@/lib/validate';
import { summarise } from '@/lib/summary';
import { audit } from '@/lib/audit';
import type { AssessmentData } from '@/lib/assurance';

type Ctx = { params: Promise<{ id: string }> };
const MAX_BYTES = 240_000;

export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  return json({ id: a.system.id, data: a.system.data, version: a.system.version, updatedAt: a.system.updatedAt, canEdit: a.canEdit });
}

export async function PUT(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You can view this system but not edit it.');
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return err(413, 'This record is too large. Shorten some evidence entries.');
  let body: { data?: unknown; version?: unknown };
  try { body = JSON.parse(raw); } catch { return err(400, 'Invalid JSON.'); }
  const parsed = assessmentSchema.safeParse(body.data);
  if (!parsed.success) return err(400, 'Some fields are not in the expected format.');
  const version = Number(body.version);
  if (!Number.isInteger(version)) return err(400, 'Missing version.');
  const data = parsed.data as AssessmentData;
  const prev = a.system.data as Record<string, unknown>;
  const sections = Object.keys({ ...prev, ...data }).filter(k => JSON.stringify(prev[k]) !== JSON.stringify((data as Record<string, unknown>)[k]));
  const [row] = await db.update(schema.aiSystems)
    .set({ data, ...summarise(data), version: sql`${schema.aiSystems.version} + 1`, updatedById: v.id, updatedAt: new Date() })
    .where(and(eq(schema.aiSystems.id, id), eq(schema.aiSystems.version, version)))
    .returning({ version: schema.aiSystems.version, updatedAt: schema.aiSystems.updatedAt });
  if (!row) {
    const cur = await db.query.aiSystems.findFirst({ where: eq(schema.aiSystems.id, id) });
    return json({ error: 'Someone else saved a newer version of this system.', current: cur ? { data: cur.data, version: cur.version } : null }, 409);
  }
  if (sections.length) await audit({ orgId: a.system.orgId, systemId: id, userId: v.id, action: 'system.updated', detail: { sections } });
  return json({ version: row.version, updatedAt: row.updatedAt });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.caps.deleteSystems) return err(403, 'You cannot delete systems here.');
  await db.delete(schema.aiSystems).where(eq(schema.aiSystems.id, id));
  await audit({ orgId: a.system.orgId, userId: v.id, action: 'system.deleted', detail: { name: a.system.name } });
  return json({ ok: true, redirect: `/o/${a.org.slug}` });
}
