import { orgForPage } from '@/lib/session';
import { inventory, riskSummary } from '@/lib/portfolio';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Risk assessment summary' };

export default async function RiskSummary({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await orgForPage(slug);
  const rows = await inventory(org.id);
  const sum = riskSummary(rows);
  const ranked = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <DocShell back={`/o/${slug}/risk`} backLabel="Risk management" kind="Risk assessment summary" org={org.name} title="Risk assessment summary" subtitle="EU AI Act classification per system">
      <h2>Portfolio</h2>
      <table><tbody>
        <tr><th style={{ width: 260 }}>AI systems</th><td>{rows.length}</td></tr>
        <tr><th>Average risk score (1 to 4)</th><td>{sum.avg?.toFixed(2) ?? 'No system classified yet'}</td></tr>
        {sum.dist.filter(d => d.count).map(d => <tr key={d.key}><th>{d.label}</th><td>{d.count}</td></tr>)}
        <tr><th>Flagged for reassessment</th><td>{sum.flagged.length ? sum.flagged.map(r => r.name).join(', ') : 'None'}</td></tr>
        <tr><th>Classification not yet confirmed</th><td>{sum.unconfirmed.length ? sum.unconfirmed.map(r => r.name).join(', ') : 'None'}</td></tr>
      </tbody></table>
      <p className="muted" style={{ fontSize: 12 }}>Scoring: the whole number is the EU AI Act tier (1 minimal, 2 limited, 3 high, 4 prohibited); the decimal places the system within its tier from its impact factors (who is affected, data, scale, automation and reversibility).</p>
      <h2>Classification per system</h2>
      {ranked.map(r => (
        <div key={r.id} style={{ breakInside: 'avoid', marginBottom: 14 }}>
          <h3>{r.name} · {r.tierLabel}{r.score != null ? ` · ${r.score.toFixed(1)}` : ''}</h3>
          <table><tbody>
            <tr><th style={{ width: 200 }}>Basis</th><td>{r.basis.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{r.basis.map(b => <li key={b}>{b}</li>)}</ul> : 'Not classified yet'}</td></tr>
            <tr><th>Confirmation</th><td>{r.confirmed ? (r.reassess.length ? `Confirmed, but these answers have changed since: ${r.reassess.join(', ')}` : 'Confirmed and current') : 'Not confirmed'}</td></tr>
            <tr><th>Article 43</th><td>{r.art43 ? `Conformity assessment likely required; ${r.conf}% of questions confirmed` : 'Not required on the current answers'}</td></tr>
          </tbody></table>
        </div>
      ))}
    </DocShell>
  );
}
