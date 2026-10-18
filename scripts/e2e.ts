/* End-to-end checks against the production build.
   Usage: npm run build && npm run test:e2e
   Needs TEST_DATABASE_URL, a MySQL/MariaDB server URL whose user may create databases named assurance_test_*,
   for example mysql://app:pass@127.0.0.1:3306/. Creates a fresh database and a temporary data folder, and drops
   both at the end, so real data is never touched. Starts `next start` itself on port 3100. */
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'assurance-e2e-'));
process.env.DATA_DIR = DATA;
if (!process.env.TEST_DATABASE_URL) { console.error('Set TEST_DATABASE_URL, for example mysql://app:pass@127.0.0.1:3306/'); process.exit(2); }
const DB_NAME = 'assurance_test_' + randomBytes(4).toString('hex');
const SERVER_URL = new URL(process.env.TEST_DATABASE_URL);
process.env.DATABASE_URL = new URL('/' + DB_NAME, SERVER_URL).toString();
process.env.NEXTAUTH_URL = process.env.E2E_URL || 'http://localhost:3100';
process.env.NEXTAUTH_SECRET ||= 'e2e-secret-' + randomBytes(16).toString('hex');
process.env.BOOTSTRAP_ADMIN_EMAIL = 'boss@itutitech.test';
process.env.SMTP_HOST = '';
process.env.ANTHROPIC_API_KEY = '';

import mysql from 'mysql2/promise';
import { db } from '../src/data';
import { closePool } from '../src/data/sql';
import { hashToken } from '../src/lib/tokens';

