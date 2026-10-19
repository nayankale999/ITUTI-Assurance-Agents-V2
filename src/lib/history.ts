/* Field-level change history for each AI system: who recorded what, when, and through which route. It is the
 * audit trail behind every answer. Repeated edits to one field by one person within ten minutes fold into one row,
 * so typing does not flood the trail. */
import { db } from '@/data';
import type { AssessmentData } from './assurance';
import { fieldFor, displayValue } from './agent/fields';

const FOLD_MS = 10 * 60 * 1000;
const MAX_ROWS = 200;
const clip = (s: string | null) => (s == null ? null : s.length > 1500 ? s.slice(0, 1500) + '…' : s);

/** Flattens an assessment into path -> value for the fields people answer. */
export function flatten(d: AssessmentData): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(d.profile || {})) out.set(`profile.${k}`, v);
  for (const [k, v] of Object.entries(d.cls || {})) {
    if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) out.set(`cls.${k}.${k2}`, v2);
    else out.set(`cls.${k}`, v);
  }
  for (const [k, v] of Object.entries(d.ctrl || {})) out.set(`ctrl.${k}`, v);
  for (const [k, v] of Object.entries(d.card || {})) out.set(`card.${k}`, v);
  for (const [k, v] of Object.entries(d.conf || {})) out.set(`conf.${k}`, v);
  for (const m of d.metrics || []) out.set(`metric.${m.name}`, { kind: m.kind, threshold: m.threshold, dir: m.dir, readings: (m.readings || []).length });
  if (d.clsOk) out.set('clsOk', { at: d.clsOk.at });
  return out;
}

const empty = (v: unknown) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.values(v as object).some(x => x != null && x !== ''));

function show(path: string, v: unknown): string | null {
  if (empty(v)) return null;
  if (path === 'clsOk') return 'Classification confirmed';
  if (path.startsWith('conf.')) { const a = v as { t?: string; ok?: boolean }; return `${a.ok ? '[confirmed] ' : '[to review] '}${a.t || ''}`; }
  if (path.startsWith('metric.')) { const m = v as { threshold?: unknown; dir?: string; readings: number }; return `${m.readings} reading${m.readings === 1 ? '' : 's'}${m.threshold !== '' && m.threshold != null ? `, threshold ${m.dir === 'below' ? '≤' : '≥'} ${m.threshold}` : ''}`; }
  if (fieldFor(path)) return displayValue(path, v);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function labelFor(path: string) {
  if (path === 'clsOk') return 'Classification confirmation';
  if (path.startsWith('conf.')) return `Conformity assessment ${path.slice(5)}`;
  return fieldFor(path)?.label || path;
}

export function diff(before: AssessmentData, after: AssessmentData) {
  const a = flatten(before), b = flatten(after);
  const out: { path: string; label: string; before: string | null; after: string | null }[] = [];
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(path), y = b.get(path);
    if (empty(x) && empty(y)) continue;
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    out.push({ path: path.slice(0, 191), label: labelFor(path).slice(0, 250), before: clip(show(path, x)), after: clip(show(path, y)) });
  }
  return out.slice(0, MAX_ROWS);
}

export async function recordChanges(opts: { orgId: string; systemId: string; userId: string | null; via: 'editor' | 'agent' | 'a2a'; before: AssessmentData; after: AssessmentData }) {
  try {
    const changes = diff(opts.before, opts.after);
    if (!changes.length) return;
    const now = new Date();
    const since = new Date(now.getTime() - FOLD_MS);
    const recent = opts.userId ? await db.changes.find({ systemId: opts.systemId, userId: opts.userId, via: opts.via, updatedAt: { gt: since } }) : [];
    const byPath = new Map(recent.map(r => [r.path, r]));
    const fresh = [];
    for (const c of changes) {
      const prev = byPath.get(c.path);
      if (prev) await db.changes.update({ id: prev.id }, { after: c.after, updatedAt: now });
      else fresh.push({ orgId: opts.orgId, systemId: opts.systemId, userId: opts.userId, via: opts.via, ...c, createdAt: now, updatedAt: now });
    }
    if (fresh.length) await db.changes.insertMany(fresh);
  } catch (e) {
    console.error('[history] not recorded', e);
  }
}
