/* Server helpers for teams and tasks. */
import { db, type TaskRow } from '@/data';
import { scopeLabel } from './tasks';
import { sendActionEmail } from './mail';

/** People who can be given tasks on a system: the leads and members of the teams working on it. */
export async function assignable(systemId: string) {
  const teamIds = (await db.teamSystems.find({ systemId })).map(t => t.teamId);
  if (!teamIds.length) return { teams: [], people: [] };
  const teams = await db.teams.find({ id: teamIds }, { orderBy: [['name', 'asc']] });
  const members = await db.teamMembers.find({ teamId: teamIds });
  const ids = [...new Set([...members.map(m => m.userId), ...teams.map(t => t.leadId).filter((x): x is string => !!x)])];
  const users = ids.length ? await db.users.find({ id: ids, disabled: false }) : [];
  const people = users.map(u => ({
    id: u.id, name: u.name || u.email, email: u.email,
    teams: teams.filter(t => t.leadId === u.id || members.some(m => m.teamId === t.id && m.userId === u.id)).map(t => ({ id: t.id, name: t.name, lead: t.leadId === u.id })),
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { teams: teams.map(t => ({ id: t.id, name: t.name, leadId: t.leadId })), people };
}

export async function taskView(rows: TaskRow[]) {
  const ids = [...new Set(rows.flatMap(r => [r.assigneeId, r.createdById]).filter((x): x is string => !!x))];
  const users = new Map((ids.length ? await db.users.find({ id: ids }) : []).map(u => [u.id, u.name || u.email]));
  return rows.map(r => ({ id: r.id, systemId: r.systemId, scope: r.scope, label: scopeLabel(r.scope), status: r.status, due: r.due, note: r.note,
    assigneeId: r.assigneeId, assignee: users.get(r.assigneeId) || 'Removed user', by: r.createdById ? users.get(r.createdById) || '' : '', updatedAt: r.updatedAt.toISOString() }));
}

export async function notifyAssignee(tasks: TaskRow[], systemName: string, orgSlug: string, by: string) {
  const task = tasks[0];
  if (!task) return;
  const what = tasks.map(t => scopeLabel(t.scope));
  const u = await db.users.first({ id: task.assigneeId });
  if (!u) return;
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  await sendActionEmail({
    to: u.email,
    subject: tasks.length === 1 ? `New task on ${systemName}: ${what[0]}` : `${tasks.length} new tasks on ${systemName}`,
    heading: tasks.length === 1 ? 'You have a new assessment task' : 'You have new assessment tasks',
    body: `${by} asked you to work on ${systemName}: ${what.join('; ')}${task.due ? `, due ${task.due}` : ''}.${task.note ? ` Note: ${task.note}` : ''}`,
    action: 'Open my tasks',
    url: `${base}/o/${orgSlug}/tasks`,
  }).catch(e => console.error('[tasks] email failed', e));
}
