import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { readStoredFile, removeDocument } from '@/lib/documents';
import { audit } from '@/lib/audit';
import { validKinds, EVIDENCE_TYPES } from '@/lib/evidence';

type Ctx = { params: Promise<{ id: string }> };

/** Downloads the original file. */
export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const doc = await db.documents.first({ id }); if (!doc) return err(404, 'Not found.');
  const a = await loadSystem(v, doc.systemId); if (!a) return err(404, 'Not found.');
  const buf = await readStoredFile(doc).catch(() => null);
  if (!buf) return err(404, 'The file is missing from storage.');
  return new Response(new Uint8Array(buf), { headers: {
    'Content-Type': doc.mime, 'Content-Length': String(buf.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
  } });
}

/** Corrects which evidence types a document provides: { kinds: string[] }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const doc = await db.documents.first({ id }); if (!doc) return err(404, 'Not found.');
  const a = await loadSystem(v, doc.systemId); if (!a) return err(404, 'Not found.');
  if (!a.canEdit && !a.scopes?.includes('evidence')) return err(403, 'You cannot change this document.');
  const body = await req.json().catch(() => null) as { kinds?: unknown } | null;
  const kinds = validKinds(body?.kinds);
  if (!kinds) return err(400, `kinds must be a list of: ${EVIDENCE_TYPES.map(t => t.id).join(', ')}.`);
  await db.documents.update({ id }, { kinds });
  await audit({ orgId: doc.orgId, systemId: doc.systemId, userId: v.id, action: 'document.kinds', detail: { name: doc.name, kinds } });
  return json({ ok: true, kinds });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const doc = await db.documents.first({ id }); if (!doc) return err(404, 'Not found.');
  const a = await loadSystem(v, doc.systemId); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You cannot remove documents from this system.');
  await removeDocument(id);
  await audit({ orgId: doc.orgId, systemId: doc.systemId, userId: v.id, action: 'document.removed', detail: { name: doc.name } });
  return json({ ok: true });
}
