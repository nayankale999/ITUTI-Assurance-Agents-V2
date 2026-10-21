import Link from 'next/link';
import { db } from '@/data';
import { orgForPage } from '@/lib/session';
import { scopeLabel, scopeTab } from '@/lib/tasks';
import { TaskList, type TaskItem } from '@/components/TaskList';

export const metadata = { title: 'Tasks' };

export default async function Tasks({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { viewer, org, caps } = await orgForPage(slug);
  const systems = new Map((await db.aiSystems.find({ orgId: org.id }, { columns: ['id', 'name'] })).map(s => [s.id, s.name]));
  const led = (await db.teams.find({ orgId: org.id, leadId: viewer.id })).map(t => t.id);
  const ledSystems = led.length ? new Set((await db.teamSystems.find({ teamId: led })).map(x => x.systemId)) : new Set<string>();
  const all = await db.tasks.find({ orgId: org.id }, { orderBy: [['createdAt', 'desc']] });
  const ids = [...new Set(all.flatMap(t => [t.assigneeId, t.createdById]).filter((x): x is string => !!x))];
  const names = new Map((ids.length ? await db.users.find({ id: ids }) : []).map(u => [u.id, u.name || u.email]));
  const order = { doing: 0, todo: 1, done: 2 } as Record<string, number>;
  const item = (t: (typeof all)[number]): TaskItem => ({
    id: t.id, systemId: t.systemId, system: systems.get(t.systemId) || 'Deleted system', label: scopeLabel(t.scope), scope: t.scope, tab: scopeTab(t.scope),
    status: t.status, due: t.due, note: t.note, assignee: names.get(t.assigneeId) || 'Removed user', by: t.createdById ? names.get(t.createdById) || '' : '',
    mine: t.assigneeId === viewer.id, canEdit: t.assigneeId === viewer.id || caps.manage || ledSystems.has(t.systemId),
  });
  const sort = (a: TaskItem, b: TaskItem) => (order[a.status] - order[b.status]) || (a.due || '9').localeCompare(b.due || '9');
  const mine = all.filter(t => t.assigneeId === viewer.id).map(item).sort(sort);
  const team = all.filter(t => t.assigneeId !== viewer.id && (caps.manage || ledSystems.has(t.systemId))).map(item).sort(sort);
  const openMine = mine.filter(t => t.status !== 'done').length;
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Tasks</h1>
        <p className="muted">{openMine ? `You have ${openMine} open task${openMine === 1 ? '' : 's'}. Start one to open the system with the parts you are assigned unlocked; mark it done when you have finished.` : 'You have no open tasks.'}</p></div>
        {caps.manage && <Link className="btn" href={`/o/${slug}/teams`}>Manage teams</Link>}</section>
      <section className="panel"><header><h3>My tasks</h3></header>
        <TaskList items={mine} slug={slug} empty="Nothing is assigned to you yet." />
      </section>
      {(caps.manage || led.length > 0) && (
        <section className="panel"><header><div><h3>{caps.manage ? 'All team tasks' : 'Tasks in the teams you lead'}</h3><small className="muted">Assign work from each system&rsquo;s Team tab.</small></div></header>
          <TaskList items={team} slug={slug} showAssignee empty="No tasks assigned to others yet." />
        </section>
      )}
    </>
  );
}
