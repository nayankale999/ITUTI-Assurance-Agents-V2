import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { gapActionSchema, planSettingsSchema } from '@/lib/validate';
import { planFor, owners, raiseActions, planSettings, autoRaise } from '@/lib/plan';
import { journey } from '@/lib/journey';
import { audit } from '@/lib/audit';
import type { AssessmentData } from '@/lib/assurance';

type Ctx = { params: Promise<{ id: string }> };
const canPlan = (a: { canEdit: boolean; scopes: string[] | null }) => a.canEdit || !!a.scopes?.includes('plan');

export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  const data = a.system.data as AssessmentData;
  const plan = await planFor(id, data);
  const { updatedById: _u, orgId: _o, systemId: _s, ...settings } = await planSettings(a.system, v);
  return json({ ...plan, ...(await owners(a.org.id)), canPlan: canPlan(a), settings, journeyDone: journey(data).done >= 5 });
}

async function memberOwner(orgId: string, ownerId: string | null | undefined) {
  if (!ownerId) return null;
  const owner = await db.users.first({ id: ownerId, disabled: false });
  return owner && (await db.memberships.first({ orgId, userId: ownerId })) ? owner : undefined;
}

/** Raises one action per gap, all against the same owner and department. */
export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!canPlan(a)) return err(403, 'You cannot raise gap actions on this system.');
  const p = gapActionSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return err(400, 'Choose the gaps, an owner and a department.');
  const { items, ownerId, ownerName, department, due } = p.data;
  if (!ownerId && !ownerName) return err(400, 'Name an owner for the actions.');
  const owner = await memberOwner(a.org.id, ownerId);
  if (owner === undefined) return err(400, 'The owner must be a member of this organisation, or enter a name instead.');
  const created = await raiseActions({ org: a.org, system: a.system, items, owner, ownerName, department, due: due || null, by: { id: v.id, name: v.name || v.email } });
  if (!created) return err(400, 'These gaps already have open actions, or have been closed.');
  return json({ created }, 201);
}

/** Saves the automatic action settings. Turning them on raises actions straight away when the assessment is complete. */
export async function PATCH(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!canPlan(a)) return err(403, 'You cannot change the action plan of this system.');
  const p = planSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return err(400, 'Check the owner, department and number of days.');
  const s = p.data;
  const owner = await memberOwner(a.org.id, s.ownerId);
  if (owner === undefined) return err(400, 'The owner must be a member of this organisation, or enter a name instead.');
  if (s.auto && !owner && !s.ownerName) return err(400, 'Choose who owns the actions raised automatically.');
  if (s.auto && !s.department) return err(400, 'Enter the department responsible.');
  const row = { orgId: a.org.id, auto: s.auto, ownerId: owner?.id || null, ownerName: owner ? null : s.ownerName || null, department: s.department || null, dueDays: s.dueDays, updatedById: v.id, updatedAt: new Date() };
  if (await db.planSettings.first({ systemId: id })) await db.planSettings.update({ systemId: id }, row);
  else await db.planSettings.insert({ systemId: id, ...row });
  await audit({ orgId: a.org.id, systemId: id, userId: v.id, action: 'gap.settings', detail: { title: s.auto ? `Automatic actions on, owner ${owner ? owner.name || owner.email : s.ownerName}` : 'Automatic actions off' } });
  const created = s.auto ? await autoRaise(id) : 0;
  return json({ ok: true, created });
}
