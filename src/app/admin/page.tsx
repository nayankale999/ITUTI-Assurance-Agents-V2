import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { requireViewer, visibleOrgs } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createOrg } from '@/app/actions';

export const metadata = { title: 'Clients' };

export default async function AdminHome() {
  const viewer = await requireViewer();
  if (viewer.role === 'CLIENT') notFound();
  const orgs = await visibleOrgs(viewer);
  const ids = orgs.map(o => o.id);
  const stats = ids.length ? await db.select({
    orgId: schema.aiSystems.orgId,
    systems: sql<number>`count(*)::int`,
    high: sql<number>`count(*) filter (where ${schema.aiSystems.tier} = 'high')::int`,
    flagged: sql<number>`count(*) filter (where ${schema.aiSystems.tier} in ('prohibited','review'))::int`,
    readiness: sql<number>`coalesce(round(avg(${schema.aiSystems.readiness})),0)::int`,
    incidents: sql<number>`coalesce(sum(${schema.aiSystems.openIncidents}),0)::int`,
  }).from(schema.aiSystems).where(inArray(schema.aiSystems.orgId, ids)).groupBy(schema.aiSystems.orgId) : [];
  const members = ids.length ? await db.select({ orgId: schema.memberships.orgId, n: sql<number>`count(*)::int` }).from(schema.memberships).where(inArray(schema.memberships.orgId, ids)).groupBy(schema.memberships.orgId) : [];
  const by = new Map(stats.map(s => [s.orgId, s]));
  const mby = new Map(members.map(m => [m.orgId, m.n]));
  const totals = stats.reduce((a, s) => ({ systems: a.systems + s.systems, high: a.high + s.high, flagged: a.flagged + s.flagged, incidents: a.incidents + s.incidents }), { systems: 0, high: 0, flagged: 0, incidents: 0 });
  return (
    <>
      <TopBar viewer={viewer} current="clients" />
      <main className="wrap">
        <section className="pf-head">
          <div className="titles">
            <span className="eyebrow">{viewer.role === 'ITUTI_ADMIN' ? 'All clients' : 'Your assigned clients'}</span>
            <h1>Clients</h1>
            <p className="muted">Each client has its own workspace, members and AI system records.</p>
          </div>
        </section>
        <section className="stats" aria-label="Summary">
          <div className="stat"><b>{orgs.length}</b><span>Clients</span></div>
          <div className="stat"><b>{totals.systems}</b><span>AI systems</span></div>
          <div className="stat"><b>{totals.high}</b><span>High risk (EU AI Act)</span></div>
          <div className={`stat ${totals.flagged ? 'alert' : ''}`}><b>{totals.flagged}</b><span>Prohibited or needing legal review</span></div>
          <div className={`stat ${totals.incidents ? 'alert' : ''}`}><b>{totals.incidents}</b><span>Open incidents</span></div>
        </section>
        <section className="panel">
          {orgs.length ? (
            <div className="scroll"><table className="ledger">
              <thead><tr><th>Client</th><th className="num">Systems</th><th className="num">High risk</th><th className="num">Flagged</th><th>Average readiness</th><th className="num">Open incidents</th><th className="num">Members</th></tr></thead>
              <tbody>{orgs.map(o => { const s = by.get(o.id); return (
                <tr key={o.id}>
                  <td><Link href={`/o/${o.slug}`} className="sysname" style={{ textDecoration: 'none', color: 'inherit' }}>{o.name}</Link></td>
                  <td className="num">{s?.systems ?? 0}</td>
                  <td className="num">{s?.high ?? 0}</td>
                  <td className="num">{s?.flagged ? <span className="pill t-crit">{s.flagged}</span> : 0}</td>
                  <td><div className="barwrap"><div className="bar"><i style={{ width: `${s?.readiness ?? 0}%` }} /></div>{s?.readiness ?? 0}%</div></td>
                  <td className="num">{s?.incidents ? <span className="pill t-warn">{s.incidents}</span> : 0}</td>
                  <td className="num">{mby.get(o.id) ?? 0}</td>
                </tr>); })}</tbody>
            </table></div>
          ) : (
            <div className="empty"><h3>No clients yet</h3><p>{viewer.role === 'ITUTI_ADMIN' ? 'Add your first client below.' : 'An Ituti admin has not assigned you to a client yet.'}</p></div>
          )}
        </section>
        {viewer.role === 'ITUTI_ADMIN' && (
          <section className="panel">
            <header><h3>Add a client</h3></header>
            <div className="body">
              <ActionForm action={createOrg} className="formrow" resetOnSuccess>
                <label className="field"><span>Client organisation name</span><input type="text" name="name" id="org-name" required minLength={2} maxLength={120} placeholder="e.g. Northbridge Building Society" /></label>
                <Submit className="btn primary">Add client</Submit>
              </ActionForm>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
