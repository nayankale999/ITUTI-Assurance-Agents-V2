import { legalReview, statusLabel } from '@/lib/incidents';

type Row = { id: string; date: string; system?: string; title: string; severity: string; category: string; status: string; serious: boolean; notes: string };

export function IncidentTable({ rows, showSystem }: { rows: Row[]; showSystem?: boolean }) {
  if (!rows.length) return <p>No incidents recorded.</p>;
  return (
    <table><thead><tr><th>Date</th>{showSystem && <th>AI system</th>}<th>Incident</th><th>Severity</th><th>Category</th><th>Status</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td>{r.date}</td>{showSystem && <td>{r.system}</td>}<td><b>{r.title}</b>{r.serious ? ' (possible serious incident)' : ''}{r.notes && <div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</div>}{legalReview(r) && <div><i>Flag: {legalReview(r)}</i></div>}</td><td>{r.severity}</td><td>{r.category}</td><td>{statusLabel(r.status)}</td></tr>)}</tbody></table>
  );
}
