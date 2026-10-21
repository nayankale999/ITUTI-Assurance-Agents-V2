import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/data';
import { orgForPage } from '@/lib/session';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createTeam, updateTeam, deleteTeam } from '@/app/actions';
import { ROLE_LABEL } from '@/lib/permissions';

export const metadata = { title: 'Teams' };

export default async function Teams({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, caps } = await orgForPage(slug);
  if (!caps.manage) notFound();
  const memberships = await db.memberships.find({ orgId: org.id });
  const users = memberships.length ? await db.users.find({ id: memberships.map(m => m.userId), disabled: false }) : [];
  const people = users.map(u => ({ id: u.id, name: u.name || u.email, email: u.email, role: memberships.find(m => m.userId === u.id)!.role })).sort((a, b) => a.name.localeCompare(b.name));
  const systems = await db.aiSystems.find({ orgId: org.id }, { columns: ['id', 'name'], orderBy: [['name', 'asc']] });
  const teams = await db.teams.find({ orgId: org.id }, { orderBy: [['name', 'asc']] });
  const tm = teams.length ? await db.teamMembers.find({ teamId: teams.map(t => t.id) }) : [];
  const ts = teams.length ? await db.teamSystems.find({ teamId: teams.map(t => t.id) }) : [];
  const tasks = teams.length ? await db.tasks.find({ teamId: teams.map(t => t.id) }) : [];
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Teams</h1>
        <p className="muted">Put people into teams, give each team a lead, and assign the team to AI systems. The lead can then hand out work on those systems (controls, conformity questions, proposal reviews and more) to team members, who can change only what they are assigned.</p></div></section>
      {people.length < 1 && <section className="panel"><div className="body"><p>Invite people on the <Link href={`/o/${slug}/people`}>People</Link> page first; teams are made from your organisation&rsquo;s members.</p></div></section>}
      {teams.map(t => {
        const mem = new Set(tm.filter(x => x.teamId === t.id).map(x => x.userId));
        const sys = new Set(ts.filter(x => x.teamId === t.id).map(x => x.systemId));
        const open = tasks.filter(x => x.teamId === t.id && x.status !== 'done').length, done = tasks.filter(x => x.teamId === t.id && x.status === 'done').length;
        return (
          <section className="panel" key={t.id}>
            <header><div><h3>{t.name}</h3><small className="muted">{mem.size} member{mem.size === 1 ? '' : 's'} · {sys.size} system{sys.size === 1 ? '' : 's'} · {open} open task{open === 1 ? '' : 's'}, {done} done</small></div></header>
            <div className="body">
              <ActionForm action={updateTeam} className="team-form">
                <input type="hidden" name="teamId" value={t.id} />
                <div className="grid2">
                  <label className="field"><span>Team name</span><input type="text" name="name" defaultValue={t.name} required minLength={2} maxLength={120} /></label>
                  <label className="field"><span>Team lead</span>
                    <select name="leadId" defaultValue={t.leadId || ''}><option value="">No lead yet</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    <small>The lead can edit the team&rsquo;s systems and assign tasks on them.</small></label>
                </div>
                <fieldset className="pickset"><legend>Members</legend>
                  {people.map(p => <label key={p.id} className="pick"><input type="checkbox" name="member" value={p.id} defaultChecked={mem.has(p.id)} /> {p.name} <small className="muted">{ROLE_LABEL[p.role] || p.role}</small></label>)}
                </fieldset>
                <fieldset className="pickset"><legend>AI systems this team works on</legend>
                  {systems.length ? systems.map(s => <label key={s.id} className="pick"><input type="checkbox" name="system" value={s.id} defaultChecked={sys.has(s.id)} /> {s.name}</label>) : <span className="muted">No systems yet.</span>}
                </fieldset>
                <Submit className="btn primary">Save team</Submit>
              </ActionForm>
              <ActionForm action={deleteTeam} confirm="Deleting the team withdraws its open tasks." style={{ marginTop: 10 }}>
                <input type="hidden" name="teamId" value={t.id} /><Submit className="linkbtn">Delete team</Submit>
              </ActionForm>
            </div>
          </section>
        );
      })}
      <section className="panel"><header><h3>New team</h3></header><div className="body">
        <ActionForm action={createTeam} className="formrow" resetOnSuccess>
          <input type="hidden" name="orgId" value={org.id} />
          <label className="field"><span>Team name</span><input type="text" name="name" placeholder="e.g. HR AI assurance" required minLength={2} maxLength={120} /></label>
          <label className="field"><span>Team lead</span><select name="leadId" defaultValue=""><option value="">Choose later</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <Submit className="btn primary">Create team</Submit>
        </ActionForm>
      </div></section>
    </>
  );
}
