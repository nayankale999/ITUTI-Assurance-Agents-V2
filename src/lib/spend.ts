/* AI spend: every Claude call is recorded with who it was for (client, system, run), which agent made it, the
 * model, tokens and estimated cost. Monthly budgets, overall and per client, raise email alerts and can stop new
 * AI work once reached. This works without any external control plane. */
import { AsyncLocalStorage } from 'async_hooks';
import type Anthropic from '@anthropic-ai/sdk';
import { db } from '@/data';
import { pool, query, ready } from '@/data/sql';
import { tokensOf, costOf } from './agent/pricing';
import { sendActionEmail } from './mail';

export type SpendSource = 'run' | 'a2a' | 'review' | 'research' | 'other';
export type SpendCtx = { orgId: string | null; systemId: string | null; runId: string | null; source: SpendSource; agent: string };

const als = new AsyncLocalStorage<SpendCtx>();
const BLANK: SpendCtx = { orgId: null, systemId: null, runId: null, source: 'other', agent: 'unknown' };

/** Runs fn with spend attribution; fields not given are inherited from the surrounding context. */
export function withSpend<T>(ctx: Partial<SpendCtx>, fn: () => Promise<T>): Promise<T> {
  return als.run({ ...(als.getStore() || BLANK), ...ctx }, fn);
}

export const SOURCE_LABEL: Record<string, string> = { run: 'Assessment runs', a2a: 'Agent endpoint (A2A)', review: 'Evidence review', research: 'Model research', other: 'Other' };
export const AGENT_LABEL: Record<string, string> = {
  reader: 'Evidence reader', research: 'Model researcher', classify: 'Risk classifier', controls: 'Controls assessor', docs: 'Documentation writer',
  conformity: 'Conformity writer', checker: 'Source checker', coordinator: 'Assessment coordinator', assistant: 'Main A2A agent', review: 'Evidence review', unknown: 'Other',
};

/** Records one model call against the current context. Never throws. */
export async function recordCall(model: string, msg: Anthropic.Message) {
  try {
    const c = als.getStore() || BLANK;
    const t = tokensOf(msg.usage);
    await db.aiSpend.insert({
      orgId: c.orgId, systemId: c.systemId, runId: c.runId, source: c.source, agent: c.agent.slice(0, 32), model: model.slice(0, 80),
      inputTokens: t.input, outputTokens: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, costMicros: Math.round(costOf(model, t) * 1e6),
    });
    void checkAlerts(c.orgId);
  } catch (e) { console.error('[spend] not recorded', e); }
}

/* ---------- Periods ---------- */

