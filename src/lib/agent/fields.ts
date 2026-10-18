/* The fields the assessment agent may propose values for, how to validate a proposed value, and how to apply it.
 * Paths:
 *   profile.<key>              text, or an option key (select), or a list of option keys (multi)
 *   cls.p1 … cls.p8            'no' | 'yes' | 'unsure'          prohibited-practice screens
 *   cls.annex1|profiling|exempt|gpai   'no' | 'yes'
 *   cls.a3.<area>, cls.t.<k>   true | false                     Annex III areas, transparency triggers
 *   ctrl.<CONTROL-ID>          { s: 'met'|'partial'|'gap'|'na', e: evidence text }
 *   card.<key>                 text                             model card
 *   metric.<name>              { kind, threshold, dir, readings: [{ d: 'YYYY-MM-DD', v: number }] }
 */
import { OPTS, PROFILE_SECTIONS, PROHIBITED, ANNEX3, TRANSPARENCY, CONTROLS, AREAS, applicable, type AssessmentData, type Metric } from '../assurance';
import { CARD_FIELDS } from '../report';

export type FieldKind = 'text' | 'select' | 'multi' | 'yn' | 'ynu' | 'bool' | 'control' | 'metric';
export type Field = { path: string; label: string; section: string; kind: FieldKind; opts?: [string, string][]; help?: string };

const YN: [string, string][] = [['no', 'No'], ['yes', 'Yes']];
const YNU: [string, string][] = [['no', 'No'], ['yes', 'Yes'], ['unsure', 'Unsure']];

export const SECTION_LABEL: Record<string, string> = { profile: 'Profile', cls: 'Classification', ctrl: 'Controls', card: 'Model card', metric: 'Monitoring' };

export function fieldCatalogue(): Field[] {
  const out: Field[] = [];
  for (const s of PROFILE_SECTIONS) for (const f of s.fields) {
    out.push({ path: `profile.${f.k}`, label: f.label, section: 'profile', kind: f.type === 'select' ? 'select' : f.type === 'multi' ? 'multi' : 'text', opts: f.opts ? OPTS[f.opts] : undefined, help: f.hint });
  }
  for (const [k, t, ref] of PROHIBITED) out.push({ path: `cls.${k}`, label: `${ref}: ${t}`, section: 'cls', kind: 'ynu' });
  for (const [k, t, ref] of ANNEX3) out.push({ path: `cls.a3.${k}`, label: `High-risk area, ${ref}: ${t}`, section: 'cls', kind: 'bool' });
  out.push({ path: 'cls.annex1', label: 'Art. 6(1): safety component of, or itself, a product under EU product-safety law (Annex I)', section: 'cls', kind: 'yn' });
  out.push({ path: 'cls.profiling', label: 'Art. 6(3): profiles individuals (evaluates economic situation, behaviour, reliability and similar)', section: 'cls', kind: 'yn' });
  out.push({ path: 'cls.exempt', label: 'Art. 6(3) exemption: only a narrow procedural task, improves a completed human activity, detects patterns without replacing human assessment, or prepares an assessment', section: 'cls', kind: 'yn' });
  for (const [k, t, ref] of TRANSPARENCY) out.push({ path: `cls.t.${k}`, label: `Transparency trigger, ${ref}: ${t}`, section: 'cls', kind: 'bool' });
  out.push({ path: 'cls.gpai', label: 'Art. 51–55: the organisation places a general-purpose AI model on the market (not only uses one)', section: 'cls', kind: 'yn' });
  const area = Object.fromEntries(AREAS);
  for (const c of CONTROLS) out.push({ path: `ctrl.${c.id}`, label: `${c.id} (${area[c.a]}): ${c.q}`, section: 'ctrl', kind: 'control', help: `Expected evidence: ${c.ev}` });
  for (const [k, l] of CARD_FIELDS) out.push({ path: `card.${k}`, label: `Model card: ${l}`, section: 'card', kind: 'text' });
  return out;
}

