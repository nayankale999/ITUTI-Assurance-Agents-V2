/* Database layer tests. Need TEST_DATABASE_URL (a server URL whose user may create databases named assurance_test_*);
   skipped without it. Each run uses a fresh database that is dropped afterwards. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import mysql from 'mysql2/promise';

const SERVER = process.env.TEST_DATABASE_URL;
const NAME = 'assurance_test_' + randomBytes(4).toString('hex');
const skip = !SERVER && 'TEST_DATABASE_URL not set';
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assurance-dbtest-'));

async function admin() {
  const u = new URL(SERVER!);
  return mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) });
}

let mod: typeof import('../src/data');
let sql: typeof import('../src/data/sql');

before(async () => {
  if (skip) return;
  const c = await admin();
  await c.query(`CREATE DATABASE \`${NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.end();
  process.env.DATABASE_URL = new URL('/' + NAME, SERVER!).toString();
  process.env.DATA_DIR = DATA;
  // Leftover CSV data from the earlier storage: imported on first use
  fs.writeFileSync(path.join(DATA, 'users.csv'), '﻿id,email,name,role,disabled,emailVerified,image,createdAt\r\nu-old,old@example.test,"Old, User",ITUTI_ADMIN,false,,,2026-10-01T10:00:00.000Z\r\n');
  fs.writeFileSync(path.join(DATA, 'organizations.csv'), '﻿id,name,slug,createdAt\r\no-old,\'=Old Bank,old-bank,2026-10-01T10:00:00.000Z\r\n');
  fs.writeFileSync(path.join(DATA, 'ai_systems.csv'), '﻿id,orgId,name,tier,riskScore,readiness,openIncidents,version,createdById,updatedById,createdAt,updatedAt,data\r\n' +
    's-old,o-old,Scoring,high,62,40,0,3,u-old,u-old,2026-10-01T10:00:00.000Z,2026-10-02T10:00:00.000Z,"{""profile"":{""name"":""Scoring""},""ctrl"":{""GOV-1"":{""s"":""met"",""e"":""Policy v1""}}}"\r\n');
  mod = await import('../src/data');
  sql = await import('../src/data/sql');
});

after(async () => {
  if (skip) return;
  await sql.closePool();
  const c = await admin();
  await c.query(`DROP DATABASE IF EXISTS \`${NAME}\``);
  await c.end();
  fs.rmSync(DATA, { recursive: true, force: true });
});

test('imports the earlier CSV data on first use', { skip }, async () => {
  const { db } = mod;
  const u = await db.users.first({ id: 'u-old' });
  assert.equal(u?.name, 'Old, User');
  assert.equal(u?.role, 'ITUTI_ADMIN');
  const s = await db.aiSystems.first({ id: 's-old' });
  assert.equal(s?.version, 3);
  assert.equal((s?.data as any).ctrl['GOV-1'].e, 'Policy v1');
  const o = await db.organizations.first({ slug: 'old-bank' });
  assert.equal(o?.name, '=Old Bank'); // spreadsheet formula protection removed on import
  assert.equal(o?.aiEnabled, false);
});

test('filters translate to SQL', { skip }, async () => {
  const { db } = mod;
  const org = await db.organizations.insert({ name: 'Filter Co', slug: 'filter-co' });
  const mk = (title: string, status: string, date: string) => db.incidents.insert({ systemId: 'sys-f', title, status, date, severity: 'low', category: 'x' });
  await mk('a', 'open', '2026-01-01'); await mk('b', 'closed', '2026-02-01'); await mk('c', 'investigating', '2026-03-01');
  assert.equal(await db.incidents.count({ systemId: 'sys-f', status: { ne: 'closed' } }), 2);
  assert.deepEqual((await db.incidents.find({ systemId: 'sys-f', status: ['open', 'closed'] }, { orderBy: [['date', 'desc']] })).map(r => r.title), ['b', 'a']);
  assert.equal((await db.incidents.find({ id: [] })).length, 0);
  assert.equal(await db.invitations.count({ orgId: null }), 0);
  await db.invitations.insert({ email: 'x@y.test', orgId: org.id, role: 'VIEWER', tokenHash: 'h1', invitedById: 'u', expiresAt: new Date(Date.now() + 1000) });
  assert.equal(await db.invitations.count({ orgId: org.id, acceptedAt: null, expiresAt: { gt: new Date() } }), 1);
  assert.equal(await db.invitations.count({ orgId: org.id, expiresAt: { lt: new Date() } }), 0);
  const [r] = await db.organizations.update({ id: org.id }, { aiEnabled: true });
  assert.equal(r.aiEnabled, true);
  assert.equal((await db.organizations.first({ id: org.id }))?.aiEnabled, true);
});

test('text survives a round trip', { skip }, async () => {
  const { db } = mod;
  const awkward = 'Line one\nquote " comma , emoji 🙂 formula =SUM(A1) and é';
  const s = await db.aiSystems.insert({ orgId: 'o', name: awkward, data: { profile: { name: awkward, regions: ['eu'] } } });
  const back = await db.aiSystems.first({ id: s.id });
  assert.equal(back?.name, awkward);
  assert.deepEqual(back?.data, { profile: { name: awkward, regions: ['eu'] } });
  assert.ok(back?.createdAt instanceof Date);
});

test('concurrent read-modify-write saves do not lose updates', { skip }, async () => {
  const { db } = mod;
  const { saveSystemData } = await import('../src/lib/systems');
  const s = await db.aiSystems.insert({ orgId: 'o', name: 'Counter', data: { profile: { name: 'Counter', n: 0 } } as any });
  await Promise.all(Array.from({ length: 12 }, () => saveSystemData(s.id, 'u', d => ({ ...d, profile: { ...d.profile, n: (d.profile as any).n + 1 } }))));
  const back = await db.aiSystems.first({ id: s.id });
  assert.equal((back?.data.profile as any).n, 12);
  assert.equal(back?.version, 13);
  const stale = await saveSystemData(s.id, 'u', d => d, 1);
  assert.ok('conflict' in stale);
});

test('a failed transaction leaves nothing behind', { skip }, async () => {
  const { db } = mod;
  await assert.rejects(db.tx(async t => {
    await t.organizations.insert({ name: 'Ghost', slug: 'ghost' });
    throw new Error('boom');
  }));
  assert.equal(await db.organizations.first({ slug: 'ghost' }), undefined);
});

test('documents: extraction, search and reading', { skip }, async () => {
  const { addDocument, searchDocuments, readDocument, removeDocument } = await import('../src/lib/documents');
  const md = '# Model validation report\n\nThe independent validation team in second line reviewed the credit scoring model in August 2026.\n\nGini on the out-of-time sample was 0.61 against an acceptance threshold of 0.55.\n\n' + 'Filler paragraph about governance. '.repeat(200);
  const doc = await addDocument({ orgId: 'o', systemId: 'sys-d', name: 'validation.md', buf: Buffer.from(md), userId: 'u' });
  assert.equal(doc.status, 'ready');
  await assert.rejects(addDocument({ orgId: 'o', systemId: 'sys-d', name: 'copy.md', buf: Buffer.from(md), userId: 'u' }), /already uploaded/);
  await assert.rejects(addDocument({ orgId: 'o', systemId: 'sys-d', name: 'x.exe', buf: Buffer.from('x'), userId: 'u' }), /not supported/);
  const csv = await addDocument({ orgId: 'o', systemId: 'sys-d', name: 'metrics.csv', buf: Buffer.from('metric,value\nGini,0.61\nKS,0.42\n'), userId: 'u' });
  assert.equal(csv.status, 'ready');
  const hits = await searchDocuments('sys-d', 'independent validation Gini threshold');
  assert.ok(hits.length > 0);
  assert.ok(hits[0].text.includes('0.55') || hits.some(h => h.text.includes('0.55')));
  assert.equal((await searchDocuments('other-system', 'validation')).length, 0); // never crosses systems
  const read = await readDocument('sys-d', doc.id);
  assert.ok(read && read.chunks.length >= 1 && read.chunks[0].locator.startsWith('section'));
  assert.equal(await readDocument('other-system', doc.id), null);
  await removeDocument(doc.id);
  assert.equal(await mod.db.chunks.count({ documentId: doc.id }), 0);
});
