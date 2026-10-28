/* Model use and estimated cost of the assessment crew, per specialist, for FinOps reporting. */
import { db, type RunUsage } from '@/data';
import { SPECIALISTS, COORDINATOR } from './agent/specialists';
import { emptyUsage } from './agent/pricing';

export const CREW_ORDER = [...SPECIALISTS.map(s => s.key), COORDINATOR.key] as string[];

/** Adds up the per-specialist usage of a client's runs since a date. */
export async function crewUsage(orgId: string, since: Date) {
  const runs = await db.agentRuns.find({ orgId, createdAt: { gte: since } }, { columns: ['id', 'systemId', 'usage_detail', 'inputTokens', 'outputTokens', 'specialist', 'status'] });
  const by: RunUsage = {};
  for (const r of runs) {
    for (const [k, u] of Object.entries(r.usage_detail || {})) {
      const t = (by[k] ??= emptyUsage(u.model));
      t.calls += u.calls; t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheWrite += u.cacheWrite;
      t.costUsd += u.costUsd; t.ms += u.ms; t.proposals += u.proposals; t.tools += u.tools; t.model = u.model || t.model;
    }
  }
  const rows = CREW_ORDER.filter(k => by[k]).map(k => ({ key: k, ...by[k] }));
  const total = rows.reduce((a, r) => ({ cost: a.cost + r.costUsd, tokens: a.tokens + r.input + r.output + r.cacheRead + r.cacheWrite }), { cost: 0, tokens: 0 });
  // Runs from before per-specialist metering only have totals
  const legacy = runs.filter(r => !r.usage_detail).reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
  return { runs: runs.length, rows, total, legacyTokens: legacy };
}

export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
