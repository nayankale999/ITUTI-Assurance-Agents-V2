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
export type Plan = 'per_assessment' | 'enterprise' | 'internal';
export type Subscription = 'free' | 'standard' | 'enterprise';
export type Org = { id: string; name: string; slug: string; aiEnabled: boolean; plan: Plan; subscription: Subscription; signupSource: string | null; createdAt: Date };
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
  /** 'incident' for an adverse event; 'gap' for an action raised to close an assessment gap */
  kind: 'incident' | 'gap'; gapRef: string | null; ownerId: string | null; ownerName: string | null; department: string | null; due: string | null;
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
  log: RunLogEntry[]; summary: string | null; error: string | null; inputTokens: number; outputTokens: number; proposals: number; source: 'web' | 'a2a' | 'mcp';
  createdAt: Date; heartbeatAt: Date | null; finishedAt: Date | null; usage_detail: RunUsage | null; specialist: string | null;
};
/** Tokens, estimated cost and time per specialist in one run. */
export type SpecialistUsage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; ms: number; proposals: number; tools: number; model: string };
export type RunUsage = Record<string, SpecialistUsage>;
export type PlanSettings = { systemId: string; orgId: string; auto: boolean; ownerId: string | null; ownerName: string | null; department: string | null; dueDays: number; updatedById: string | null; updatedAt: Date; lastAutoAt: Date | null };
export type SpendRow = { id: string; orgId: string | null; systemId: string | null; runId: string | null; source: string; agent: string; model: string; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; costMicros: number; createdAt: Date };
export type SpendBudget = { scope: string; monthlyCents: number; alertPct: number; hardStop: boolean; alertedMonth: string | null; alertedLevel: number; updatedById: string | null; updatedAt: Date };
export type OAuthClient = { id: string; name: string; redirectUris: string[]; secretHash: string | null; createdAt: Date; lastUsedAt: Date | null };
/** An authorisation code, access token or refresh token given to an MCP client for one user and one client organisation. */
export type OAuthGrant = { id: string; kind: 'code' | 'access' | 'refresh'; tokenHash: string; clientId: string; userId: string; orgId: string; scope: string; redirectUri: string | null; codeChallenge: string | null; resource: string | null; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null; lastUsedAt: Date | null; familyId: string; createdAt: Date };
export type Proposal = {
  id: string; runId: string; systemId: string; path: string; label: string; value: unknown; previous: unknown; rationale: string;
  sources: Source[]; confidence: 'high' | 'medium' | 'low'; status: 'pending' | 'accepted' | 'rejected' | 'superseded';
  decidedById: string | null; decidedAt: Date | null; createdAt: Date;
};

