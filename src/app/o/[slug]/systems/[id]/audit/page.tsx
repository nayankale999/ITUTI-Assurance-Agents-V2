import { db } from '@/data';
import { systemForDoc } from '@/lib/docs';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Audit trail' };

const VIA: Record<string, string> = { editor: 'Entered by a person', agent: 'Agent proposal, accepted by a person', a2a: 'Through the agent endpoint' };

export default async function AuditTrail({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const rows = await db.changes.find({ systemId: id }, { orderBy: [['updatedAt', 'desc']], limit: 2000 });
  const events = await db.auditLog.find({ systemId: id, action: { ne: 'system.updated' } }, { orderBy: [['updatedAt', 'desc']], limit: 500 });
  const ids = [...new Set([...rows.map(r => r.userId), ...events.map(e => e.userId)].filter((x): x is string => !!x))];
  const who = new Map((ids.length ? await db.users.find({ id: ids }) : []).map(u => [u.id, u.name ? `${u.name} (${u.email})` : u.email]));
  const when = (x: Date) => x.toISOString().slice(0, 16).replace('T', ' ');
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Audit trail" org={d.org.name} title={d.name}
      subtitle="Who recorded what, and when. Times are UTC. Repeated edits to one answer by one person within ten minutes appear as one entry.">
      <h2>Answers and changes</h2>
      {rows.length ? <table><thead><tr><th style={{ width: 120 }}>When</th><th>Who</th><th>Answer</th><th>Before</th><th>After</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}><td className="mono">{when(r.updatedAt)}</td><td>{r.userId ? who.get(r.userId) || 'Removed user' : 'System'}<div className="muted" style={{ fontSize: 11 }}>{VIA[r.via] || r.via}</div></td>
          <td>{r.label}</td><td style={{ whiteSpace: 'pre-wrap' }} className="muted">{r.before ?? '–'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{r.after ?? '(cleared)'}</td></tr>)}</tbody></table>
        : <p>No answer-level changes recorded yet. Changes are recorded from this version of the platform onwards.</p>}
      <h2>Other events</h2>
      {events.length ? <table><thead><tr><th style={{ width: 120 }}>When</th><th>Who</th><th>Event</th></tr></thead>
        <tbody>{events.map(e => <tr key={e.id}><td className="mono">{when(e.updatedAt)}</td><td>{e.userId ? who.get(e.userId) || 'Removed user' : 'System'}</td><td>{e.action.replace(/[._]/g, ' ')}{e.detail && (e.detail as { title?: string }).title ? `: ${(e.detail as { title?: string }).title}` : ''}</td></tr>)}</tbody></table>
        : <p>None.</p>}
    </DocShell>
  );
}
