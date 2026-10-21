'use client';
/* The team working on this system and the tasks handed out on it. The lead (or a client admin or Ituti assessor)
 * assigns pieces of the assessment to team members; each member sees and moves along their own tasks. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { scopeOptions, TASK_STATUS } from '@/lib/tasks';

type Task = { id: string; scope: string; label: string; status: string; due: string | null; note: string | null; assigneeId: string; assignee: string; by: string };
type Person = { id: string; name: string; email: string; teams: { id: string; name: string; lead: boolean }[] };
type Data = { tasks: Task[]; teams: { id: string; name: string; leadId: string | null }[]; people: Person[]; canAllocate: boolean; me: string };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, body: (await r.json().catch(() => ({}))) as Record<string, any> };
}
const tone: Record<string, string> = { todo: 't-muted', doing: 't-info', done: 't-good' };

export function TeamTab({ systemId, slug, canAllocate }: { systemId: string; slug: string; canAllocate: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [who, setWho] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => scopeOptions(), []);
  const groups = useMemo(() => [...new Set(opts.map(o => o[2]))], [opts]);

  const load = useCallback(async () => { const r = await call(`/api/systems/${systemId}/tasks`, 'GET'); if (r.ok) setD(r.body as Data); }, [systemId]);
  useEffect(() => { load(); }, [load]);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    const scopes = picked.length ? picked : pick ? [pick] : [];
    if (!who || !scopes.length) { setMsg({ err: 'Choose a person and at least one piece of work.' }); return; }
    setBusy(true);
    const r = await call(`/api/systems/${systemId}/tasks`, 'POST', { assigneeId: who, scopes, due: due || null, note });
    setBusy(false);
    if (r.ok) { setMsg({ ok: `Assigned ${r.body.tasks.length} task${r.body.tasks.length === 1 ? '' : 's'}. They have been emailed.` }); setPicked([]); setPick(''); setNote(''); load(); }
    else setMsg({ err: r.body.error || 'Could not assign.' });
  }
  async function update(id: string, change: Record<string, unknown>) {
    const r = await call(`/api/tasks/${id}`, 'PATCH', change);
    if (r.ok) load(); else setMsg({ err: r.body.error || 'Could not update the task.' });
  }
  async function remove(id: string) {
    const r = await call(`/api/tasks/${id}`, 'DELETE', {});
    if (r.ok) load(); else setMsg({ err: r.body.error || 'Could not remove the task.' });
  }

  if (!d) return <section className="panel"><div className="body"><p className="muted">Loading the team…</p></div></section>;
  const lead = (t: { leadId: string | null }) => d.people.find(p => p.id === t.leadId)?.name;
  const label = (s: string) => opts.find(o => o[0] === s)?.[1] || s;
  const byPerson = d.people.map(p => ({ p, tasks: d.tasks.filter(t => t.assigneeId === p.id) }));
  const others = d.tasks.filter(t => !d.people.some(p => p.id === t.assigneeId));

  return (
    <>
      <section className="panel"><header><div><h3>Team</h3><small className="muted">{d.teams.length ? 'Teams working on this system. Team members can change only what is assigned to them.' : 'No team is working on this system yet.'}</small></div>
        {canAllocate && <><div className="spacer" /><Link className="btn" href={`/o/${slug}/teams`}>Manage teams</Link></>}</header>
        <div className="body">
          {d.teams.length ? <ul className="team-list">{d.teams.map(t => <li key={t.id}><b>{t.name}</b> <span className="muted">· lead: {lead(t) || 'not set'}</span></li>)}</ul>
            : <p className="muted">{canAllocate ? 'Create a team on the Teams page, add members and tick this system, then come back here to hand out the work.' : 'Ask your organisation’s admin to set up a team for this system.'}</p>}
        </div>
      </section>

      {msg.ok && <div className="banner" role="status">{msg.ok}</div>}
      {msg.err && <div className="banner err" role="alert">{msg.err}</div>}

      {d.canAllocate && d.people.length > 0 && (
        <section className="panel"><header><div><h3>Assign work</h3><small className="muted">Pick a team member and the parts of the assessment they should complete. They can then edit only those parts.</small></div></header>
          <form className="body assign-form" onSubmit={assign}>
            <div className="grid2">
              <label className="field"><span>Team member</span>
                <select value={who} onChange={e => setWho(e.target.value)} required><option value="">Choose…</option>
                  {d.people.map(p => <option key={p.id} value={p.id}>{p.name}{p.teams.some(t => t.lead) ? ' (lead)' : ''}</option>)}</select></label>
              <label className="field"><span>Work to assign</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={pick} onChange={e => setPick(e.target.value)} style={{ flex: 1 }}><option value="">Choose…</option>
                    {groups.map(g => <optgroup key={g} label={g}>{opts.filter(o => o[2] === g).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>)}</select>
                  <button type="button" className="btn" disabled={!pick || picked.includes(pick)} onClick={() => { setPicked(l => [...l, pick]); setPick(''); }}>Add</button>
                </div></label>
            </div>
            {picked.length > 0 && <div className="checks" aria-label="Chosen work">{picked.map(s => <button key={s} type="button" className="chk" aria-pressed="true" onClick={() => setPicked(l => l.filter(x => x !== s))} title="Remove">{label(s)} ×</button>)}</div>}
            <div className="grid2">
              <label className="field"><span>Due date (optional)</span><input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
              <label className="field"><span>Note (optional)</span><input type="text" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Context, documents to use, who to ask" /></label>
            </div>
            <div><button className="btn primary" disabled={busy}>{busy ? 'Assigning…' : `Assign${picked.length > 1 ? ` ${picked.length} tasks` : ''}`}</button></div>
          </form>
        </section>
      )}

      <section className="panel"><header><div><h3>Tasks on this system</h3><small className="muted">{d.tasks.filter(t => t.status !== 'done').length} open, {d.tasks.filter(t => t.status === 'done').length} done</small></div></header>
        {d.tasks.length ? <div className="scroll"><table className="ledger">
          <thead><tr><th>Assigned to</th><th>Task</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>{[...byPerson.flatMap(x => x.tasks), ...others].map(t => {
            const mine = t.assigneeId === d.me;
            return (
              <tr key={t.id}>
                <td>{t.assignee}{mine && <span className="assigned-mark">You</span>}</td>
                <td><b>{t.label}</b>{t.note && <div className="muted" style={{ fontSize: 12 }}>{t.note}</div>}{t.by && <div className="muted" style={{ fontSize: 11.5 }}>Assigned by {t.by}</div>}</td>
                <td className="mono">{t.due || <span className="muted">–</span>}</td>
                <td>{mine || d.canAllocate ? <select aria-label="Status" value={t.status} style={{ width: 'auto' }} onChange={e => update(t.id, { status: e.target.value })}>{TASK_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  : <span className={`pill ${tone[t.status]}`}>{TASK_STATUS.find(s => s[0] === t.status)?.[1]}</span>}</td>
                <td className="num">{d.canAllocate && <button type="button" className="linkbtn" onClick={() => remove(t.id)}>Remove</button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div> : <div className="empty"><p>No tasks yet.</p></div>}
      </section>
    </>
  );
}
