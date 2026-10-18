import { notFound } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireViewer, systemAccess } from '@/lib/session';
import { SystemEditor } from '@/components/editor/SystemEditor';
import type { AssessmentData } from '@/lib/assurance';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await db.query.aiSystems.findFirst({ where: eq(schema.aiSystems.id, id), columns: { name: true } });
  return { title: s?.name || 'AI system' };
}

export default async function SystemPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const viewer = await requireViewer();
  const a = await systemAccess(viewer, id);
  if (!a || a.org.slug !== slug) notFound();
  const incidents = await db.query.incidents.findMany({ where: eq(schema.incidents.systemId, id), orderBy: desc(schema.incidents.date) });
  return (
    <SystemEditor
      key={a.system.id}
      org={{ slug: a.org.slug, name: a.org.name }}
      system={{ id: a.system.id, data: a.system.data as AssessmentData, version: a.system.version }}
      canEdit={a.canEdit}
      canDelete={a.caps.deleteSystems}
      aiEnabled={!!process.env.ANTHROPIC_API_KEY}
      incidents={incidents.map(i => ({ id: i.id, title: i.title, date: i.date, severity: i.severity, category: i.category, status: i.status, serious: i.serious, notes: i.notes }))}
    />
  );
}
