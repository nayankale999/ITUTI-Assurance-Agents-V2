import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { aiBlocked } from '@/lib/agent/access';
import { startRun, STALE_MS } from '@/lib/agent/runner';
import { displayValue, fieldFor, SECTION_LABEL } from '@/lib/agent/fields';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };

/** The latest run and the proposals waiting for review. */
export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  const run = await db.agentRuns.first({ systemId: id }, { orderBy: [['createdAt', 'desc']] });
  const live = run && ['queued', 'running'].includes(run.status) && Date.now() - (run.heartbeatAt || run.createdAt).getTime() > STALE_MS
    ? { ...run, status: 'failed' as const, error: 'The run stopped responding. Start it again.' } : run;
  const pending = await db.proposals.find({ systemId: id, status: 'pending' }, { orderBy: [['createdAt', 'asc']] });
  const decided = await db.proposals.count({ systemId: id, status: ['accepted', 'rejected'] });
  return json({
    blocked: aiBlocked(a.org),
    run: live ? { id: live.id, status: live.status, log: live.log.slice(-60), summary: live.summary, error: live.error, proposals: live.proposals, createdAt: live.createdAt, finishedAt: live.finishedAt } : null,
    decided,
    proposals: pending.map(p => ({
      id: p.id, path: p.path, label: p.label, section: SECTION_LABEL[p.path.split('.')[0]] || 'Other', kind: fieldFor(p.path)?.kind || 'text',
      value: p.value, display: displayValue(p.path, p.value), previous: p.previous === null ? null : displayValue(p.path, p.previous),
      rationale: p.rationale, confidence: p.confidence, sources: p.sources, createdAt: p.createdAt,
    })),
  });
}

/** Starts a pre-fill run. */
export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You cannot run the agent on this system.');
  const blocked = aiBlocked(a.org); if (blocked) return err(503, blocked);
  const run = await startRun({ orgId: a.system.orgId, systemId: id, userId: v.id });
  await audit({ orgId: a.system.orgId, systemId: id, userId: v.id, action: 'agent.started' });
  return json({ run: { id: run.id, status: run.status } }, 202);
}
