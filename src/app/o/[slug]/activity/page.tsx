import { notFound } from 'next/navigation';
import { db } from '@/data';
import { orgForPage } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/permissions';

export const metadata = { title: 'Activity' };

const ACTIONS: Record<string, string> = {
  'org.created': 'created this client', 'org.renamed': 'renamed the client',
  'invite.sent': 'sent an invitation', 'invite.revoked': 'revoked an invitation', 'invite.accepted': 'joined',
  'member.role': 'changed a member’s role', 'member.removed': 'removed a member', 'member.systems': 'changed a contributor’s systems',
  'system.created': 'added a system', 'system.updated': 'updated a system', 'system.deleted': 'deleted a system',
  'incident.created': 'recorded an incident', 'incident.updated': 'updated an incident', 'incident.deleted': 'deleted an incident',
  'review.run': 'ran an AI evidence review',
  'org.registered': 'signed up', 'share.created': 'created a public model card link', 'share.revoked': 'revoked a public model card link',
  'proposals.accepted': 'accepted agent proposals', 'proposals.rejected': 'rejected agent proposals', 'agent.completed': 'agent run completed',
};

export default async function Activity({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, caps } = await orgForPage(slug);
  if (!caps.manage) notFound();
  const rows = await db.auditLog.find({ orgId: org.id }, { orderBy: [['updatedAt', 'desc']], limit: 200 });
  const uname = new Map((await db.users.find({ id: [...new Set(rows.map(r => r.userId).filter((x): x is string => !!x))] })).map(u => [u.id, u.name || u.email]));
  const sname = new Map((await db.aiSystems.find({ orgId: org.id }, { columns: ['id', 'name'] })).map(s => [s.id, s.name]));
  const describe = (r: (typeof rows)[number]) => {
    const d = (r.detail || {}) as Record<string, unknown>;
    const bits: string[] = [];
    if (r.systemId) bits.push(sname.get(r.systemId) || String(d.name || 'a deleted system'));
    if (d.email) bits.push(String(d.email));
    if (d.role) bits.push(ROLE_LABEL[String(d.role)] || String(d.role));
    if (Array.isArray(d.sections) && d.sections.length) bits.push(`sections: ${d.sections.join(', ')}`);
    if (d.title) bits.push(String(d.title));
    return bits.join(' · ');
  };
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Activity</h1>
        <p className="muted">Who changed what, newest first. Repeated edits to one system within ten minutes appear as one entry.</p></div></section>
      <section className="panel">
        {rows.length ? (
          <div className="scroll"><table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><td className="mono">{r.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td>{r.userId ? uname.get(r.userId) || 'Removed user' : 'System'}</td>
                <td>{ACTIONS[r.action] || r.action}</td><td className="muted">{describe(r)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty"><p>No activity yet.</p></div>}
      </section>
    </>
  );
}