export type ApiKey = { id: string; orgId: string; name: string; prefix: string; keyHash: string; createdById: string | null; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
export type UsageEvent = { id: string; orgId: string; kind: 'assessment'; systemId: string | null; runId: string | null; source: string; billable: boolean; plan: string; createdAt: Date; reportedAt: Date | null };
export type A2ATaskRow = { id: string; orgId: string; contextId: string; task: unknown; createdAt: Date; updatedAt: Date };
export type Registration = { id: string; email: string; name: string; orgName: string; source: string | null; expiresAt: Date; completedAt: Date | null; orgId: string | null; createdAt: Date };
export type SystemChange = { id: string; orgId: string; systemId: string; userId: string | null; path: string; label: string; before: string | null; after: string | null; via: 'editor' | 'agent' | 'a2a'; createdAt: Date; updatedAt: Date };
export type ShareLink = { id: string; orgId: string; systemId: string; kind: 'card'; tokenHash: string; createdById: string | null; createdAt: Date; revokedAt: Date | null; lastViewedAt: Date | null };
export type Team = { id: string; orgId: string; name: string; leadId: string | null; createdAt: Date };
export type TeamMember = { teamId: string; userId: string; createdAt: Date };
export type TeamSystem = { teamId: string; systemId: string; createdAt: Date };
export type TaskRow = { id: string; orgId: string; systemId: string; teamId: string | null; assigneeId: string; scope: string; status: 'todo' | 'doing' | 'done'; due: string | null; note: string | null; createdById: string | null; createdAt: Date; updatedAt: Date; doneAt: Date | null };
/** A client's request to move to a larger subscription, decided by an Ituti admin. */
export type UpgradeRequest = { id: string; orgId: string; fromTier: Subscription; toTier: Subscription; message: string | null; requestedById: string; status: 'pending' | 'approved' | 'declined'; decidedById: string | null; decidedAt: Date | null; createdAt: Date };
export type A2AContextRow = { id: string; orgId: string; history: { role: 'user' | 'assistant'; text: string }[]; updatedAt: Date };

const def = (name: string, key: string[], columns: Record<string, ColType>): TableDef => ({ name, key, columns });
const now = () => new Date();
const withId = () => ({ id: randomUUID(), createdAt: now() });

export const DEFS = {
  users: def('users', ['id'], { id: 'str', email: 'str', name: 'str?', role: 'str', disabled: 'bool', emailVerified: 'date?', image: 'str?', createdAt: 'date' }),
  sessions: def('sessions', ['sessionToken'], { sessionToken: 'str', userId: 'str', expires: 'date' }),
  verificationTokens: def('verification_tokens', ['identifier', 'token'], { identifier: 'str', token: 'str', expires: 'date' }),
  organizations: def('organizations', ['id'], { id: 'str', name: 'str', slug: 'str', aiEnabled: 'bool', plan: 'str', subscription: 'str', signupSource: 'str?', createdAt: 'date' }),
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
    kind: 'str', gapRef: 'str?', ownerId: 'str?', ownerName: 'str?', department: 'str?', due: 'str?',
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
    inputTokens: 'int', outputTokens: 'int', proposals: 'int', source: 'str', createdAt: 'date', heartbeatAt: 'date?', finishedAt: 'date?',
    usage_detail: 'json?', specialist: 'str?',
  }),
  aiSpend: def('ai_spend', ['id'], { id: 'str', orgId: 'str?', systemId: 'str?', runId: 'str?', source: 'str', agent: 'str', model: 'str', inputTokens: 'int', outputTokens: 'int', cacheRead: 'int', cacheWrite: 'int', costMicros: 'int', createdAt: 'date' }),
  spendBudgets: def('spend_budgets', ['scope'], { scope: 'str', monthlyCents: 'int', alertPct: 'int', hardStop: 'bool', alertedMonth: 'str?', alertedLevel: 'int', updatedById: 'str?', updatedAt: 'date' }),
  oauthClients: def('oauth_clients', ['id'], { id: 'str', name: 'str', redirectUris: 'json', secretHash: 'str?', createdAt: 'date', lastUsedAt: 'date?' }),
  oauthGrants: def('oauth_grants', ['id'], { id: 'str', kind: 'str', tokenHash: 'str', clientId: 'str', userId: 'str', orgId: 'str', scope: 'str', redirectUri: 'str?', codeChallenge: 'str?', resource: 'str?', expiresAt: 'date', usedAt: 'date?', revokedAt: 'date?', lastUsedAt: 'date?', familyId: 'str', createdAt: 'date' }),
  planSettings: def('plan_settings', ['systemId'], { systemId: 'str', orgId: 'str', auto: 'bool', ownerId: 'str?', ownerName: 'str?', department: 'str?', dueDays: 'int', updatedById: 'str?', updatedAt: 'date', lastAutoAt: 'date?' }),
  apiKeys: def('api_keys', ['id'], { id: 'str', orgId: 'str', name: 'str', prefix: 'str', keyHash: 'str', createdById: 'str?', createdAt: 'date', lastUsedAt: 'date?', revokedAt: 'date?' }),
  usage: def('usage_events', ['id'], { id: 'str', orgId: 'str', kind: 'str', systemId: 'str?', runId: 'str?', source: 'str', billable: 'bool', plan: 'str', createdAt: 'date', reportedAt: 'date?' }),
  a2aTasks: def('a2a_tasks', ['id'], { id: 'str', orgId: 'str', contextId: 'str', task: 'json', createdAt: 'date', updatedAt: 'date' }),
  a2aContexts: def('a2a_contexts', ['id'], { id: 'str', orgId: 'str', history: 'json', updatedAt: 'date' }),
  registrations: def('registrations', ['id'], { id: 'str', email: 'str', name: 'str', orgName: 'str', source: 'str?', expiresAt: 'date', completedAt: 'date?', orgId: 'str?', createdAt: 'date' }),
  changes: def('system_changes', ['id'], { id: 'str', orgId: 'str', systemId: 'str', userId: 'str?', path: 'str', label: 'str', before: 'str?', after: 'str?', via: 'str', createdAt: 'date', updatedAt: 'date' }),
  shares: def('share_links', ['id'], { id: 'str', orgId: 'str', systemId: 'str', kind: 'str', tokenHash: 'str', createdById: 'str?', createdAt: 'date', revokedAt: 'date?', lastViewedAt: 'date?' }),
  teams: def('teams', ['id'], { id: 'str', orgId: 'str', name: 'str', leadId: 'str?', createdAt: 'date' }),
  teamMembers: def('team_members', ['teamId', 'userId'], { teamId: 'str', userId: 'str', createdAt: 'date' }),
  teamSystems: def('team_systems', ['teamId', 'systemId'], { teamId: 'str', systemId: 'str', createdAt: 'date' }),
  tasks: def('tasks', ['id'], { id: 'str', orgId: 'str', systemId: 'str', teamId: 'str?', assigneeId: 'str', scope: 'str', status: 'str', due: 'str?', note: 'str?', createdById: 'str?', createdAt: 'date', updatedAt: 'date', doneAt: 'date?' }),
  upgradeRequests: def('upgrade_requests', ['id'], { id: 'str', orgId: 'str', fromTier: 'str', toTier: 'str', message: 'str?', requestedById: 'str', status: 'str', decidedById: 'str?', decidedAt: 'date?', createdAt: 'date' }),
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
    organizations: t<Org>(DEFS.organizations, () => ({ ...withId(), aiEnabled: false, plan: 'per_assessment', subscription: 'free', signupSource: null })),
    memberships: t<Membership>(DEFS.memberships, () => ({ createdAt: now() })),
    assessorAssignments: t<AssessorAssignment>(DEFS.assessorAssignments, () => ({ createdAt: now() })),
    aiSystems: t<AiSystemRow>(DEFS.aiSystems, () => ({ ...withId(), updatedAt: now(), tier: 'unknown', riskScore: null, readiness: 0, openIncidents: 0, version: 1, createdById: null, updatedById: null })),
    systemAssignments: t<SystemAssignment>(DEFS.systemAssignments, () => ({ createdAt: now() })),
    incidents: t<IncidentRow>(DEFS.incidents, () => ({ ...withId(), updatedAt: now(), status: 'open', serious: false, notes: '', source: null, externalId: null, externalUrl: null, createdById: null, kind: 'incident', gapRef: null, ownerId: null, ownerName: null, department: null, due: null })),
    invitations: t<Invitation>(DEFS.invitations, () => ({ ...withId(), orgId: null, acceptedAt: null, revokedAt: null })),
    auditLog: t<AuditEntry>(DEFS.auditLog, () => ({ ...withId(), updatedAt: now(), orgId: null, systemId: null, userId: null, detail: null })),
    documents: t<DocumentRow>(DEFS.documents, () => ({ ...withId(), pages: 0, chars: 0, status: 'ready', error: null, uploadedById: null })),
    chunks: t<ChunkRow>(DEFS.chunks, () => ({ id: randomUUID() })),
    models: t<ModelRow>(DEFS.models, () => ({ ...withId(), updatedAt: now(), status: 'researching', dossier: null, sources: null, error: null, researchedAt: null })),
    agentRuns: t<AgentRun>(DEFS.agentRuns, () => ({ ...withId(), status: 'queued', startedById: null, log: [], summary: null, error: null, inputTokens: 0, outputTokens: 0, proposals: 0, source: 'web', heartbeatAt: null, finishedAt: null, usage_detail: null, specialist: null })),
    aiSpend: t<SpendRow>(DEFS.aiSpend, () => ({ ...withId(), orgId: null, systemId: null, runId: null, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costMicros: 0 })),
    spendBudgets: t<SpendBudget>(DEFS.spendBudgets, () => ({ alertPct: 80, hardStop: false, alertedMonth: null, alertedLevel: 0, updatedById: null, updatedAt: now() })),
    oauthClients: t<OAuthClient>(DEFS.oauthClients, () => ({ createdAt: now(), secretHash: null, lastUsedAt: null })),
    oauthGrants: t<OAuthGrant>(DEFS.oauthGrants, () => ({ ...withId(), redirectUri: null, codeChallenge: null, resource: null, usedAt: null, revokedAt: null, lastUsedAt: null })),
    planSettings: t<PlanSettings>(DEFS.planSettings, () => ({ auto: false, ownerId: null, ownerName: null, department: null, dueDays: 30, updatedById: null, updatedAt: now(), lastAutoAt: null })),
    apiKeys: t<ApiKey>(DEFS.apiKeys, () => ({ ...withId(), createdById: null, lastUsedAt: null, revokedAt: null })),
    usage: t<UsageEvent>(DEFS.usage, () => ({ ...withId(), systemId: null, runId: null, reportedAt: null })),
    a2aTasks: t<A2ATaskRow>(DEFS.a2aTasks, () => ({ createdAt: now(), updatedAt: now() })),
    a2aContexts: t<A2AContextRow>(DEFS.a2aContexts, () => ({ history: [], updatedAt: now() })),
    registrations: t<Registration>(DEFS.registrations, () => ({ ...withId(), source: null, completedAt: null, orgId: null })),
    changes: t<SystemChange>(DEFS.changes, () => ({ ...withId(), updatedAt: now(), userId: null, before: null, after: null, via: 'editor' })),
    shares: t<ShareLink>(DEFS.shares, () => ({ ...withId(), kind: 'card', createdById: null, revokedAt: null, lastViewedAt: null })),
    teams: t<Team>(DEFS.teams, () => ({ ...withId(), leadId: null })),
    teamMembers: t<TeamMember>(DEFS.teamMembers, () => ({ createdAt: now() })),
    teamSystems: t<TeamSystem>(DEFS.teamSystems, () => ({ createdAt: now() })),
    tasks: t<TaskRow>(DEFS.tasks, () => ({ ...withId(), updatedAt: now(), teamId: null, status: 'todo', due: null, note: null, createdById: null, doneAt: null })),
    upgradeRequests: t<UpgradeRequest>(DEFS.upgradeRequests, () => ({ ...withId(), message: null, status: 'pending', decidedById: null, decidedAt: null })),
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
    await t.changes.remove({ systemId: ids });
    await t.tasks.remove({ systemId: ids });
    await t.teamSystems.remove({ systemId: ids });
    await t.shares.remove({ systemId: ids });
    await t.planSettings.remove({ systemId: ids });
    await t.aiSpend.update({ systemId: ids }, { systemId: null, runId: null });
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
    await t.apiKeys.remove({ orgId });
    await t.a2aTasks.remove({ orgId });
    await t.a2aContexts.remove({ orgId });
    await t.spendBudgets.remove({ scope: orgId });
    await t.oauthGrants.remove({ orgId });
    await t.upgradeRequests.remove({ orgId });
    await t.registrations.update({ orgId }, { orgId: null });
    const teamIds = (await t.teams.find({ orgId })).map(x => x.id);
    if (teamIds.length) { await t.teamMembers.remove({ teamId: teamIds }); await t.teamSystems.remove({ teamId: teamIds }); }
    await t.tasks.remove({ orgId });
    await t.teams.remove({ orgId });
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
    await t.apiKeys.update({ createdById: userId }, { createdById: null });
    await t.proposals.update({ decidedById: userId }, { decidedById: null });
    await t.changes.update({ userId }, { userId: null });
    await t.incidents.update({ ownerId: userId }, { ownerId: null });
    await t.teamMembers.remove({ userId });
    await t.teams.update({ leadId: userId }, { leadId: null });
    await t.tasks.remove({ assigneeId: userId });
    await t.tasks.update({ createdById: userId }, { createdById: null });
    await t.planSettings.update({ ownerId: userId }, { ownerId: null, auto: false });
    await t.planSettings.update({ updatedById: userId }, { updatedById: null });
    await t.spendBudgets.update({ updatedById: userId }, { updatedById: null });
    await t.oauthGrants.remove({ userId });
    await t.shares.update({ createdById: userId }, { createdById: null });
    await t.users.remove({ id: userId });
  });
}
