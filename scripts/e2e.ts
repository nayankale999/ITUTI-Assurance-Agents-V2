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
process.env.AGENT_FAKE_LLM = '1'; // scripted stand-in for Claude

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

    // ---------- Evidence documents and the assessment agent ----------
    const report = '# Credit scoring model: validation report\n\nThe model has been in production since March 2026 and scores retail loan applications.\n\nIndependent validation of the model was completed by the second-line Model Risk team in August 2026, with no material findings.\n\nGini on the out-of-time sample was 0.61 against an acceptance threshold of 0.55.\n';
    const uploadAs = (cookie: string, name: string, body: string, origin = BASE) => {
      const fd = new FormData();
      fd.append('file', new Blob([body], { type: 'text/markdown' }), name);
      return fetch(`${BASE}/api/systems/${s1.id}/documents`, { method: 'POST', headers: { cookie, origin }, body: fd });
    };
    check('viewer cannot upload documents', (await uploadAs(c.viewer, 'v.md', report)).status === 403);
    check('cross-site upload is refused', (await uploadAs(c.contrib, 'x.md', report, 'https://evil.example')).status === 400);
    const up = await uploadAs(c.contrib, 'validation-report.md', report);
    const upBody = await up.json();
    check('contributor uploads a document and its text is read', up.status === 201 && upBody.documents?.[0]?.status === 'ready', JSON.stringify(upBody));
    const docId = upBody.documents?.[0]?.id;
    check('viewer downloads the document', (await get(`/api/documents/${docId}`, c.viewer)).status === 200);
    check('another client cannot download the document', (await get(`/api/documents/${docId}`, c.other)).status === 404);
    check('agent is refused while AI assistance is off for the client', (await send(`/api/systems/${s1.id}/agent`, 'POST', c.contrib, {})).status === 503);
    await db.organizations.update({ id: orgA.id }, { aiEnabled: true });
    check('viewer cannot start the agent', (await send(`/api/systems/${s1.id}/agent`, 'POST', c.viewer, {})).status === 403);
    const started = await send(`/api/systems/${s1.id}/agent`, 'POST', c.contrib, {});
    check('contributor starts the agent', started.status === 202);
    let state: any = null;
    for (let i = 0; i < 60; i++) {
      state = await (await get(`/api/systems/${s1.id}/agent`, c.contrib)).json();
      if (state.run && !['queued', 'running'].includes(state.run.status)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    check('the run finishes with a summary', state?.run?.status === 'completed' && /No evidence found/.test(state.run.summary || ''), JSON.stringify(state?.run));
    const paths = (state?.proposals || []).map((x: any) => x.path).sort();
    check('valid proposals are waiting for review', JSON.stringify(paths) === JSON.stringify(['card.limitations', 'ctrl.TEC-2', 'profile.lifecycle']), paths.join(','));
    check('an invented quote, an invalid option and model-only control evidence are all refused', !paths.includes('ctrl.GOV-1') && !paths.includes('profile.sector') && !paths.includes('ctrl.DAT-1'));
    const tec = state?.proposals?.find((x: any) => x.path === 'ctrl.TEC-2');
    check('a proposal cites the document and the page section', tec?.sources?.[0]?.ref === docId && /^section/.test(tec?.sources?.[0]?.locator || ''));
    const lim = state?.proposals?.find((x: any) => x.path === 'card.limitations');
    check('a model-card proposal cites the provider page', lim?.sources?.some((x: any) => x.kind === 'web' && x.url === 'https://huggingface.co/example/model'));
    check('the researched model is kept in the shared library', (await db.models.first({ mkey: 'example-ai/example-model-1' }))?.status === 'ready');
    const ver = (await db.aiSystems.first({ id: s1.id }))!.version;
    check('viewer cannot accept proposals', (await send(`/api/systems/${s1.id}/proposals`, 'POST', c.viewer, { action: 'accept', ids: [tec?.id], version: ver })).status === 403);
    check('accepting on a stale version is refused', (await send(`/api/systems/${s1.id}/proposals`, 'POST', c.contrib, { action: 'accept', ids: [tec?.id], version: ver - 1 })).status === 409);
    const acc = await send(`/api/systems/${s1.id}/proposals`, 'POST', c.contrib, { action: 'accept', ids: [tec?.id], version: ver });
    const accBody = await acc.json();
    check('accepting writes the value with its provenance', acc.status === 200 && accBody.data?.ctrl?.['TEC-2']?.s === 'met' && accBody.data?.prov?.['ctrl.TEC-2']?.p === tec?.id && accBody.version === ver + 1);
    const edit = await send(`/api/systems/${s1.id}/proposals`, 'POST', c.contrib, { action: 'accept', ids: [lim?.id], version: accBody.version, value: 'Edited by the reviewer: not for final credit decisions.' });
    check('an edited proposal is accepted with the edited text', edit.status === 200 && (await edit.json()).data?.card?.limitations?.startsWith('Edited by the reviewer'));
    const lc = state?.proposals?.find((x: any) => x.path === 'profile.lifecycle');
    const rej = await send(`/api/systems/${s1.id}/proposals`, 'POST', c.contrib, { action: 'reject', ids: [lc?.id], version: accBody.version + 1 });
    check('rejecting leaves the assessment unchanged', rej.status === 200 && (await db.aiSystems.first({ id: s1.id }))?.data.profile?.lifecycle === undefined);
    check('nothing is left to review', ((await (await get(`/api/systems/${s1.id}/agent`, c.contrib)).json()).proposals || []).length === 0);
    const rep = await (await get(`/o/${orgA.slug}/systems/${s1.id}/report`, c.viewer)).text();
    check('the report lists agent answers with their sources', rep.includes('Answers proposed by the assessment agent') && rep.includes('validation-report.md'));
    check('the editor shows the Evidence and agent tab', (await (await get(`/o/${orgA.slug}/systems/${s1.id}`, c.contrib)).text()).includes('Evidence and agent'));

    // ---------- A2A agent endpoint (IBM watsonx Orchestrate and other A2A clients) ----------
    const card = await get('/.well-known/agent-card.json');
    const cardBody = await card.json().catch(() => ({}));
    check('the agent card is published at the well-known address', card.status === 200 && cardBody.protocolVersion === '0.3.0' && String(cardBody.url).endsWith('/api/a2a') && cardBody.skills?.length >= 3);
    const { createApiKey } = await import('../src/lib/apikeys');
    const keyA = (await createApiKey(orgA.id, 'e2e A', admin.id)).key;
    const keyB = (await createApiKey(orgB.id, 'e2e B', admin.id)).key;
    await db.aiSystems.insert({ orgId: orgB.id, name: 'Secret claims model', data: { profile: { name: 'Secret claims model' } } });
    await db.organizations.update({ id: orgB.id }, { aiEnabled: true });
    let rpcId = 0;
    const rpc = (key: string | null, method: string, params: unknown, headerStyle: 'bearer' | 'x-api-key' = 'bearer') => fetch(`${BASE}/api/a2a`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? (headerStyle === 'bearer' ? { authorization: `Bearer ${key}` } : { 'x-api-key': key }) : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const say = async (key: string, text: string, contextId?: string, extraParts: unknown[] = []) => {
      const r = await rpc(key, 'message/send', { message: { kind: 'message', role: 'user', messageId: randomBytes(8).toString('hex'), parts: [{ kind: 'text', text }, ...extraParts], ...(contextId ? { contextId } : {}) } });
      const j = await r.json();
      const task = j.result;
      const reply = task?.status?.message?.parts?.map((x: any) => x.text).join('') || '';
      return { status: r.status, task, reply, raw: j };
    };
    check('the endpoint refuses calls without an API key', (await rpc(null, 'message/send', {})).status === 401);
    check('the endpoint refuses an unknown API key', (await rpc('ita_not-a-real-key', 'message/send', {})).status === 401);
    const port = await say(keyA, 'Show me our portfolio');
    check('message/send returns a completed task', port.status === 200 && port.task?.kind === 'task' && port.task?.status?.state === 'completed', JSON.stringify(port.raw).slice(0, 300));
    check('the portfolio lists this client\'s systems only', port.reply.includes('Loan scoring') && !port.reply.includes('Secret claims model'));
    const portB = await say(keyB, 'Show me our portfolio', undefined);
    check('another client\'s key sees only its own systems', portB.reply.includes('Secret claims model') && !portB.reply.includes('Loan scoring'));
    check('the x-api-key header is accepted too', (await (await rpc(keyA, 'tasks/get', { id: port.task?.id }, 'x-api-key')).json()).result?.status?.state === 'completed');
    const crossGet = await (await rpc(keyB, 'tasks/get', { id: port.task?.id })).json();
    check('another client cannot read this client\'s task', !!crossGet.error && !crossGet.result);
    const ctxId = 'ctx-' + randomBytes(6).toString('hex');
    const reg = await say(keyA, 'Please register "Fraud model"', ctxId);
    check('the agent registers a new system', reg.reply.includes('"created":true') && !!(await db.aiSystems.first({ orgId: orgA.id, name: 'Fraud model' })));
    const filePart = { kind: 'file', file: { name: 'fraud-validation.md', mimeType: 'text/markdown', bytes: Buffer.from(report.replace('Credit scoring', 'Fraud')).toString('base64') } };
    const att = await say(keyA, 'attach this to "Fraud model"', ctxId, [filePart]);
    check('attached files are saved as evidence', att.reply.includes('fraud-validation.md') && (await db.documents.count({ systemId: (await db.aiSystems.first({ orgId: orgA.id, name: 'Fraud model' }))!.id })) === 1, att.reply.slice(0, 200));
    const ask = await say(keyA, 'assess "Fraud model"', ctxId);
    check('a billable assessment asks for confirmation first', ask.reply.includes('needs_confirmation') && !(await db.agentRuns.first({ systemId: (await db.aiSystems.first({ orgId: orgA.id, name: 'Fraud model' }))!.id })));
    const go = await say(keyA, 'assess "Fraud model" - confirmed', ctxId);
    check('after confirmation the assessment starts in the background', go.reply.includes('"started":true'));
    const fraud = (await db.aiSystems.first({ orgId: orgA.id, name: 'Fraud model' }))!;
    let fraudRun = null;
    for (let i = 0; i < 60; i++) { fraudRun = await db.agentRuns.first({ systemId: fraud.id }); if (fraudRun && !['queued', 'running'].includes(fraudRun.status)) break; await new Promise(r => setTimeout(r, 500)); }
    check('the assessment run completes, marked as started through A2A', fraudRun?.status === 'completed' && fraudRun?.source === 'a2a', JSON.stringify({ s: fraudRun?.status, e: fraudRun?.error }));
    const use = await db.usage.find({ systemId: fraud.id });
    check('one billable assessment is metered', use.length === 1 && use[0].billable && use[0].source === 'a2a' && use[0].plan === 'per_assessment');
    check('re-running within 30 days is not billed again', !(await say(keyA, 'assess "Fraud model"', ctxId)).reply.includes('needs_confirmation'));
    for (let i = 0; i < 60; i++) { const r = await db.agentRuns.first({ systemId: fraud.id, status: ['queued', 'running'] }); if (!r) break; await new Promise(res => setTimeout(res, 500)); }
    check('the re-run adds no usage', (await db.usage.count({ systemId: fraud.id })) === 1);
    await db.organizations.update({ id: orgA.id }, { plan: 'enterprise' });
    const { wouldBill } = await import('../src/lib/usage');
    check('enterprise clients are never asked to confirm billing', !(await wouldBill(orgA.id, s1.id)) && !(await wouldBill(orgA.id, fraud.id)));
    const st = await say(keyA, 'status of "Fraud model"', ctxId);
    check('status reports proposals waiting and the review link', st.reply.includes('proposals_waiting_for_review') && st.reply.includes(`/systems/${fraud.id}`));
    const ctxRow = await db.a2aContexts.first({ id: ctxId });
    check('the conversation is remembered for its context', (ctxRow?.history.length || 0) >= 8);
    const sse = await fetch(`${BASE}/api/a2a`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${keyA}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'message/stream', params: { message: { kind: 'message', role: 'user', messageId: 'm-stream', parts: [{ kind: 'text', text: 'status of "Fraud model"' }] } } }) });
    const events = (await sse.text()).split('\n\n').filter(Boolean).map(chunk => JSON.parse(chunk.replace(/^data: /, '')));
    const lastEv = events[events.length - 1]?.result;
    check('message/stream sends server-sent events ending in a final completed status', !!sse.headers.get('content-type')?.includes('text/event-stream') && events.length >= 2 && lastEv?.kind === 'status-update' && lastEv?.final === true && lastEv?.status?.state === 'completed', JSON.stringify(events).slice(0, 300));
    await db.organizations.update({ id: orgB.id }, { aiEnabled: false });
    check('a client with AI switched off gets an explanation, not a run', (await say(keyB, 'Show me our portfolio')).reply.includes('switched off'));
    await db.apiKeys.update({ orgId: orgB.id }, { revokedAt: new Date() });
    check('a revoked key is refused', (await rpc(keyB, 'message/send', {})).status === 401);
    check('the admin sees plan, usage and keys on the client page', await (async () => { const h = await (await get(`/o/${orgA.slug}`, c.admin)).text(); return h.includes('Billing and agent access') && h.includes('e2e A'); })());
    check('client admins do not see API keys', !(await (await get(`/o/${orgA.slug}`, c.clientAdmin)).text()).includes('Billing and agent access'));

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
    // ---------- Inventory, risk, incidents and documents ----------
    for (const path of ['', '/risk', '/incidents', '/documents', '/documents/inventory', '/documents/risk', '/documents/incidents']) {
      check(`viewer opens ${path || 'the inventory'}`, (await get(`/o/${orgA.slug}${path}`, c.viewer)).status === 200);
    }
    check('another client cannot open the risk page', (await get(`/o/${orgA.slug}/risk`, c.other)).status === 404);
    const invCsv = await get(`/o/${orgA.slug}/documents/inventory.csv`, c.viewer);
    check('inventory exports as CSV', invCsv.status === 200 && (await invCsv.text()).includes('Responsible person'));
    check('another client cannot export the inventory', (await get(`/o/${orgA.slug}/documents/inventory.csv`, c.other)).status === 404);
    check('incidents export as CSV', (await get(`/o/${orgA.slug}/documents/incidents.csv`, c.viewer)).status === 200);
    for (const doc of ['documents', 'overview', 'conformity', 'technical', 'audit', 'incidents', 'metrics']) {
      check(`viewer opens the system ${doc} page`, (await get(`/o/${orgA.slug}/systems/${s1.id}/${doc}`, c.viewer)).status === 200);
    }
    check('another client cannot open a system document', (await get(`/o/${orgA.slug}/systems/${s1.id}/technical`, c.other)).status === 404);
    check('saving records field-level history', (await db.changes.count({ systemId: s1.id })) > 0);
    check('accepting agent proposals is recorded as agent-sourced history', !!(await db.changes.first({ systemId: s1.id, via: 'agent' })));
    const audit = await (await get(`/o/${orgA.slug}/systems/${s1.id}/audit`, c.viewer)).text();
    check('the audit trail shows who changed an answer', audit.includes('Agent proposal, accepted by a person'));
    const shareToken = 'shr' + randomBytes(24).toString('hex');
    const share = await db.shares.insert({ orgId: orgA.id, systemId: s1.id, kind: 'card', tokenHash: hashToken(shareToken), createdById: clientAdmin.id });
    const pub = await fetch(`${BASE}/share/${shareToken}`);
    const pubHtml = await pub.text();
    check('a public model card link opens without signing in', pub.status === 200 && pubHtml.includes('MODEL CARD'));
    check('the public page shows the card, not the controls', !pubHtml.includes('GOV-1') && !pubHtml.includes('Policy v2'));
    await db.shares.update({ id: share.id }, { revokedAt: new Date() });
    check('a revoked public link stops working', (await fetch(`${BASE}/share/${shareToken}`)).status === 404);
    check('an unknown public link 404s', (await fetch(`${BASE}/share/${'x'.repeat(40)}`)).status === 404);
    const resolved = await send(`/api/incidents/${irBody.incident.id}`, 'PATCH', c.assessorIn, { status: 'resolved' });
    check('an incident can be marked resolved, which closes it in the counts', resolved.status === 200 && (await resolved.json()).open === 0);

    // ---------- Teams and tasks ----------
    const lead = await mk('lead@bank.test', 'CLIENT'), member = await mk('member@bank.test', 'CLIENT');
    await db.memberships.insertMany([{ userId: lead.id, orgId: orgA.id, role: 'VIEWER' }, { userId: member.id, orgId: orgA.id, role: 'VIEWER' }]);
    const team = await db.teams.insert({ orgId: orgA.id, name: 'HR assurance', leadId: lead.id });
    await db.teamMembers.insertMany([{ teamId: team.id, userId: lead.id }, { teamId: team.id, userId: member.id }]);
    await db.teamSystems.insert({ teamId: team.id, systemId: s1.id });
    const cl = await sessionFor(lead.id), cm = await sessionFor(member.id);
    check('client admin opens the Teams page', (await get(`/o/${orgA.slug}/teams`, c.clientAdmin)).status === 200);
    check('a team member cannot open the Teams page', (await get(`/o/${orgA.slug}/teams`, cm)).status === 404);
    check('team members open the Tasks page', (await get(`/o/${orgA.slug}/tasks`, cm)).status === 200);
    check('a member cannot assign tasks', (await send(`/api/systems/${s1.id}/tasks`, 'POST', cm, { assigneeId: member.id, scopes: ['profile'] })).status === 403);
    const asg = await send(`/api/systems/${s1.id}/tasks`, 'POST', cl, { assigneeId: member.id, scopes: ['ctrl:GOV-2', 'confPart:project'], due: '2026-12-01', note: 'Use the AI policy' });
    const asgBody = await asg.json();
    check('the team lead assigns tasks to a member', asg.status === 201 && asgBody.tasks?.length === 2, JSON.stringify(asgBody));
    check('the assignee is emailed', logs.join('').includes(`To: ${member.email}`));
    check('tasks cannot go to someone outside the team', (await send(`/api/systems/${s1.id}/tasks`, 'POST', cl, { assigneeId: viewer.id, scopes: ['profile'] })).status === 400);
    const s3 = await db.aiSystems.insert({ orgId: orgA.id, name: 'Other', data: blank });
    check('tasks cannot be given on a system the team does not cover', (await send(`/api/systems/${s3.id}/tasks`, 'POST', cl, { assigneeId: member.id, scopes: ['profile'] })).status === 403);
    const cur = async () => { const r = await (await get(`/api/systems/${s1.id}`, c.clientAdmin)).json(); return { data: r.data, version: r.version }; };
    let sv = await cur();
    const mine = await send(`/api/systems/${s1.id}`, 'PUT', cm, { data: { ...sv.data, ctrl: { ...sv.data.ctrl, 'GOV-2': { s: 'partial', e: 'Policy approved, review overdue.' } }, conf: { ...(sv.data.conf || {}), P1: { t: 'Shortlisting support', ok: true } } }, version: sv.version });
    check('a member saves the parts assigned to them', mine.status === 200, String(mine.status));
    sv = await cur();
    const outside = await send(`/api/systems/${s1.id}`, 'PUT', cm, { data: { ...sv.data, profile: { ...sv.data.profile, name: 'Renamed' } }, version: sv.version });
    check('a member cannot change anything else', outside.status === 403);
    check('a member cannot run the agent', (await send(`/api/systems/${s1.id}/agent`, 'POST', cm, {})).status === 403);
    sv = await cur();
    check('the team lead can edit the whole system', (await send(`/api/systems/${s1.id}`, 'PUT', cl, { data: { ...sv.data, profile: { ...sv.data.profile, team: 'HR assurance' } }, version: sv.version })).status === 200);
    const done = await send(`/api/tasks/${asgBody.tasks[0].id}`, 'PATCH', cm, { status: 'done' });
    check('a member marks their task done', done.status === 200 && (await done.json()).task.status === 'done');
    check('a member cannot change the due date', (await send(`/api/tasks/${asgBody.tasks[1].id}`, 'PATCH', cm, { due: '2027-01-01' })).status === 403);
    sv = await cur();
    check('once done, the task no longer unlocks that control', (await send(`/api/systems/${s1.id}`, 'PUT', cm, { data: { ...sv.data, ctrl: { ...sv.data.ctrl, 'GOV-2': { s: 'met', e: 'Changed after done.' } } }, version: sv.version })).status === 403);
    const sysPage = await (await get(`/o/${orgA.slug}/systems/${s1.id}`, cm)).text();
    check('the system page shows the member their tasks', sysPage.includes('Your tasks on this system'));
    check('another client cannot see the tasks', (await get(`/api/systems/${s1.id}/tasks`, c.other)).status === 404);

    // ---------- Gap action plan ----------
    const plan0 = await (await get(`/api/systems/${s1.id}/actions`, c.clientAdmin)).json();
    check('the action plan lists the gaps', Array.isArray(plan0.rows) && plan0.rows.length > 0 && plan0.canPlan === true, JSON.stringify(plan0).slice(0, 200));
    const gapRefs = plan0.rows.slice(0, 3).map((r: any) => r.gap.ref);
    const raised = await send(`/api/systems/${s1.id}/actions`, 'POST', c.clientAdmin, { items: gapRefs.map((gapRef: string) => ({ gapRef })), ownerId: contrib.id, department: 'Model Risk', due: '2026-12-15' });
    check('actions are raised against an owner and a department', raised.status === 201 && (await raised.json()).created === 3);
    const gapRows = await db.incidents.find({ systemId: s1.id, kind: 'gap' });
    check('each action is kept as a gap action with owner, department and due date', gapRows.length === 3 && gapRows.every(g => g.ownerId === contrib.id && g.department === 'Model Risk' && g.due === '2026-12-15' && g.category === 'Assessment gap'));
    check('the owner is emailed', logs.join('').includes(`To: ${contrib.email} | ${'3 actions have'}`) || logs.join('').includes(`To: ${contrib.email}`));
    check('gap actions do not count as open AI incidents', (await db.aiSystems.first({ id: s1.id }))!.openIncidents === (await db.incidents.count({ systemId: s1.id, kind: 'incident', status: ['open', 'investigating', 'mitigated'] })));
    check('a gap cannot get two open actions', (await send(`/api/systems/${s1.id}/actions`, 'POST', c.clientAdmin, { items: [{ gapRef: gapRefs[0] }], ownerName: 'Someone', department: 'Legal' })).status === 400);
    check('an owner from outside the organisation must be named, not linked', (await send(`/api/systems/${s1.id}/actions`, 'POST', c.clientAdmin, { items: [{ gapRef: plan0.rows[4].gap.ref }], ownerId: otherClient.id, department: 'Legal' })).status === 400);
    check('a viewer cannot raise actions', (await send(`/api/systems/${s1.id}/actions`, 'POST', c.viewer, { items: [{ gapRef: plan0.rows[4].gap.ref }], ownerName: 'X', department: 'Legal' })).status === 403);
    const reassign = await send(`/api/incidents/${gapRows[0].id}`, 'PATCH', c.clientAdmin, { department: 'Legal', ownerName: 'Tom Okafor, DPO', ownerId: null, status: 'investigating' });
    check('an action can be reassigned and moved along', reassign.status === 200 && (await db.incidents.first({ id: gapRows[0].id }))!.department === 'Legal');
    check('the tracker shows gap actions', (await (await get(`/o/${orgA.slug}/incidents?view=gaps`, c.viewer)).text()).includes('Gap actions'));
    check('the remediation plan document opens', (await get(`/o/${orgA.slug}/systems/${s1.id}/plan`, c.viewer)).status === 200);
    check('ordinary incidents cannot be given a department', (await send(`/api/incidents/${irBody.incident.id}`, 'PATCH', c.clientAdmin, { department: 'X' })).status === 400);
    check('another client cannot see the action plan', (await get(`/api/systems/${s1.id}/actions`, c.other)).status === 404);

    // Self-service sign-up
    check('the sign-up page loads', (await get('/register')).status === 200);
    check('a stranger without a sign-up gets no sign-in link', !(await signInRequest(`${tag}-stranger@newco.test`)).url);
    const { startRegistration } = await import('../src/lib/registration');
    const regEmail = `${tag}-founder@newco.test`;
    check('a sign-up is recorded', (await startRegistration({ email: regEmail, name: 'Nia Founder', orgName: `NewCo ${tag}` })) === 'created');
    check('an existing member signing up is just signed in', (await startRegistration({ email: clientAdmin.email, name: 'x', orgName: 'Dup' })) === 'existing');
    const signup = await signInRequest(regEmail);
    check('the new sign-up gets a sign-in link', !!signup.url);
    if (signup.url) {
      const r = await fetch(signup.url, { redirect: 'manual' });
      const cookie = (r.headers.getSetCookie?.() || []).find(x => x.startsWith('next-auth.session-token'))?.split(';')[0];
      const u = await db.users.first({ email: regEmail });
      const m = u ? await db.memberships.first({ userId: u.id }) : null;
      const o = m ? await db.organizations.first({ id: m.orgId }) : null;
      check('following the link creates the workspace with them as client admin', m?.role === 'CLIENT_ADMIN' && o?.name === `NewCo ${tag}` && u?.name === 'Nia Founder', JSON.stringify({ m, o }));
      check('AI assistance starts switched off for a new sign-up', o?.aiEnabled === false);
      check('the sign-up is completed only once', (await db.registrations.find({ email: regEmail })).every(x => x.completedAt && x.orgId === o?.id));
      if (cookie && o) check('the new client admin opens their workspace', (await get(`/o/${o.slug}`, cookie)).status === 200);
      if (cookie) check('the new client cannot open another client', (await get(`/o/${orgA.slug}`, cookie)).status === 404);
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
