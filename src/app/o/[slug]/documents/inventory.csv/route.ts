import { orgForApi, csvResponse, err } from '@/lib/api';
import { inventory } from '@/lib/portfolio';

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = await orgForApi(slug); if (!a) return err(404, 'Not found.');
  const rows = await inventory(a.org.id);
  return csvResponse(`${slug}-ai-inventory.csv`,
    ['System', 'Business unit or entity', 'Team', 'Responsible person', 'Purpose', 'Business function', 'Lifecycle', 'Model or product', 'Regions', 'EU AI Act tier', 'Risk score (1-4)', 'Basis', 'Reassessment due', 'Journey steps complete', 'Control readiness %', 'Conformity questions confirmed %', 'Open incidents', 'Last updated'],
    rows.map(r => [r.name, r.unit, r.team, r.owner, r.purpose, r.func, r.lifecycle, r.vendor, r.regions, r.tierLabel, r.score ?? '', r.basis.join('; '), r.reassess.join(', '), r.stage, r.readiness, r.conf, r.openIncidents, r.updatedAt.slice(0, 10)]));
}
