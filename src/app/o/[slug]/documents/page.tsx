import Link from 'next/link';
import { orgForPage } from '@/lib/session';
import { inventory } from '@/lib/portfolio';

export const metadata = { title: 'Documents' };

export default async function Documents({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await orgForPage(slug);
  const rows = await inventory(org.id);
  const base = `/o/${slug}/documents`;
  const docs: [string, string, string][] = [
    [`${base}/inventory`, 'AI inventory report', 'Every AI system with its purpose, team, responsible person, data, regions and risk tier.'],
    [`${base}/risk`, 'Risk assessment summary', 'EU AI Act classification and risk score per system, with the basis for each, and the portfolio view.'],
    [`${base}/incidents`, 'Incident inventory', 'All recorded incidents across the portfolio with severity, category, status and legal-review flags.'],
  ];
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Document centre</h1>
        <p className="muted">Audit-ready documents compiled from the record you already keep: nothing is written twice. Open a document and choose Download as PDF, or export the inventory and incidents as spreadsheets.</p></div></section>
      <section className="panel"><header><h3>Portfolio documents</h3></header>
        <div className="doclist">{docs.map(([href, t, d]) => <Link key={href} className="docitem" href={href}><b>{t}</b><span>{d}</span></Link>)}
          <a className="docitem" href={`${base}/inventory.csv`}><b>AI inventory (CSV)</b><span>The inventory as a spreadsheet, for your own registers.</span></a>
          <a className="docitem" href={`${base}/incidents.csv`}><b>Incidents (CSV)</b><span>Every incident as a spreadsheet.</span></a>
        </div>
      </section>
      <section className="panel"><header><h3>Documents for each AI system</h3><span className="muted">Compliance overview, report, model card, conformity assessment, technical documentation, audit trail, incidents and metrics</span></header>
        {rows.length ? <div className="scroll"><table className="ledger"><thead><tr><th>System</th><th>Tier</th><th>Journey</th><th /></tr></thead><tbody>
          {rows.map(r => <tr key={r.id}><td><b>{r.name}</b><small className="muted" style={{ display: 'block' }}>{r.team || r.unit}</small></td><td><span className={`pill t-${r.tierTone}`}>{r.tierLabel}</span></td><td>{r.stage} of 5 steps</td>
            <td className="num"><Link className="btn" href={`/o/${slug}/systems/${r.id}/documents`}>Open document centre</Link></td></tr>)}
        </tbody></table></div> : <div className="empty"><p>No systems yet.</p></div>}
      </section>
    </>
  );
}
