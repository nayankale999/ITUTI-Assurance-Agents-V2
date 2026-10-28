import { orgForPage } from '@/lib/session';
import { orgIncidents } from '@/lib/portfolio';
import { isActive } from '@/lib/incidents';
import { IncidentTable } from '@/components/IncidentTable';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Incident inventory' };

export default async function IncidentInventory({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await orgForPage(slug);
  const rows = (await orgIncidents(org.id)).filter(r => r.kind === 'incident');
  return (
    <DocShell back={`/o/${slug}/incidents`} backLabel="Incident tracker" kind="Incident inventory" org={org.name} title="Incident inventory" subtitle={`${rows.length} incident${rows.length === 1 ? '' : 's'} recorded, ${rows.filter(r => isActive(r.status)).length} not yet resolved`}>
      <IncidentTable rows={rows} showSystem />
    </DocShell>
  );
}
