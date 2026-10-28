import { db } from '@/data';
import { systemForDoc } from '@/lib/docs';
import { isActive } from '@/lib/incidents';
import { DocShell } from '@/components/DocShell';
import { IncidentTable } from '@/components/IncidentTable';

export const metadata = { title: 'Incident inventory' };

export default async function SystemIncidents({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const rows = await db.incidents.find({ systemId: id, kind: 'incident' }, { orderBy: [['date', 'desc'], ['createdAt', 'desc']] });
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Incident inventory" org={d.org.name} title={d.name}
      subtitle={`${rows.length} incident${rows.length === 1 ? '' : 's'} recorded, ${rows.filter(r => isActive(r.status)).length} not yet resolved`}>
      <IncidentTable rows={rows} />
    </DocShell>
  );
}
