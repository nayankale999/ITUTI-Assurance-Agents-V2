/* Every recorded Claude call of a month, as CSV. Ituti admins only. */
import { db } from '@/data';
import { getViewer } from '@/lib/session';
import { spendRows, monthKey } from '@/lib/spend';

export const dynamic = 'force-dynamic';
const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s; };

export async function GET(req: Request) {
  const v = await getViewer();
  if (!v || v.role !== 'ITUTI_ADMIN') return new Response('Not found', { status: 404 });
  const m = new URL(req.url).searchParams.get('m') || monthKey();
  if (!/^\d{4}-\d{2}$/.test(m)) return new Response('Bad month', { status: 400 });
  const rows = await spendRows(m);
  const orgs = new Map((await db.organizations.all({ columns: ['id', 'name'] })).map(o => [o.id, o.name]));
  const systems = new Map((await db.aiSystems.all({ columns: ['id', 'name'] })).map(s => [s.id, s.name]));
  const head = ['time_utc', 'client', 'system', 'run_id', 'source', 'agent', 'model', 'input_tokens', 'cache_write_tokens', 'cache_read_tokens', 'output_tokens', 'estimated_cost_usd'];
  const lines = rows.map(r => [r.createdAt.toISOString(), r.orgId ? orgs.get(r.orgId) || 'Deleted client' : '', r.systemId ? systems.get(r.systemId) || '' : '', r.runId || '', r.source, r.agent, r.model, r.inputTokens, r.cacheWrite, r.cacheRead, r.outputTokens, (r.costMicros / 1e6).toFixed(6)].map(cell).join(','));
  return new Response([head.join(','), ...lines].join('\n') + '\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ai-spend-${m}.csv"`, 'Cache-Control': 'no-store' } });
}
