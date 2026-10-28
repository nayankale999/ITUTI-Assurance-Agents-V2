/* Server side of the gap action plan. */
import { db, type IncidentRow } from '@/data';
import type { AssessmentData } from './assurance';
import { findGaps, planStatus, type GapAction } from './gaps';
import { sendActionEmail } from './mail';

export const toAction = (i: IncidentRow): GapAction => ({ id: i.id, gapRef: i.gapRef, status: i.status, ownerId: i.ownerId, ownerName: i.ownerName, department: i.department, due: i.due, title: i.title, notes: i.notes, severity: i.severity, date: i.date });

export async function planFor(systemId: string, data: AssessmentData) {
  const actions = (await db.incidents.find({ systemId, kind: 'gap' }, { orderBy: [['createdAt', 'asc']] })).map(toAction);
  const gaps = findGaps(data);
  return { gaps, actions, ...planStatus(gaps, actions) };
}

/** Organisation members who can own an action, and the departments already used across the organisation. */
export async function owners(orgId: string) {
  const ms = await db.memberships.find({ orgId });
  const users = ms.length ? await db.users.find({ id: ms.map(m => m.userId), disabled: false }) : [];
  const systems = await db.aiSystems.find({ orgId }, { columns: ['id', 'data'] });
  const used = systems.length ? await db.incidents.find({ systemId: systems.map(s => s.id), kind: 'gap' }, { columns: ['department'] }) : [];
  const depts = new Set<string>();
  for (const u of used) if (u.department) depts.add(u.department);
  for (const s of systems) { const p = (s.data as AssessmentData).profile || {}; if (p.team) depts.add(String(p.team)); if (p.client) depts.add(String(p.client)); }
  return { people: users.map(u => ({ id: u.id, name: u.name || u.email, email: u.email })).sort((a, b) => a.name.localeCompare(b.name)), departments: [...depts].sort() };
}

export async function notifyOwner(email: string, count: number, systemName: string, url: string, due: string | null, by: string) {
  await sendActionEmail({
    to: email,
    subject: `${count === 1 ? 'An action has' : `${count} actions have`} been assigned to you: ${systemName}`,
    heading: count === 1 ? 'You own an action to close an assessment gap' : `You own ${count} actions to close assessment gaps`,
    body: `${by} raised ${count === 1 ? 'an action' : `${count} actions`} on ${systemName} for you to resolve${due ? ` by ${due}` : ''}. Each one describes the gap found in the AI assessment and what is needed to close it.`,
    action: 'Open the action plan',
    url,
  }).catch(e => console.error('[plan] email failed', e));
}

/* An action owner who can sign in also gets a task for the gap, so they can edit exactly the control or
 * conformity question behind it. The task closes when the action is resolved or closed, and follows the action
 * if it is reassigned. The gap reference ('ctrl:GOV-3', 'conf:P5') is already a task scope. */
export async function giveOwnerTasks(opts: { orgId: string; systemId: string; ownerId: string; gapRefs: string[]; due: string | null; by: string }) {
  if (!opts.gapRefs.length) return 0;
  const open = await db.tasks.find({ systemId: opts.systemId, assigneeId: opts.ownerId, scope: opts.gapRefs, status: ['todo', 'doing'] });
  const fresh = opts.gapRefs.filter(r => !open.some(t => t.scope === r));
  if (!fresh.length) return 0;
  const team = (await db.teamSystems.find({ systemId: opts.systemId }))[0]?.teamId || null;
  await db.tasks.insertMany(fresh.map(scope => ({ orgId: opts.orgId, systemId: opts.systemId, teamId: team, assigneeId: opts.ownerId, scope, due: opts.due, note: 'Close the gap recorded in the action plan.', createdById: opts.by })));
  return fresh.length;
}

export async function closeOwnerTask(systemId: string, ownerId: string | null, gapRef: string | null) {
  if (!ownerId || !gapRef) return;
  const now = new Date();
  await db.tasks.update({ systemId, assigneeId: ownerId, scope: gapRef, status: ['todo', 'doing'] }, { status: 'done', doneAt: now, updatedAt: now });
}

/** After the assessment changes: an action owner's task closes once the gap behind the action is closed. */
export async function syncGapTasks(systemId: string, data: AssessmentData) {
  try {
    const actions = await db.incidents.find({ systemId, kind: 'gap' }, { columns: ['ownerId', 'gapRef'] });
    const linked = actions.filter(a => a.ownerId && a.gapRef);
    if (!linked.length) return;
    const open = new Set(findGaps(data).map(g => g.ref));
    for (const a of linked) if (!open.has(a.gapRef!)) await closeOwnerTask(systemId, a.ownerId, a.gapRef);
  } catch (e) { console.error('[plan] task sync failed', e); }
}

/** Whether a task is an action owner's task whose gap is still open (so it cannot be marked done yet). */
export async function gapStillOpen(task: { systemId: string; assigneeId: string; scope: string }) {
  const action = await db.incidents.first({ systemId: task.systemId, kind: 'gap', ownerId: task.assigneeId, gapRef: task.scope });
  if (!action) return false;
  const sys = await db.aiSystems.first({ id: task.systemId }, { columns: ['data'] });
  return findGaps((sys?.data || {}) as AssessmentData).some(g => g.ref === task.scope);
}
