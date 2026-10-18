/* One-off move from the earlier CSV storage: on first start against an empty database,
 * rows from the CSV files in DATA_DIR are copied in. The CSV files are left untouched as a backup. */
import fs from 'fs';
import path from 'path';
import { readTable, dataDir, type TableDef as CsvDef } from './csv';
import type { Db } from './index';

const CSV: [keyof Db & string, CsvDef][] = [
  ['users', { file: 'users.csv', columns: { id: 'str', email: 'str', name: 'str?', role: 'str', disabled: 'bool', emailVerified: 'date?', image: 'str?', createdAt: 'date' } }],
  ['organizations', { file: 'organizations.csv', columns: { id: 'str', name: 'str', slug: 'str', createdAt: 'date' } }],
  ['memberships', { file: 'memberships.csv', columns: { userId: 'str', orgId: 'str', role: 'str', createdAt: 'date' } }],
  ['assessorAssignments', { file: 'assessor_assignments.csv', columns: { userId: 'str', orgId: 'str', createdAt: 'date' } }],
  ['aiSystems', { file: 'ai_systems.csv', columns: {
    id: 'str', orgId: 'str', name: 'str', tier: 'str', riskScore: 'int?', readiness: 'int', openIncidents: 'int', version: 'int',
    createdById: 'str?', updatedById: 'str?', createdAt: 'date', updatedAt: 'date', data: 'json',
  } }],
  ['systemAssignments', { file: 'system_assignments.csv', columns: { userId: 'str', systemId: 'str', createdAt: 'date' } }],
  ['incidents', { file: 'incidents.csv', columns: {
    id: 'str', systemId: 'str', date: 'str', title: 'str', severity: 'str', category: 'str', status: 'str', serious: 'bool', notes: 'str',
    createdById: 'str?', createdAt: 'date', updatedAt: 'date',
  } }],
  ['invitations', { file: 'invitations.csv', columns: {
    id: 'str', email: 'str', orgId: 'str?', role: 'str', tokenHash: 'str', invitedById: 'str', expiresAt: 'date', acceptedAt: 'date?', revokedAt: 'date?', createdAt: 'date',
  } }],
  ['auditLog', { file: 'audit_log.csv', columns: { id: 'str', createdAt: 'date', updatedAt: 'date', orgId: 'str?', systemId: 'str?', userId: 'str?', action: 'str', detail: 'json?' } }],
  ['sessions', { file: 'sessions.csv', columns: { sessionToken: 'str', userId: 'str', expires: 'date' } }],
];

export async function importCsvOnce(db: Db) {
  const dir = dataDir();
  if (!fs.existsSync(path.join(dir, 'users.csv'))) return;
  if ((await db.users.count()) > 0) return;
  const counts: string[] = [];
  await db.tx(async t => {
    for (const [name, def] of CSV) {
      if (!fs.existsSync(path.join(dir, def.file))) continue;
      let rows = readTable(def);
      if (name === 'sessions') rows = rows.filter(r => (r.expires as Date).getTime() > Date.now());
      for (let i = 0; i < rows.length; i += 200) await (t[name] as { insertMany(r: unknown[]): Promise<unknown> }).insertMany(rows.slice(i, i + 200));
      counts.push(`${name} ${rows.length}`);
    }
  });
  console.log(`[db] imported CSV data from ${dir}: ${counts.join(', ')}`);
}
