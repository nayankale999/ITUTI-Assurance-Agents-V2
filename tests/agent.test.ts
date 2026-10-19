import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateValue, applyValue, currentValue, describeForAgent, displayValue, fieldCatalogue } from '../src/lib/agent/fields';
import { parseDossier, modelKey } from '../src/lib/agent/models';
import { assessmentSchema } from '../src/lib/validate';
import type { AssessmentData } from '../src/lib/assurance';

const base: AssessmentData = { profile: { name: 'Loan scoring', regions: ['eu'] }, cls: { a3: {}, t: {} }, ctrl: {}, card: {}, metrics: [] };

test('every catalogue path is unique and covers all 39 controls', () => {
  const paths = fieldCatalogue().map(f => f.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths.filter(p => p.startsWith('ctrl.')).length, 39);
});

test('values are validated against the field type', () => {
  assert.equal(validateValue('profile.sector', 'bank').ok, true);
  assert.equal(validateValue('profile.sector', 'spaceships').ok, false);
  assert.deepEqual(validateValue('profile.regions', ['eu', 'uk', 'eu']), { ok: true, value: ['eu', 'uk'] });
  assert.equal(validateValue('cls.p3', 'unsure').ok, true);
  assert.equal(validateValue('cls.annex1', 'unsure').ok, false);
  assert.equal(validateValue('cls.a3.h_credit', 'yes').ok, false);
  assert.equal(validateValue('cls.a3.h_credit', true).ok, true);
  assert.equal(validateValue('ctrl.GOV-1', { s: 'met' }).ok, false); // evidence note required
  assert.equal(validateValue('ctrl.GOV-1', { s: 'done', e: 'A policy approved in May.' }).ok, false);
  assert.equal(validateValue('ctrl.NOPE-1', { s: 'met', e: 'Something long enough.' }).ok, false);
  assert.equal(validateValue('profile.hack', 'x').ok, false);
  assert.equal(validateValue('__proto__.x', 'x').ok, false);
});

test('applied values land where the editor reads them, and pass the save schema', () => {
  let d = applyValue(base, 'profile.sector', 'bank');
  d = applyValue(d, 'cls.a3.h_credit', true);
  d = applyValue(d, 'cls.t.t1', true);
  d = applyValue(d, 'cls.profiling', 'yes');
  d = applyValue(d, 'ctrl.TEC-2', { s: 'met', e: 'Independent validation by second line, August 2026.' });
  d = applyValue(d, 'card.limitations', 'Not for final decisions.');
  const m = validateValue('metric.Gini', { kind: 'Performance', threshold: 0.55, dir: 'above', readings: [{ d: '2026-09-01', v: 0.6 }, { d: 'bad', v: 1 }] });
  assert.ok(m.ok);
  d = applyValue(d, 'metric.Gini', m.ok && m.value);
  d = applyValue(d, 'metric.Gini', { kind: 'Performance', threshold: '0.55', dir: 'above', readings: [{ d: '2026-10-01', v: 0.58 }] });
  assert.equal(d.profile!.sector, 'bank');
  assert.equal(d.cls!.a3.h_credit, true);
  assert.equal(d.ctrl!['TEC-2'].s, 'met');
  assert.equal(d.metrics!.length, 1);
  assert.deepEqual(d.metrics![0].readings!.map(r => r.d), ['2026-09-01', '2026-10-01']);
  assert.equal(base.profile!.sector, undefined); // the original is untouched
  assert.equal(assessmentSchema.safeParse({ ...d, prov: { 'profile.sector': { p: 'x', at: new Date().toISOString(), u: 'u', v: '"bank"' } } }).success, true);
  assert.equal(currentValue(d, 'ctrl.TEC-2') !== undefined, true);
  assert.equal(currentValue(d, 'ctrl.GOV-1'), undefined);
  assert.equal(currentValue(d, 'cls.a3.h_ins'), undefined);
  assert.match(displayValue('profile.sector', 'bank'), /Banking/);
  assert.match(displayValue('ctrl.TEC-2', d.ctrl!['TEC-2']), /^Met: /);
});

test('the field listing for the agent shows options, applicability and current values', () => {
  const text = describeForAgent(applyValue(base, 'profile.sector', 'bank'));
  assert.match(text, /profile\.sector .*options: bank=Banking and lending/);
  assert.match(text, /current: "bank"/);
  assert.match(text, /ctrl\.GOV-1 \[applies\]/);
  assert.match(text, /ctrl\.CNF-1 \[does not apply yet\]/);
});

test('research replies are split into sections with their cited pages', () => {
  const content = [
    { type: 'text', text: 'Here is what I found.\n### identity\nExample Model 1 by Example AI.\n### limitations\n' },
    { type: 'text', text: 'It can state falsehoods.', citations: [{ type: 'web_search_result_location', url: 'https://example.ai/card', title: 'Model card', encrypted_index: 'x', cited_text: 'can state falsehoods' }] },
    { type: 'web_fetch_tool_result', tool_use_id: 't', content: { type: 'web_fetch_result', url: 'https://example.ai/policy', retrieved_at: '', content: { type: 'document', title: 'Usage policy', source: { type: 'text', media_type: 'text/plain', data: '' } } } },
    { type: 'text', text: '\n### restrictions\nNo use for weapons.', citations: [{ type: 'char_location', document_title: 'Usage policy', cited_text: 'No use for weapons', start_char_index: 0, end_char_index: 1, document_index: 0 }] },
  ] as never;
  const { dossier, sources } = parseDossier(content);
  assert.equal(dossier.identity, 'Example Model 1 by Example AI.');
  assert.equal(dossier.limitations, 'It can state falsehoods.');
  assert.equal(dossier.trainingData, 'Not found.');
  assert.deepEqual(sources.map(s => [s.ref, s.url]), [['limitations', 'https://example.ai/card'], ['restrictions', 'https://example.ai/policy']]);
  assert.equal(modelKey('Anthropic', 'Claude Sonnet 5.5'), 'anthropic/claude-sonnet-5.5');
});

test('foundation models are recognised from the vendor field, including a bare provider name', async () => {
  const { detectModels } = await import('../src/lib/agent/detect');
  assert.deepEqual(detectModels('Anthropic'), [{ provider: 'Anthropic', model: 'Claude (latest generally available model)', specific: false }]);
  const sonnet = detectModels('Anthropic Claude Sonnet 5.5 via the Anthropic API (CV summarisation); in-house ranking model');
  assert.equal(sonnet[0].provider, 'Anthropic');
  assert.equal(sonnet[0].model, 'Claude Sonnet 5.5');
  assert.equal(sonnet[0].specific, true);
  assert.equal(detectModels('We use Claude Opus')[0].model, 'Claude Opus (latest generally available version)');
  assert.equal(detectModels('OpenAI GPT-5 through Azure')[0].provider, 'OpenAI');
  assert.equal(detectModels('IBM watsonx with Granite 3.3')[0].model, 'Granite 3.3');
  assert.deepEqual(detectModels('Built in-house with XGBoost'), []);
});