const BASE = process.env.NEXTAUTH_URL || 'http://localhost:3100';
const PORT = new URL(BASE).port || '3100';
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` (${detail})` : ''}`); };
const logs: string[] = [];

async function startServer() {
  const proc = spawn('npx', ['next', 'start', '-p', PORT], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  proc.stdout.on('data', d => logs.push(String(d)));
  proc.stderr.on('data', d => logs.push(String(d)));
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.status) return proc; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Server did not start');
}

async function sessionFor(userId: string) {
  const token = randomBytes(24).toString('hex');
  await db.sessions.insert({ sessionToken: token, userId, expires: new Date(Date.now() + 3600e3) });
  return `next-auth.session-token=${token}`;
}

const get = (path: string, cookie = '') => fetch(BASE + path, { headers: { cookie }, redirect: 'manual' });
const send = (path: string, method: string, cookie: string, body: unknown, origin = BASE) =>
  fetch(BASE + path, { method, headers: { cookie, 'content-type': 'application/json', origin }, body: JSON.stringify(body), redirect: 'manual' });

async function adminConn() {
  return mysql.createConnection({ host: SERVER_URL.hostname, port: Number(SERVER_URL.port || 3306), user: decodeURIComponent(SERVER_URL.username), password: decodeURIComponent(SERVER_URL.password) });
}

async function main() {
  const conn = await adminConn();
  await conn.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  await db.users.count(); // applies the schema before the server starts
  const server = await startServer();
  const tag = 'e2e' + Date.now().toString(36);
  try {
    // ---------- Fixtures ----------
    const mk = (email: string, role: 'ITUTI_ADMIN' | 'ITUTI_ASSESSOR' | 'CLIENT') => db.users.insert({ email: `${tag}-${email}`, role });
    const admin = await mk('admin@itutitech.com', 'ITUTI_ADMIN');
    const assessorIn = await mk('assessor-in@itutitech.com', 'ITUTI_ASSESSOR');
    const assessorOut = await mk('assessor-out@itutitech.com', 'ITUTI_ASSESSOR');
    const clientAdmin = await mk('cadmin@bank.test', 'CLIENT');
    const contrib = await mk('contrib@bank.test', 'CLIENT');
    const viewer = await mk('viewer@bank.test', 'CLIENT');
    const otherClient = await mk('other@insurer.test', 'CLIENT');
    const orgA = await db.organizations.insert({ name: `${tag} Bank`, slug: `${tag}-bank` });
    const orgB = await db.organizations.insert({ name: `${tag} Insurer`, slug: `${tag}-insurer` });
    await db.memberships.insertMany([
      { userId: clientAdmin.id, orgId: orgA.id, role: 'CLIENT_ADMIN' },
      { userId: contrib.id, orgId: orgA.id, role: 'CONTRIBUTOR' },
      { userId: viewer.id, orgId: orgA.id, role: 'VIEWER' },
      { userId: otherClient.id, orgId: orgB.id, role: 'CLIENT_ADMIN' },
    ]);
    await db.assessorAssignments.insert({ userId: assessorIn.id, orgId: orgA.id });
    const blank = { profile: { name: 'Loan scoring', regions: ['eu'], role: ['deployer'], aiType: [] }, cls: { a3: {}, t: {} }, ctrl: {}, card: {}, metrics: [] };
    const s1 = await db.aiSystems.insert({ orgId: orgA.id, name: 'Loan scoring', data: blank });
    const s2 = await db.aiSystems.insert({ orgId: orgA.id, name: 'Chatbot', data: { ...blank, profile: { ...blank.profile, name: 'Chatbot' } } });
    await db.systemAssignments.insert({ userId: contrib.id, systemId: s1.id });

    const c = {
      admin: await sessionFor(admin.id), assessorIn: await sessionFor(assessorIn.id), assessorOut: await sessionFor(assessorOut.id),
      clientAdmin: await sessionFor(clientAdmin.id), contrib: await sessionFor(contrib.id), viewer: await sessionFor(viewer.id), other: await sessionFor(otherClient.id),
    };

    // ---------- Page access ----------
    check('signed-out visitor is sent to login', (await get(`/o/${orgA.slug}`)).status === 307);
    check('admin opens the clients page', (await get('/admin', c.admin)).status === 200);
    check('admin opens the team page', (await get('/admin/team', c.admin)).status === 200);
    check('assessor cannot open the team page', (await get('/admin/team', c.assessorIn)).status === 404);
    check('client user cannot open the clients page', (await get('/admin', c.clientAdmin)).status === 404);
    check('assigned assessor opens the client', (await get(`/o/${orgA.slug}`, c.assessorIn)).status === 200);
    check('unassigned assessor cannot open the client', (await get(`/o/${orgA.slug}`, c.assessorOut)).status === 404);
    check('another client cannot open this client', (await get(`/o/${orgA.slug}`, c.other)).status === 404);
    check('client admin opens People', (await get(`/o/${orgA.slug}/people`, c.clientAdmin)).status === 200);
    check('contributor cannot open People', (await get(`/o/${orgA.slug}/people`, c.contrib)).status === 404);
    check('viewer opens the system page', (await get(`/o/${orgA.slug}/systems/${s1.id}`, c.viewer)).status === 200);
    check('viewer opens the printable report', (await get(`/o/${orgA.slug}/systems/${s1.id}/report`, c.viewer)).status === 200);
    check('system page under the wrong client 404s', (await get(`/o/${orgB.slug}/systems/${s1.id}`, c.admin)).status === 404);

    // ---------- Saving ----------
    const edited = { ...blank, profile: { ...blank.profile, affects: 'cust', personal: 'personal', scale: 's2', autonomy: 'a1', revers: 'r1' },
      cls: { p1: 'no', p2: 'no', p3: 'no', p4: 'no', p5: 'no', p6: 'no', p7: 'no', p8: 'no', a3: { h_credit: true }, profiling: 'yes', t: {} },
      ctrl: { 'GOV-1': { s: 'met', e: 'Policy v2' } } };
    check('viewer cannot save', (await send(`/api/systems/${s1.id}`, 'PUT', c.viewer, { data: edited, version: 1 })).status === 403);
    check('contributor cannot save an unassigned system', (await send(`/api/systems/${s2.id}`, 'PUT', c.contrib, { data: edited, version: 1 })).status === 403);
    const save = await send(`/api/systems/${s1.id}`, 'PUT', c.contrib, { data: edited, version: 1 });
    check('contributor saves an assigned system', save.status === 200, String(save.status));
    const row = await db.aiSystems.first({ id: s1.id });
    check('server recomputes tier, risk and readiness', row?.tier === 'high' && row.riskScore !== null && row.readiness > 0 && row.version === 2, JSON.stringify({ tier: row?.tier, risk: row?.riskScore, ready: row?.readiness, v: row?.version }));
    const stale = await send(`/api/systems/${s1.id}`, 'PUT', c.clientAdmin, { data: blank, version: 1 });
    check('a stale save is refused with 409', stale.status === 409);
    check('cross-site save is refused', (await send(`/api/systems/${s1.id}`, 'PUT', c.admin, { data: edited, version: 2 }, 'https://evil.example')).status === 400);
    check('malformed data is refused', (await send(`/api/systems/${s1.id}`, 'PUT', c.admin, { data: { profile: { name: 'x' }, hack: true }, version: 2 })).status === 400);
    check('another client cannot read the system', (await get(`/api/systems/${s1.id}`, c.other)).status === 404);

    // ---------- Incidents ----------
    const inc = { title: 'Approval ratio below threshold', date: '2026-10-01', severity: 'high', category: 'Bias or discrimination', serious: false, notes: '' };
    check('viewer cannot record an incident', (await send(`/api/systems/${s1.id}/incidents`, 'POST', c.viewer, inc)).status === 403);
    const ir = await send(`/api/systems/${s1.id}/incidents`, 'POST', c.contrib, inc);
    const irBody = await ir.json();
    check('contributor records an incident', ir.status === 201 && irBody.open === 1);
    check('incident count is stored on the system', (await db.aiSystems.first({ id: s1.id }))?.openIncidents === 1);
    const csv = await get(`/api/systems/${s1.id}/incidents?format=csv`, c.viewer);
    check('viewer exports incidents as CSV', csv.status === 200 && (await csv.text()).includes('Approval ratio'));
    const close = await send(`/api/incidents/${irBody.incident.id}`, 'PATCH', c.assessorIn, { status: 'closed' });
    check('assigned assessor closes the incident', close.status === 200 && (await close.json()).open === 0);
    check('unassigned assessor cannot change the incident', (await send(`/api/incidents/${irBody.incident.id}`, 'PATCH', c.assessorOut, { status: 'open' })).status === 404);

    // ---------- Delete ----------
    check('contributor cannot delete a system', (await send(`/api/systems/${s2.id}`, 'DELETE', c.contrib, {})).status === 403);
    check('client admin deletes a system', (await send(`/api/systems/${s2.id}`, 'DELETE', c.clientAdmin, {})).status === 200);

    // ---------- Sign-in rules (real email flow, links printed to the log) ----------
    const signInRequest = async (email: string, callbackUrl = '/') => {
      const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
      const jar = (csrfRes.headers.getSetCookie?.() || []).map(x => x.split(';')[0]).join('; ');
      const { csrfToken } = await csrfRes.json();
      const before = logs.join('').length;
      const r = await fetch(`${BASE}/api/auth/signin/email`, { method: 'POST', headers: { cookie: jar, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, csrfToken, callbackUrl, json: 'true' }), redirect: 'manual' });
      await new Promise(res => setTimeout(res, 500));
      const after = logs.join('').slice(before);
      const m = after.match(/\[mail\] To: (\S+) \| [^|]+\| (\S+)/);
      return { status: r.status, url: m ? m[2] : null, location: r.headers.get('location') || '' };
    };
    const unknown = await signInRequest(`${tag}-stranger@nowhere.test`);
    check('unknown email gets no sign-in link', !unknown.url);
    const known = await signInRequest(clientAdmin.email);
    check('existing user gets a sign-in link', !!known.url);
    if (known.url) {
      const cb = await fetch(known.url, { redirect: 'manual' });
      const sessionCookie = (cb.headers.getSetCookie?.() || []).find(x => x.startsWith('next-auth.session-token'));
      check('following the link creates a session', !!sessionCookie);
      if (sessionCookie) check('the new session opens the client', (await get(`/o/${orgA.slug}`, sessionCookie.split(';')[0])).status === 200);
    }
    const token = 'tok' + randomBytes(16).toString('hex');
    await db.invitations.insert({ email: `${tag}-newhire@bank.test`, orgId: orgA.id, role: 'VIEWER', tokenHash: hashToken(token), invitedById: clientAdmin.id, expiresAt: new Date(Date.now() + 864e5) });
    const invitee = await signInRequest(`${tag}-newhire@bank.test`, `/invite/${token}`);
    check('invited person gets a sign-in link', !!invitee.url);
    const invPage = await get(`/invite/${token}`);
    check('invitation page loads for a signed-out visitor', invPage.status === 200 && (await invPage.text()).includes('Sign in to accept'));
    const boss = await signInRequest('boss@itutitech.test');
    check('bootstrap admin email gets a sign-in link', !!boss.url);
    if (boss.url) {
      await fetch(boss.url, { redirect: 'manual' });
      check('bootstrap admin becomes an Ituti admin on first sign-in', (await db.users.first({ email: 'boss@itutitech.test' }))?.role === 'ITUTI_ADMIN');
    }
    check('saved assessment is stored in the database', ((await db.aiSystems.first({ id: s1.id }))?.data as { ctrl?: Record<string, { e?: string }> }).ctrl?.['GOV-1']?.e === 'Policy v2');
    check('deleting a system removes its incidents and assignments', !(await db.incidents.first({ systemId: s2.id })) && !(await db.systemAssignments.first({ systemId: s2.id })) && !(await db.aiSystems.first({ id: s2.id })));
    check('disabled account gets no sign-in link', await (async () => {
      await db.users.update({ id: viewer.id }, { disabled: true });
      return !(await signInRequest(viewer.email)).url;
    })());
  } finally {
    try { process.kill(-server.pid!, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    fs.rmSync(DATA, { recursive: true, force: true });
    await closePool();
    const c2 = await adminConn(); await c2.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``); await c2.end();
  }
  const failed = results.filter(r => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { console.log(logs.join('').slice(-3000)); process.exit(1); }
  process.exit(0);
}
main().catch(async e => { console.error(e); console.log(logs.join('').slice(-3000)); process.exit(1); });
