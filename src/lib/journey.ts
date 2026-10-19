/* The compliance journey (five steps from inventory to conformity), the 1-4 regulatory risk score, and the check
 * that tells people when a system's context has changed since its classification was confirmed. */
import { PROHIBITED, TRANSPARENCY, PROFILE_SECTIONS, classify, inherentRisk, type AssessmentData } from './assurance';
import { confProgress } from './conformity';

export type StepState = 'done' | 'progress' | 'todo';
export type Step = { key: string; n: number; label: string; tab: string; state: StepState; detail: string; next: string };

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== '');
export const INVENTORY_KEYS = ['name', 'owner', 'team', 'description', 'lifecycle', 'func', 'regions', 'role', 'aiType', 'affects', 'personal'];

/** Profile answers that decide the classification: when one changes after it was confirmed, the system needs reassessing. */
export const CONTEXT_KEYS = ['description', 'func', 'sector', 'regions', 'role', 'aiType', 'source', 'vendor', 'affects', 'personal', 'scale', 'autonomy', 'dataSources'];
const label = (k: string) => PROFILE_SECTIONS.flatMap(s => s.fields).find(f => f.k === k)?.label || k;

export function contextSnapshot(sys: AssessmentData): string {
  const p: Record<string, unknown> = sys.profile || {};
  return JSON.stringify(CONTEXT_KEYS.map(k => { const v = p[k]; return Array.isArray(v) ? [...v].sort() : (v ?? ''); }));
}

export function reassessment(sys: AssessmentData): { confirmed: boolean; changed: string[]; at?: string } {
  const ok = sys.clsOk;
  if (!ok?.snap) return { confirmed: false, changed: [] };
  let before: unknown[] = [];
  try { before = JSON.parse(ok.snap); } catch { return { confirmed: false, changed: [] }; }
  const now = JSON.parse(contextSnapshot(sys)) as unknown[];
  const changed = CONTEXT_KEYS.filter((_, i) => JSON.stringify(before[i] ?? '') !== JSON.stringify(now[i] ?? '')).map(label);
  return { confirmed: true, changed, at: ok.at };
}

const BASE: Record<string, number> = { minimal: 1, limited: 2, high: 3, review: 3, prohibited: 4 };
/** 1.0-4.9 style score on the EU AI Act's four tiers: the whole number is the tier, the decimal is where the system sits within it. */
export function regulatoryScore(sys: AssessmentData): number | null {
  const tier = classify(sys).tier;
  if (!(tier in BASE)) return null;
  if (tier === 'prohibited') return 4;
  const ir = inherentRisk(sys);
  const within = tier === 'review' ? 0.9 : ir ? Math.min(0.9, Math.round(ir.score / 100 * 9) / 10) : 0.5;
  return Math.round((BASE[tier] + within) * 10) / 10;
}
export const SCORE_TIERS: [number, string, string][] = [[1, 'Minimal', 'good'], [2, 'Limited', 'info'], [3, 'High', 'warn'], [4, 'Prohibited', 'crit']];

export function journey(sys: AssessmentData): { steps: Step[]; current: number; done: number } {
  const p: Record<string, unknown> = sys.profile || {};
  const c: Record<string, any> = sys.cls || {};
  const inv = INVENTORY_KEYS.filter(k => filled(p[k])).length;
  const screens = PROHIBITED.filter(([k]) => c[k]).length;
  const banned = PROHIBITED.some(([k]) => c[k] === 'yes');
  const tier = classify(sys).tier;
  const ir = inherentRisk(sys);
  const re = reassessment(sys);
  const tx = TRANSPARENCY.filter(([k]) => c.t?.[k]).length;
  const cp = confProgress(sys);
  const st = (done: boolean, any: boolean): StepState => (done ? 'done' : any ? 'progress' : 'todo');

  const riskDone = tier !== 'unknown' && tier !== 'review' && !!ir && !ir.partial && re.confirmed && !re.changed.length;
  const steps: Step[] = [
    { key: 'inventory', n: 1, label: 'AI inventory', tab: 'profile', state: st(inv === INVENTORY_KEYS.length, inv > 1),
      detail: `${inv} of ${INVENTORY_KEYS.length} inventory details recorded`,
      next: 'Record what the system does, who owns it, the team that manages it, where it is used and who it affects.' },
    { key: 'prohibited', n: 2, label: 'Prohibited practices scan', tab: 'classify', state: st(screens === PROHIBITED.length, screens > 0),
      detail: banned ? 'A prohibited practice was identified' : `${screens} of ${PROHIBITED.length} screens answered`,
      next: banned ? 'Stop: the system uses a practice banned in the EU. Take legal advice and redesign or withdraw it.' : 'Answer each of the eight Article 5 screens. Choose “Unsure” rather than guessing; it routes the system to legal review.' },
    { key: 'risk', n: 3, label: 'Risk assessment', tab: 'classify', state: st(riskDone, tier !== 'unknown' || !!ir),
      detail: re.changed.length ? `Context changed since the classification was confirmed: ${re.changed.join(', ')}` : !re.confirmed && tier !== 'unknown' ? 'Classification computed, waiting for confirmation' : tier === 'unknown' ? 'Not classified yet' : 'Classification confirmed',
      next: re.changed.length ? 'Review the classification against the changed answers, then confirm it again.' : tier === 'review' ? 'Resolve the “Unsure” prohibited-practice screens with legal counsel.' : 'Check the Annex III areas and the impact factors, then confirm the classification so later changes are flagged.' },
    { key: 'transparency', n: 4, label: 'Transparency check', tab: 'classify', state: st(tx > 0 || c.tNone === 'yes', false),
      detail: tx ? `${tx} transparency trigger${tx === 1 ? '' : 's'} recorded` : c.tNone === 'yes' ? 'No transparency trigger applies' : 'Not checked yet',
      next: 'Say whether people interact with the system directly, whether it generates content, or whether it recognises emotions or biometric categories; or confirm that none apply.' },
    { key: 'conformity', n: 5, label: 'Conformity assessment', tab: 'conformity', state: st(cp.total > 0 && cp.done === cp.total, cp.done > 0),
      detail: `${cp.done} of ${cp.total} questions confirmed${cp.parts.some(x => x.review) ? `, ${cp.parts.reduce((a, x) => a + x.review, 0)} pre-filled to review` : ''}`,
      next: 'Work through the organisational, project and technical questions. Pre-filled answers come from earlier steps: check and confirm each one.' },
  ];
  const current = steps.findIndex(s => s.state !== 'done');
  return { steps, current: current === -1 ? steps.length : current, done: steps.filter(s => s.state === 'done').length };
}
