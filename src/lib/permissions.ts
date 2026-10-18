/* Who can do what. Pure functions first (unit-tested), then database-backed loaders. */
export type UserRoleT = 'ITUTI_ADMIN' | 'ITUTI_ASSESSOR' | 'CLIENT';
export type OrgRoleT = 'CLIENT_ADMIN' | 'CONTRIBUTOR' | 'VIEWER';

export type OrgCaps = {
  view: boolean;            // see the organisation, its systems and reports
  manage: boolean;          // invite and manage client users, assign contributors
  createSystems: boolean;
  deleteSystems: boolean;
  editAllSystems: boolean;  // edit any system in the organisation
  staff: boolean;           // Ituti staff (admin or assigned assessor)
  orgRole: OrgRoleT | null;
};

export function orgCaps(input: { userRole: UserRoleT; assigned: boolean; orgRole: OrgRoleT | null }): OrgCaps {
  const { userRole, assigned, orgRole } = input;
  const admin = userRole === 'ITUTI_ADMIN';
  const assessor = userRole === 'ITUTI_ASSESSOR' && assigned;
  const clientAdmin = orgRole === 'CLIENT_ADMIN';
  const manager = admin || assessor || clientAdmin;
  return {
    view: manager || orgRole === 'CONTRIBUTOR' || orgRole === 'VIEWER',
    manage: manager,
    createSystems: manager,
    deleteSystems: manager,
    editAllSystems: manager,
    staff: admin || assessor,
    orgRole,
  };
}

export function canEditSystem(caps: OrgCaps, assignedToSystem: boolean) {
  return caps.editAllSystems || (caps.orgRole === 'CONTRIBUTOR' && assignedToSystem);
}

export const CLIENT_ROLES: OrgRoleT[] = ['CLIENT_ADMIN', 'CONTRIBUTOR', 'VIEWER'];
export const STAFF_ROLES: UserRoleT[] = ['ITUTI_ADMIN', 'ITUTI_ASSESSOR'];

export function canInvite(inviterRole: UserRoleT, caps: OrgCaps | null, role: string): boolean {
  if ((STAFF_ROLES as string[]).includes(role)) return inviterRole === 'ITUTI_ADMIN';
  if ((CLIENT_ROLES as string[]).includes(role)) return !!caps?.manage;
  return false;
}

export const ROLE_LABEL: Record<string, string> = {
  ITUTI_ADMIN: 'Ituti admin',
  ITUTI_ASSESSOR: 'Ituti assessor',
  CLIENT: 'Client user',
  CLIENT_ADMIN: 'Client admin',
  CONTRIBUTOR: 'Contributor',
  VIEWER: 'Viewer',
};
