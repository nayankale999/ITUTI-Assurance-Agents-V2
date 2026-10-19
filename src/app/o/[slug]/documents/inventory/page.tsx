import { orgForPage } from '@/lib/session';
import { inventory } from '@/lib/portfolio';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'AI inventory report' };

export default async function InventoryReport({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await orgForPage(slug);
  const rows = await inventory(org.id);
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.unit || 'No business unit or entity recorded', [...(by.get(r.unit || 'No business unit or entity recorded') || []), r]);
  return (
    <DocShell back={`/o/${slug}/documents`} backLabel="Document centre" kind="AI inventory report" org={org.name} title={`AI inventory: ${org.name}`} subtitle={`${rows.length} AI system${rows.length === 1 ? '' : 's'} recorded`}>
      <h2>Summary</h2>
      <table><thead><tr><th>System</th><th>Team</th><th>Responsible person</th><th>Lifecycle</th><th>Risk tier</th><th>Score</th><th>Journey</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td>{r.name}</td><td>{r.team || '–'}</td><td>{r.owner || '–'}</td><td>{r.lifecycle || '–'}</td><td>{r.tierLabel}{r.reassess.length ? ' (reassessment due)' : ''}</td><td>{r.score?.toFixed(1) ?? '–'}</td><td>{r.stage}/5</td></tr>)}</tbody></table>
      {[...by.entries()].map(([unit, list]) => (
        <section key={unit}>
          <h2>{unit}</h2>
          {list.map(r => (
            <div key={r.id} style={{ breakInside: 'avoid', marginBottom: 16 }}>
              <h3>{r.name}</h3>
              <table><tbody>
                <tr><th style={{ width: 200 }}>Purpose</th><td style={{ whiteSpace: 'pre-wrap' }}>{r.purpose || '–'}</td></tr>
                <tr><th>Business function</th><td>{r.func || '–'}</td></tr>
                <tr><th>Team that manages it</th><td>{r.team || '–'}</td></tr>
                <tr><th>Responsible person</th><td>{r.owner || '–'}</td></tr>
                <tr><th>Model or product</th><td>{r.vendor || '–'}</td></tr>
                <tr><th>Where it is used</th><td>{r.regions || '–'}</td></tr>
                <tr><th>EU AI Act classification</th><td>{r.tierLabel}{r.score != null ? `, score ${r.score.toFixed(1)} of 4` : ''}{r.basis.length ? `. ${r.basis.join('; ')}` : ''}</td></tr>
                <tr><th>Assessment status</th><td>{r.stage} of 5 journey steps complete; control readiness {r.readiness}%; {r.openIncidents} open incident{r.openIncidents === 1 ? '' : 's'}</td></tr>
              </tbody></table>
            </div>
          ))}
        </section>
      ))}
    </DocShell>
  );
}
