import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, priceFor } from '../src/lib/agent/pricing';
import { SPECIALISTS, specialist, inRemit, orchestrateIds, modelFor } from '../src/lib/agent/specialists';
import { describeForAgent } from '../src/lib/agent/fields';

test('cost estimates use list prices per million tokens, including cache reads and writes', () => {
  assert.equal(costOf('claude-opus-5-5', { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }), 4 + 20 + 0.2 + 5);
  assert.deepEqual(priceFor('claude-opus-5-5-20260901'), priceFor('claude-opus-5-5'));
  assert.equal(costOf('some-unknown-model', { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }), 0);
});

test('every field section has exactly one specialist', () => {
  for (const path of ['profile.owner', 'cls.p1', 'ctrl.GOV-1', 'card.limitations', 'metric.Gini', 'conf.P1']) {
    assert.equal(SPECIALISTS.filter(s => inRemit(s, path)).length, 1, path);
  }
  assert.equal(specialist('controls-assessor')?.key, 'controls');
  assert.equal(new Set(SPECIALISTS.map(s => s.slug)).size, SPECIALISTS.length);
});

test('Orchestrate agent IDs and per-specialist models come from settings', () => {
  process.env.ORCHESTRATE_AGENT_IDS = 'coordinator=a1, evidence-reader=b2,controls=c3';
  assert.deepEqual(orchestrateIds(), { coordinator: 'a1', reader: 'b2', controls: 'c3' });
  process.env.ORCHESTRATE_AGENT_IDS = '{"docs":"d4"}';
  assert.deepEqual(orchestrateIds(), { docs: 'd4' });
  delete process.env.ORCHESTRATE_AGENT_IDS;
  process.env.ANTHROPIC_MODEL_READER = 'claude-sonnet-5-5';
  assert.equal(modelFor('reader', 'claude-opus-5-5'), 'claude-sonnet-5-5');
  assert.equal(modelFor('controls', 'claude-opus-5-5'), 'claude-opus-5-5');
  delete process.env.ANTHROPIC_MODEL_READER;
});

test('each specialist is given only its own fields', () => {
  const text = describeForAgent({ profile: { name: 'X' } }, ['ctrl']);
  assert.ok(text.includes('ctrl.GOV-1') && !text.includes('profile.owner') && !text.includes('conf.P1') && !text.includes('metric.'));
  assert.ok(describeForAgent({}, ['card', 'metric']).includes('Monitoring metrics'));
});
