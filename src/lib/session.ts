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
  const u = db.users.first(r => r.id === id);
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
  const assigned = viewer.role === 'ITUTI_ASSESSOR' && !!db.assessorAssignments.first(a => a.userId === viewer.id && a.orgId === orgId);
  const member = db.memberships.first(m => m.userId === viewer.id && m.orgId === orgId);
  return orgCaps({ userRole: viewer.role, assigned, orgRole: (member?.role as OrgRoleT) ?? null });
}

/** Loads an organisation by slug for a page, or 404s when the viewer may not see it. */
export async function orgForPage(slug: string) {
  const viewer = await requireViewer();
  const org = db.organizations.first(o => o.slug === slug);
  if (!org) notFound();
  const caps = await capsFor(viewer, org.id);
  if (!caps.view) notFound();
  return { viewer, org, caps };
}

/** Loads a system with the viewer's rights over it; null when not visible. */
export async function systemAccess(viewer: Viewer, systemId: string) {
  const system = db.aiSystems.first(s => s.id === systemId);
  if (!system) return null;
  const caps = await capsFor(viewer, system.orgId);
  if (!caps.view) return null;
  const assigned = caps.orgRole === 'CONTRIBUTOR' && !!db.systemAssignments.first(a => a.userId === viewer.id && a.systemId === systemId);
  const org = db.organizations.first(o => o.id === system.orgId);
  if (!org) return null;
  return { system, org, caps, canEdit: canEditSystem(caps, assigned) };
}

/** Organisations the viewer can open, by name. */
export async function visibleOrgs(viewer: Viewer) {
  const byName = <T extends { name: string }>(l: T[]) => [...l].sort((a, b) => a.name.localeCompare(b.name));
  if (viewer.role === 'ITUTI_ADMIN') return byName(db.organizations.all());
  const ids = new Set<string>();
  if (viewer.role === 'ITUTI_ASSESSOR') for (const a of db.assessorAssignments.find(a => a.userId === viewer.id)) ids.add(a.orgId);
  for (const m of db.memberships.find(m => m.userId === viewer.id)) ids.add(m.orgId);
  return byName(db.organizations.find(o => ids.has(o.id)));
}
