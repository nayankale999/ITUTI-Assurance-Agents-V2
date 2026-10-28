import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { gapActionSchema } from '@/lib/validate';
import { planFor, owners, notifyOwner } from '@/lib/plan';
import { audit } from '@/lib/audit';
import type { AssessmentData } from '@/lib/assurance';

type Ctx = { params: Promise<{ id: string }> };
const canPlan = (a: { canEdit: boolean; scopes: string[] | null }) => a.canEdit || !!a.scopes?.includes('plan');

export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  const plan = await planFor(id, a.system.data as AssessmentData);
  return json({ ...plan, ...(await owners(a.org.id)), canPlan: canPlan(a) });
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
  const owner = ownerId ? await db.users.first({ id: ownerId }) : null;
  if (ownerId && (!owner || !(await db.memberships.first({ orgId: a.org.id, userId: ownerId })))) return err(400, 'The owner must be a member of this organisation, or enter a name instead.');
  const plan = await planFor(id, a.system.data as AssessmentData);
  const gaps = new Map(plan.gaps.map(g => [g.ref, g]));
  const taken = new Set(plan.rows.filter(r => r.action).map(r => r.gap.ref));
  const fresh = items.filter(i => gaps.has(i.gapRef) && !taken.has(i.gapRef));
  if (!fresh.length) return err(400, 'These gaps already have open actions, or have been closed.');
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.incidents.insertMany(fresh.map(i => {
    const g = gaps.get(i.gapRef)!;
    return {
      systemId: id, kind: 'gap' as const, gapRef: g.ref, title: g.title.slice(0, 300), date: today, severity: g.severity, category: 'Assessment gap',
      status: 'open', serious: false, notes: (i.notes?.trim() || g.suggested).slice(0, 5000), ownerId: owner?.id || null,
      ownerName: owner ? (owner.name || owner.email) : ownerName!.slice(0, 255), department, due: due || null, createdById: v.id,
    };
  }));
  await audit({ orgId: a.org.id, systemId: id, userId: v.id, action: 'gap.actions', detail: { title: `${rows.length} action${rows.length === 1 ? '' : 's'} for ${department}` } });
  // Only people who can sign in are emailed: the link is useless to an owner outside the platform
  const email = owner?.email || null;
  if (email) {
    const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    await notifyOwner(email, rows.length, String((a.system.data as AssessmentData).profile?.name || a.system.name), `${base}/o/${a.org.slug}/systems/${id}?tab=plan`, due || null, v.name || v.email);
  }
  return json({ created: rows.length }, 201);
}
