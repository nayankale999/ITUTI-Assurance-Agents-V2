/* Database schema, applied automatically before the first query.
 * Migrations run in order and are recorded in schema_migrations; never edit one that has shipped, add a new one. */
import type { Pool } from 'mysql2/promise';
import { query, run } from './sql';

const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const ID = 'VARCHAR(36) NOT NULL';
const REF = 'VARCHAR(36) NULL';
const AT = 'DATETIME(3) NOT NULL';
const AT_NULL = 'DATETIME(3) NULL';

export const MIGRATIONS: [string, string[]][] = [
  ['001_core', [
    `CREATE TABLE IF NOT EXISTS users (id ${ID} PRIMARY KEY, email VARCHAR(255) NOT NULL, name VARCHAR(255) NULL, role VARCHAR(32) NOT NULL,
      disabled TINYINT(1) NOT NULL DEFAULT 0, emailVerified ${AT_NULL}, image TEXT NULL, createdAt ${AT}, UNIQUE KEY uq_users_email (email)) ${T}`,
    `CREATE TABLE IF NOT EXISTS sessions (sessionToken VARCHAR(255) NOT NULL PRIMARY KEY, userId ${ID}, expires ${AT},
      KEY ix_sessions_user (userId), KEY ix_sessions_expires (expires)) ${T}`,
    `CREATE TABLE IF NOT EXISTS verification_tokens (identifier VARCHAR(255) NOT NULL, token VARCHAR(255) NOT NULL, expires ${AT},
      PRIMARY KEY (identifier, token), KEY ix_vt_expires (expires)) ${T}`,
    `CREATE TABLE IF NOT EXISTS organizations (id ${ID} PRIMARY KEY, name VARCHAR(255) NOT NULL, slug VARCHAR(255) NOT NULL,
      aiEnabled TINYINT(1) NOT NULL DEFAULT 0, createdAt ${AT}, UNIQUE KEY uq_org_slug (slug)) ${T}`,
    `CREATE TABLE IF NOT EXISTS memberships (userId ${ID}, orgId ${ID}, role VARCHAR(32) NOT NULL, createdAt ${AT},
      PRIMARY KEY (userId, orgId), KEY ix_mem_org (orgId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS assessor_assignments (userId ${ID}, orgId ${ID}, createdAt ${AT}, PRIMARY KEY (userId, orgId), KEY ix_aa_org (orgId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS ai_systems (id ${ID} PRIMARY KEY, orgId ${ID}, name VARCHAR(255) NOT NULL, tier VARCHAR(32) NOT NULL,
      riskScore INT NULL, readiness INT NOT NULL DEFAULT 0, openIncidents INT NOT NULL DEFAULT 0, version INT NOT NULL DEFAULT 1,
      createdById ${REF}, updatedById ${REF}, createdAt ${AT}, updatedAt ${AT}, data LONGTEXT NOT NULL, KEY ix_sys_org (orgId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS system_assignments (userId ${ID}, systemId ${ID}, createdAt ${AT}, PRIMARY KEY (userId, systemId), KEY ix_sa_sys (systemId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS incidents (id ${ID} PRIMARY KEY, systemId ${ID}, date VARCHAR(32) NOT NULL, title VARCHAR(500) NOT NULL,
      severity VARCHAR(32) NOT NULL, category VARCHAR(255) NOT NULL, status VARCHAR(32) NOT NULL, serious TINYINT(1) NOT NULL DEFAULT 0,
      notes TEXT NOT NULL, source VARCHAR(64) NULL, externalId VARCHAR(255) NULL, externalUrl TEXT NULL,
      createdById ${REF}, createdAt ${AT}, updatedAt ${AT}, KEY ix_inc_sys (systemId), KEY ix_inc_ext (systemId, source, externalId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS invitations (id ${ID} PRIMARY KEY, email VARCHAR(255) NOT NULL, orgId ${REF}, role VARCHAR(32) NOT NULL,
      tokenHash VARCHAR(128) NOT NULL, invitedById ${ID}, expiresAt ${AT}, acceptedAt ${AT_NULL}, revokedAt ${AT_NULL}, createdAt ${AT},
      UNIQUE KEY uq_inv_token (tokenHash), KEY ix_inv_email (email), KEY ix_inv_org (orgId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS audit_log (id ${ID} PRIMARY KEY, createdAt ${AT}, updatedAt ${AT}, orgId ${REF}, systemId ${REF}, userId ${REF},
      action VARCHAR(64) NOT NULL, detail LONGTEXT NULL, KEY ix_audit_org (orgId, createdAt), KEY ix_audit_sys (systemId, userId, action, updatedAt)) ${T}`,
  ]],
  ['002_agent', [
    `CREATE TABLE IF NOT EXISTS documents (id ${ID} PRIMARY KEY, orgId ${ID}, systemId ${ID}, name VARCHAR(255) NOT NULL, mime VARCHAR(128) NOT NULL,
      size INT NOT NULL, sha256 CHAR(64) NOT NULL, pages INT NOT NULL DEFAULT 0, chars INT NOT NULL DEFAULT 0, status VARCHAR(16) NOT NULL,
      error TEXT NULL, uploadedById ${REF}, createdAt ${AT}, KEY ix_doc_sys (systemId)) ${T}`,
    `CREATE TABLE IF NOT EXISTS document_chunks (id ${ID} PRIMARY KEY, documentId ${ID}, systemId ${ID}, seq INT NOT NULL, locator VARCHAR(128) NOT NULL,
      text MEDIUMTEXT NOT NULL, KEY ix_chunk_doc (documentId, seq), KEY ix_chunk_sys (systemId), FULLTEXT KEY ft_chunk_text (text)) ${T}`,
    `CREATE TABLE IF NOT EXISTS model_library (id ${ID} PRIMARY KEY, mkey VARCHAR(191) NOT NULL, provider VARCHAR(128) NOT NULL, model VARCHAR(255) NOT NULL,
      status VARCHAR(16) NOT NULL, dossier LONGTEXT NULL, sources LONGTEXT NULL, error TEXT NULL, researchedAt ${AT_NULL},
      createdAt ${AT}, updatedAt ${AT}, UNIQUE KEY uq_model_key (mkey)) ${T}`,
    `CREATE TABLE IF NOT EXISTS agent_runs (id ${ID} PRIMARY KEY, orgId ${ID}, systemId ${ID}, status VARCHAR(16) NOT NULL, startedById ${REF},
      model VARCHAR(64) NOT NULL, log LONGTEXT NOT NULL, summary TEXT NULL, error TEXT NULL, inputTokens INT NOT NULL DEFAULT 0,
      outputTokens INT NOT NULL DEFAULT 0, proposals INT NOT NULL DEFAULT 0, createdAt ${AT}, heartbeatAt ${AT_NULL}, finishedAt ${AT_NULL},
      KEY ix_run_sys (systemId, createdAt)) ${T}`,
    `CREATE TABLE IF NOT EXISTS proposals (id ${ID} PRIMARY KEY, runId ${ID}, systemId ${ID}, path VARCHAR(191) NOT NULL, label VARCHAR(255) NOT NULL,
      value LONGTEXT NOT NULL, previous LONGTEXT NULL, rationale TEXT NOT NULL, sources LONGTEXT NOT NULL, confidence VARCHAR(16) NOT NULL,
      status VARCHAR(16) NOT NULL, decidedById ${REF}, decidedAt ${AT_NULL}, createdAt ${AT},
      KEY ix_prop_sys (systemId, status), KEY ix_prop_run (runId)) ${T}`,
  ]],
];

/** Applies pending migrations. A named lock stops two app processes migrating at once. */
export async function migrate(p: Pool, log = console.log) {
  const conn = await p.getConnection();
  try {
    await query(conn, `SELECT GET_LOCK('assurance_migrate', 60)`);
    await run(conn, `CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(64) NOT NULL PRIMARY KEY, appliedAt DATETIME(3) NOT NULL) ${T}`);
    const done = new Set((await query<{ name: string }>(conn, 'SELECT name FROM schema_migrations')).map(r => r.name));
    for (const [name, stmts] of MIGRATIONS) {
      if (done.has(name)) continue;
      for (const s of stmts) await run(conn, s);
      await run(conn, 'INSERT INTO schema_migrations (name, appliedAt) VALUES (?, ?)', [name, new Date()]);
      log(`[db] applied migration ${name}`);
    }
  } finally {
    await query(conn, `SELECT RELEASE_LOCK('assurance_migrate')`).catch(() => {});
    conn.release();
  }
}
