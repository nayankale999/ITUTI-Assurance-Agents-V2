import { getServerSession } from 'next-auth';
import { redirect, notFound } from 'next/navigation';
import { and, eq, asc, inArray } from 'drizzle-orm';
import { authOptions } from './auth';
import { db, schema } from '@/db';
import { orgCaps, canEditSystem, type OrgCaps, type UserRoleT, type OrgRoleT } from './permissions';

export type Viewer = { id: string; email: string; name: string | null; role: UserRoleT };

export async function getViewer(): Promise<Viewer | null> {
  const session = await getServerSession(authOptions);
  const id = (session?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
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
  const [assign, member] = await Promise.all([
    viewer.role === 'ITUTI_ASSESSOR'
      ? db.query.assessorAssignments.findFirst({ where: and(eq(schema.assessorAssignments.userId, viewer.id), eq(schema.assessorAssignments.orgId, orgId)) })
      : Promise.resolve(undefined),
    db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, viewer.id), eq(schema.memberships.orgId, orgId)) }),
  ]);
  return orgCaps({ userRole: viewer.role, assigned: !!assign, orgRole: (member?.role as OrgRoleT) ?? null });
}

/** Loads an organisation by slug for a page, or 404s when the viewer may not see it. */
export async function orgForPage(slug: string) {
  const viewer = await requireViewer();
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.slug, slug) });
  if (!org) notFound();
  const caps = await capsFor(viewer, org.id);
  if (!caps.view) notFound();
  return { viewer, org, caps };
}

/** Loads a system with the viewer's rights over it; null when not visible. */
export async function systemAccess(viewer: Viewer, systemId: string) {
  const system = await db.query.aiSystems.findFirst({ where: eq(schema.aiSystems.id, systemId) });
  if (!system) return null;
  const caps = await capsFor(viewer, system.orgId);
  if (!caps.view) return null;
  const assigned = caps.orgRole === 'CONTRIBUTOR'
    ? !!(await db.query.systemAssignments.findFirst({ where: and(eq(schema.systemAssignments.userId, viewer.id), eq(schema.systemAssignments.systemId, systemId)) }))
    : false;
  const org = (await db.query.organizations.findFirst({ where: eq(schema.organizations.id, system.orgId) }))!;
  return { system, org, caps, canEdit: canEditSystem(caps, assigned) };
}

/** Organisations the viewer can open. */
export async function visibleOrgs(viewer: Viewer) {
  if (viewer.role === 'ITUTI_ADMIN') return db.query.organizations.findMany({ orderBy: asc(schema.organizations.name) });
  const ids = new Set<string>();
  if (viewer.role === 'ITUTI_ASSESSOR') {
    for (const a of await db.query.assessorAssignments.findMany({ where: eq(schema.assessorAssignments.userId, viewer.id) })) ids.add(a.orgId);
  }
  for (const m of await db.query.memberships.findMany({ where: eq(schema.memberships.userId, viewer.id) })) ids.add(m.orgId);
  if (!ids.size) return [];
  return db.query.organizations.findMany({ where: inArray(schema.organizations.id, [...ids]), orderBy: asc(schema.organizations.name) });
}
