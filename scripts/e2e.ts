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
// Traces go to a local stand-in for the watsonx Orchestrate ingestion endpoint
const OTLP_PORT = 4400 + Math.floor(Math.random() * 500);
process.env.ORCHESTRATE_OTEL_URL = `http://127.0.0.1:${OTLP_PORT}/v1/orchestrate/inject/traces`;
process.env.ORCHESTRATE_API_KEY = 'e2e-orchestrate-key';
process.env.ORCHESTRATE_AUTH = 'apikey';
process.env.ORCHESTRATE_TENANT_ID = 'acct1_inst1';
process.env.ORCHESTRATE_AGENT_IDS = 'coordinator=wxo-coordinator,reader=wxo-reader,research=wxo-research,classify=wxo-classify,controls=wxo-controls,docs=wxo-docs,conformity=wxo-conformity,checker=wxo-checker';

import http from 'http';
import mysql from 'mysql2/promise';
import { db } from '../src/data';
import { closePool } from '../src/data/sql';
import { hashToken } from '../src/lib/tokens';

const BASE = process.env.NEXTAUTH_URL || 'http://localhost:3100';
const PORT = new URL(BASE).port || '3100';
const results: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail?: string) => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` (${detail})` : ''}`); };
const logs: string[] = [];
const traces: { headers: http.IncomingHttpHeaders; body: Buffer }[] = [];
const otlp = http.createServer((req, res) => {
  const parts: Buffer[] = [];
  req.on('data', d => parts.push(d)).on('end', () => { traces.push({ headers: req.headers, body: Buffer.concat(parts) }); res.writeHead(200, { 'content-type': 'application/x-protobuf' }); res.end(); });
}).listen(OTLP_PORT, '127.0.0.1');
const traceText = () => traces.map(t => t.body.toString('latin1')).join('\n');

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
    {
      const runRow = await db.agentRuns.first({ id: state?.run?.id });
      const u = runRow?.usage_detail || {};
      check('each specialist has its own meter', ['reader', 'classify', 'controls', 'docs', 'conformity', 'checker'].every(k => u[k]) && u.controls.calls >= 2 && u.controls.costUsd > 0 && u.checker.tools >= 4 && u.checker.calls === 0, JSON.stringify(u).slice(0, 400));
      check('proposals are counted against the specialist that made them', u.controls.proposals === 1 && u.classify.proposals === 1 && u.docs.proposals === 1);
      check('the run totals add up the specialists', runRow!.outputTokens === Object.values(u).reduce((a: number, x: any) => a + x.output, 0));
      check('a specialist cannot propose outside its fields', state.run.log.some((l: any) => /Rejected ctrl\.GOV-3: outside your fields; the controls assessor/.test(l.text)));
      check('the run is shown as a crew with costs', state.run.usage?.controls?.costUsd > 0);
      for (let i = 0; i < 20 && !traceText().includes('wxo-conformity'); i++) await new Promise(r => setTimeout(r, 300));
      const tt = traceText();
      check('traces are sent to Orchestrate with the API key', traces.length > 0 && traces.every(t => t.headers['x-api-key'] === 'e2e-orchestrate-key' && String(t.headers['content-type']).includes('protobuf')));
      check('each specialist reports under its own Orchestrate agent ID', ['wxo-coordinator', 'wxo-reader', 'wxo-classify', 'wxo-controls', 'wxo-docs', 'wxo-conformity', 'wxo-checker'].every(id => tt.includes(id)), tt.slice(0, 200));
      check('traces carry the tenant, session and token usage', tt.includes('acct1_inst1') && tt.includes('langfuse.session.id') && tt.includes(state.run.id) && tt.includes('gen_ai.usage.input_tokens') && tt.includes('langfuse.observation.cost_details'));
    }
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

    // ---------- The specialists as separate A2A agents ----------
    {
      const list = await (await get('/api/a2a/agents')).json();
      check('the crew is listed with an address per specialist', list.specialists?.length === 7 && list.specialists.every((x: any) => x.url.startsWith(`${BASE}/api/a2a/agents/`)));
      const spCard = await (await get('/api/a2a/agents/controls-assessor/.well-known/agent-card.json')).json();
      check('each specialist publishes its own agent card', spCard.protocolVersion === '0.3.0' && spCard.name === 'Ituti AI Assurance: Controls assessor' && spCard.url === `${BASE}/api/a2a/agents/controls-assessor` && spCard.skills?.length === 1);
      check('an unknown specialist is not found', (await get('/api/a2a/agents/nobody')).status === 404);
      const spRpc = (slug: string, key: string | null, text: string) => fetch(`${BASE}/api/a2a/agents/${slug}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'message/send', params: { message: { kind: 'message', role: 'user', messageId: randomBytes(8).toString('hex'), parts: [{ kind: 'text', text }] } } }),
      });
      const spSay = async (slug: string, text: string) => { const r = await spRpc(slug, keyA, text); const j = await r.json(); return { status: r.status, reply: j.result?.status?.message?.parts?.map((x: any) => x.text).join('') || '', raw: j }; };
      check('a specialist refuses calls without an API key', (await spRpc('evidence-reader', null, 'hi')).status === 401);
      const rd = await spSay('evidence-reader', 'search the evidence of "Fraud model" for validation');
      check('the evidence reader answers from the documents', rd.status === 200 && rd.reply.includes('fraud-validation.md') && /validation/i.test(rd.reply), JSON.stringify(rd.raw).slice(0, 300));
      const okQ = await spSay('source-checker', 'verify «Independent validation of the model was completed by the second-line Model Risk team» in "Fraud model"');
      check('the source checker confirms a real quote and where it is', okQ.reply.includes('"found":true') && okQ.reply.includes('fraud-validation.md'), okQ.reply.slice(0, 200));
      const badQ = await spSay('source-checker', 'verify «The board approved the AI policy on 1 January 2019» in "Fraud model"');
      check('the source checker rejects an invented quote', badQ.reply.includes('"found":false'));
      check('the model researcher looks up a model', (await spSay('model-researcher', 'look up Example Model 1')).reply.includes('huggingface.co/example/model'));
      check('the specialists only see this client\'s systems', (await spSay('evidence-reader', 'search "Secret claims model"')).reply.includes('No system matches'));
      const runsBefore = await db.agentRuns.count({ systemId: fraud.id });
      const sp = await spSay('controls-assessor', 'start on "Fraud model"');
      check('a writer starts a run of just that specialist', sp.reply.includes('"started":true'), sp.reply.slice(0, 200));
      let spRun = null;
      for (let i = 0; i < 60; i++) { spRun = await db.agentRuns.first({ systemId: fraud.id, specialist: 'controls' }); if (spRun && !['queued', 'running'].includes(spRun.status)) break; await new Promise(r => setTimeout(r, 500)); }
      const su = spRun?.usage_detail || {};
      check('the specialist run uses only that writer, with the reader and checker in support', spRun?.status === 'completed' && (await db.agentRuns.count({ systemId: fraud.id })) === runsBefore + 1 && !!su.controls && !!su.reader && !su.classify && !su.docs && !su.conformity, JSON.stringify({ s: spRun?.status, e: spRun?.error, k: Object.keys(su) }));
      const res = await spSay('controls-assessor', 'results for "Fraud model"');
      check('a writer reports its own results and cost', res.reply.includes('"status":"completed"') && res.reply.includes('estimated_cost_usd') && res.reply.includes('ctrl.TEC-2') && !res.reply.includes('card.limitations'), res.reply.slice(0, 300));
      check('specialist conversations are traced under their own agent ID', traceText().includes('wxo-reader') && traceText().includes('wxo-checker'));
    }

    // ---------- AI spend, budgets and on-prem support ----------
    {
      const spend = await db.aiSpend.find({});
      const agents = new Set(spend.map(x => x.agent));
      check('every Claude call is recorded in the spend ledger', spend.length > 10 && ['reader', 'classify', 'controls', 'docs', 'conformity', 'assistant', 'research'].every(a => agents.has(a)), [...agents].join(','));
      check('calls are attributed to the client, system and run', spend.filter(x => x.source === 'run').every(x => x.orgId === orgA.id && !!x.systemId && !!x.runId) && spend.some(x => x.source === 'a2a' && x.agent === 'controls' && x.orgId === orgA.id));
      check('each call is priced', spend.filter(x => x.model.startsWith('claude-opus')).every(x => x.costMicros > 0));
      const { spendReport, spendBlocked } = await import('../src/lib/spend');
      const rep = await spendReport();
      check('the report adds up by client, agent and model', Math.abs(rep.byOrg.reduce((a, r) => a + r.cost, 0) - rep.total.cost) < 1e-6 && rep.byAgent.some(r => r.k === 'controls') && rep.daily.length >= 28);
      const page = await get('/admin/spend', c.admin);
      const ph = await page.text();
      check('the admin Spend page shows the month by client, agent and model', page.status === 200 && ph.includes('AI spend') && ph.includes('Controls assessor') && ph.includes('By model'));
      check('clients and assessors cannot open the Spend page', (await get('/admin/spend', c.clientAdmin)).status === 404);
      const csv = await (await get('/admin/spend/export.csv', c.admin)).text();
      check('spend can be exported as CSV', csv.startsWith('time_utc,client,system') && csv.split('\n').length > 10);
      await db.spendBudgets.insert({ scope: orgA.id, monthlyCents: 1, alertPct: 80, hardStop: true });
      check('a client over a hard-stop budget is refused new AI work', !!(await spendBlocked(orgA.id)) && (await send(`/api/systems/${s1.id}/agent`, 'POST', c.contrib, {})).status === 503);
      check('the agent endpoint explains the budget stop', (await say(keyA, 'Show me our portfolio')).reply.includes('budget'));
      for (let i = 0; i < 20 && (await db.spendBudgets.first({ scope: orgA.id }))?.alertedLevel !== 2; i++) await new Promise(r => setTimeout(r, 300));
      const alerted = await db.spendBudgets.first({ scope: orgA.id });
      check('admins are alerted once when a budget is reached', alerted?.alertedLevel === 2 && alerted.alertedMonth === new Date().toISOString().slice(0, 7));
      await db.spendBudgets.update({ scope: orgA.id }, { hardStop: false });
      check('a budget without a hard stop only alerts', !(await spendBlocked(orgA.id)));
      await db.spendBudgets.remove({ scope: orgA.id });
      const health = await get('/api/health');
      const hb = await health.json();
      check('the health check reports database and storage', health.status === 200 && hb.status === 'ok' && hb.checks.database === 'ok' && hb.checks.storage === 'ok' && hb.migrations >= 9);
      const sysPage = await get('/admin/system', c.admin);
      const sh = await sysPage.text();
      check('the System page shows the installation status', sysPage.status === 200 && sh.includes('Database migrations') && sh.includes('009_spend'));
      const { makeSignInLink } = await import('../src/lib/signin-link');
      const link = await makeSignInLink(contrib.email, 60);
      const cb = await fetch(link, { redirect: 'manual' });
      const sess = (cb.headers.getSetCookie?.() || []).find(x => x.startsWith('next-auth.session-token'))?.split(';')[0];
      check('a one-time sign-in link made without email signs the user in', !!sess && (await get(`/o/${orgA.slug}`, sess!)).status === 200);
      check('the link works only once', !((await fetch(link, { redirect: 'manual' })).headers.getSetCookie?.() || []).some(x => x.startsWith('next-auth.session-token')));
    }
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
    check('the client page shows model use by agent and the address of each specialist', await (async () => { const h = await (await get(`/o/${orgA.slug}`, c.admin)).text(); const ok = [h.includes('Model use this month, by agent'), h.includes('Controls assessor'), h.includes('/api/a2a/agents/<!-- -->source-checker') || h.includes('/api/a2a/agents/source-checker'), /\$\d+\.\d\d|&lt;\$0\.01/.test(h)]; if (!ok.every(Boolean)) console.log('client page checks', ok, h.slice(h.indexOf('Model use'), h.indexOf('Model use') + 1500)); return ok.every(Boolean); })());
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
    check('the action owner gets a task for each gap', (await db.tasks.count({ systemId: s1.id, assigneeId: contrib.id, scope: gapRefs })) === 3);
    check('reassigning the action closes the old owner\'s task', (await db.tasks.first({ systemId: s1.id, assigneeId: contrib.id, scope: gapRows[0].gapRef! }))?.status === 'done');
    await send(`/api/incidents/${gapRows[1].id}`, 'PATCH', c.clientAdmin, { status: 'resolved' });
    const ownerTask = await db.tasks.first({ systemId: s1.id, assigneeId: contrib.id, scope: gapRows[1].gapRef! });
    check('resolving the action keeps the owner\'s task open while the gap is open', ownerTask?.status === 'todo');
    check('the owner cannot mark that task done before the gap is closed', (await send(`/api/tasks/${ownerTask!.id}`, 'PATCH', c.contrib, { status: 'done' })).status === 409);
    const plan1 = await (await get(`/api/systems/${s1.id}/actions`, c.clientAdmin)).json();
    check('the resolved action stays on its gap, awaiting the assessment update', plan1.rows.some((r: any) => r.gap.ref === gapRows[1].gapRef && r.awaitingUpdate));
    {
      const r = await (await get(`/api/systems/${s1.id}`, c.clientAdmin)).json();
      const [k, key] = gapRows[1].gapRef!.split(':');
      const data = k === 'ctrl' ? { ...r.data, ctrl: { ...r.data.ctrl, [key]: { s: 'met', e: 'Closed by the action owner with evidence.' } } } : { ...r.data, conf: { ...(r.data.conf || {}), [key]: { t: 'Answered and confirmed.', ok: true } } };
      await send(`/api/systems/${s1.id}`, 'PUT', c.contrib, { data, version: r.version });
    }
    check('closing the gap in the assessment closes the owner\'s task', (await db.tasks.first({ id: ownerTask!.id }))?.status === 'done');
    await send(`/api/incidents/${gapRows[2].id}`, 'PATCH', c.clientAdmin, { ownerId: member.id });
    check('a new owner gets the task', !!(await db.tasks.first({ systemId: s1.id, assigneeId: member.id, scope: gapRows[2].gapRef!, status: 'todo' })) && (await db.incidents.first({ id: gapRows[2].id }))!.ownerName === member.email);
    check('the tracker shows gap actions', (await (await get(`/o/${orgA.slug}/incidents?view=gaps`, c.viewer)).text()).includes('Gap actions'));
    check('the remediation plan document opens', (await get(`/o/${orgA.slug}/systems/${s1.id}/plan`, c.viewer)).status === 200);
    check('ordinary incidents cannot be given a department', (await send(`/api/incidents/${irBody.incident.id}`, 'PATCH', c.clientAdmin, { department: 'X' })).status === 400);
    check('another client cannot see the action plan', (await get(`/api/systems/${s1.id}/actions`, c.other)).status === 404);

    // ---------- Automatic gap actions ----------
    {
      const { questionsFor } = await import('../src/lib/conformity');
      const { contextSnapshot, journey } = await import('../src/lib/journey');
      const { findGaps } = await import('../src/lib/gaps');
      const all8 = Object.fromEntries(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(k => [k, 'no']));
      const base: any = {
        profile: { name: 'Auto plan', owner: 'Head of Talent', team: 'HR Technology', description: 'Ranks job applicants', lifecycle: 'prod', func: 'hr', regions: ['eu'], role: ['provider'], aiType: ['ml'],
          affects: 'staff', personal: 'personal', scale: 's2', autonomy: 'a1', revers: 'r1', vendor: 'In-house', version: '1.3' },
        cls: { ...all8, a3: { h_emp: true }, t: {}, profiling: 'yes', tNone: 'yes' },
        ctrl: { 'GOV-1': { s: 'met', e: 'AI policy v2 approved by the board in March 2026.' } },
      };
      base.clsOk = { at: '2026-10-01', snap: contextSnapshot(base) };
      base.conf = Object.fromEntries(questionsFor(base).map(q => [q.id, { t: 'Answered with documents, owners and dates.', ok: true }]));
      check('the fixture completes all five steps', journey(base).done === 5, JSON.stringify(journey(base).steps.map(x => x.state)));
      const s4 = await db.aiSystems.insert({ orgId: orgA.id, name: 'Auto plan', data: base });
      const gaps4 = findGaps(base).length;
      const st0 = await (await get(`/api/systems/${s4.id}/actions`, c.clientAdmin)).json();
      check('automatic actions start switched off, with a suggested owner and the profile team as department', st0.settings?.auto === false && st0.settings.department === 'HR Technology' && !!st0.settings.ownerId && st0.journeyDone === true, JSON.stringify(st0.settings));
      check('a viewer cannot turn on automatic actions', (await send(`/api/systems/${s4.id}/actions`, 'PATCH', c.viewer, { auto: true, ownerId: contrib.id, department: 'Model Risk', dueDays: 14 })).status === 403);
      check('automatic actions need an owner', (await send(`/api/systems/${s4.id}/actions`, 'PATCH', c.clientAdmin, { auto: true, ownerId: null, department: 'Model Risk', dueDays: 14 })).status === 400);
      logs.length = 0;
      const on = await send(`/api/systems/${s4.id}/actions`, 'PATCH', c.clientAdmin, { auto: true, ownerId: contrib.id, department: 'Model Risk', dueDays: 14 });
      const onBody = await on.json();
      check('turning on automatic actions on a complete assessment raises one per gap', on.status === 200 && onBody.created === gaps4 && gaps4 > 0, JSON.stringify(onBody));
      const autoRows = await db.incidents.find({ systemId: s4.id, kind: 'gap' });
      const due14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      check('automatic actions carry the default owner, department and due date', autoRows.length === gaps4 && autoRows.every(r => r.ownerId === contrib.id && r.department === 'Model Risk' && r.due === due14));
      check('the owner gets a task per automatic action and one email', (await db.tasks.count({ systemId: s4.id, assigneeId: contrib.id, status: 'todo' })) === gaps4 && logs.join('').split(`To: ${contrib.email}`).length === 2);
      const again = await send(`/api/systems/${s4.id}/actions`, 'PATCH', c.clientAdmin, { auto: true, ownerId: contrib.id, department: 'Model Risk', dueDays: 14 });
      check('saving the settings again raises nothing twice', (await again.json()).created === 0 && (await db.incidents.count({ systemId: s4.id, kind: 'gap' })) === gaps4);
      const r4 = await (await get(`/api/systems/${s4.id}`, c.clientAdmin)).json();
      const put4 = await send(`/api/systems/${s4.id}`, 'PUT', c.clientAdmin, { data: { ...r4.data, ctrl: { ...r4.data.ctrl, 'GOV-1': { s: 'gap', e: 'The policy lapsed in September.' } } }, version: r4.version });
      check('a gap found after a save gets an action automatically', put4.status === 200 && !!(await db.incidents.first({ systemId: s4.id, kind: 'gap', gapRef: 'ctrl:GOV-1', ownerId: contrib.id })));
      await send(`/api/systems/${s4.id}/actions`, 'PATCH', c.clientAdmin, { auto: false, ownerId: contrib.id, department: 'Model Risk', dueDays: 14 });
      await db.incidents.remove({ systemId: s4.id, kind: 'gap', gapRef: 'ctrl:GOV-1' });
      const r5 = await (await get(`/api/systems/${s4.id}`, c.clientAdmin)).json();
      await send(`/api/systems/${s4.id}`, 'PUT', c.clientAdmin, { data: { ...r5.data, ctrl: { ...r5.data.ctrl, 'GOV-1': { s: 'gap', e: 'Still lapsed.' } } }, version: r5.version });
      check('with automatic actions off, saving raises nothing', !(await db.incidents.first({ systemId: s4.id, kind: 'gap', gapRef: 'ctrl:GOV-1' })));
      const inc = { ...base, conf: {} };
      const s5 = await db.aiSystems.insert({ orgId: orgA.id, name: 'Auto plan early', data: inc });
      const early = await send(`/api/systems/${s5.id}/actions`, 'PATCH', c.clientAdmin, { auto: true, ownerName: 'Tom Okafor, DPO', department: 'Legal', dueDays: 30 });
      check('before all five steps are complete, turning it on raises nothing yet', (await early.json()).created === 0 && (await db.incidents.count({ systemId: s5.id, kind: 'gap' })) === 0);
    }

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
    otlp.close();
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
