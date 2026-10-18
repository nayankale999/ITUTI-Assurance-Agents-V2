import { notFound } from 'next/navigation';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db';
import { orgForPage } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/permissions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { inviteUser, revokeInvite, changeMemberRole, removeMember, setContributorSystems } from '@/app/actions';

export const metadata = { title: 'People' };

export default async function People({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { viewer, org, caps } = await orgForPage(slug);
  if (!caps.manage) notFound();
  const members = await db.select({ userId: schema.memberships.userId, role: schema.memberships.role, email: schema.users.email, name: schema.users.name, disabled: schema.users.disabled })
    .from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.orgId, org.id)).orderBy(asc(schema.users.email));
  const assessors = await db.select({ email: schema.users.email, name: schema.users.name })
    .from(schema.assessorAssignments).innerJoin(schema.users, eq(schema.users.id, schema.assessorAssignments.userId))
    .where(eq(schema.assessorAssignments.orgId, org.id));
  const systems = await db.query.aiSystems.findMany({ where: eq(schema.aiSystems.orgId, org.id), columns: { id: true, name: true }, orderBy: asc(schema.aiSystems.name) });
  const contributorIds = members.filter(m => m.role === 'CONTRIBUTOR').map(m => m.userId);
  const assigned = contributorIds.length && systems.length
    ? await db.query.systemAssignments.findMany({ where: and(inArray(schema.systemAssignments.userId, contributorIds), inArray(schema.systemAssignments.systemId, systems.map(s => s.id))) })
    : [];
  const inv = schema.invitations;
  const pending = await db.query.invitations.findMany({ where: and(eq(inv.orgId, org.id), isNull(inv.acceptedAt), isNull(inv.revokedAt), gt(inv.expiresAt, new Date())), orderBy: asc(inv.createdAt) });

  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>People</h1>
        <p className="muted">Client admins invite colleagues and manage roles. Contributors edit only the systems assigned to them. Viewers can read systems and reports.</p></div></section>

      <section className="panel">
        <header><h3>Invite someone from {org.name}</h3></header>
        <div className="body">
          <ActionForm action={inviteUser} className="formrow" resetOnSuccess>
            <input type="hidden" name="orgId" value={org.id} />
            <label className="field"><span>Email</span><input type="email" name="email" id="invite-email" required placeholder="name@client.com" /></label>
            <label className="field" style={{ flex: '0 0 auto' }}><span>Role</span>
              <select name="role" id="invite-role" defaultValue="CONTRIBUTOR"><option value="CLIENT_ADMIN">Client admin</option><option value="CONTRIBUTOR">Contributor</option><option value="VIEWER">Viewer</option></select></label>
            <Submit className="btn primary">Send invitation</Submit>
          </ActionForm>
          {pending.length > 0 && (
            <table className="table"><thead><tr><th>Pending invitation</th><th>Role</th><th>Expires</th><th /></tr></thead><tbody>
              {pending.map(p => (
                <tr key={p.id}><td>{p.email}</td><td>{ROLE_LABEL[p.role]}</td><td className="mono">{p.expiresAt.toISOString().slice(0, 10)}</td>
                  <td><ActionForm action={revokeInvite} className="row-actions"><input type="hidden" name="id" value={p.id} /><Submit className="btn ghost danger">Revoke</Submit></ActionForm></td></tr>
              ))}
            </tbody></table>
          )}
        </div>
      </section>

      <section className="panel">
        <header><h3>Members</h3><span className="muted">{members.length}</span></header>
        {members.length ? (
          <div className="scroll"><table className="table">
            <thead><tr><th>Person</th><th>Role</th><th>Systems they can edit</th><th /></tr></thead>
            <tbody>{members.map(m => {
              const self = m.userId === viewer.id;
              const mine = new Set(assigned.filter(a => a.userId === m.userId).map(a => a.systemId));
              return (
                <tr key={m.userId}>
                  <td><b>{m.name || m.email}</b>{m.name && <div className="muted" style={{ fontSize: 12 }}>{m.email}</div>}{m.disabled && <span className="pill t-crit">Disabled</span>}</td>
                  <td>{self ? <span>{ROLE_LABEL[m.role]} (you)</span> : (
                    <ActionForm action={changeMemberRole} className="formrow">
                      <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="userId" value={m.userId} />
                      <select name="role" defaultValue={m.role} aria-label={`Role for ${m.email}`}><option value="CLIENT_ADMIN">Client admin</option><option value="CONTRIBUTOR">Contributor</option><option value="VIEWER">Viewer</option></select>
                      <Submit>Save</Submit>
                    </ActionForm>
                  )}</td>
                  <td>{m.role === 'CONTRIBUTOR' ? (systems.length ? (
                    <ActionForm action={setContributorSystems} style={{ display: 'grid', gap: 8 }}>
                      <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="userId" value={m.userId} />
                      <div className="checks">{systems.map(s => <label key={s.id} className="chk" style={{ cursor: 'pointer' }}><input type="checkbox" name="systemId" value={s.id} defaultChecked={mine.has(s.id)} /> {s.name}</label>)}</div>
                      <div><Submit>Save assignments</Submit></div>
                    </ActionForm>) : <span className="muted">No systems yet</span>)
                    : <span className="muted">{m.role === 'CLIENT_ADMIN' ? 'All systems' : 'None (read only)'}</span>}</td>
                  <td>{!self && (
                    <ActionForm action={removeMember} className="row-actions" confirm="They lose access to this client.">
                      <input type="hidden" name="orgId" value={org.id} /><input type="hidden" name="userId" value={m.userId} />
                      <Submit className="btn ghost danger">Remove</Submit>
                    </ActionForm>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="empty"><p>No client members yet. Invite the client&rsquo;s AI or risk lead as client admin first.</p></div>}
      </section>

      <section className="panel">
        <header><h3>Ituti assessors on this client</h3></header>
        <div className="body">{assessors.length
          ? <p>{assessors.map(a => a.name || a.email).join(', ')}</p>
          : <p className="muted">No assessor assigned. Ituti admins can assign one from the Ituti team page.</p>}</div>
      </section>
    </>
  );
}
