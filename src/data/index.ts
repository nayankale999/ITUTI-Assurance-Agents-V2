/* The app's tables, stored in MySQL / MariaDB. See sql.ts for the query API and schema.ts for the tables. */
import { randomUUID } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { makeTable, onFirstUse, pool, transaction, type ColType, type Table, type TableDef } from './sql';
import { migrate } from './schema';
import { importCsvOnce } from './csv-import';
import type { AssessmentData } from '@/lib/assurance';
import type { UserRoleT, OrgRoleT } from '@/lib/permissions';

export type User = { id: string; name: string | null; email: string; emailVerified: Date | null; image: string | null; role: UserRoleT; disabled: boolean; createdAt: Date };
export type Session = { sessionToken: string; userId: string; expires: Date };
export type VerificationToken = { identifier: string; token: string; expires: Date };
export type Org = { id: string; name: string; slug: string; aiEnabled: boolean; createdAt: Date };
export type Membership = { userId: string; orgId: string; role: OrgRoleT; createdAt: Date };
export type AssessorAssignment = { userId: string; orgId: string; createdAt: Date };
export type AiSystemRow = {
  id: string; orgId: string; name: string; data: AssessmentData; tier: string; riskScore: number | null; readiness: number;
  openIncidents: number; version: number; createdById: string | null; updatedById: string | null; createdAt: Date; updatedAt: Date;
};
export type SystemAssignment = { userId: string; systemId: string; createdAt: Date };
export type IncidentRow = {
  id: string; systemId: string; title: string; date: string; severity: string; category: string; status: string;
  serious: boolean; notes: string; source: string | null; externalId: string | null; externalUrl: string | null;
  createdById: string | null; createdAt: Date; updatedAt: Date;
};
/** role holds a client role (orgId set) or an Ituti staff role (orgId null). Only a hash of the token is stored. */
export type Invitation = {
  id: string; email: string; orgId: string | null; role: string; tokenHash: string; invitedById: string;
  expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null; createdAt: Date;
};
export type AuditEntry = { id: string; orgId: string | null; systemId: string | null; userId: string | null; action: string; detail: Record<string, unknown> | null; createdAt: Date; updatedAt: Date };

/* ---------- Agent tables ---------- */
export type DocumentRow = {
  id: string; orgId: string; systemId: string; name: string; mime: string; size: number; sha256: string; pages: number; chars: number;
  status: 'ready' | 'failed'; error: string | null; uploadedById: string | null; createdAt: Date;
};
export type ChunkRow = { id: string; documentId: string; systemId: string; seq: number; locator: string; text: string };
export type Source = { kind: 'document' | 'web' | 'model' | 'system'; title: string; ref: string; locator?: string; quote?: string; url?: string };
export type ModelDossier = Record<string, string>;
export type ModelRow = {
  id: string; mkey: string; provider: string; model: string; status: 'ready' | 'researching' | 'failed';
  dossier: ModelDossier | null; sources: Source[] | null; error: string | null; researchedAt: Date | null; createdAt: Date; updatedAt: Date;
};
export type RunLogEntry = { at: string; text: string };
export type AgentRun = {
  id: string; orgId: string; systemId: string; status: 'queued' | 'running' | 'completed' | 'failed'; startedById: string | null; model: string;
  log: RunLogEntry[]; summary: string | null; error: string | null; inputTokens: number; outputTokens: number; proposals: number;
  createdAt: Date; heartbeatAt: Date | null; finishedAt: Date | null;
};
export type Proposal = {
  id: string; runId: string; systemId: string; path: string; label: string; value: unknown; previous: unknown; rationale: string;
  sources: Source[]; confidence: 'high' | 'medium' | 'low'; status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  decidedById: string | null; decidedAt: Date | null; createdAt: Date;
};

const def = (name: string, key: string[], columns: Record<string, ColType>): TableDef => ({ name, key, columns });
const now = () => new Date();
const withId = () => ({ id: randomUUID(), createdAt: now() });

