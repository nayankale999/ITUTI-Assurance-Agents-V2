/* The gaps an assessment leaves open, and the action that should close each one.
 * A gap is an applicable control that is not met (or not yet assessed), or a conformity question that has not been
 * answered and confirmed. Each gap is closed by an action raised against an owner and a department; actions are kept
 * with incidents (kind 'gap') so they appear in the tracker, but they never count as AI incidents. */
import { AREAS, applicable, classify, type AssessmentData } from './assurance';
import { questionsFor, answerState, confLabel, CONF_PARTS } from './conformity';

export type Gap = { ref: string; kind: 'control' | 'conformity'; title: string; area: string; status: string; severity: 'low' | 'medium' | 'high' | 'critical'; detail: string; suggested: string };

const AREA = Object.fromEntries(AREAS);
const PART = Object.fromEntries(CONF_PARTS.map(([k, l]) => [k, l]));
const STATUS: Record<string, string> = { gap: 'Not met', partial: 'Partly met', '': 'Not assessed' };

export function findGaps(sys: AssessmentData): Gap[] {
  const high = ['high', 'prohibited', 'review'].includes(classify(sys).tier);
  const out: Gap[] = [];
  for (const c of applicable(sys)) {
    const st = sys.ctrl?.[c.id];
    const s = st?.s || '';
    if (s === 'met' || s === 'na') continue;
    const severity = s === 'gap' ? (high ? 'critical' : 'high') : s === 'partial' ? (high ? 'high' : 'medium') : (high ? 'high' : 'medium');
    const missing = st?.e ? st.e.match(/(?:Missing|missing|Not covered|not supplied|Open)[^.]*\./g)?.join(' ') : '';
    out.push({
      ref: `ctrl:${c.id}`, kind: 'control', title: `${c.id}: ${c.q}`, area: AREA[c.a], status: STATUS[s] ?? s, severity,
      detail: st?.e || 'No evidence recorded yet.',
      suggested: `${s === 'partial' ? 'Complete' : 'Put in place and evidence'}: ${c.q}${missing ? ` Outstanding: ${missing}` : ''} Expected evidence: ${c.ev}`,
    });
  }
  for (const q of questionsFor(sys)) {
    const a = answerState(sys, q);
    if (a.state === 'done') continue;
    out.push({
      ref: `conf:${q.id}`, kind: 'conformity', title: `Conformity ${confLabel(q.id)}: ${q.topic}`, area: `${PART[q.part]} conformity`,
      status: a.state === 'review' ? 'Pre-filled, not confirmed' : 'Not answered', severity: high ? 'medium' : 'low',
      detail: a.text || q.q,
      suggested: a.state === 'review' ? `Review and confirm the pre-filled answer to: ${q.q}` : `Answer, with documents, owners and dates: ${q.q}`,
    });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}

export type GapAction = { id: string; gapRef: string | null; status: string; ownerId: string | null; ownerName: string | null; department: string | null; due: string | null; title: string; notes: string; severity: string; date: string };

/** Pairs each gap with its open action, and lists actions whose gap has since been closed. */
export function planStatus(gaps: Gap[], actions: GapAction[]) {
  const open = actions.filter(a => !['resolved', 'closed'].includes(a.status));
  const byRef = new Map(open.map(a => [a.gapRef, a]));
  const rows = gaps.map(g => ({ gap: g, action: byRef.get(g.ref) || null }));
  const refs = new Set(gaps.map(g => g.ref));
  const closable = open.filter(a => a.gapRef && !refs.has(a.gapRef));
  const today = new Date().toISOString().slice(0, 10);
  return {
    rows, closable,
    withAction: rows.filter(r => r.action).length,
    withoutAction: rows.filter(r => !r.action).length,
    overdue: open.filter(a => a.due && a.due < today).length,
  };
}
