/* Server side of the gap action plan. */
import { db, type IncidentRow, type PlanSettings, type User } from '@/data';
import type { AssessmentData } from './assurance';
import { findGaps, planStatus, type GapAction } from './gaps';
import { journey } from './journey';
import { audit } from './audit';
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

export async function notifyOwner(email: string, count: number, systemName: string, url: string, due: string | null, by: string, auto = false) {
  const what = count === 1 ? 'an action' : `${count} actions`;
  await sendActionEmail({
    to: email,
    subject: `${count === 1 ? 'An action has' : `${count} actions have`} been assigned to you: ${systemName}`,
    heading: count === 1 ? 'You own an action to close an assessment gap' : `You own ${count} actions to close assessment gaps`,
    body: `${auto ? `The assessment of ${systemName} is complete, and ${what} ${count === 1 ? 'was' : 'were'} raised automatically under the plan set by ${by}` : `${by} raised ${what} on ${systemName}`} for you to resolve${due ? ` by ${due}` : ''}. Each one describes the gap found in the AI assessment and what is needed to close it.`,
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

/** Raises one action per gap against one owner and department, gives a signed-in owner a task per gap and emails
 * them. Gaps that already have an open action, or that have closed, are skipped. Returns how many were raised. */
export async function raiseActions(opts: {
  org: { id: string; slug: string }; system: { id: string; name: string; data: unknown }; items: { gapRef: string; notes?: string }[];
  owner: User | null; ownerName?: string | null; department: string; due: string | null; by: { id: string | null; name: string }; auto?: boolean;
}) {
  const data = opts.system.data as AssessmentData;
  const plan = await planFor(opts.system.id, data);
  const gaps = new Map(plan.gaps.map(g => [g.ref, g]));
  const taken = new Set(plan.rows.filter(r => r.action && !r.awaitingUpdate).map(r => r.gap.ref));
  const fresh = opts.items.filter(i => gaps.has(i.gapRef) && !taken.has(i.gapRef));
  if (!fresh.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const { owner } = opts;
  const rows = await db.incidents.insertMany(fresh.map(i => {
    const g = gaps.get(i.gapRef)!;
    return {
      systemId: opts.system.id, kind: 'gap' as const, gapRef: g.ref, title: g.title.slice(0, 300), date: today, severity: g.severity, category: 'Assessment gap',
      status: 'open', serious: false, notes: (i.notes?.trim() || g.suggested).slice(0, 5000), ownerId: owner?.id || null,
      ownerName: owner ? (owner.name || owner.email) : String(opts.ownerName || 'Not assigned').slice(0, 255), department: opts.department.slice(0, 120), due: opts.due, createdById: opts.by.id,
    };
  }));
  if (owner) await giveOwnerTasks({ orgId: opts.org.id, systemId: opts.system.id, ownerId: owner.id, gapRefs: rows.map(r => r.gapRef!).filter(Boolean), due: opts.due, by: opts.by.id || owner.id });
  await audit({ orgId: opts.org.id, systemId: opts.system.id, userId: opts.by.id, action: 'gap.actions', detail: { title: `${rows.length} action${rows.length === 1 ? '' : 's'} for ${opts.department}${opts.auto ? ', raised automatically' : ''}` } });
  // Only people who can sign in are emailed: the link is useless to an owner outside the platform
  if (owner?.email) {
    const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    await notifyOwner(owner.email, rows.length, String(data.profile?.name || opts.system.name), `${base}/o/${opts.org.slug}/systems/${opts.system.id}?tab=plan`, opts.due, opts.by.name, opts.auto);
  }
  return rows.length;
}

/* ---------- Raising actions automatically ----------
 * A system can be set to raise an action for every gap once all five assessment steps are complete, against a
 * default owner, department and due period. It then runs after every save, so gaps found later get actions too. */

export const addDays = (days: number, from = new Date()) => new Date(from.getTime() + days * 864e5).toISOString().slice(0, 10);

/** The settings for a system, with defaults when none are saved: the lead of the system's team (or the person
 * asking) as owner, and the team recorded in the profile as department. */
export async function planSettings(system: { id: string; orgId: string; data: unknown }, me?: { id: string }) {
  const saved = await db.planSettings.first({ systemId: system.id });
  if (saved) return { ...saved, saved: true };
  const links = await db.teamSystems.find({ systemId: system.id });
  const teams = links.length ? await db.teams.find({ id: links.map(l => l.teamId) }) : [];
  const lead = teams.find(t => t.leadId)?.leadId || null;
  const p = (system.data as AssessmentData).profile || {};
  return {
    systemId: system.id, orgId: system.orgId, auto: false, ownerId: lead || me?.id || null, ownerName: null,
    department: String(p.team || p.client || '').slice(0, 120) || null, dueDays: 30, updatedById: null, updatedAt: new Date(), lastAutoAt: null, saved: false,
  } satisfies PlanSettings & { saved: boolean };
}

const running = new Map<string, Promise<number>>();

/** Raises actions for every gap without one, when the system is set to do so and all five steps are complete.
 * Calls for the same system are serialised so two quick saves cannot raise the same action twice. */
export async function autoRaise(systemId: string): Promise<number> {
  const prev = running.get(systemId) || Promise.resolve(0);
  const next = prev.catch(() => 0).then(() => autoRaiseNow(systemId));
  running.set(systemId, next);
  try { return await next; } catch (e) { console.error('[plan] automatic actions failed', e); return 0; }
  finally { if (running.get(systemId) === next) running.delete(systemId); }
}

async function autoRaiseNow(systemId: string) {
  const s = await db.planSettings.first({ systemId });
  if (!s?.auto) return 0;
  const sys = await db.aiSystems.first({ id: systemId });
  if (!sys) return 0;
  const data = sys.data as AssessmentData;
  if (journey(data).done < 5) return 0;
  const plan = await planFor(systemId, data);
  const open = plan.rows.filter(r => !r.action).map(r => ({ gapRef: r.gap.ref }));
  if (!open.length) return 0;
  const org = await db.organizations.first({ id: sys.orgId });
  if (!org) return 0;
  let owner = (s.ownerId ? await db.users.first({ id: s.ownerId, disabled: false }) : null) || null;
  if (owner && !(await db.memberships.first({ orgId: org.id, userId: owner.id }))) owner = null;
  const setter = s.updatedById ? await db.users.first({ id: s.updatedById }) : null;
  const p = data.profile || {};
  const n = await raiseActions({
    org, system: sys, items: open, owner, ownerName: owner ? null : s.ownerName || 'Not assigned',
    department: s.department || String(p.team || p.client || '') || 'Not set', due: addDays(s.dueDays),
    by: { id: setter?.id || null, name: setter ? setter.name || setter.email : 'The action plan' }, auto: true,
  });
  if (n) await db.planSettings.update({ systemId }, { lastAutoAt: new Date() });
  return n;
}

/** After the assessment changes: close owner tasks whose gap has closed, then raise any automatic actions. */
export async function afterAssessmentChange(systemId: string, data: AssessmentData) {
  await syncGapTasks(systemId, data);
  await autoRaise(systemId);
}
