import Link from 'next/link';
import { orgForPage } from '@/lib/session';
import { isActive, legalReview } from '@/lib/incidents';
import { IncidentTracker } from '@/components/IncidentTracker';
import { orgIncidents } from '@/lib/portfolio';

export const metadata = { title: 'Incident tracker' };

export default async function Incidents({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string }> }) {
  const { slug } = await params;
  const { view } = await searchParams;
  const { org } = await orgForPage(slug);
  const all = await orgIncidents(org.id);
  const rows = all.filter(r => r.kind === 'incident');
  const gapsOpen = all.filter(r => r.kind === 'gap' && isActive(r.status));
  const overdue = gapsOpen.filter(r => r.due && r.due < new Date().toISOString().slice(0, 10)).length;
  const active = rows.filter(r => isActive(r.status));
  const critical = active.filter(r => r.severity === 'critical').length;
  const resolved = rows.filter(r => r.status === 'resolved' || r.status === 'closed').length;
  const legal = active.filter(r => legalReview(r)).length;
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Incident tracker</h1>
        <p className="muted">Every AI incident across the portfolio, tied to the system it happened on, and every action raised to close an assessment gap. Incidents move from open to investigating, mitigated, resolved and closed. Possible discrimination, personal-data issues and reportable serious incidents are flagged for legal review.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Link className="btn" href={`/o/${slug}/documents/incidents`}>Incident inventory (PDF)</Link><a className="btn" href={`/o/${slug}/documents/incidents.csv`}>CSV</a></div></section>
      <section className="stats" aria-label="Incident summary">
        <div className={`stat ${active.length ? 'alert' : ''}`}><b>{active.length}</b><span>Open (not yet resolved)</span></div>
        <div className={`stat ${critical ? 'alert' : ''}`}><b>{critical}</b><span>Critical and open</span></div>
        <div className={`stat ${legal ? 'alert' : ''}`}><b>{legal}</b><span>Open and flagged for legal review</span></div>
        <div className="stat"><b>{resolved}</b><span>Resolved or closed</span></div>
        <div className="stat"><b>{gapsOpen.length}</b><span>Open gap actions</span></div>
        <div className={`stat ${overdue ? 'alert' : ''}`}><b>{overdue}</b><span>Gap actions overdue</span></div>
      </section>
      <IncidentTracker rows={all} slug={slug} initialView={view === 'gaps' ? 'gap' : 'incident'} />
      <p className="muted" style={{ fontSize: 12 }}>To record an incident, open the system and use its Monitoring tab; raise gap actions from its Action plan tab. Serious incidents involving high-risk systems may need reporting to the market surveillance authority (EU AI Act Art. 73).</p>
    </>
  );
}
