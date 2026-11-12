import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemLimits, cleanSource, limitText, limitReached } from '../src/lib/subscription';

test('tier limits default to 2 for Free, 10 for Standard and none for Enterprise', () => {
  assert.deepEqual(systemLimits(''), { free: 2, standard: 10, enterprise: null });
});

test('SYSTEM_LIMITS overrides tiers it names and ignores anything it does not understand', () => {
  assert.deepEqual(systemLimits('free=3, standard=unlimited'), { free: 3, standard: null, enterprise: null });
  assert.deepEqual(systemLimits('enterprise=50,gold=9,free=lots,standard='), { free: 2, standard: 10, enterprise: 50 });
});

test('limit messages name the tier and the number', () => {
  assert.equal(limitText('free'), 'up to 2 AI systems');
  assert.equal(limitText('enterprise'), 'unlimited AI systems');
  assert.match(limitReached('free'), /Free plan includes up to 2 AI systems/);
});

test('sign-up sources are short slugs; anything else is dropped', () => {
  assert.equal(cleanSource('FinTech-Connect'), 'fintech-connect');
  assert.equal(cleanSource(' qr2026 '), 'qr2026');
  for (const bad of ['', null, undefined, '-x', 'a b', '<script>', 'x'.repeat(41)]) assert.equal(cleanSource(bad), null);
});
