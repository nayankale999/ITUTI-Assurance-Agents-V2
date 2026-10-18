import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { table, escapeText, unescapeText } from '../src/data/csv';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csvtest-'));
process.env.DATA_DIR = dir;

// DATA_DIR is read when a table is first used, so setting it here is enough

type R = { id: string; text: string; n: number | null; ok: boolean; at: Date | null; data: unknown };
const t = table<R>({ file: 'things.csv', columns: { id: 'str', text: 'str', n: 'int?', ok: 'bool', at: 'date?', data: 'json?' } });

before(() => { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); });

test('round-trips awkward text, numbers, dates and JSON', async () => {
  const awkward = 'Line one, with "quotes"\nline two – éè ✓';
  const data = { nested: { list: [1, 'two', null], text: 'a,"b"\nc' } };
  await t.insert({ id: 'a', text: awkward, n: -42, ok: true, at: new Date('2026-10-18T10:00:00Z'), data });
  await t.insert({ id: 'b', text: '', n: null, ok: false, at: null, data: null });
  // Force a re-read from disk
  const file = path.join(dir, 'things.csv');
  const later = new Date(Date.now() + 2000); fs.utimesSync(file, later, later);
  const [a, b] = t.all();
  assert.equal(a.text, awkward);
  assert.equal(a.n, -42);
  assert.equal(a.ok, true);
  assert.equal(a.at?.toISOString(), '2026-10-18T10:00:00.000Z');
  assert.deepEqual(a.data, data);
  assert.equal(b.text, '');
  assert.equal(b.n, null);
  assert.equal(b.at, null);
  assert.equal(b.data, null);
});

test('formula-like text is neutralised in the file and restored on read', async () => {
  for (const v of ['=HYPERLINK("x")', '+1', '-2', '@SUM(A1)', "'already quoted", 'plain']) assert.equal(unescapeText(escapeText(v)), v);
  await t.insert({ id: 'f', text: '=1+1', n: 0, ok: true, at: null, data: null });
  const raw = fs.readFileSync(path.join(dir, 'things.csv'), 'utf8');
  assert.ok(raw.includes("'=1+1") && !/(^|,)=1\+1/m.test(raw));
  assert.equal(t.first(r => r.id === 'f')!.text, '=1+1');
});

test('the file opens in a spreadsheet: header row, UTF-8 BOM, CRLF', () => {
  const raw = fs.readFileSync(path.join(dir, 'things.csv'), 'utf8');
  assert.ok(raw.startsWith('﻿id,text,n,ok,at,data\r\n'));
});

test('update and remove change only matching rows, and no-ops do not rewrite the file', async () => {
  const file = path.join(dir, 'things.csv');
  await t.update(r => r.id === 'b', { text: 'changed' });
  assert.equal(t.first(r => r.id === 'b')!.text, 'changed');
  const before = fs.statSync(file).mtimeMs;
  assert.deepEqual(await t.update(r => r.id === 'zzz', { text: 'x' }), []);
  assert.deepEqual(await t.remove(r => r.id === 'zzz'), []);
  assert.equal(fs.statSync(file).mtimeMs, before);
  await t.remove(r => r.id === 'f');
  assert.equal(t.first(r => r.id === 'f'), undefined);
});

test('picks up edits made by another program', () => {
  const file = path.join(dir, 'things.csv');
  const raw = fs.readFileSync(file, 'utf8').replace('changed', 'edited outside');
  fs.writeFileSync(file, raw);
  assert.equal(t.first(r => r.id === 'b')!.text, 'edited outside');
});

test('a column added later reads as empty for old rows', () => {
  const t2 = table<R & { extra: string | null }>({ file: 'things.csv', columns: { id: 'str', text: 'str', n: 'int?', ok: 'bool', at: 'date?', data: 'json?', extra: 'str?' } });
  assert.equal(t2.first(r => r.id === 'a')!.extra, null);
});

test('concurrent writes in one process are all kept', async () => {
  const c = table<{ id: string }>({ file: 'burst.csv', columns: { id: 'str' } });
  await Promise.all(Array.from({ length: 60 }, (_, i) => c.insert({ id: String(i) })));
  assert.equal(c.all().length, 60);
});

test('concurrent writes from three processes are all kept', async () => {
  const run = (w: string) => new Promise<number>((res, rej) => {
    const p = spawn(process.execPath, ['--import', 'tsx', 'tests/helpers/insert-worker.ts', w, '40'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'inherit' });
    p.on('exit', code => (code === 0 ? res(0) : rej(new Error(`worker ${w} exited ${code}`))));
  });
  await Promise.all([run('a'), run('b'), run('c')]);
  const race = table<{ id: string; worker: string; n: number }>({ file: 'race.csv', columns: { id: 'str', worker: 'str', n: 'int' } });
  const rows = race.all();
  assert.equal(rows.length, 120);
  assert.equal(new Set(rows.map(r => r.id)).size, 120);
  assert.equal(fs.readdirSync(dir).filter(f => f.endsWith('.lock') || f.endsWith('.tmp')).length, 0);
});
