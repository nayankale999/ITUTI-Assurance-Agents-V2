/* One row per AI system with everything the inventory, risk and document views show. */
import { db, type AiSystemRow } from '@/data';
import { OPTS, TIERS, classify, inherentRisk, type AssessmentData } from './assurance';
import { journey, reassessment, regulatoryScore } from './journey';
import { art43, confProgress } from './conformity';

const opt = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];

export type InventoryRow = {
  id: string; name: string; unit: string; team: string; owner: string; func: string; lifecycle: string; lifecycleKey: string;
  tier: string; tierLabel: string; tierTone: string; score: number | null; inherent: number | null; readiness: number;
  stage: number; stageLabel: string; openIncidents: number; reassess: string[]; confirmed: boolean; art43: boolean;
  conf: number; vendor: string; regions: string; purpose: string; basis: string[]; updatedAt: string;
};

export function inventoryRow(s: AiSystemRow): InventoryRow {
  const d = s.data as AssessmentData;
  const p: Record<string, any> = d.profile || {};
  const c = classify(d), j = journey(d), re = reassessment(d), t = TIERS[c.tier] || TIERS.unknown;
  return {
    id: s.id, name: s.name, unit: String(p.client || ''), team: String(p.team || ''), owner: String(p.owner || ''),
    func: opt('func', p.func), lifecycle: opt('lifecycle', p.lifecycle), lifecycleKey: String(p.lifecycle || ''),
    tier: c.tier, tierLabel: t.label, tierTone: t.tone, score: regulatoryScore(d), inherent: inherentRisk(d)?.score ?? null,
    readiness: s.readiness, stage: j.done, stageLabel: j.current < 5 ? j.steps[j.current].label : 'Complete',
    openIncidents: s.openIncidents, reassess: re.changed, confirmed: re.confirmed, art43: art43(d).likely,
    conf: confProgress(d).pct, vendor: String(p.vendor || ''), regions: (p.regions || []).map((x: string) => opt('regions', x)).join(', '),
    purpose: String(p.description || ''), basis: c.reasons, updatedAt: s.updatedAt.toISOString(),
  };
}

export async function inventory(orgId: string) {
  const systems = await db.aiSystems.find({ orgId }, { orderBy: [['name', 'asc']] });
  return systems.map(inventoryRow);
}

export function riskSummary(rows: InventoryRow[]) {
  const scored = rows.filter(r => r.score != null);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score!, 0) / scored.length * 100) / 100 : null;
  const dist = [
    ['minimal', 'Minimal', 'good'], ['limited', 'Limited', 'info'], ['high', 'High', 'warn'], ['prohibited', 'Prohibited', 'crit'],
    ['review', 'Needs legal review', 'crit'], ['outside', 'Outside the AI Act', 'muted'], ['unknown', 'Not classified', 'muted'],
  ].map(([k, l, tone]) => ({ key: k, label: l, tone, count: rows.filter(r => r.tier === k).length }));
  return { avg, dist, flagged: rows.filter(r => r.reassess.length), unconfirmed: rows.filter(r => !r.confirmed && r.tier !== 'unknown') };
}

export const scoreTone = (s: number | null) => (s == null ? 'muted' : s >= 4 ? 'crit' : s >= 3 ? 'warn' : s >= 2 ? 'info' : 'good');

/** Every incident across a client's systems, newest first. */
export async function orgIncidents(orgId: string) {
  const systems = await db.aiSystems.find({ orgId }, { columns: ['id', 'name'] });
  const names = new Map(systems.map(s => [s.id, s.name]));
  const rows = systems.length ? await db.incidents.find({ systemId: systems.map(s => s.id) }, { orderBy: [['date', 'desc'], ['createdAt', 'desc']] }) : [];
  return rows.map(i => ({ id: i.id, systemId: i.systemId, system: names.get(i.systemId) || '', title: i.title, date: i.date, severity: i.severity, category: i.category, status: i.status, serious: i.serious, notes: i.notes,
    kind: i.kind, gapRef: i.gapRef, owner: i.ownerName || '', department: i.department || '', due: i.due }));
}

