import { z } from 'zod';
import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { validScope } from '@/lib/tasks';
import { assignable, taskView, notifyAssignee } from '@/lib/teamwork';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  const rows = await db.tasks.find({ systemId: id }, { orderBy: [['createdAt', 'asc']] });
  const who = await assignable(id);
  return json({ tasks: await taskView(rows), ...who, canAllocate: a.canAllocate, me: v.id });
}

const body = z.object({
  assigneeId: z.string().max(40), scopes: z.array(z.string().max(64)).min(1).max(60),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(1000).optional(),
});

/** A lead (or client admin, or Ituti assessor) hands one or more pieces of work on this system to a team member. */
export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canAllocate) return err(403, 'Only the team lead or an admin can assign tasks on this system.');
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return err(400, 'Choose a person and at least one piece of work.');
  if (p.data.scopes.some(s => !validScope(s))) return err(400, 'Unknown piece of work.');
  const who = await assignable(id);
  const person = who.people.find(x => x.id === p.data.assigneeId);
  if (!person) return err(400, 'That person is not in a team working on this system.');
  const team = person.teams[0]?.id || null;
  const open = await db.tasks.find({ systemId: id, assigneeId: person.id, scope: p.data.scopes, status: ['todo', 'doing'] });
  const fresh = p.data.scopes.filter(s => !open.some(t => t.scope === s));
  if (!fresh.length) return err(400, `${person.name} already has ${p.data.scopes.length === 1 ? 'this task' : 'these tasks'}.`);
  const rows = await db.tasks.insertMany(fresh.map(scope => ({ orgId: a.org.id, systemId: id, teamId: team, assigneeId: person.id, scope, due: p.data.due || null, note: p.data.note?.trim() || null, createdById: v.id })));
  await audit({ orgId: a.org.id, systemId: id, userId: v.id, action: 'task.assigned', detail: { email: person.email, title: `${rows.length} task${rows.length === 1 ? '' : 's'}` } });
  await notifyAssignee(rows, String((a.system.data as { profile?: { name?: string } }).profile?.name || a.system.name), a.org.slug, v.name || v.email);
  return json({ tasks: await taskView(rows) }, 201);
}
