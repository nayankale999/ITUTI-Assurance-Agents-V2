import { notFound } from 'next/navigation';
import { db } from '@/data';
import { requireViewer, systemAccess } from '@/lib/session';
import { SystemEditor } from '@/components/editor/SystemEditor';
import type { AssessmentData } from '@/lib/assurance';
import { aiBlocked } from '@/lib/agent/access';
import { ACCEPT_LIST } from '@/lib/documents';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await db.aiSystems.first({ id });
  return { title: s?.name || 'AI system' };
}

export default async function SystemPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ tab?: string; task?: string }> }) {
  const { slug, id } = await params;
  const { tab, task } = await searchParams;
  const viewer = await requireViewer();
  const a = await systemAccess(viewer, id);
  if (!a || a.org.slug !== slug) notFound();
  const incidents = await db.incidents.find({ systemId: id, kind: 'incident' }, { orderBy: [['date', 'desc'], ['createdAt', 'desc']] });
  return (
    <SystemEditor
      key={a.system.id}
      org={{ slug: a.org.slug, name: a.org.name }}
      system={{ id: a.system.id, data: a.system.data as AssessmentData, version: a.system.version }}
      canEdit={a.canEdit}
      canDelete={a.caps.deleteSystems}
      aiEnabled={!aiBlocked(a.org)}
      aiBlockedReason={aiBlocked(a.org)}
      accept={ACCEPT_LIST}
      initialTab={tab}
      focusTask={task}
      scopes={a.scopes}
      canAllocate={a.canAllocate}
      incidents={incidents.map(i => ({ id: i.id, title: i.title, date: i.date, severity: i.severity, category: i.category, status: i.status, serious: i.serious, notes: i.notes }))}
    />
  );
}
