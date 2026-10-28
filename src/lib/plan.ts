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
