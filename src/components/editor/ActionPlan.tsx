'use client';
/* The action plan: every gap the assessment leaves open, and the action raised to close it, with an owner, a
 * department and a due date. Actions also appear in the Incident tracker under "Gap actions". */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { INCIDENT_STATUSES, sevTone, statusLabel } from '@/lib/incidents';
import type { Gap, GapAction } from '@/lib/gaps';

type Row = { gap: Gap; action: GapAction | null; awaitingUpdate: boolean };
type Settings = { auto: boolean; ownerId: string | null; ownerName: string | null; department: string | null; dueDays: number; saved: boolean; lastAutoAt: string | null };
type Data = { settings: Settings; rows: Row[]; closable: GapAction[]; actions: GapAction[]; withAction: number; withoutAction: number; awaitingUpdate: number; overdue: number; people: { id: string; name: string; email: string }[]; departments: string[]; canPlan: boolean; journeyDone: boolean };

async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: r.ok, body: (await r.json().catch(() => ({}))) as Record<string, any> };
}
const SEV_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export function ActionPlan({ systemId, settle, goTo, journeyDone }: { systemId: string; settle: () => Promise<boolean>; goTo: (tab: string, focus: string) => void; journeyDone: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [dept, setDept] = useState('');
  const [due, setDue] = useState('');
  const [kind, setKind] = useState<'all' | 'control' | 'conformity'>('all');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState<{ on: boolean; owner: string; ownerName: string; dept: string; days: number } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const load = useCallback(async () => {
    await settle();
    const r = await call(`/api/systems/${systemId}/actions`, 'GET');
    if (!r.ok) return;
    const data = r.body as Data;
    setD(data);
    const s = data.settings;
    setAuto(prev => prev || { on: s.auto, owner: s.ownerId || (s.ownerName ? 'other' : ''), ownerName: s.ownerName || '', dept: s.department || '', days: s.dueDays });
  }, [systemId, settle]);
  useEffect(() => { load(); }, [load]);

  async function saveAuto(on: boolean) {
    if (!auto) return;
    if (on && (!auto.owner || (auto.owner === 'other' && !auto.ownerName.trim()))) { setMsg({ err: 'Choose who owns the actions raised automatically.' }); return; }
    if (on && !auto.dept.trim()) { setMsg({ err: 'Enter the department responsible for the automatic actions.' }); return; }
    setAutoBusy(true);
    const r = await call(`/api/systems/${systemId}/actions`, 'PATCH', {
      auto: on, dueDays: Math.max(1, Math.min(365, Math.round(auto.days) || 30)), department: auto.dept.trim() || null,
      ...(auto.owner === 'other' ? { ownerId: null, ownerName: auto.ownerName.trim() } : { ownerId: auto.owner || null, ownerName: null }),
    });
    setAutoBusy(false);
    if (!r.ok) { setMsg({ err: r.body.error || 'Could not save the settings.' }); return; }
    setAuto({ ...auto, on });
    const n = r.body.created as number;
    setMsg({ ok: !on ? 'Automatic actions are off. Raise actions by hand below.'
      : n ? `Automatic actions are on. ${n} action${n === 1 ? ' was' : 's were'} raised now for the open gaps${auto.owner !== 'other' ? ', and the owner has been emailed' : ''}.`
      : d?.journeyDone ? 'Automatic actions are on. Every gap already has an action; new gaps will get one when the assessment is saved.'
      : 'Automatic actions are on. Actions will be raised for every gap once all five assessment steps are complete.' });
    load();
  }

  const rows = useMemo(() => (d?.rows || []).filter(r => kind === 'all' || r.gap.kind === kind), [d, kind]);
  const open = rows.filter(r => !r.action);
  const today = new Date().toISOString().slice(0, 10);

  async function raise(e: React.FormEvent) {
    e.preventDefault();
    if (!sel.size) { setMsg({ err: 'Tick the gaps to raise actions for.' }); return; }
    if (!owner || (owner === 'other' && !ownerName.trim())) { setMsg({ err: 'Choose an owner.' }); return; }
    if (!dept.trim()) { setMsg({ err: 'Enter the department responsible.' }); return; }
    setBusy(true);
    const r = await call(`/api/systems/${systemId}/actions`, 'POST', {
      items: [...sel].map(gapRef => ({ gapRef })), department: dept.trim(), due: due || null,
      ...(owner === 'other' ? { ownerName: ownerName.trim() } : { ownerId: owner }),
    });
    setBusy(false);
    if (r.ok) { setMsg({ ok: `Raised ${r.body.created} action${r.body.created === 1 ? '' : 's'}${owner !== 'other' ? '. The owner has been emailed and given a task for each gap, so they can edit those items' : ''}. They also appear in the Incident tracker under Gap actions.` }); setSel(new Set()); load(); }
    else setMsg({ err: r.body.error || 'Could not raise the actions.' });
  }
  async function update(id: string, change: Record<string, unknown>) {
    const r = await call(`/api/incidents/${id}`, 'PATCH', change);
    if (r.ok) load(); else setMsg({ err: r.body.error || 'Could not update the action.' });
  }

  if (!d) return <section className="panel"><div className="body"><p className="muted">Working out the gaps…</p></div></section>;
  const total = d.rows.length;
  const bySev = (s: string) => d.rows.filter(r => r.gap.severity === s).length;
  const toggle = (ref: string) => setSel(prev => { const n = new Set(prev); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });

  return (
    <>
      <section className="panel"><div className="body">
        <div className="plan-head">
          <div>
            <span className="eyebrow">Action plan</span>
            <h3 style={{ margin: '4px 0' }}>{total ? `${total} gap${total === 1 ? '' : 's'} to close` : 'No gaps left'}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{total
              ? `${journeyDone ? 'All five assessment steps are complete. ' : ''}Every control that is not met, and every conformity question not yet confirmed, is a gap. Raise an action for each, with an owner, the department responsible and a due date.`
              : 'Every applicable control is met or not applicable, and every conformity question is confirmed.'}</p>
          </div>
          <div className="plan-stats">
            {(['critical', 'high', 'medium', 'low'] as const).map(s => bySev(s) ? <span key={s} className={`pill ${sevTone(s)}`}>{bySev(s)} {SEV_LABEL[s].toLowerCase()}</span> : null)}
            <span className="pill t-good">{d.withAction} with an action</span>
            {d.withoutAction > 0 && <span className="pill t-warn">{d.withoutAction} need an owner</span>}
            {d.awaitingUpdate > 0 && <span className="pill t-info">{d.awaitingUpdate} resolved, assessment to update</span>}
            {d.overdue > 0 && <span className="pill t-crit">{d.overdue} overdue</span>}
          </div>
        </div>
        {total > 0 && <div className="plan-bar" aria-label={`${d.withAction} of ${total} gaps have an action`}><i style={{ width: `${d.withAction / total * 100}%` }} /></div>}
      </div></section>

      {auto && (d.canPlan || auto.on) && (
        <section className="panel auto-plan"><header><div><h3>Automatic actions</h3>
          <small className="muted">{auto.on
            ? (d.journeyDone ? 'On. Every gap gets an action as soon as the assessment is saved, against the owner and department below.' : 'On. When all five assessment steps are complete, every gap gets an action against the owner and department below.')
            : 'Raise an action for every gap automatically once all five assessment steps are complete, and for any gap found after that.'}</small></div>
          {d.canPlan && <><div className="spacer" /><label className="switch"><input type="checkbox" checked={auto.on} disabled={autoBusy} onChange={e => saveAuto(e.target.checked)} /><span>{auto.on ? 'On' : 'Off'}</span></label></>}</header>
          {d.canPlan && <div className="body raise auto-form">
            <label className="field"><span>Default owner</span>
              <select value={auto.owner} onChange={e => setAuto({ ...auto, owner: e.target.value })}><option value="">Choose…</option>
                {d.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="other">Someone not on the platform…</option></select></label>
            {auto.owner === 'other' && <label className="field"><span>Owner&rsquo;s name and role</span><input type="text" value={auto.ownerName} onChange={e => setAuto({ ...auto, ownerName: e.target.value })} maxLength={255} /></label>}
            <label className="field"><span>Department</span><input type="text" list="plan-depts" value={auto.dept} onChange={e => setAuto({ ...auto, dept: e.target.value })} maxLength={120} placeholder="e.g. Model Risk" /></label>
            <label className="field"><span>Due in (days)</span><input type="number" min={1} max={365} value={auto.days} onChange={e => setAuto({ ...auto, days: Number(e.target.value) })} style={{ width: 90 }} /></label>
            {auto.on && <button type="button" className="btn" disabled={autoBusy} onClick={() => saveAuto(true)}>{autoBusy ? 'Saving…' : 'Save changes'}</button>}
          </div>}
          {!d.canPlan && <div className="body muted" style={{ fontSize: 13 }}>Owner: {d.people.find(p => p.id === d.settings.ownerId)?.name || d.settings.ownerName || 'not set'} · {d.settings.department} · due {d.settings.dueDays} days after raising</div>}
        </section>
      )}

      {d.closable.length > 0 && (
        <section className="panel"><header><div><h3>Ready to close</h3><small className="muted">The gap behind these actions has been closed in the assessment.</small></div></header>
          <div className="scroll"><table className="ledger"><tbody>{d.closable.map(a => (
            <tr key={a.id}><td><b>{a.title}</b><small className="muted" style={{ display: 'block' }}>{a.ownerName} · {a.department}</small></td>
              <td className="num">{d.canPlan && <button type="button" className="btn primary" onClick={() => update(a.id, { status: 'resolved' })}>Mark resolved</button>}</td></tr>
          ))}</tbody></table></div>
        </section>
      )}

      {msg.ok && <div className="banner" role="status">{msg.ok}</div>}
      {msg.err && <div className="banner err" role="alert">{msg.err}</div>}

      {total > 0 && (
        <section className="panel">
          <header style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="seg" role="group" aria-label="Which gaps">
              {([['all', 'All gaps'], ['control', 'Controls'], ['conformity', 'Conformity']] as const).map(([k, l]) => <button key={k} type="button" className="v-plain" aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}
            </div>
            {d.canPlan && open.length > 0 && <button type="button" className="btn" onClick={() => setSel(new Set(open.map(r => r.gap.ref)))}>Select all {open.length} without an action</button>}
          </header>

          {d.canPlan && sel.size > 0 && (
            <form className="raise" onSubmit={raise}>
              <b>Raise {sel.size} action{sel.size === 1 ? '' : 's'}</b>
              <label className="field"><span>Owner</span>
                <select value={owner} onChange={e => setOwner(e.target.value)} required><option value="">Choose…</option>
                  {d.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="other">Someone not on the platform…</option></select></label>
              {owner === 'other' && <label className="field"><span>Owner&rsquo;s name and role</span><input type="text" value={ownerName} onChange={e => setOwnerName(e.target.value)} maxLength={255} placeholder="e.g. Tom Okafor, Data Protection Officer" /></label>}
              <label className="field"><span>Department</span><input type="text" list="plan-depts" value={dept} onChange={e => setDept(e.target.value)} maxLength={120} placeholder="e.g. Model Risk, HR Technology, Legal" />
                <datalist id="plan-depts">{d.departments.map(x => <option key={x} value={x} />)}</datalist></label>
              <label className="field"><span>Due date</span><input type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
              <button className="btn primary" disabled={busy}>{busy ? 'Raising…' : 'Raise actions'}</button>
              <button type="button" className="linkish" onClick={() => setSel(new Set())}>Clear selection</button>
            </form>
          )}

          <div className="scroll"><table className="ledger plan-table">
            <thead><tr>{d.canPlan && <th aria-label="Select" />}<th>Gap</th><th>Priority</th><th>Action</th></tr></thead>
            <tbody>{rows.map(({ gap: g, action: a, awaitingUpdate }) => (
              <tr key={g.ref}>
                {d.canPlan && <td>{!a && <input type="checkbox" aria-label={`Select ${g.title}`} checked={sel.has(g.ref)} onChange={() => toggle(g.ref)} />}</td>}
                <td>
                  <b>{g.title}</b>
                  <small className="muted" style={{ display: 'block' }}>{g.area} · {g.status}</small>
                  <div className="clamp2 muted" style={{ fontSize: 12, marginTop: 4 }}>{a ? a.notes : g.suggested}</div>
                  <button type="button" className="linkish" style={{ fontSize: 12 }} onClick={() => goTo(g.kind === 'control' ? 'controls' : 'conformity', g.ref)}>Open in the assessment</button>
                </td>
                <td><span className={`pill ${sevTone(g.severity)}`}>{SEV_LABEL[g.severity]}</span></td>
                <td style={{ minWidth: 230 }}>{a ? <>
                  <b>{a.ownerName || 'No owner'}</b><small className="muted" style={{ display: 'block' }}>{a.department}{a.due ? <> · due <span className={a.due < today ? 'err' : ''}>{a.due}</span></> : ''}</small>
                  {d.canPlan
                    ? <select aria-label="Action status" value={a.status} style={{ width: 'auto', marginTop: 6 }} onChange={e => update(a.id, { status: e.target.value })}>{INCIDENT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    : <span className="pill t-info" style={{ marginTop: 6 }}>{statusLabel(a.status)}</span>}
                  {awaitingUpdate && <div className="await-note">Action {statusLabel(a.status).toLowerCase()}. The gap, and the owner’s task, stay open until the assessment shows it: {g.kind === 'control' ? `set ${g.ref.slice(5)} to Met and record the evidence` : 'confirm the answer'}.{' '}
                    <button type="button" className="linkish" onClick={() => goTo(g.kind === 'control' ? 'controls' : 'conformity', g.ref)}>Update the assessment</button></div>}
                </> : <span className="pill t-warn">Needs an action</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </>
  );
}
