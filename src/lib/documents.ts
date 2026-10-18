/* Evidence documents: storage, text extraction and search.
 * Files are kept under DATA_DIR/documents/<systemId>/<documentId>. Their text is split into chunks
 * with a locator (page, sheet rows or section) so the agent can cite exactly where a fact came from. */
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { db, type DocumentRow, type ChunkRow } from '@/data';
import { query, pool } from '@/data/sql';

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_DOCS_PER_SYSTEM = 40;
const MAX_CHARS = 1_500_000; // per document; the rest is ignored and the document is marked as truncated
const CHUNK = 3500;

export const ACCEPT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
};
export const ACCEPT_LIST = Object.keys(ACCEPT).map(e => '.' + e).join(',');

const dataDir = () => path.resolve(process.env.DATA_DIR || 'data');
const fileFor = (systemId: string, id: string) => path.join(dataDir(), 'documents', systemId, id);
const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '');

export type Piece = { locator: string; text: string };

const clean = (s: string) => s.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Splits long text into chunks of about CHUNK characters on paragraph boundaries. */
function split(text: string, label: (i: number, n: number) => string): Piece[] {
  const paras = clean(text).split(/\n\s*\n/);
  const parts: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > CHUNK) { parts.push(cur); cur = ''; }
    if (p.length > CHUNK) { for (let i = 0; i < p.length; i += CHUNK) parts.push(p.slice(i, i + CHUNK)); continue; }
    cur = cur ? cur + '\n\n' + p : p;
  }
  if (cur) parts.push(cur);
  return parts.map((t, i) => ({ locator: label(i + 1, parts.length), text: t }));
}

export async function extract(buf: Buffer, name: string): Promise<{ pieces: Piece[]; pages: number }> {
  const e = ext(name);
  if (e === 'pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text, totalPages } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).flatMap((t, i) => {
      const c = clean(t);
      if (!c) return [];
      return c.length <= CHUNK ? [{ locator: `p. ${i + 1}`, text: c }] : split(c, (j, n) => `p. ${i + 1} (part ${j} of ${n})`);
    });
    return { pieces: pages, pages: totalPages };
  }
  if (e === 'docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { pieces: split(value, (i, n) => `section ${i} of ${n}`), pages: 0 };
  }
  if (e === 'xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const pieces: Piece[] = [];
    wb.eachSheet(ws => {
      const rows: { n: number; line: string }[] = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        const vals = (row.values as unknown[]).slice(1).map(v => {
          if (v == null) return '';
          if (typeof v === 'object') {
            const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
            if (o.richText) return o.richText.map(r => r.text).join('');
            if (o.text) return o.text;
            if (o.result !== undefined) return String(o.result);
            if (v instanceof Date) return v.toISOString().slice(0, 10);
          }
          return String(v);
        });
        rows.push({ n, line: vals.join(' | ') });
      });
      for (let i = 0; i < rows.length; i += 60) {
        const block = rows.slice(i, i + 60);
        pieces.push({ locator: `sheet "${ws.name}", rows ${block[0].n}–${block[block.length - 1].n}`, text: block.map(r => r.line).join('\n') });
      }
    });
    return { pieces, pages: 0 };
  }
  if (['csv', 'txt', 'md', 'json', 'html', 'htm'].includes(e)) {
    let text = buf.toString('utf8');
    if (e === 'html' || e === 'htm') text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    if (e === 'csv') {
      const lines = text.split(/\r?\n/).filter(Boolean);
      const pieces: Piece[] = [];
      for (let i = 0; i < lines.length; i += 60) pieces.push({ locator: `rows ${i + 1}–${Math.min(i + 60, lines.length)}`, text: (i ? lines[0] + '\n' : '') + lines.slice(i, i + 60).join('\n') });
      return { pieces, pages: 0 };
    }
    return { pieces: split(text, (i, n) => `section ${i} of ${n}`), pages: 0 };
  }
  throw new Error(`Files of type .${e || '?'} are not supported. Use PDF, Word (.docx), Excel (.xlsx), CSV, text, Markdown, JSON or HTML.`);
}

