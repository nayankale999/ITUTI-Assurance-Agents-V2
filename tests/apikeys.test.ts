import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanKey, findKey } from '../src/lib/apikeys';

const K = 'ita_abcDEF123_-xyz';
const req = (h: Record<string, string>) => new Request('https://x.test/api/a2a', { method: 'POST', headers: h });

test('cleanKey strips schemes, quotes and spaces', () => {
  for (const v of [K, ` ${K} `, `Bearer ${K}`, `bearer  ${K}`, `Bearer Bearer ${K}`, `"${K}"`, `Bearer "${K}"`, `'Bearer ${K}'`, `Token ${K}`, `ApiKey: ${K}`])
    assert.equal(cleanKey(v), K, v);
  assert.equal(cleanKey(null), '');
});

test('findKey reads the usual headers and any custom header', () => {
  assert.deepEqual(findKey(req({ Authorization: `Bearer ${K}` })), { raw: K, header: 'authorization' });
  assert.deepEqual(findKey(req({ Authorization: `Bearer Bearer ${K}` })), { raw: K, header: 'authorization' });
  assert.deepEqual(findKey(req({ Authorization: K })), { raw: K, header: 'authorization' });
  assert.deepEqual(findKey(req({ 'x-api-key': K })), { raw: K, header: 'x-api-key' });
  assert.deepEqual(findKey(req({ LV_CKey: K })), { raw: K, header: 'lv_ckey' });
  assert.equal(findKey(req({ Authorization: 'Bearer eyJhbGciOi.notakey' })), null);
  assert.equal(findKey(req({})), null);
});
