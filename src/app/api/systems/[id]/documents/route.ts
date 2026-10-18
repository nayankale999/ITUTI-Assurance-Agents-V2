import { db } from '@/data';
import { apiViewer, loadSystem, json, err, sameOrigin } from '@/lib/api';
import { addDocument, MAX_BYTES } from '@/lib/documents';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

const view = (d: Awaited<ReturnType<typeof db.documents.find>>[number]) => ({ id: d.id, name: d.name, size: d.size, pages: d.pages, chars: d.chars, status: d.status, error: d.error, createdAt: d.createdAt });

export async function GET(_: Request, { params }: Ctx) {
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  return json({ documents: (await db.documents.find({ systemId: id }, { orderBy: [['createdAt', 'asc']] })).map(view) });
}

/** Uploads one or more files as multipart form data (field "file"). */
export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOrigin(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You cannot add documents to this system.');
  if (Number(req.headers.get('content-length') || 0) > MAX_BYTES * 4 + 100_000) return err(413, 'Upload at most four files of 25 MB at a time.');
  let form: FormData;
  try { form = await req.formData(); } catch { return err(400, 'Send the files as a multipart form.'); }
  const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && 'arrayBuffer' in f).slice(0, 4);
  if (!files.length) return err(400, 'Choose a file to upload.');
  const added = [], errors: string[] = [];
  for (const f of files) {
    try {
      if (f.size > MAX_BYTES) throw new Error('Files must be 25 MB or smaller.');
      const doc = await addDocument({ orgId: a.system.orgId, systemId: id, name: f.name, buf: Buffer.from(await f.arrayBuffer()), userId: v.id });
      added.push(view(doc));
    } catch (e) { errors.push(`${f.name}: ${e instanceof Error ? e.message : 'upload failed'}`); }
  }
  if (added.length) await audit({ orgId: a.system.orgId, systemId: id, userId: v.id, action: 'document.added', detail: { names: added.map(d => d.name) } });
  return json({ documents: added, errors }, added.length ? 201 : 400);
}