export const DEFS = {
  users: def('users', ['id'], { id: 'str', email: 'str', name: 'str?', role: 'str', disabled: 'bool', emailVerified: 'date?', image: 'str?', createdAt: 'date' }),
  sessions: def('sessions', ['sessionToken'], { sessionToken: 'str', userId: 'str', expires: 'date' }),
  verificationTokens: def('verification_tokens', ['identifier', 'token'], { identifier: 'str', token: 'str', expires: 'date' }),
  organizations: def('organizations', ['id'], { id: 'str', name: 'str', slug: 'str', aiEnabled: 'bool', createdAt: 'date' }),
  memberships: def('memberships', ['userId', 'orgId'], { userId: 'str', orgId: 'str', role: 'str', createdAt: 'date' }),
  assessorAssignments: def('assessor_assignments', ['userId', 'orgId'], { userId: 'str', orgId: 'str', createdAt: 'date' }),
  aiSystems: def('ai_systems', ['id'], {
    id: 'str', orgId: 'str', name: 'str', tier: 'str', riskScore: 'int?', readiness: 'int', openIncidents: 'int', version: 'int',
    createdById: 'str?', updatedById: 'str?', createdAt: 'date', updatedAt: 'date', data: 'json',
  }),
  systemAssignments: def('system_assignments', ['userId', 'systemId'], { userId: 'str', systemId: 'str', createdAt: 'date' }),
  incidents: def('incidents', ['id'], {
    id: 'str', systemId: 'str', date: 'str', title: 'str', severity: 'str', category: 'str', status: 'str', serious: 'bool', notes: 'str',
    source: 'str?', externalId: 'str?', externalUrl: 'str?', createdById: 'str?', createdAt: 'date', updatedAt: 'date',
  }),
  invitations: def('invitations', ['id'], {
    id: 'str', email: 'str', orgId: 'str?', role: 'str', tokenHash: 'str', invitedById: 'str', expiresAt: 'date', acceptedAt: 'date?', revokedAt: 'date?', createdAt: 'date',
  }),
  auditLog: def('audit_log', ['id'], { id: 'str', createdAt: 'date', updatedAt: 'date', orgId: 'str?', systemId: 'str?', userId: 'str?', action: 'str', detail: 'json?' }),
  documents: def('documents', ['id'], {
    id: 'str', orgId: 'str', systemId: 'str', name: 'str', mime: 'str', size: 'int', sha256: 'str', pages: 'int', chars: 'int', status: 'str', error: 'str?', uploadedById: 'str?', createdAt: 'date',
  }),
  chunks: def('document_chunks', ['id'], { id: 'str', documentId: 'str', systemId: 'str', seq: 'int', locator: 'str', text: 'str' }),
  models: def('model_library', ['id'], {
    id: 'str', mkey: 'str', provider: 'str', model: 'str', status: 'str', dossier: 'json?', sources: 'json?', error: 'str?', researchedAt: 'date?', createdAt: 'date', updatedAt: 'date',
  }),
  agentRuns: def('agent_runs', ['id'], {
    id: 'str', orgId: 'str', systemId: 'str', status: 'str', startedById: 'str?', model: 'str', log: 'json', summary: 'str?', error: 'str?',
    inputTokens: 'int', outputTokens: 'int', proposals: 'int', createdAt: 'date', heartbeatAt: 'date?', finishedAt: 'date?',
  }),
  proposals: def('proposals', ['id'], {
    id: 'str', runId: 'str', systemId: 'str', path: 'str', label: 'str', value: 'json', previous: 'json?', rationale: 'str', sources: 'json',
    confidence: 'str', status: 'str', decidedById: 'str?', decidedAt: 'date?', createdAt: 'date',
  }),
};