const CATALOGUE = fieldCatalogue();
const BY_PATH = new Map(CATALOGUE.map(f => [f.path, f]));

export function fieldFor(path: string): Field | undefined {
  if (path.startsWith('metric.')) return { path, label: `Metric: ${path.slice(7)}`, section: 'metric', kind: 'metric' };
  return BY_PATH.get(path);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Returns the normalised value, or an error message the agent can act on. */
export function validateValue(path: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const f = fieldFor(path);
  if (!f) return { ok: false, error: `Unknown field "${path}". Use a path from the field list.` };
  const keys = (f.opts || []).map(o => o[0]);
  switch (f.kind) {
    case 'text':
      if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `${path} needs non-empty text.` };
      return { ok: true, value: clip(value.trim(), 5000) };
    case 'select':
      if (typeof value !== 'string' || !keys.includes(value)) return { ok: false, error: `${path} must be one of: ${keys.join(', ')}.` };
      return { ok: true, value };
    case 'multi': {
      const arr = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null;
      if (!arr || !arr.length || arr.some(v => !keys.includes(String(v)))) return { ok: false, error: `${path} must be a list of: ${keys.join(', ')}.` };
      return { ok: true, value: [...new Set(arr.map(String))] };
    }
    case 'yn': case 'ynu': {
      const allowed = f.kind === 'yn' ? ['no', 'yes'] : ['no', 'yes', 'unsure'];
      if (typeof value !== 'string' || !allowed.includes(value)) return { ok: false, error: `${path} must be one of: ${allowed.join(', ')}.` };
      return { ok: true, value };
    }
    case 'bool':
      if (typeof value !== 'boolean') return { ok: false, error: `${path} must be true or false.` };
      return { ok: true, value };
    case 'control': {
      const v = value as { s?: unknown; e?: unknown } | null;
      if (!v || typeof v !== 'object' || !['met', 'partial', 'gap', 'na'].includes(String(v.s))) return { ok: false, error: `${path} needs {"s": "met" | "partial" | "gap" | "na", "e": "evidence"}.` };
      if (typeof v.e !== 'string' || v.e.trim().length < 10) return { ok: false, error: `${path} needs an evidence note "e" of at least a sentence: what the evidence is, its owner and date where known.` };
      return { ok: true, value: { s: String(v.s), e: clip(v.e.trim(), 5000) } };
    }
    case 'metric': {
      const v = value as Partial<Metric> | null;
      const name = path.slice(7).trim();
      if (!name || name.length > 200) return { ok: false, error: 'A metric path is "metric.<name>" with a short name.' };
      if (!v || typeof v !== 'object') return { ok: false, error: `${path} needs {"kind", "threshold", "dir", "readings"}.` };
      const readings = Array.isArray(v.readings) ? v.readings.filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.d)) && Number.isFinite(Number(r.v))).map(r => ({ d: String(r.d), v: Number(r.v) })) : [];
      return { ok: true, value: {
        kind: ['Performance', 'Fairness', 'Drift', 'Other'].includes(String(v.kind)) ? String(v.kind) : 'Performance',
        threshold: v.threshold == null ? '' : clip(String(v.threshold), 40),
        dir: v.dir === 'below' ? 'below' : 'above',
        readings: readings.sort((a, b) => a.d.localeCompare(b.d)).slice(-120),
      } };
    }
  }
}

/** The current value at a path, or undefined when empty. */
export function currentValue(data: AssessmentData, path: string): unknown {
  const [head, ...rest] = path.split('.');
  if (head === 'metric') return (data.metrics || []).find(m => m.name === rest.join('.'));
  if (head === 'ctrl') { const c = data.ctrl?.[rest.join('.')]; return c && (c.s || c.e) ? c : undefined; }
  let cur: any = (data as any)[head];
  for (const k of rest) cur = cur?.[k];
  if (cur === '' || cur == null || (Array.isArray(cur) && !cur.length) || cur === false) return undefined;
  return cur;
}

