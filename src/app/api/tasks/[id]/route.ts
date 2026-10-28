import { z } from 'zod';
import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { taskView } from '@/lib/teamwork';
import { audit } from '@/lib/audit';
import { gapStillOpen } from '@/lib/plan';

type Ctx = { params: Promise<{ id: string }> };
const patch = z.object({ status: z.enum(['todo', 'doing', 'done']).optional(), due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().max(1000).optional() });

async function load(id: string) {
  const v = await apiViewer(); if (!v) return { error: err(401, 'Sign in again.') };
  const task = await db.tasks.first({ id });
  if (!task) return { error: err(404, 'Not found.') };
  const a = await loadSystem(v, task.systemId);
  if (!a) return { error: err(404, 'Not found.') };
  return { v, task, a };
}

/** The assignee moves their task along; the lead or an admin can also change the due date and note. */
export async function PATCH(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const { id } = await params;
  const l = await load(id); if ('error' in l) return l.error;
  const { v, task, a } = l;
  const mine = task.assigneeId === v.id;
  if (!mine && !a.canAllocate) return err(403, 'This task is not yours.');
  const p = patch.safeParse(await req.json().catch(() => null));
  if (!p.success) return err(400, 'Invalid change.');
  if (!a.canAllocate && (p.data.due !== undefined || p.data.note !== undefined)) return err(403, 'Only the team lead can change the due date or note.');
  if (p.data.status === 'done' && task.status !== 'done' && await gapStillOpen(task)) {
    return err(409, 'This task belongs to a gap action. It closes by itself once the gap is closed in the assessment: set the control to Met with its evidence, or confirm the conformity answer.');
  }
  const now = new Date();
  const change = { ...p.data, updatedAt: now, ...(p.data.status ? { doneAt: p.data.status === 'done' ? now : null } : {}) };
  const [row] = await db.tasks.update({ id }, change);
  if (p.data.status) await audit({ orgId: a.org.id, systemId: task.systemId, userId: v.id, action: 'task.updated', detail: { title: p.data.status } });
  return json({ task: (await taskView([row]))[0] });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const { id } = await params;
  const l = await load(id); if ('error' in l) return l.error;
  if (!l.a.canAllocate) return err(403, 'Only the team lead or an admin can remove tasks.');
  await db.tasks.remove({ id });
  return json({ ok: true });
}
