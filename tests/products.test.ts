import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssessmentData } from '../src/lib/assurance';
import { CONF_QUESTIONS, questionsFor, prefill, answerState, confProgress, art43 } from '../src/lib/conformity';
import { journey, regulatoryScore, reassessment, contextSnapshot } from '../src/lib/journey';
import { diff } from '../src/lib/history';
import { legalReview, isActive } from '../src/lib/incidents';
import { assessmentSchema } from '../src/lib/validate';

const all = (v: string) => Object.fromEntries(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map(k => [k, v]));
const hr: AssessmentData = {
  profile: { name: 'CV screening', owner: 'Head of Talent', team: 'HR Technology', description: 'Ranks job applicants', lifecycle: 'prod', func: 'hr', regions: ['eu'], role: ['provider'], aiType: ['ml'],
    affects: 'staff', personal: 'personal', scale: 's2', autonomy: 'a1', revers: 'r1', vendor: 'In-house', version: '1.3' },
  cls: { ...all('no'), a3: { h_emp: true }, t: {}, profiling: 'yes' },
  ctrl: { 'GOV-1': { s: 'met', e: 'AI policy v2 approved by the board in March 2026.' } },
  card: { users: 'Recruiters' }, metrics: [{ id: 'm', name: 'Precision at 20', threshold: 0.65, dir: 'above', readings: [{ d: '2026-09-30', v: 0.7 }] }],
};

test('conformity questions have unique ids, 6/20/15 per part, and the generative question only for generative systems', () => {
  assert.equal(new Set(CONF_QUESTIONS.map(q => q.id)).size, CONF_QUESTIONS.length);
  assert.deepEqual(['org', 'project', 'tech'].map(p => CONF_QUESTIONS.filter(q => q.part === p).length), [6, 20, 15]);
  assert.equal(questionsFor(hr).length, 40);
  assert.equal(questionsFor({ ...hr, profile: { ...hr.profile, aiType: ['genai'] } }).length, 41);
});

test('answers recorded elsewhere pre-fill the conformity questions and need confirming', () => {
  assert.match(prefill(hr, 'P1')!.t, /Ranks job applicants/);
  assert.match(prefill(hr, 'O1')!.t, /In place \(GOV-1\): AI policy v2/);
  assert.match(prefill(hr, 'T5')!.t, /Precision at 20: threshold ≥ 0.65/);
  assert.equal(prefill(hr, 'P16'), null);
  const p1 = CONF_QUESTIONS.find(q => q.id === 'P1')!;
  assert.equal(answerState(hr, p1).state, 'review');
  const confirmed = { ...hr, conf: { P1: { t: 'Shortlisting support.', ok: true } } };
  assert.equal(answerState(confirmed, p1).state, 'done');
  assert.equal(confProgress(confirmed).done, 1);
  assert.equal(art43(hr).required, true);
  assert.equal(art43({ ...hr, profile: { ...hr.profile, role: ['deployer'] } }).required, false);
});

test('risk score sits on the four EU AI Act tiers', () => {
  const s = regulatoryScore(hr)!;
  assert.ok(s >= 3 && s < 4, String(s));
  assert.equal(regulatoryScore({ ...hr, cls: { ...hr.cls, p1: 'yes' } }), 4);
  assert.equal(regulatoryScore({}), null);
  const minimal = regulatoryScore({ profile: hr.profile, cls: { ...all('no'), a3: {}, t: {} } })!;
  assert.ok(minimal >= 1 && minimal < 2, String(minimal));
});

test('changing the context after confirming the classification flags reassessment', () => {
  const ok = { ...hr, clsOk: { at: '2026-10-01T00:00:00Z', snap: contextSnapshot(hr) } };
  assert.deepEqual(reassessment(ok).changed, []);
  const moved = { ...ok, profile: { ...ok.profile, personal: 'special', regions: ['eu', 'uk'] } };
  assert.deepEqual(reassessment(moved).changed, ['Where it is used or its outputs take effect', 'Data processed']);
  assert.equal(reassessment(hr).confirmed, false);
});

test('the journey moves through five steps', () => {
  let j = journey(hr);
  assert.deepEqual(j.steps.map(s => s.state), ['done', 'done', 'progress', 'todo', 'todo']);
  assert.equal(j.current, 2);
  j = journey({ ...hr, clsOk: { at: 'x', snap: contextSnapshot(hr) }, cls: { ...hr.cls, tNone: 'yes' } });
  assert.equal(j.steps[2].state, 'done');
  assert.equal(j.steps[3].state, 'done');
  assert.equal(j.current, 4);
});

test('the change history records field-level before and after values', () => {
  const after = { ...hr, profile: { ...hr.profile, owner: 'Chief People Officer' }, conf: { P1: { t: 'Shortlisting', ok: true } } };
  const d = diff(hr, after);
  assert.deepEqual(d.map(x => x.path).sort(), ['conf.P1', 'profile.owner']);
  const owner = d.find(x => x.path === 'profile.owner')!;
  assert.equal(owner.before, 'Head of Talent');
  assert.equal(owner.after, 'Chief People Officer');
});

test('incident lifecycle and legal-review flags', () => {
  assert.equal(isActive('mitigated'), true);
  assert.equal(isActive('resolved'), false);
  assert.match(legalReview({ category: 'Bias or discrimination', serious: false, severity: 'high' })!, /discrimination/);
  assert.equal(legalReview({ category: 'Outage or failure', serious: false, severity: 'high' }), null);
});

