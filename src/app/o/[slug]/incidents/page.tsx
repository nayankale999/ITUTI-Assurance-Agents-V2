import Link from 'next/link';
import { orgForPage } from '@/lib/session';
import { isActive, legalReview } from '@/lib/incidents';
import { IncidentTracker } from '@/components/IncidentTracker';
import { orgIncidents } from '@/lib/portfolio';

export const metadata = { title: 'Incident tracker' };

export default async function Incidents({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await orgForPage(slug);
  const rows = await orgIncidents(org.id);
  const active = rows.filter(r => isActive(r.status));
  const critical = active.filter(r => r.severity === 'critical').length;
  const resolved = rows.filter(r => r.status === 'resolved' || r.status === 'closed').length;
  const legal = active.filter(r => legalReview(r)).length;
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Incident tracker</h1>
        <p className="muted">Every AI incident across the portfolio, tied to the system it happened on. Incidents move from open to investigating, mitigated, resolved and closed. Possible discrimination, personal-data issues and reportable serious incidents are flagged for legal review.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Link className="btn" href={`/o/${slug}/documents/incidents`}>Incident inventory (PDF)</Link><a className="btn" href={`/o/${slug}/documents/incidents.csv`}>CSV</a></div></section>
      <section className="stats" aria-label="Incident summary">
        <div className={`stat ${active.length ? 'alert' : ''}`}><b>{active.length}</b><span>Open (not yet resolved)</span></div>
        <div className={`stat ${critical ? 'alert' : ''}`}><b>{critical}</b><span>Critical and open</span></div>
        <div className={`stat ${legal ? 'alert' : ''}`}><b>{legal}</b><span>Open and flagged for legal review</span></div>
        <div className="stat"><b>{resolved}</b><span>Resolved or closed</span></div>
      </section>
      <IncidentTracker rows={rows} slug={slug} />
      <p className="muted" style={{ fontSize: 12 }}>To record or update an incident, open the system and use its Monitoring tab. Serious incidents involving high-risk systems may need reporting to the market surveillance authority (EU AI Act Art. 73).</p>
    </>
  );
}
