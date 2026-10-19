'use client';
/* Every incident across the organisation's AI systems, filtered by where it is in its lifecycle. */
import { useState } from 'react';
import Link from 'next/link';
import { INCIDENT_STATUSES, ACTIVE_STATUSES, sevTone, statusLabel, legalReview } from '@/lib/incidents';

export type TrackerRow = { id: string; systemId: string; system: string; title: string; date: string; severity: string; category: string; status: string; serious: boolean; notes: string };

export function IncidentTracker({ rows, slug }: { rows: TrackerRow[]; slug: string }) {
  const [filter, setFilter] = useState('active');
  const [legal, setLegal] = useState(false);
  const tabs: [string, string, number][] = [
    ['all', 'All', rows.length], ['active', 'Active', rows.filter(r => ACTIVE_STATUSES.includes(r.status)).length],
    ...INCIDENT_STATUSES.map(([k, l]) => [k, l, rows.filter(r => r.status === k).length] as [string, string, number]),
  ];
  const shown = rows.filter(r => (filter === 'all' || (filter === 'active' ? ACTIVE_STATUSES.includes(r.status) : r.status === filter)) && (!legal || legalReview(r)));
  return (
    <section className="panel">
      <header style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="seg" role="group" aria-label="Filter by status">
          {tabs.map(([k, l, n]) => <button key={k} type="button" className="v-plain" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} · {n}</button>)}
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={legal} onChange={e => setLegal(e.target.checked)} /> Only those flagged for legal review</label>
      </header>
      <div className="scroll"><table className="ledger">
        <thead><tr><th>Date</th><th>Incident</th><th>AI system</th><th>Severity</th><th>Status</th></tr></thead>
        <tbody>{shown.map(r => {
          const lr = legalReview(r);
          return (
            <tr key={r.id}>
              <td className="mono">{r.date}</td>
              <td><b>{r.title}</b>{r.serious && <> <span className="pill t-crit">Reportable</span></>}{lr && <> <span className="pill t-warn" title={lr}>Legal review</span></>}
                <div className="muted" style={{ fontSize: 12 }}>{r.category}{lr ? ` · ${lr}` : ''}</div></td>
              <td><Link href={`/o/${slug}/systems/${r.systemId}?tab=monitor`}>{r.system}</Link></td>
              <td><span className={`pill ${sevTone(r.severity)}`}>{r.severity}</span></td>
              <td>{statusLabel(r.status)}</td>
            </tr>
          );
        })}
        {!shown.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>{rows.length ? 'No incidents match this filter.' : 'No incidents recorded. Log them on each system’s Monitoring tab.'}</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}
