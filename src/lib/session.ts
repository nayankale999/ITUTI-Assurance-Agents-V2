import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { authOptions } from './auth';
import { db } from '@/data';
import { orgCaps, canEditSystem, type OrgCaps, type UserRoleT, type OrgRoleT } from './permissions';

export type Viewer = { id: string; email: string; name: string | null; role: UserRoleT };

export async function getViewer(): Promise<Viewer | null> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const u = await db.users.first({ id });
  if (!u || u.disabled) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect('/login');
  return v;
}

export async function requireItutiAdmin(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.role !== 'ITUTI_ADMIN') notFound();
  return v;
}

export async function capsFor(viewer: Viewer, orgId: string): Promise<OrgCaps> {
  const assigned = viewer.role === 'ITUTI_ASSESSOR' && !!(await db.assessorAssignments.first({ userId: viewer.id, orgId }));
  const member = await db.memberships.first({ userId: viewer.id, orgId });
  return orgCaps({ userRole: viewer.role, assigned, orgRole: (member?.role as OrgRoleT) ?? null });
}

/** Loads an organisation by slug for a page, or 404s when the viewer may not see it. */
export async function orgForPage(slug: string) {
  const viewer = await requireViewer();
  const org = await db.organizations.first({ slug });
  if (!org) notFound();
  const caps = await capsFor(viewer, org.id);
  if (!caps.view) notFound();
  return { viewer, org, caps };
}

/** Loads a system with the viewer's rights over it; null when not visible. */
export async function systemAccess(viewer: Viewer, systemId: string) {
  const system = await db.aiSystems.first({ id: systemId });
  if (!system) return null;
  const caps = await capsFor(viewer, system.orgId);
  if (!caps.view) return null;
  const assigned = caps.orgRole === 'CONTRIBUTOR' && !!(await db.systemAssignments.first({ userId: viewer.id, systemId }));
  const org = await db.organizations.first({ id: system.orgId });
  if (!org) return null;
  return { system, org, caps, canEdit: canEditSystem(caps, assigned) };
}

/** Organisations the viewer can open, by name. */
export async function visibleOrgs(viewer: Viewer) {
  const byName = <T extends { name: string }>(l: T[]) => [...l].sort((a, b) => a.name.localeCompare(b.name));
  if (viewer.role === 'ITUTI_ADMIN') return byName(await db.organizations.all());
  const ids = new Set<string>();
  if (viewer.role === 'ITUTI_ASSESSOR') for (const a of await db.assessorAssignments.find({ userId: viewer.id })) ids.add(a.orgId);
  for (const m of await db.memberships.find({ userId: viewer.id })) ids.add(m.orgId);
  return byName(await db.organizations.find({ id: [...ids] }));
}
