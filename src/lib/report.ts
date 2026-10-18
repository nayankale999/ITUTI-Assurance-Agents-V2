import { OPTS, type AssessmentData } from './assurance';

const optLabel = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];

export const CARD_FIELDS: [string, string, (p: Record<string, any>) => string][] = [
  ['purpose', 'Purpose and intended use', p => p.description || ''],
  ['users', 'Intended users', () => ''],
  ['outOfScope', 'Out-of-scope uses', () => ''],
  ['model', 'Model details', p => [optLabel('aiType', (p.aiType || [])[0]), p.vendor, p.version ? 'version ' + p.version : ''].filter(Boolean).join(', ')],
  ['data', 'Data', () => ''],
  ['performance', 'Performance', () => ''],
  ['fairness', 'Fairness and bias testing', () => ''],
  ['limitations', 'Known limitations and risks', () => ''],
  ['oversight', 'Human oversight', p => optLabel('autonomy', p.autonomy)],
  ['contact', 'Contact for questions or complaints', p => p.owner || ''],
];

export function cardValue(sys: AssessmentData, k: string): string {
  const v = sys.card?.[k];
  if (v) return v;
  if (k === 'performance' && (sys.metrics || []).length) {
    return sys.metrics!.map(m => {
      const l = (m.readings || []).slice(-1)[0];
      return `${m.name}: ${l ? l.v : 'no data'}${m.threshold !== '' && m.threshold != null ? ` (threshold ${m.dir === 'below' ? '≤' : '≥'} ${m.threshold})` : ''}`;
    }).join('\n');
  }
  const f = CARD_FIELDS.find(x => x[0] === k);
  return f ? f[2](sys.profile || {}) : '';
}

export function residualText(ir: { score: number } | null, pct: number) {
  if (!ir) return 'Score the impact factors to see the residual risk position.';
  const hi = ir.score >= 50, ready = pct >= 75;
  if (hi && !ready) return 'High inherent risk with incomplete controls: prioritise the open gaps before further rollout.';
  if (hi && ready) return 'High inherent risk with strong controls: maintain monitoring and re-validate on schedule.';
  if (!hi && !ready) return 'Moderate or low inherent risk: close the remaining gaps in the normal planning cycle.';
  return 'Low inherent risk with strong controls: review annually or on material change.';
}
