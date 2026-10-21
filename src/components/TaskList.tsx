'use client';
/* A list of assessment tasks with their status. People move their own tasks along; leads can do so for anyone. */
import { useState } from 'react';
import Link from 'next/link';
import { TASK_STATUS } from '@/lib/tasks';

export type TaskItem = { id: string; systemId: string; system: string; label: string; scope: string; tab: string; status: string; due: string | null; note: string | null; assignee: string; by: string; mine: boolean; canEdit: boolean };

const tone: Record<string, string> = { todo: 't-muted', doing: 't-info', done: 't-good' };

export function TaskList({ items, slug, showAssignee, empty }: { items: TaskItem[]; slug: string; showAssignee?: boolean; empty: string }) {
  const [rows, setRows] = useState(items);
  const [msg, setMsg] = useState('');
  async function setStatus(id: string, status: string) {
    const r = await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    if (r.ok) { setRows(l => l.map(x => x.id === id ? { ...x, status } : x)); setMsg(''); }
    else setMsg((await r.json().catch(() => ({}))).error || 'Could not update the task.');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (!rows.length) return <div className="empty"><p>{empty}</p></div>;
  return (
    <>
      {msg && <p className="err" role="alert" style={{ padding: '0 20px' }}>{msg}</p>}
      <div className="scroll"><table className="ledger">
        <thead><tr><th>Task</th><th>AI system</th>{showAssignee && <th>Assigned to</th>}<th>Due</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(t => (
          <tr key={t.id}>
            <td><b>{t.label}</b>{t.note && <div className="muted" style={{ fontSize: 12 }}>{t.note}</div>}{t.by && <div className="muted" style={{ fontSize: 11.5 }}>Assigned by {t.by}</div>}</td>
            <td>{t.system}</td>
            {showAssignee && <td>{t.assignee}</td>}
            <td className="mono">{t.due ? <span className={t.status !== 'done' && t.due < today ? 'err' : ''}>{t.due}</span> : <span className="muted">–</span>}</td>
            <td>{t.canEdit ? <select aria-label="Status" value={t.status} style={{ width: 'auto' }} onChange={e => setStatus(t.id, e.target.value)}>{TASK_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              : <span className={`pill ${tone[t.status]}`}>{TASK_STATUS.find(s => s[0] === t.status)?.[1]}</span>}</td>
            <td className="num">{t.status !== 'done' && t.mine && <Link className="btn primary" href={`/o/${slug}/systems/${t.systemId}?tab=${t.tab}&task=${encodeURIComponent(t.scope)}`}>Start</Link>}
              {(!t.mine || t.status === 'done') && <Link className="btn" href={`/o/${slug}/systems/${t.systemId}?tab=${t.tab}`}>Open</Link>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