function makeDb(exec: () => import('mysql2/promise').Pool | PoolConnection, inTx: (fn: (e: any) => Promise<unknown>) => Promise<unknown>) {
  const t = <T>(d: TableDef, defaults: () => Partial<T> = () => ({})): Table<T> => makeTable<T>(d, defaults, exec, inTx);
  return {
    users: t<User>(DEFS.users, () => ({ ...withId(), name: null, image: null, emailVerified: null, role: 'CLIENT', disabled: false })),
    sessions: t<Session>(DEFS.sessions),
    verificationTokens: t<VerificationToken>(DEFS.verificationTokens),
    organizations: t<Org>(DEFS.organizations, () => ({ ...withId(), aiEnabled: false })),
    memberships: t<Membership>(DEFS.memberships, () => ({ createdAt: now() })),
    assessorAssignments: t<AssessorAssignment>(DEFS.assessorAssignments, () => ({ createdAt: now() })),
    aiSystems: t<AiSystemRow>(DEFS.aiSystems, () => ({ ...withId(), updatedAt: now(), tier: 'unknown', riskScore: null, readiness: 0, openIncidents: 0, version: 1, createdById: null, updatedById: null })),
    systemAssignments: t<SystemAssignment>(DEFS.systemAssignments, () => ({ createdAt: now() })),
    incidents: t<IncidentRow>(DEFS.incidents, () => ({ ...withId(), updatedAt: now(), status: 'open', serious: false, notes: '', source: null, externalId: null, externalUrl: null, createdById: null })),
    invitations: t<Invitation>(DEFS.invitations, () => ({ ...withId(), orgId: null, acceptedAt: null, revokedAt: null })),
    auditLog: t<AuditEntry>(DEFS.auditLog, () => ({ ...withId(), updatedAt: now(), orgId: null, systemId: null, userId: null, detail: null })),
    documents: t<DocumentRow>(DEFS.documents, () => ({ ...withId(), pages: 0, chars: 0, status: 'ready', error: null, uploadedById: null })),
    chunks: t<ChunkRow>(DEFS.chunks, () => ({ id: randomUUID() })),
    models: t<ModelRow>(DEFS.models, () => ({ ...withId(), updatedAt: now(), status: 'researching', dossier: null, sources: null, error: null, researchedAt: null })),
    agentRuns: t<AgentRun>(DEFS.agentRuns, () => ({ ...withId(), status: 'queued', startedById: null, log: [], summary: null, error: null, inputTokens: 0, outputTokens: 0, proposals: 0, heartbeatAt: null, finishedAt: null })),
    proposals: t<Proposal>(DEFS.proposals, () => ({ ...withId(), previous: null, status: 'pending', decidedById: null, decidedAt: null })),
  };
}

export type Db = ReturnType<typeof makeDb> & { tx<R>(fn: (t: Db) => Promise<R>): Promise<R> };

function txDb(conn: PoolConnection): Db {
  const inTx = (fn: (e: PoolConnection) => Promise<unknown>) => fn(conn); // already in a transaction
  const d = makeDb(() => conn, inTx) as Db;
  d.tx = fn => fn(d);
  return d;
}

const base = makeDb(() => pool(), fn => transaction(conn => fn(conn))) as Db;
base.tx = fn => transaction(conn => fn(txDb(conn)));
export const db: Db = base;

onFirstUse(async () => {
  await migrate(pool());
  await importCsvOnce(db);
});

/* ---------- Deletes that cascade to related rows (children first) ---------- */
export async function deleteSystems(ids: string[]) {
  if (!ids.length) return;
  await db.tx(async t => {
    await t.incidents.remove({ systemId: ids });
    await t.systemAssignments.remove({ systemId: ids });
    await t.chunks.remove({ systemId: ids });
    await t.documents.remove({ systemId: ids });
    await t.proposals.remove({ systemId: ids });
    await t.agentRuns.remove({ systemId: ids });
    await t.aiSystems.remove({ id: ids });
  });
  // Uploaded files are removed after the rows are gone
  const { removeStoredFiles } = await import('@/lib/documents');
  await removeStoredFiles(ids);
}

export async function deleteOrg(orgId: string) {
  await deleteSystems((await db.aiSystems.find({ orgId }, { columns: ['id'] })).map(s => s.id));
  await db.tx(async t => {
    await t.memberships.remove({ orgId });
    await t.assessorAssignments.remove({ orgId });
    await t.invitations.remove({ orgId });
    await t.auditLog.remove({ orgId });
    await t.organizations.remove({ id: orgId });
  });
}

export async function deleteUser(userId: string) {
  await db.tx(async t => {
    await t.sessions.remove({ userId });
    await t.memberships.remove({ userId });
    await t.assessorAssignments.remove({ userId });
    await t.systemAssignments.remove({ userId });
    await t.invitations.remove({ invitedById: userId });
    await t.auditLog.update({ userId }, { userId: null });
    await t.incidents.update({ createdById: userId }, { createdById: null });
    await t.aiSystems.update({ createdById: userId }, { createdById: null });
    await t.aiSystems.update({ updatedById: userId }, { updatedById: null });
    await t.documents.update({ uploadedById: userId }, { uploadedById: null });
    await t.agentRuns.update({ startedById: userId }, { startedById: null });
    await t.proposals.update({ decidedById: userId }, { decidedById: null });
    await t.users.remove({ id: userId });
  });
}
