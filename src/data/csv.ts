/* CSV table storage.
 *
 * Each table is one CSV file in DATA_DIR (default ./data) with a header row.
 * - Reads are cached and re-read automatically when the file changes on disk
 *   (another process, a restore from backup, or a manual edit).
 * - Writes take a lock file, re-read the latest rows, apply the change, write a
 *   temporary file and rename it over the original, so a crash never leaves a
 *   half-written table and two processes never overwrite each other's changes.
 * - Text cells that a spreadsheet would treat as a formula (starting with = + - @)
 *   are stored with a leading apostrophe and restored on read.
 *
 * Suitable for one server process and modest volumes (hundreds of systems).
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

export type ColType = 'str' | 'str?' | 'int' | 'int?' | 'bool' | 'date' | 'date?' | 'json' | 'json?';
export type TableDef = { file: string; columns: Record<string, ColType> };
type Row = Record<string, unknown>;

const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

export const dataDir = () => path.resolve(process.env.DATA_DIR || 'data');

/* ---------- Cell encoding ---------- */
const FORMULA = /^[=+\-@\t\r]/;
export function escapeText(s: string) { return FORMULA.test(s) || s.startsWith("'") ? "'" + s : s; }
export function unescapeText(s: string) { return s.startsWith("'") ? s.slice(1) : s; }

function encode(type: ColType, v: unknown): string {
  if (v === null || v === undefined) return '';
  switch (type) {
    case 'str': case 'str?': return escapeText(String(v));
    case 'int': case 'int?': return String(Math.trunc(Number(v)));
    case 'bool': return v ? 'true' : 'false';
    case 'date': case 'date?': return (v instanceof Date ? v : new Date(String(v))).toISOString();
    case 'json': case 'json?': return escapeText(JSON.stringify(v));
  }
}

function decode(type: ColType, raw: string | undefined): unknown {
  const s = raw ?? '';
  switch (type) {
    case 'str': return unescapeText(s);
    case 'str?': return s === '' ? null : unescapeText(s);
    case 'int': return s === '' ? 0 : parseInt(s, 10);
    case 'int?': return s === '' ? null : parseInt(s, 10);
    case 'bool': return s === 'true';
    case 'date': return s === '' ? new Date(0) : new Date(s);
    case 'date?': return s === '' ? null : new Date(s);
    case 'json': case 'json?': return s === '' ? null : JSON.parse(unescapeText(s));
  }
}

/* ---------- Files ---------- */
type CacheEntry = { key: string; rows: Row[] };
const g = globalThis as unknown as { __csvCache?: Map<string, CacheEntry>; __csvQueues?: Map<string, Promise<unknown>> };
const cache = (g.__csvCache ??= new Map());
const queues = (g.__csvQueues ??= new Map());

const fileOf = (def: TableDef) => path.join(dataDir(), def.file);
const cacheId = (def: TableDef) => fileOf(def) + '|' + Object.keys(def.columns).join(',');
const statKey = (st: fs.Stats) => `${st.ino}:${st.size}:${st.mtimeMs}`;

/** Current rows of a table. Treat the result as read-only. */
export function readTable(def: TableDef): Row[] {
  const file = fileOf(def);
  let st: fs.Stats;
  const id = cacheId(def);
  try { st = fs.statSync(file); } catch { cache.delete(id); return []; }
  const key = statKey(st);
  const hit = cache.get(id);
  if (hit && hit.key === key) return hit.rows;
  const text = fs.readFileSync(file, 'utf8');
  const records = parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
  const rows = records.map(rec => {
    const row: Row = {};
    for (const [col, type] of Object.entries(def.columns)) row[col] = decode(type, rec[col]);
    return row;
  });
  cache.set(id, { key, rows });
  return rows;
}

function writeTable(def: TableDef, rows: Row[]) {
  const file = fileOf(def);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const cols = Object.keys(def.columns);
  const text = stringify(rows.map(r => cols.map(c => encode(def.columns[c], r[c]))), { header: true, columns: cols, bom: true, record_delimiter: 'windows' });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  cache.set(cacheId(def), { key: statKey(fs.statSync(file)), rows });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function acquireLock(lock: string) {
  const start = Date.now();
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS) fs.rmSync(lock, { force: true }); } catch {}
      if (Date.now() - start > LOCK_TIMEOUT_MS) throw new Error(`Timed out waiting to save ${path.basename(lock, '.lock')}. Try again.`);
      await sleep(10 + Math.random() * 30);
    }
  }
}

/** Runs a change against the latest rows under the table's lock and saves the result. */
/** Return rows: null from fn to leave the file untouched. */
export function mutateTable<R>(def: TableDef, fn: (rows: Row[]) => { rows: Row[] | null; result: R }): Promise<R> {
  const file = fileOf(def);
  const prev = queues.get(file) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => {
    const lock = file + '.lock';
    await acquireLock(lock);
    try {
      const current = readTable(def).map(r => ({ ...r }));
      const { rows, result } = fn(current);
      if (rows) { try { writeTable(def, rows); } catch (e) { cache.delete(cacheId(def)); throw e; } }
      return result;
    } finally {
      fs.rmSync(lock, { force: true });
    }
  });
  queues.set(file, run);
  return run;
}

/* ---------- Typed table API ---------- */
export type Table<T> = {
  all(): T[];
  find(pred: (r: T) => boolean): T[];
  first(pred: (r: T) => boolean): T | undefined;
  insert(row: Partial<T>): Promise<T>;
  insertMany(rows: Partial<T>[]): Promise<T[]>;
  update(pred: (r: T) => boolean, patch: Partial<T> | ((r: T) => Partial<T>)): Promise<T[]>;
  remove(pred: (r: T) => boolean): Promise<T[]>;
  /** Advanced: read-modify-write the whole table atomically. */
  mutate<R>(fn: (rows: T[]) => { rows: T[] | null; result: R }): Promise<R>;
};

export function table<T>(def: TableDef, defaults: () => Partial<T> = () => ({})): Table<T> {
  const all = () => readTable(def) as T[];
  const mutate = <R>(fn: (rows: T[]) => { rows: T[] | null; result: R }) => mutateTable(def, rows => fn(rows as T[]) as { rows: Row[] | null; result: R });
  return {
    all,
    find: pred => all().filter(pred),
    first: pred => all().find(pred),
    insert: row => mutate(rows => { const r = { ...defaults(), ...row } as T; return { rows: [...rows, r], result: r }; }),
    insertMany: list => mutate(rows => { const add = list.map(row => ({ ...defaults(), ...row }) as T); return { rows: [...rows, ...add], result: add }; }),
    update: (pred, patch) => mutate(rows => {
      const changed: T[] = [];
      const next = rows.map(r => {
        if (!pred(r)) return r;
        const u = { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } as T;
        changed.push(u);
        return u;
      });
      return { rows: changed.length ? next : null, result: changed };
    }),
    remove: pred => mutate(rows => {
      const gone = rows.filter(pred);
      return { rows: gone.length ? rows.filter(r => !pred(r)) : null, result: gone };
    }),
    mutate,
  };
}
