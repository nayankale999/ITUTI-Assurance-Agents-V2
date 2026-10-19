import { orgForApi, csvResponse, err } from '@/lib/api';
import { orgIncidents } from '@/lib/portfolio';
import { legalReview, statusLabel } from '@/lib/incidents';

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await orgForApi(slug); if (!a) return err(404, 'Not found.');
  const rows = await orgIncidents(a.org.id);
  return csvResponse(`${slug}-incidents.csv`, ['Date', 'AI system', 'Incident', 'Severity', 'Category', 'Status', 'Possible serious incident', 'Legal review', 'Details'],
    rows.map(r => [r.date, r.system, r.title, r.severity, r.category, statusLabel(r.status), r.serious ? 'Yes' : 'No', legalReview(r) || '', r.notes]));
}