/** Stores an uploaded file and its extracted text. Extraction failures are kept as a failed document with the reason. */
export async function addDocument(opts: { orgId: string; systemId: string; name: string; buf: Buffer; userId: string | null }): Promise<DocumentRow> {
  const name = path.basename(opts.name).slice(0, 200) || 'document';
  const e = ext(name);
  if (!ACCEPT[e]) throw new Error(`Files of type .${e || '?'} are not supported.`);
  if (opts.buf.length > MAX_BYTES) throw new Error('Files must be 25 MB or smaller.');
  if ((await db.documents.count({ systemId: opts.systemId })) >= MAX_DOCS_PER_SYSTEM) throw new Error(`A system can hold up to ${MAX_DOCS_PER_SYSTEM} documents. Remove one first.`);
  const sha256 = createHash('sha256').update(opts.buf).digest('hex');
  const dup = await db.documents.first({ systemId: opts.systemId, sha256 });
  if (dup) throw new Error(`This file is already uploaded as “${dup.name}”.`);

  const doc = await db.documents.insert({ orgId: opts.orgId, systemId: opts.systemId, name, mime: ACCEPT[e], size: opts.buf.length, sha256, uploadedById: opts.userId, status: 'ready' });
  const file = fileFor(opts.systemId, doc.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, opts.buf);
  try {
    const { pieces, pages } = await extract(opts.buf, name);
    let total = 0;
    const kept: Piece[] = [];
    for (const p of pieces) { if (total + p.text.length > MAX_CHARS) break; kept.push(p); total += p.text.length; }
    if (!kept.length) throw new Error('No readable text was found. If this is a scanned PDF, upload a text-based copy.');
    const rows = kept.map((p, i) => ({ documentId: doc.id, systemId: opts.systemId, seq: i, locator: p.locator, text: p.text }));
    for (let i = 0; i < rows.length; i += 100) await db.chunks.insertMany(rows.slice(i, i + 100));
    const truncated = kept.length < pieces.length;
    const patch = { pages, chars: total, error: truncated ? 'Only the first 1.5 million characters were read.' : null };
    await db.documents.update({ id: doc.id }, patch);
    return { ...doc, ...patch };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not read this file.';
    await db.documents.update({ id: doc.id }, { status: 'failed', error: msg.slice(0, 500) });
    return { ...doc, status: 'failed', error: msg };
  }
}

export async function removeDocument(id: string) {
  const doc = await db.documents.first({ id });
  if (!doc) return null;
  await db.tx(async t => { await t.chunks.remove({ documentId: id }); await t.documents.remove({ id }); });
  await fs.rm(fileFor(doc.systemId, id), { force: true });
  return doc;
}

export async function removeStoredFiles(systemIds: string[]) {
  for (const s of systemIds) await fs.rm(path.join(dataDir(), 'documents', s), { recursive: true, force: true });
}

export async function readStoredFile(doc: DocumentRow) {
  return fs.readFile(fileFor(doc.systemId, doc.id));
}

export type Hit = { documentId: string; document: string; seq: number; locator: string; text: string };

/** Full-text search over a system's documents, best matches first. Falls back to keyword matching for short or unusual terms. */
export async function searchDocuments(systemId: string, q: string, limit = 6): Promise<Hit[]> {
  const terms = q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\-_.]{1,}/gu) || [];
  if (!terms.length) return [];
  const names = new Map((await db.documents.find({ systemId, status: 'ready' }, { columns: ['id', 'name'] })).map(d => [d.id, d.name]));
  let rows = await query<ChunkRow & { score: number }>(pool(),
    'SELECT id, documentId, seq, locator, text, MATCH(text) AGAINST (?) AS score FROM document_chunks WHERE systemId = ? AND MATCH(text) AGAINST (?) ORDER BY score DESC LIMIT ?',
    [q, systemId, q, limit]);
  if (!rows.length) {
    const like = terms.slice(0, 6).map(() => 'LOWER(text) LIKE ?').join(' OR ');
    rows = await query<ChunkRow & { score: number }>(pool(), `SELECT id, documentId, seq, locator, text, 0 AS score FROM document_chunks WHERE systemId = ? AND (${like}) LIMIT ?`,
      [systemId, ...terms.slice(0, 6).map(t => `%${t}%`), limit]);
  }
  return rows.filter(r => names.has(r.documentId)).map(r => ({ documentId: r.documentId, document: names.get(r.documentId)!, seq: Number(r.seq), locator: r.locator, text: r.text }));
}

/** Reads consecutive chunks of one document, starting from a locator or the beginning. */
export async function readDocument(systemId: string, documentId: string, fromSeq = 0, maxChars = 12000) {
  const doc = await db.documents.first({ id: documentId, systemId });
  if (!doc) return null;
  const chunks = await db.chunks.find({ documentId, seq: { gte: fromSeq } }, { orderBy: [['seq', 'asc']], limit: 12 });
  const out: ChunkRow[] = [];
  let n = 0;
  for (const c of chunks) { if (out.length && n + c.text.length > maxChars) break; out.push(c); n += c.text.length; }
  const total = await db.chunks.count({ documentId });
  const after = out.length ? out[out.length - 1].seq + 1 : total;
  return { doc, chunks: out, next: after < total ? after : null, total };
}
