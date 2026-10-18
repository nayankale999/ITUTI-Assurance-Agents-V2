import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson, refreshIncidentCount } from '@/lib/api';
import { incidentSchema } from '@/lib/validate';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  const rows = db.incidents.find(i => i.systemId === id).sort((a, b) => b.date.localeCompare(a.date));
  if (new URL(req.url).searchParams.get('format') === 'csv') {
    const q = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const csv = [['Date', 'Incident', 'Severity', 'Category', 'Status', 'Reportable', 'Details'].map(q).join(','),
      ...rows.map(r => [r.date, r.title, r.severity, r.category, r.status, r.serious ? 'Yes' : 'No', r.notes].map(q).join(','))].join('\n');
    const name = a.system.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'system';
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-incidents.csv"`, 'Cache-Control': 'no-store' } });
  }
  return json({ incidents: rows });
}

export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You cannot record incidents for this system.');
  const parsed = incidentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, 'Check the incident details.');
  const row = await db.incidents.insert({ ...parsed.data, systemId: id, createdById: v.id });
  const open = await refreshIncidentCount(id);
  await audit({ orgId: a.system.orgId, systemId: id, userId: v.id, action: 'incident.created', detail: { title: row.title, severity: row.severity } });
  return json({ incident: row, open }, 201);
}