export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export function monthRange(key = monthKey()) {
  const [y, m] = key.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

/** Spend in a month, in US dollars: everything, or one client. */
export async function monthSpend(orgId: string | null, key = monthKey()) {
  await ready();
  const { from, to } = monthRange(key);
  const rows = await query<{ c: string | number | null }>(pool(), `SELECT SUM(costMicros) AS c FROM ai_spend WHERE createdAt >= ? AND createdAt < ?${orgId ? ' AND orgId = ?' : ''}`, orgId ? [from, to, orgId] : [from, to]);
  return Number(rows[0]?.c || 0) / 1e6;
}

/* ---------- Budgets ---------- */

export type BudgetState = { scope: string; limit: number; spent: number; pct: number; hardStop: boolean; alertPct: number; over: boolean; warn: boolean };

async function stateFor(scope: string, key = monthKey()): Promise<BudgetState | null> {
  const b = await db.spendBudgets.first({ scope });
  if (!b || b.monthlyCents <= 0) return null;
  const spent = await monthSpend(scope === 'global' ? null : scope, key);
  const limit = b.monthlyCents / 100;
  const pct = Math.round((spent / limit) * 1000) / 10;
  return { scope, limit, spent, pct, hardStop: b.hardStop, alertPct: b.alertPct, over: spent >= limit, warn: pct >= b.alertPct };
}

export async function budgets(orgId?: string | null) {
  return { global: await stateFor('global'), org: orgId ? await stateFor(orgId) : null };
}

/** Why new AI work must not start for a client because a budget with a hard stop is used up, or null. */
export async function spendBlocked(orgId: string | null): Promise<string | null> {
  try {
    const { global, org } = await budgets(orgId);
    if (global?.warn || org?.warn) void checkAlerts(orgId);
    if (global?.over && global.hardStop) return `The monthly AI budget of $${global.limit.toFixed(2)} for this installation has been reached. An administrator can raise it on the Spend page.`;
    if (org?.over && org.hardStop) return `This client's monthly AI budget of $${org.limit.toFixed(2)} has been reached. An administrator can raise it on the Spend page.`;
    return null;
  } catch (e) { console.error('[spend] budget check failed', e); return null; }
}

const checking = new Set<string>();

/** Emails administrators once per month when a budget passes its alert level, and again when it is reached. */
async function checkAlerts(orgId: string | null) {
  for (const scope of ['global', ...(orgId ? [orgId] : [])]) {
    if (checking.has(scope)) continue;
    checking.add(scope);
    try {
      const st = await stateFor(scope);
      if (!st || !st.warn) continue;
      const level = st.over ? 2 : 1;
      const month = monthKey();
      const b = await db.spendBudgets.first({ scope });
      if (!b || (b.alertedMonth === month && b.alertedLevel >= level)) continue;
      await db.spendBudgets.update({ scope }, { alertedMonth: month, alertedLevel: level });
      const org = scope === 'global' ? null : await db.organizations.first({ id: scope });
      const who = org ? `${org.name}'s` : 'The installation\'s';
      const admins = await db.users.find({ role: 'ITUTI_ADMIN', disabled: false });
      const clientAdmins = org ? await db.memberships.find({ orgId: org.id, role: 'CLIENT_ADMIN' }) : [];
      const extra = clientAdmins.length ? await db.users.find({ id: clientAdmins.map(m => m.userId), disabled: false }) : [];
      const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
      for (const u of [...admins, ...extra]) {
        await sendActionEmail({
          to: u.email,
          subject: `${level === 2 ? 'AI budget reached' : 'AI budget alert'}: ${org ? org.name : 'all clients'}`,
          heading: level === 2 ? `${who} monthly AI budget has been reached` : `${who} AI spend has passed ${st.alertPct}% of its monthly budget`,
          body: `Estimated spend this month is $${st.spent.toFixed(2)} of a $${st.limit.toFixed(2)} budget (${st.pct}%).${level === 2 && st.hardStop ? ' New assessments and agent requests are paused until the budget is raised or the month ends.' : ''}`,
          action: 'Open the Spend page', url: `${base}/admin/spend`,
        }).catch(e => console.error('[spend] alert email failed', e));
      }
    } catch (e) { console.error('[spend] alert check failed', e); }
    finally { checking.delete(scope); }
  }
}

/* ---------- Reporting ---------- */

type Agg = { k: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };

async function grouped(col: string, from: Date, to: Date, orgId?: string | null): Promise<Agg[]> {
  const rows = await query<Record<string, unknown>>(pool(),
    `SELECT ${col} AS k, COUNT(*) AS calls, SUM(inputTokens) AS input, SUM(outputTokens) AS output, SUM(cacheRead) AS cacheRead, SUM(cacheWrite) AS cacheWrite, SUM(costMicros) AS cost
     FROM ai_spend WHERE createdAt >= ? AND createdAt < ?${orgId ? ' AND orgId = ?' : ''} GROUP BY ${col} ORDER BY cost DESC`, orgId ? [from, to, orgId] : [from, to]);
  return rows.map(r => ({ k: r.k == null ? '' : String(r.k), calls: Number(r.calls), input: Number(r.input || 0), output: Number(r.output || 0), cacheRead: Number(r.cacheRead || 0), cacheWrite: Number(r.cacheWrite || 0), cost: Number(r.cost || 0) / 1e6 }));
}

/** Everything the Spend page shows for a month. */
export async function spendReport(key = monthKey(), orgId?: string | null) {
  await ready();
  const { from, to } = monthRange(key);
  const [byOrg, byAgent, byModel, bySource, byDay] = await Promise.all([
    grouped('orgId', from, to, orgId), grouped('agent', from, to, orgId), grouped('model', from, to, orgId), grouped('source', from, to, orgId), grouped("DATE_FORMAT(createdAt, '%Y-%m-%d')", from, to, orgId),
  ]);
  const total = byModel.reduce((a, r) => ({ cost: a.cost + r.cost, calls: a.calls + r.calls, tokens: a.tokens + r.input + r.output + r.cacheRead + r.cacheWrite }), { cost: 0, calls: 0, tokens: 0 });
  const days = new Date(to.getTime() - 1).getUTCDate();
  const now = new Date();
  const elapsed = now >= to ? days : now < from ? 0 : Math.max(1, now.getUTCDate());
  const forecast = elapsed && elapsed < days ? (total.cost / elapsed) * days : total.cost;
  const daily = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), i + 1)).toISOString().slice(0, 10);
    return { d, cost: byDay.find(r => r.k.slice(0, 10) === d)?.cost || 0 };
  });
  return { key, total, forecast, daily, byOrg, byAgent, byModel, bySource };
}

/** The months that have any spend, newest first, plus the current one. */
export async function spendMonths() {
  await ready();
  const rows = await query<{ m: string }>(pool(), `SELECT DISTINCT DATE_FORMAT(createdAt, '%Y-%m') AS m FROM ai_spend ORDER BY m DESC LIMIT 24`);
  return [...new Set([monthKey(), ...rows.map(r => r.m)])].sort().reverse();
}

/** All calls of a month, for CSV export. */
export async function spendRows(key = monthKey()) {
  const { from, to } = monthRange(key);
  return db.aiSpend.find({ createdAt: { gte: from } }, { orderBy: [['createdAt', 'asc']] }).then(r => r.filter(x => x.createdAt < to));
}

export const money = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
