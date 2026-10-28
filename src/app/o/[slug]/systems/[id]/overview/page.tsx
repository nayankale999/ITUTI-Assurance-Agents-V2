import { db } from '@/data';
import { systemForDoc } from '@/lib/docs';
import { TIERS, classify, obligations, readiness, inherentRisk } from '@/lib/assurance';
import { journey, regulatoryScore, reassessment } from '@/lib/journey';
import { confProgress, art43 } from '@/lib/conformity';
import { isActive } from '@/lib/incidents';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Compliance overview' };

export default async function Overview({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const sys = d.sys, p = sys.profile || {};
  const j = journey(sys), r = classify(sys), score = regulatoryScore(sys), ir = inherentRisk(sys), rd = readiness(sys), cp = confProgress(sys), a43 = art43(sys), re = reassessment(sys);
  const incidents = await db.incidents.find({ systemId: id, kind: 'incident' });
  const tier = TIERS[r.tier] || TIERS.unknown;
  const STATE: Record<string, string> = { done: 'Complete', progress: 'In progress', todo: 'Not started' };
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Compliance overview" org={d.org.name} title={d.name}
      subtitle={<>{[p.client, p.team, p.owner && `Responsible: ${p.owner}`].filter(Boolean).join(' · ')}</>}>
      <h2>Position</h2>
      <table><tbody>
        <tr><th style={{ width: 240 }}>EU AI Act classification</th><td><span className={`pill t-${tier.tone}`}>{tier.label}</span>{score != null ? ` · risk score ${score.toFixed(1)} of 4` : ''}{re.changed.length ? ` · reassessment due (${re.changed.join(', ')} changed)` : re.confirmed ? ' · confirmed' : ' · not yet confirmed'}</td></tr>
        <tr><th>Inherent risk</th><td>{ir ? `${ir.score}/100 (${ir.band})` : 'Impact factors not complete'}</td></tr>
        <tr><th>Control readiness</th><td>{rd.pct}% ({rd.met} met, {rd.partial} partial, {rd.gap} not met, {rd.open} open)</td></tr>
        <tr><th>Conformity assessment</th><td>{cp.done} of {cp.total} questions confirmed ({cp.pct}%). {a43.text}</td></tr>
        <tr><th>Incidents</th><td>{incidents.filter(i => isActive(i.status)).length} open of {incidents.length} recorded</td></tr>
      </tbody></table>
      <h2>Compliance journey</h2>
      <table><thead><tr><th>Step</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>{j.steps.map(s => <tr key={s.key}><td>{s.n}. {s.label}</td><td>{STATE[s.state]}</td><td>{s.detail}{s.state !== 'done' && <div className="muted">Next: {s.next}</div>}</td></tr>)}</tbody></table>
      <h2>What applies</h2>
      {obligations(sys).map(o => <div key={o.region}><h3>{o.region}</h3><ul>{o.items.map(([t, ref]) => <li key={t}>{t} <span className="muted">({ref})</span></li>)}</ul></div>)}
    </DocShell>
  );
}
