import { notFound } from 'next/navigation';
import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
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
};

export default async function Activity({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, caps } = await orgForPage(slug);
  if (!caps.manage) notFound();
  const rows = await db.query.auditLog.findMany({ where: eq(schema.auditLog.orgId, org.id), orderBy: desc(schema.auditLog.updatedAt), limit: 200 });
  const userIds = [...new Set(rows.map(r => r.userId).filter(Boolean))] as string[];
  const users = userIds.length ? await db.query.users.findMany({ where: inArray(schema.users.id, userIds), columns: { id: true, email: true, name: true } }) : [];
  const systemIds = [...new Set(rows.map(r => r.systemId).filter(Boolean))] as string[];
  const systems = systemIds.length ? await db.query.aiSystems.findMany({ where: inArray(schema.aiSystems.id, systemIds), columns: { id: true, name: true } }) : [];
  const uname = new Map(users.map(u => [u.id, u.name || u.email]));
  const sname = new Map(systems.map(s => [s.id, s.name]));
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
