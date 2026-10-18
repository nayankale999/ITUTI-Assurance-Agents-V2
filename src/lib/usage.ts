/* Usage metering. One assessment is counted when a pre-fill run completes for a system; further runs on the
 * same system within 30 days are included. Every client's usage is recorded, and the plan decides what is billable. */
import { db, type Plan } from '@/data';

export const FREE_RERUN_DAYS = 30;
export const PLAN_LABEL: Record<Plan, string> = { per_assessment: 'Per assessment', enterprise: 'Enterprise (flat fee)', internal: 'Internal or trial (not billed)' };

/** Records a completed assessment run. Returns whether it started a new billable assessment. */
export async function recordAssessment(opts: { orgId: string; systemId: string; runId: string; source: string }) {
  const org = await db.organizations.first({ id: opts.orgId });
  if (!org) return false;
  const since = new Date(Date.now() - FREE_RERUN_DAYS * 864e5);
  const recent = await db.usage.first({ systemId: opts.systemId, kind: 'assessment', createdAt: { gt: since } });
  if (recent) return false; // a re-run within the window is part of the same assessment
  await db.usage.insert({ orgId: opts.orgId, kind: 'assessment', systemId: opts.systemId, runId: opts.runId, source: opts.source, plan: org.plan, billable: org.plan === 'per_assessment' });
  return org.plan === 'per_assessment';
}

/** Whether running the agent on this system now would start a new billable assessment. */
export async function wouldBill(orgId: string, systemId: string) {
  const org = await db.organizations.first({ id: orgId });
  if (!org || org.plan !== 'per_assessment') return false;
  return !(await db.usage.first({ systemId, kind: 'assessment', createdAt: { gt: new Date(Date.now() - FREE_RERUN_DAYS * 864e5) } }));
}

export async function monthUsage(orgId: string, at = new Date()) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const rows = await db.usage.find({ orgId, kind: 'assessment', createdAt: { gte: start } });
  return { total: rows.length, billable: rows.filter(r => r.billable).length, viaAgent: rows.filter(r => r.source === 'a2a').length };
}
