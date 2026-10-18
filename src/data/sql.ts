/* MySQL / MariaDB table storage.
 *
 * Each table is described by its columns and how they are decoded (dates, booleans, JSON).
 * Reads take a filter object, translated to SQL:
 *   { orgId: 'x' }            orgId = 'x'
 *   { acceptedAt: null }      acceptedAt IS NULL
 *   { id: ['a', 'b'] }        id IN ('a', 'b')   (an empty list matches nothing)
 *   { status: { ne: 'closed' } }, { expiresAt: { gt: new Date() } }, { lt }, { gte }, { lte }
 * Writes that must read first run inside db.tx(), which uses SELECT ... FOR UPDATE.
 */
import { AsyncLocalStorage } from 'async_hooks';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

export type ColType = 'str' | 'str?' | 'int' | 'int?' | 'bool' | 'date' | 'date?' | 'json' | 'json?';
export type TableDef = { name: string; key: string[]; columns: Record<string, ColType> };
type Row = Record<string, unknown>;

type Op<V> = { ne: V | null } | { gt: V } | { lt: V } | { gte: V } | { lte: V };
export type Where<T> = { [K in keyof T]?: T[K] | null | T[K][] | Op<T[K]> };
export type Opts<T> = { orderBy?: [keyof T & string, 'asc' | 'desc'][]; limit?: number; offset?: number; forUpdate?: boolean; columns?: (keyof T & string)[] };

/* ---------- Connection ---------- */
type Exec = Pool | PoolConnection;
const g = globalThis as unknown as { __sqlPool?: Pool; __sqlReady?: Promise<void> | null };

// Node can resolve "localhost" to IPv6 (::1), which some database users are not granted; use IPv4.
const ipv4 = (h: string) => (h === 'localhost' ? '127.0.0.1' : h);

function config(): mysql.PoolOptions {
  const common = { waitForConnections: true, connectionLimit: 8, timezone: 'Z', charset: 'utf8mb4_unicode_ci', supportBigNumbers: true, dateStrings: false } as const;
  const url = process.env.DATABASE_URL;
  if (url && /^mysql|^mariadb/.test(url)) {
    const u = new URL(url.replace(/^mariadb:/, 'mysql:'));
    return { ...common, host: ipv4(u.hostname), port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, '') };
  }
  if (!process.env.DB_NAME) throw new Error('Database not configured: set DATABASE_URL, or DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD.');
  return { ...common, host: ipv4(process.env.DB_HOST || '127.0.0.1'), port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
}

export function pool(): Pool {
  return (g.__sqlPool ??= mysql.createPool(config()));
}

let readyHook: (() => Promise<void>) | null = null;
const booting = new AsyncLocalStorage<boolean>();
/** Registers the schema setup that must run once before the first query (see schema.ts). */
export function onFirstUse(fn: () => Promise<void>) { readyHook = fn; }
export async function ready() {
  if (!readyHook || booting.getStore()) return; // queries made by the setup itself run straight away
  if (!g.__sqlReady) g.__sqlReady = booting.run(true, readyHook).catch(e => { g.__sqlReady = null; throw e; });
  return g.__sqlReady;
}

/** Closes the pool (tests and scripts). */
export async function closePool() {
  if (g.__sqlPool) { await g.__sqlPool.end(); g.__sqlPool = undefined; g.__sqlReady = null; }
}

export async function query<T = RowDataPacket>(exec: Exec, sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await exec.query(sql, params);
  return rows as T[];
}
export async function run(exec: Exec, sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await exec.query(sql, params);
  return res as ResultSetHeader;
}

/* ---------- Encoding ---------- */
const q = (id: string) => '`' + id.replace(/`/g, '``') + '`';

function encode(type: ColType, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  switch (type) {
    case 'bool': return v ? 1 : 0;
    case 'date': case 'date?': return v instanceof Date ? v : new Date(String(v));
    case 'json': case 'json?': return JSON.stringify(v);
    case 'int': case 'int?': return Math.trunc(Number(v));
    default: return String(v);
  }
}

function decode(type: ColType, v: unknown): unknown {
  switch (type) {
    case 'str': return v == null ? '' : String(v);
    case 'str?': return v == null ? null : String(v);
    case 'int': return v == null ? 0 : Number(v);
    case 'int?': return v == null ? null : Number(v);
    case 'bool': return v === 1 || v === true || v === '1';
    case 'date': return v == null ? new Date(0) : v instanceof Date ? v : new Date(String(v));
    case 'date?': return v == null ? null : v instanceof Date ? v : new Date(String(v));
    case 'json': case 'json?': {
      if (v == null || v === '') return null;
      if (typeof v !== 'string' && !Buffer.isBuffer(v)) return v;
      return JSON.parse(String(v));
    }
  }
}

function whereSql(def: TableDef, where: Row | undefined): [string, unknown[]] {
  if (!where) return ['', []];
  const parts: string[] = [], params: unknown[] = [];
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    const type = def.columns[k];
    if (!type) throw new Error(`Unknown column ${def.name}.${k}`);
    const col = q(k);
    if (v === null) parts.push(`${col} IS NULL`);
    else if (Array.isArray(v)) {
      if (!v.length) { parts.push('1=0'); continue; }
      parts.push(`${col} IN (${v.map(() => '?').join(',')})`);
      params.push(...v.map(x => encode(type, x)));
    } else if (typeof v === 'object' && !(v instanceof Date)) {
      const [op, val] = Object.entries(v as Record<string, unknown>)[0];
      if (op === 'ne') {
        if (val === null) parts.push(`${col} IS NOT NULL`);
        else { parts.push(`(${col} IS NULL OR ${col} <> ?)`); params.push(encode(type, val)); }
      } else {
        const sym = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[op];
        if (!sym) throw new Error(`Unknown operator ${op}`);
        parts.push(`${col} ${sym} ?`); params.push(encode(type, val));
      }
    } else { parts.push(`${col} = ?`); params.push(encode(type, v)); }
  }
  return [parts.length ? ' WHERE ' + parts.join(' AND ') : '', params];
}