/** Writes a validated value into a copy of the assessment. */
export function applyValue(data: AssessmentData, path: string, value: unknown): AssessmentData {
  const d = structuredClone(data);
  const [head, ...rest] = path.split('.');
  if (head === 'metric') {
    const name = rest.join('.');
    const m = value as Omit<Metric, 'id' | 'name'>;
    const list = [...(d.metrics || [])];
    const i = list.findIndex(x => x.name === name);
    if (i >= 0) {
      const merged = [...(list[i].readings || []), ...(m.readings || [])];
      const byDate = new Map(merged.map(r => [r.d, r]));
      list[i] = { ...list[i], kind: m.kind, threshold: m.threshold, dir: m.dir, readings: [...byDate.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-120) };
    } else list.push({ id: Math.random().toString(36).slice(2, 10), name, ...m });
    d.metrics = list;
    return d;
  }
  if (head === 'ctrl') { d.ctrl = { ...(d.ctrl || {}), [rest.join('.')]: value as { s: string; e: string } }; return d; }
  const root: any = ((d as any)[head] ||= {});
  let cur = root;
  for (const k of rest.slice(0, -1)) cur = cur[k] ||= {};
  cur[rest[rest.length - 1]] = value;
  return d;
}

/** Compact listing of every field with its allowed values and current value, for the agent's first message. */
export function describeForAgent(data: AssessmentData): string {
  const appl = new Set(applicable(data).map(c => `ctrl.${c.id}`));
  const fmt = (v: unknown) => (v === undefined ? '(empty)' : JSON.stringify(v).slice(0, 300));
  const lines: string[] = [];
  let section = '';
  for (const f of CATALOGUE) {
    if (f.section !== section) { section = f.section; lines.push(`\n## ${SECTION_LABEL[section]}`); }
    const opts = f.opts ? ` options: ${f.opts.map(o => `${o[0]}=${o[1]}`).join('; ')}` : f.kind === 'yn' ? ' options: no, yes' : f.kind === 'ynu' ? ' options: no, yes, unsure' : f.kind === 'bool' ? ' options: true, false' : '';
    const tag = f.section === 'ctrl' ? (appl.has(f.path) ? ' [applies]' : ' [does not apply yet]') : '';
    lines.push(`- ${f.path}${tag} | ${f.label}${f.help ? ` | ${f.help}` : ''}${opts} | current: ${fmt(currentValue(data, f.path))}`);
  }
  const ms = data.metrics || [];
  lines.push('\n## Monitoring metrics (path metric.<name>)');
  lines.push(ms.length ? ms.map(m => `- metric.${m.name} | current: ${fmt({ kind: m.kind, threshold: m.threshold, dir: m.dir, readings: (m.readings || []).slice(-3) })}`).join('\n') : '- (none recorded)');
  return lines.join('\n');
}

export function displayValue(path: string, value: unknown): string {
  const f = fieldFor(path);
  if (value === undefined || value === null) return '—';
  if (!f) return JSON.stringify(value);
  const label = (k: unknown) => (f.opts || []).find(o => o[0] === k)?.[1] || String(k);
  switch (f.kind) {
    case 'select': return label(value);
    case 'multi': return (value as string[]).map(label).join(', ');
    case 'yn': case 'ynu': return ({ yes: 'Yes', no: 'No', unsure: 'Unsure' } as Record<string, string>)[String(value)] || String(value);
    case 'bool': return value ? 'Yes' : 'No';
    case 'control': { const c = value as { s: string; e: string }; return `${({ met: 'Met', partial: 'Partial', gap: 'Not met', na: 'N/A' } as Record<string, string>)[c.s] || c.s}: ${c.e}`; }
    case 'metric': { const m = value as Metric; const r = (m.readings || []).slice(-1)[0]; return `${m.kind}, threshold ${m.dir === 'below' ? '≤' : '≥'} ${m.threshold || '—'}${r ? `, latest ${r.v} on ${r.d}` : ''}${m.readings?.length ? ` (${m.readings.length} readings)` : ''}`; }
    default: return String(value);
  }
}
