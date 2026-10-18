import { db } from '@/data';
import { requireItutiAdmin } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { SiteFoot } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/ActionForm';
import { inviteUser, revokeInvite, setStaffRole, setAssessorOrgs, setUserDisabled } from '@/app/actions';
import { ROLE_LABEL } from '@/lib/permissions';

export const metadata = { title: 'Ituti team' };

export default async function TeamPage() {
  const viewer = await requireItutiAdmin();
  const staff = (await db.users.find({ role: ['ITUTI_ADMIN', 'ITUTI_ASSESSOR'] })).sort((a, b) => a.email.localeCompare(b.email));
  const orgs = [...await db.organizations.all()].sort((a, b) => a.name.localeCompare(b.name));
  const staffIds = new Set(staff.map(s => s.id));
  const assigns = await db.assessorAssignments.find({ userId: [...staffIds] });
  const now = Date.now();
  const pending = (await db.invitations.find({ orgId: null, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date(now) } })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return (
    <>
      <TopBar viewer={viewer} current="team" />
      <main className="wrap">
        <section className="pf-head"><div className="titles"><span className="eyebrow">Ituti staff</span><h1>Ituti team</h1>
          <p className="muted">Admins see every client and manage the team. Assessors see only the clients assigned to them.</p></div></section>

        <section className="panel">
          <header><h3>Invite a colleague</h3></header>
          <div className="body">
            <ActionForm action={inviteUser} className="formrow" resetOnSuccess>
              <label className="field"><span>Email</span><input type="email" name="email" id="staff-email" required placeholder="name@itutitech.com" /></label>
              <label className="field" style={{ flex: '0 0 auto' }}><span>Role</span><select name="role" id="staff-role" defaultValue="ITUTI_ASSESSOR"><option value="ITUTI_ASSESSOR">Ituti assessor</option><option value="ITUTI_ADMIN">Ituti admin</option></select></label>
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
          <header><h3>Team members</h3></header>
          <div className="scroll"><table className="table">
            <thead><tr><th>Person</th><th>Role</th><th>Assigned clients (assessors)</th><th /></tr></thead>
            <tbody>{staff.map(s => {
              const mine = new Set(assigns.filter(a => a.userId === s.id).map(a => a.orgId));
              const self = s.id === viewer.id;
              return (
                <tr key={s.id}>
                  <td><b>{s.name || s.email}</b>{s.name && <div className="muted" style={{ fontSize: 12 }}>{s.email}</div>}{s.disabled && <span className="pill t-crit">Disabled</span>}</td>
                  <td>
                    {self ? <span>{ROLE_LABEL[s.role]} (you)</span> : (
                      <ActionForm action={setStaffRole} className="formrow">
                        <input type="hidden" name="userId" value={s.id} />
                        <select name="role" defaultValue={s.role} aria-label={`Role for ${s.email}`}><option value="ITUTI_ADMIN">Ituti admin</option><option value="ITUTI_ASSESSOR">Ituti assessor</option><option value="CLIENT">Remove from team</option></select>
                        <Submit>Save</Submit>
                      </ActionForm>
                    )}
                  </td>
                  <td>
                    {s.role === 'ITUTI_ASSESSOR' ? (
                      orgs.length ? (
                        <ActionForm action={setAssessorOrgs} style={{ display: 'grid', gap: 8 }}>
                          <input type="hidden" name="userId" value={s.id} />
                          <div className="checks">{orgs.map(o => (
                            <label key={o.id} className="chk" style={{ cursor: 'pointer' }}><input type="checkbox" name="orgId" value={o.id} defaultChecked={mine.has(o.id)} /> {o.name}</label>
                          ))}</div>
                          <div><Submit>Save assignments</Submit></div>
                        </ActionForm>
                      ) : <span className="muted">No clients yet</span>
                    ) : <span className="muted">All clients</span>}
                  </td>
                  <td>{!self && (
                    <ActionForm action={setUserDisabled} className="row-actions" confirm={s.disabled ? undefined : 'This signs them out everywhere.'}>
                      <input type="hidden" name="userId" value={s.id} /><input type="hidden" name="disabled" value={s.disabled ? 'false' : 'true'} />
                      <Submit className={s.disabled ? 'btn' : 'btn ghost danger'}>{s.disabled ? 'Enable' : 'Disable'}</Submit>
                    </ActionForm>
                  )}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      </main>
      <SiteFoot />
    </>
  );
}