test('new assessment fields pass the save schema', () => {
  const ok = assessmentSchema.safeParse({ ...hr, conf: { P1: { t: 'x', ok: true, from: 'Profile' } }, clsOk: { at: '2026-10-01T00:00:00Z', snap: contextSnapshot(hr) }, cls: { ...hr.cls, tNone: 'yes' } });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
});

test('task scopes unlock exactly the fields they cover', async () => {
  const { pathAllowed, proposalAllowed, scopeOptions, scopeTab } = await import('../src/lib/tasks');
  assert.equal(pathAllowed(['ctrl:GOV-1'], 'ctrl.GOV-1'), true);
  assert.equal(pathAllowed(['ctrl:GOV-1'], 'ctrl.GOV-2'), false);
  assert.equal(pathAllowed(['ctrlArea:gov'], 'ctrl.GOV-2'), true);
  assert.equal(pathAllowed(['ctrlArea:gov'], 'ctrl.TEC-1'), false);
  assert.equal(pathAllowed(['confPart:project'], 'conf.P7'), true);
  assert.equal(pathAllowed(['confPart:project'], 'conf.T7'), false);
  assert.equal(pathAllowed(['classify'], 'clsOk'), true);
  assert.equal(pathAllowed(['monitor'], 'metric.AUC'), true);
  assert.equal(pathAllowed(['card'], 'profile.name'), false);
  assert.equal(proposalAllowed(['review'], 'profile.name'), true);
  assert.equal(new Set(scopeOptions().map(o => o[0])).size, scopeOptions().length);
  assert.equal(scopeTab('conf:P3'), 'conformity');
  assert.equal(scopeTab('review'), 'agent');
});

test('gaps come from unmet controls and unconfirmed conformity answers, and pair with their actions', async () => {
  const { findGaps, planStatus } = await import('../src/lib/gaps');
  const gaps = findGaps(hr);
  assert.ok(gaps.some(g => g.ref === 'ctrl:DAT-3' && g.severity === 'high'), 'partial control on a high-risk system is high priority');
  assert.ok(!gaps.some(g => g.ref === 'ctrl:GOV-1'), 'a met control is not a gap');
  assert.ok(gaps.some(g => g.ref === 'ctrl:GOV-2' && g.status === 'Not assessed'));
  assert.ok(gaps.some(g => g.ref === 'conf:P1' && g.status === 'Pre-filled, not confirmed'));
  const withGap = { ...hr, ctrl: { ...hr.ctrl, 'GOV-2': { s: 'gap', e: 'No accountable executive named.' } } };
  assert.equal(findGaps(withGap).find(g => g.ref === 'ctrl:GOV-2')!.severity, 'critical');
  const act = (ref: string, status = 'open') => ({ id: ref, gapRef: ref, status, ownerId: null, ownerName: 'A', department: 'HR', due: '2000-01-01', title: '', notes: '', severity: 'high', date: '' });
  const p = planStatus(gaps, [act('ctrl:DAT-3'), act('ctrl:GOV-1')]);
  assert.equal(p.withAction, 1);
  assert.equal(p.closable.map(a => a.gapRef).join(), 'ctrl:GOV-1');
  assert.equal(p.overdue, 2);
});

test('a resolved action on a gap that is still open shows as awaiting the assessment update, not as needing an action', async () => {
  const { findGaps, planStatus } = await import('../src/lib/gaps');
  const gaps = findGaps(hr);
  const act = { id: 'a1', gapRef: 'ctrl:DAT-3', status: 'resolved', ownerId: null, ownerName: 'A', department: 'HR', due: null, title: '', notes: '', severity: 'high', date: '' };
  const p = planStatus(gaps, [act]);
  const row = p.rows.find(r => r.gap.ref === 'ctrl:DAT-3')!;
  assert.equal(row.action?.id, 'a1');
  assert.equal(row.awaitingUpdate, true);
  assert.equal(p.awaitingUpdate, 1);
  assert.equal(p.withoutAction, gaps.length - 1);
});

test('evidence types are recognised from names and titles, and the checklist follows the system', async () => {
  const { detectKinds, evidenceChecklist } = await import('../src/lib/evidence');
  assert.deepEqual(detectKinds('DPIA - Loan scoring v2.pdf', ''), ['dpia']);
  assert.ok(detectKinds('report.pdf', '# Credit scoring model: validation report\n\nIndependent validation...').includes('validation'));
  assert.deepEqual(detectKinds('notes.txt', ''), []);
  const sys = { profile: { personal: 'none', affects: 'no', source: 'inhouse' } };
  const c1 = evidenceChecklist(sys, []);
  assert.equal(c1.items.find(i => i.id === 'dpia')?.needed, false);
  assert.equal(c1.provided, 0);
  const c2 = evidenceChecklist({ profile: { personal: 'personal' } }, [{ id: 'd1', name: 'DPIA.pdf', status: 'ready', kinds: ['dpia'] }, { id: 'd2', name: 'scan.pdf', status: 'failed', kinds: ['policy'] }]);
  const dpia = c2.items.find(i => i.id === 'dpia')!;
  assert.ok(dpia.needed && dpia.provided[0].id === 'd1');
  assert.equal(c2.items.find(i => i.id === 'policy')!.provided.length, 0);
  assert.equal(c2.items.find(i => i.id === 'policy')!.unreadable.length, 1);
});
