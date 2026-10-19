import { systemForDoc } from '@/lib/docs';
import { metricStatus } from '@/lib/assurance';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Metrics report' };

export default async function Metrics({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const ms = d.sys.metrics || [];
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Metrics report" org={d.org.name} title={d.name} subtitle="Performance, fairness and drift metrics against their thresholds">
      {ms.length ? <>
        <h2>Summary</h2>
        <table><thead><tr><th>Metric</th><th>Type</th><th>Threshold</th><th>Latest</th><th>First reading</th><th>Status</th></tr></thead>
          <tbody>{ms.map(m => { const r = m.readings || [], last = r[r.length - 1], first = r[0], st = metricStatus(m); return (
            <tr key={m.id}><td>{m.name}</td><td>{m.kind || '–'}</td><td>{m.threshold !== '' && m.threshold != null ? `${m.dir === 'below' ? '≤' : '≥'} ${m.threshold}` : 'None set'}</td>
              <td>{last ? `${last.v} (${last.d})` : '–'}</td><td>{first ? `${first.v} (${first.d})` : '–'}</td><td><span className={`pill t-${st.tone}`}>{st.label}</span></td></tr>); })}</tbody></table>
        <h2>Readings</h2>
        {ms.map(m => (
          <div key={m.id} style={{ breakInside: 'avoid' }}>
            <h3>{m.name}</h3>
            {(m.readings || []).length ? <table><thead><tr><th>Date</th><th>Value</th><th>Against threshold</th></tr></thead><tbody>
              {(m.readings || []).slice().reverse().map(r => { const t = m.threshold === '' || m.threshold == null ? NaN : +m.threshold; const ok = isNaN(t) ? null : m.dir === 'below' ? r.v <= t : r.v >= t; return <tr key={r.d + r.v}><td>{r.d}</td><td>{r.v}</td><td>{ok == null ? '–' : ok ? 'Within' : 'Breach'}</td></tr>; })}
            </tbody></table> : <p className="muted">No readings recorded.</p>}
          </div>
        ))}
      </> : <p>No metrics recorded. Add them on the system&rsquo;s Monitoring tab.</p>}
    </DocShell>
  );
}
