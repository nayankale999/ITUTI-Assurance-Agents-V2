'use client';
/* Every incident across the organisation's AI systems, filtered by where it is in its lifecycle. */
import { useState } from 'react';
import Link from 'next/link';
import { INCIDENT_STATUSES, ACTIVE_STATUSES, sevTone, statusLabel, legalReview } from '@/lib/incidents';

export type TrackerRow = { id: string; systemId: string; system: string; title: string; date: string; severity: string; category: string; status: string; serious: boolean; notes: string; kind: string; owner: string; department: string; due: string | null };

const isActiveGap = (s: string) => ACTIVE_STATUSES.includes(s);

export function IncidentTracker({ rows: all, slug, initialView = 'incident' }: { rows: TrackerRow[]; slug: string; initialView?: string }) {
  const [view, setView] = useState(initialView);
  const [filter, setFilter] = useState('active');
  const [legal, setLegal] = useState(false);
  const [dept, setDept] = useState('');
  const gapsView = view === 'gap';
  const depts = [...new Set(all.filter(r => r.kind === 'gap' && r.department).map(r => r.department))].sort();
  const rows = all.filter(r => r.kind === view && (!gapsView || !dept || r.department === dept));
  const today = new Date().toISOString().slice(0, 10);
  const tabs: [string, string, number][] = [
    ['all', 'All', rows.length], ['active', 'Active', rows.filter(r => ACTIVE_STATUSES.includes(r.status)).length],
    ...INCIDENT_STATUSES.map(([k, l]) => [k, l, rows.filter(r => r.status === k).length] as [string, string, number]),
  ];
  const shown = rows.filter(r => (filter === 'all' || (filter === 'active' ? ACTIVE_STATUSES.includes(r.status) : r.status === filter)) && (gapsView || !legal || legalReview(r)));
  return (
    <section className="panel">
      <div className="seg view-switch" role="group" aria-label="What to show" style={{ margin: '14px 20px 0' }}>
        <button type="button" className="v-plain" aria-pressed={!gapsView} onClick={() => setView('incident')}>AI incidents · {all.filter(r => r.kind === 'incident').length}</button>
        <button type="button" className="v-plain" aria-pressed={gapsView} onClick={() => setView('gap')}>Gap actions · {all.filter(r => r.kind === 'gap').length}</button>
      </div>
      <header style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="seg" role="group" aria-label="Filter by status">
          {tabs.map(([k, l, n]) => <button key={k} type="button" className="v-plain" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} · {n}</button>)}
        </div>
        {gapsView
          ? depts.length > 0 && <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>Department <select value={dept} onChange={e => setDept(e.target.value)} style={{ width: 'auto' }}><option value="">All</option>{depts.map(d => <option key={d}>{d}</option>)}</select></label>
          : <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={legal} onChange={e => setLegal(e.target.checked)} /> Only those flagged for legal review</label>}
      </header>
      {gapsView ? (
        <div className="scroll"><table className="ledger">
          <thead><tr><th>Due</th><th>Action</th><th>Owner and department</th><th>AI system</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}>
              <td className="mono">{r.due ? <span className={isActiveGap(r.status) && r.due < today ? 'err' : ''}>{r.due}</span> : <span className="muted">–</span>}</td>
              <td><b>{r.title}</b>{r.notes && <div className="muted clamp2" style={{ fontSize: 12 }}>{r.notes}</div>}</td>
              <td>{r.owner || <span className="muted">No owner</span>}<small className="muted" style={{ display: 'block' }}>{r.department}</small></td>
              <td><Link href={`/o/${slug}/systems/${r.systemId}?tab=plan`}>{r.system}</Link></td>
              <td><span className={`pill ${sevTone(r.severity)}`}>{r.severity}</span></td>
              <td>{statusLabel(r.status)}</td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>{rows.length ? 'No actions match this filter.' : 'No gap actions yet. Raise them from each system’s Action plan tab.'}</td></tr>}
          </tbody>
        </table></div>
      ) : (
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
        )}
    </section>
  );
}