/* ---------- Typed table API ---------- */
export type Table<T> = {
  def: TableDef;
  all(opts?: Opts<T>): Promise<T[]>;
  find(where?: Where<T>, opts?: Opts<T>): Promise<T[]>;
  first(where: Where<T>, opts?: Opts<T>): Promise<T | undefined>;
  count(where?: Where<T>): Promise<number>;
  insert(row: Partial<T>): Promise<T>;
  insertMany(rows: Partial<T>[]): Promise<T[]>;
  /** Updates matching rows with a patch, or with a function of each row (the function form runs in a transaction). Returns the updated rows. */
  update(where: Where<T>, patch: Partial<T> | ((r: T) => Partial<T>)): Promise<T[]>;
  /** Deletes matching rows and returns them. */
  remove(where: Where<T>): Promise<T[]>;
};

export function makeTable<T>(def: TableDef, defaults: () => Partial<T>, exec: () => Exec, inTx: (fn: (e: Exec) => Promise<unknown>) => Promise<unknown>): Table<T> {
  const cols = Object.keys(def.columns);
  const decodeRow = (r: Row) => { const o: Row = {}; for (const c of cols) if (c in r) o[c] = decode(def.columns[c], r[c]); return o as T; };
  const keyWhere = (r: T) => Object.fromEntries(def.key.map(k => [k, (r as Row)[k]])) as Where<T>;

  async function select(e: Exec, where?: Where<T>, opts: Opts<T> = {}) {
    await ready();
    const [w, params] = whereSql(def, where as Row);
    const list = opts.columns ? opts.columns.map(q).join(',') : '*';
    let sql = `SELECT ${list} FROM ${q(def.name)}${w}`;
    if (opts.orderBy?.length) sql += ' ORDER BY ' + opts.orderBy.map(([c, d]) => `${q(c)} ${d === 'desc' ? 'DESC' : 'ASC'}`).join(', ');
    if (opts.limit != null) sql += ` LIMIT ${Math.trunc(opts.limit)}` + (opts.offset ? ` OFFSET ${Math.trunc(opts.offset)}` : '');
    if (opts.forUpdate) sql += ' FOR UPDATE';
    return (await query<Row>(e, sql, params)).map(decodeRow);
  }

  async function insertRows(e: Exec, rows: Partial<T>[]) {
    await ready();
    if (!rows.length) return [] as T[];
    const full = rows.map(r => ({ ...defaults(), ...r }) as T);
    const sql = `INSERT INTO ${q(def.name)} (${cols.map(q).join(',')}) VALUES ` + full.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
    await run(e, sql, full.flatMap(r => cols.map(c => encode(def.columns[c], (r as Row)[c]))));
    return full;
  }

  async function patchWhere(e: Exec, where: Where<T>, patch: Partial<T>) {
    const keys = Object.keys(patch).filter(k => (patch as Row)[k] !== undefined);
    if (!keys.length) return;
    for (const k of keys) if (!def.columns[k]) throw new Error(`Unknown column ${def.name}.${k}`);
    const [w, params] = whereSql(def, where as Row);
    await run(e, `UPDATE ${q(def.name)} SET ${keys.map(k => `${q(k)} = ?`).join(', ')}${w}`, [...keys.map(k => encode(def.columns[k], (patch as Row)[k])), ...params]);
  }

  return {
    def,
    all: opts => select(exec(), undefined, opts),
    find: (where, opts) => select(exec(), where, opts),
    first: async (where, opts) => (await select(exec(), where, { ...opts, limit: 1 }))[0],
    count: async where => {
      await ready();
      const [w, params] = whereSql(def, where as Row);
      const [r] = await query<{ n: number }>(exec(), `SELECT COUNT(*) AS n FROM ${q(def.name)}${w}`, params);
      return Number(r.n);
    },
    insert: async row => (await insertRows(exec(), [row]))[0],
    insertMany: rows => insertRows(exec(), rows),
    update: (where, patch) => inTx(async e => {
      const rows = await select(e, where, { forUpdate: true });
      if (!rows.length) return [];
      if (typeof patch !== 'function') {
        await patchWhere(e, where, patch);
        return rows.map(r => ({ ...r, ...patch }));
      }
      const out: T[] = [];
      for (const r of rows) {
        const p = patch(r);
        await patchWhere(e, keyWhere(r), p);
        out.push({ ...r, ...p });
      }
      return out;
    }) as Promise<T[]>,
    remove: where => inTx(async e => {
      const rows = await select(e, where, { forUpdate: true });
      if (!rows.length) return [];
      const [w, params] = whereSql(def, where as Row);
      await run(e, `DELETE FROM ${q(def.name)}${w}`, params);
      return rows;
    }) as Promise<T[]>,
  };
}

/** Runs fn in a transaction on one connection; nested calls reuse it. Retries once on deadlock. */
export async function transaction<R>(fn: (conn: PoolConnection) => Promise<R>): Promise<R> {
  await ready();
  for (let attempt = 0; ; attempt++) {
    const conn = await pool().getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => {});
      const code = (e as { code?: string }).code;
      if (attempt === 0 && (code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT')) continue;
      throw e;
    } finally {
      conn.release();
    }
  }
}
