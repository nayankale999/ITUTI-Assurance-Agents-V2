/* The app's tables, stored as CSV files. See csv.ts for how storage works. */
import { randomUUID } from 'crypto';
import { table, type TableDef } from './csv';
import type { AssessmentData } from '@/lib/assurance';
import type { UserRoleT, OrgRoleT } from '@/lib/permissions';

export type User = { id: string; name: string | null; email: string; emailVerified: Date | null; image: string | null; role: UserRoleT; disabled: boolean; createdAt: Date };
export type Session = { sessionToken: string; userId: string; expires: Date };
export type VerificationToken = { identifier: string; token: string; expires: Date };
export type Org = { id: string; name: string; slug: string; createdAt: Date };
export type Membership = { userId: string; orgId: string; role: OrgRoleT; createdAt: Date };
export type AssessorAssignment = { userId: string; orgId: string; createdAt: Date };
export type AiSystemRow = {
  id: string; orgId: string; name: string; data: AssessmentData; tier: string; riskScore: number | null; readiness: number;
  openIncidents: number; version: number; createdById: string | null; updatedById: string | null; createdAt: Date; updatedAt: Date;
};
export type SystemAssignment = { userId: string; systemId: string; createdAt: Date };
export type IncidentRow = {
  id: string; systemId: string; title: string; date: string; severity: string; category: string; status: string;
  serious: boolean; notes: string; createdById: string | null; createdAt: Date; updatedAt: Date;
};
/** role holds a client role (orgId set) or an Ituti staff role (orgId null). Only a hash of the token is stored. */
export type Invitation = {
  id: string; email: string; orgId: string | null; role: string; tokenHash: string; invitedById: string;
  expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null; createdAt: Date;
};
export type AuditEntry = { id: string; orgId: string | null; systemId: string | null; userId: string | null; action: string; detail: Record<string, unknown> | null; createdAt: Date; updatedAt: Date };

const def = (file: string, columns: TableDef['columns']): TableDef => ({ file, columns });
const now = () => new Date();
const withId = () => ({ id: randomUUID(), createdAt: now() });

export const db = {
  users: table<User>(def('users.csv', { id: 'str', email: 'str', name: 'str?', role: 'str', disabled: 'bool', emailVerified: 'date?', image: 'str?', createdAt: 'date' }),
    () => ({ ...withId(), name: null, image: null, emailVerified: null, role: 'CLIENT', disabled: false })),
  sessions: table<Session>(def('sessions.csv', { sessionToken: 'str', userId: 'str', expires: 'date' })),
  verificationTokens: table<VerificationToken>(def('verification_tokens.csv', { identifier: 'str', token: 'str', expires: 'date' })),
  organizations: table<Org>(def('organizations.csv', { id: 'str', name: 'str', slug: 'str', createdAt: 'date' }), withId),
  memberships: table<Membership>(def('memberships.csv', { userId: 'str', orgId: 'str', role: 'str', createdAt: 'date' }), () => ({ createdAt: now() })),
  assessorAssignments: table<AssessorAssignment>(def('assessor_assignments.csv', { userId: 'str', orgId: 'str', createdAt: 'date' }), () => ({ createdAt: now() })),
  aiSystems: table<AiSystemRow>(def('ai_systems.csv', {
    id: 'str', orgId: 'str', name: 'str', tier: 'str', riskScore: 'int?', readiness: 'int', openIncidents: 'int', version: 'int',
    createdById: 'str?', updatedById: 'str?', createdAt: 'date', updatedAt: 'date', data: 'json',
  }), () => ({ ...withId(), updatedAt: now(), tier: 'unknown', riskScore: null, readiness: 0, openIncidents: 0, version: 1, createdById: null, updatedById: null })),
  systemAssignments: table<SystemAssignment>(def('system_assignments.csv', { userId: 'str', systemId: 'str', createdAt: 'date' }), () => ({ createdAt: now() })),
  incidents: table<IncidentRow>(def('incidents.csv', {
    id: 'str', systemId: 'str', date: 'str', title: 'str', severity: 'str', category: 'str', status: 'str', serious: 'bool', notes: 'str',
    createdById: 'str?', createdAt: 'date', updatedAt: 'date',
  }), () => ({ ...withId(), updatedAt: now(), status: 'open', serious: false, notes: '', createdById: null })),
  invitations: table<Invitation>(def('invitations.csv', {
    id: 'str', email: 'str', orgId: 'str?', role: 'str', tokenHash: 'str', invitedById: 'str', expiresAt: 'date', acceptedAt: 'date?', revokedAt: 'date?', createdAt: 'date',
  }), () => ({ ...withId(), orgId: null, acceptedAt: null, revokedAt: null })),
  auditLog: table<AuditEntry>(def('audit_log.csv', { id: 'str', createdAt: 'date', updatedAt: 'date', orgId: 'str?', systemId: 'str?', userId: 'str?', action: 'str', detail: 'json?' }),
    () => ({ ...withId(), updatedAt: now(), orgId: null, systemId: null, userId: null, detail: null })),
};

/* ---------- Deletes that cascade to related rows (children first) ---------- */
export async function deleteSystems(ids: string[]) {
  if (!ids.length) return;
  const set = new Set(ids);
  await db.incidents.remove(i => set.has(i.systemId));
  await db.systemAssignments.remove(a => set.has(a.systemId));
  await db.aiSystems.remove(s => set.has(s.id));
}

export async function deleteOrg(orgId: string) {
  await deleteSystems(db.aiSystems.find(s => s.orgId === orgId).map(s => s.id));
  await db.memberships.remove(m => m.orgId === orgId);
  await db.assessorAssignments.remove(a => a.orgId === orgId);
  await db.invitations.remove(i => i.orgId === orgId);
  await db.auditLog.remove(a => a.orgId === orgId);
  await db.organizations.remove(o => o.id === orgId);
}

export async function deleteUser(userId: string) {
  await db.sessions.remove(s => s.userId === userId);
  await db.memberships.remove(m => m.userId === userId);
  await db.assessorAssignments.remove(a => a.userId === userId);
  await db.systemAssignments.remove(a => a.userId === userId);
  await db.invitations.remove(i => i.invitedById === userId);
  await db.auditLog.update(a => a.userId === userId, { userId: null });
  await db.incidents.update(i => i.createdById === userId, { createdById: null });
  await db.aiSystems.update(s => s.createdById === userId || s.updatedById === userId, s => ({
    createdById: s.createdById === userId ? null : s.createdById, updatedById: s.updatedById === userId ? null : s.updatedById,
  }));
  await db.users.remove(u => u.id === userId);
}
