import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, applicable, inherentRisk, readiness, obligations, CONTROLS } from '../src/lib/assurance';

const noPro = { p1: 'no', p2: 'no', p3: 'no', p4: 'no', p5: 'no', p6: 'no', p7: 'no', p8: 'no' };

test('credit scoring with profiling is high risk and needs a FRIA for deployers', () => {
  const r = classify({ profile: { role: ['deployer'], regions: ['eu'] }, cls: { ...noPro, a3: { h_credit: true }, profiling: 'yes' } });
  assert.equal(r.tier, 'high');
  assert.equal(r.fria, true);
});

test('a prohibited practice overrides everything', () => {
  assert.equal(classify({ cls: { ...noPro, p3: 'yes', a3: { h_credit: true } } }).tier, 'prohibited');
});

test('an unsure screen needs legal review', () => {
  assert.equal(classify({ cls: { ...noPro, p6: 'unsure' } }).tier, 'review');
});

test('the Art. 6(3) exemption drops a non-profiling Annex III use to a lower tier', () => {
  assert.equal(classify({ cls: { ...noPro, a3: { h_emp: true }, profiling: 'no', exempt: 'yes' } }).tier, 'minimal');
});

test('a chatbot is limited risk', () => {
  assert.equal(classify({ cls: { ...noPro, t: { t1: true } } }).tier, 'limited');
});

test('conformity controls apply only to high-risk providers', () => {
  const ids = (s: object) => applicable(s).map(c => c.id);
  const high = { profile: { role: ['provider'] }, cls: { ...noPro, a3: { h_credit: true }, profiling: 'yes' } };
  assert.ok(ids(high).includes('CNF-1'));
  assert.ok(!ids({ profile: { role: ['provider'] }, cls: noPro }).includes('CNF-1'));
});

test('readiness counts partial as half and ignores N/A', () => {
  const s = { cls: noPro, ctrl: { 'GOV-1': { s: 'met' }, 'GOV-2': { s: 'partial' }, 'GOV-3': { s: 'na' } } };
  const r = readiness(s, CONTROLS.filter(c => ['GOV-1', 'GOV-2', 'GOV-3'].includes(c.id)));
  assert.equal(r.den, 2);
  assert.equal(r.pct, 75);
});

test('risk score needs at least three impact answers', () => {
  assert.equal(inherentRisk({ profile: { affects: 'cust' } }), null);
  const r = inherentRisk({ profile: { affects: 'cust', personal: 'special', scale: 's3', autonomy: 'a3', revers: 'r2' }, cls: { ...noPro, a3: { h_credit: true }, profiling: 'yes' } });
  assert.ok(r && r.score >= 75 && r.band === 'Severe');
});

test('UK financial services obligations include Consumer Duty and SM&CR', () => {
  const ob = obligations({ profile: { regions: ['uk'], sector: 'bank', func: 'credit', affects: 'cust' }, cls: noPro });
  const uk = ob.find(o => o.region === 'United Kingdom')!;
  const refs = uk.items.map(i => i[1]);
  assert.ok(refs.includes('FCA Consumer Duty') && refs.includes('SM&CR') && refs.includes('PRA SS1/23'));
});

test('a system that is not an AI system, or is excluded, is outside the AI Act', () => {
  const base = { profile: { role: ['provider'] }, cls: { p1: 'no', a3: { h_credit: true } } };
  assert.equal(classify({ ...base, cls: { ...base.cls, def: 'no' } }).tier, 'outside');
  assert.equal(classify({ ...base, cls: { ...base.cls, excl: 'yes' } }).tier, 'outside');
  assert.deepEqual(applicable({ ...base, cls: { ...base.cls, def: 'no' } }).map(c => c.id), ['GOV-3']);
  assert.ok(classify({ ...base, cls: { ...base.cls, def: 'unsure' } }).flags.some(f => f.includes('Art. 3(1)')));
});

test('value-chain roles, public bodies, workplaces and GPAI bring their own controls', () => {
  const hi = (profile: Record<string, any>, cls: Record<string, any> = {}) => applicable({ profile, cls: { p1: 'no', p2: 'no', p3: 'no', p4: 'no', p5: 'no', p6: 'no', p7: 'no', p8: 'no', a3: { h_emp: true }, profiling: 'yes', ...cls } }).map(c => c.id);
  assert.ok(hi({ role: ['provider'], established: 'noneu' }).includes('CNF-5'));
  assert.ok(!hi({ role: ['provider'], established: 'eu' }).includes('CNF-5'));
  assert.ok(hi({ role: ['provider'] }).includes('CNF-4') && hi({ role: ['provider'] }).includes('MON-5'));
  assert.ok(hi({ role: ['importer'] }).includes('CNF-6') && hi({ role: ['distributor'] }).includes('GOV-7'));
  assert.ok(hi({ role: ['deployer'], affects: 'staff' }).includes('TXP-6'));
  assert.ok(hi({ role: ['deployer'], publicBody: 'yes' }).includes('CNF-7'));
  assert.ok(hi({ role: ['provider'] }, { gpai: 'yes', gpaiSys: 'yes' }).includes('GPA-2'));
  assert.ok(!hi({ role: ['provider'] }, { gpai: 'no', gpaiSys: 'yes' }).includes('GPA-2'));
  assert.ok(classify({ profile: { role: ['deployer'], publicBody: 'yes' }, cls: { p1: 'no', p2: 'no', p3: 'no', p4: 'no', p5: 'no', p6: 'no', p7: 'no', p8: 'no', a3: { h_edu: true }, profiling: 'yes' } }).fria);
});

test('every NIST AI RMF subcategory is evidenced by a control, and every reference is a real subcategory', async () => {
  const { NIST_SUBCATEGORIES, unmappedSubcategories, nistRefs, validNistRef, nistCoverage } = await import('../src/lib/nist');
  assert.equal(NIST_SUBCATEGORIES.length, 72);
  assert.deepEqual(unmappedSubcategories(), []);
  for (const c of CONTROLS) for (const r of nistRefs(c)) assert.ok(validNistRef(r), `${c.id}: ${r}`);
  const cov = nistCoverage({ profile: { role: ['provider'] }, cls: { ...noPro, a3: { h_credit: true }, profiling: 'yes' }, ctrl: { 'TEC-4': { s: 'met' } } });
  assert.equal(cov.rows.find(r => r.id === 'MEASURE 2.7')?.status, 'met');
  assert.equal(cov.rows.find(r => r.id === 'MEASURE 2.12')?.status, 'notApplicable');
  assert.equal(cov.byFn.reduce((a, f) => a + f.total, 0), 72);
});
