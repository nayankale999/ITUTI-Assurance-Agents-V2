'use client';
/* The organisation-wide AI inventory: every system with its owner, team, risk tier and journey stage, filterable. */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { InventoryRow } from '@/lib/portfolio';

const tone = (s: number | null) => (s == null ? 'muted' : s >= 4 ? 'crit' : s >= 3 ? 'warn' : s >= 2 ? 'info' : 'good');
const TIER_ORDER = ['prohibited', 'review', 'high', 'limited', 'minimal', 'unknown'];

export function InventoryTable({ rows, slug, readOnly }: { rows: InventoryRow[]; slug: string; readOnly: Set<string> | string[] | null }) {
  const ro = new Set(readOnly || []);
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [unit, setUnit] = useState('');
  const [team, setTeam] = useState('');
  const [stage, setStage] = useState('');
  const [sort, setSort] = useState<'name' | 'score' | 'stage' | 'updated'>('name');
  const units = useMemo(() => [...new Set(rows.map(r => r.unit).filter(Boolean))].sort(), [rows]);
  const teams = useMemo(() => [...new Set(rows.map(r => r.team).filter(Boolean))].sort(), [rows]);
  const tiers = useMemo(() => TIER_ORDER.filter(t => rows.some(r => r.tier === t)).map(t => [t, rows.find(r => r.tier === t)!.tierLabel]), [rows]);
  const shown = rows.filter(r =>
    (!q || `${r.name} ${r.owner} ${r.team} ${r.purpose} ${r.vendor}`.toLowerCase().includes(q.toLowerCase())) &&
    (!tier || r.tier === tier) && (!unit || r.unit === unit) && (!team || r.team === team) &&
    (!stage || (stage === 'review' ? r.reassess.length > 0 : stage === 'done' ? r.stage === 5 : r.stage < 5)),
  ).sort((a, b) => sort === 'score' ? (b.score ?? -1) - (a.score ?? -1) : sort === 'stage' ? a.stage - b.stage : sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : a.name.localeCompare(b.name));
  const filtered = q || tier || unit || team || stage;
  return (
    <section className="panel">
      <div className="filters" role="search">
        <label className="field"><span>Search</span><input type="search" id="inv-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Name, owner, team, purpose or model" /></label>
        <label className="field"><span>Risk tier</span><select id="inv-tier" value={tier} onChange={e => setTier(e.target.value)}><option value="">All tiers</option>{tiers.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {units.length > 0 && <label className="field"><span>Business unit or entity</span><select id="inv-unit" value={unit} onChange={e => setUnit(e.target.value)}><option value="">All</option>{units.map(u => <option key={u}>{u}</option>)}</select></label>}
        {teams.length > 0 && <label className="field"><span>Team</span><select id="inv-team" value={team} onChange={e => setTeam(e.target.value)}><option value="">All teams</option>{teams.map(u => <option key={u}>{u}</option>)}</select></label>}
        <label className="field"><span>Journey</span><select id="inv-stage" value={stage} onChange={e => setStage(e.target.value)}><option value="">All</option><option value="open">In progress</option><option value="done">All five steps complete</option><option value="review">Flagged for reassessment</option></select></label>
        <label className="field"><span>Sort by</span><select id="inv-sort" value={sort} onChange={e => setSort(e.target.value as typeof sort)}><option value="name">Name</option><option value="score">Risk score, highest first</option><option value="stage">Journey, least complete first</option><option value="updated">Recently updated</option></select></label>
      </div>
      {filtered && <p className="muted" style={{ padding: '0 20px', fontSize: 13 }}>Showing {shown.length} of {rows.length} systems. <button type="button" className="linkish" onClick={() => { setQ(''); setTier(''); setUnit(''); setTeam(''); setStage(''); }}>Clear filters</button></p>}
      <div className="scroll"><table className="ledger">
        <thead><tr><th>System</th><th>Team and responsible person</th><th>EU AI Act tier</th><th className="num">Risk score</th><th>Compliance journey</th><th>Control readiness</th><th className="num">Open incidents</th></tr></thead>
        <tbody>{shown.map(r => (
          <tr key={r.id}>
            <td><Link href={`/o/${slug}/systems/${r.id}`} className="sysname" style={{ textDecoration: 'none', color: 'inherit' }}>{r.name}<small>{[r.unit, r.func, r.lifecycle].filter(Boolean).join(' · ') || 'Details not recorded'}{ro.has(r.id) ? ' · read only' : ''}</small></Link></td>
            <td>{r.team || <span className="muted">Team not set</span>}<small className="muted" style={{ display: 'block' }}>{r.owner || 'Responsible person not set'}</small></td>
            <td><span className={`pill t-${r.tierTone}`}>{r.tierLabel}</span>{r.reassess.length > 0 && <span className="pill t-warn" style={{ marginLeft: 4 }} title={`Changed: ${r.reassess.join(', ')}`}>Review needed</span>}</td>
            <td className="num">{r.score != null ? <span className={`pill t-${tone(r.score)}`}>{r.score.toFixed(1)}</span> : <span className="muted">–</span>}</td>
            <td><div className="steps5" aria-label={`${r.stage} of 5 steps complete`}>{[0, 1, 2, 3, 4].map(i => <i key={i} className={i < r.stage ? 'on' : ''} />)}</div><small className="muted">{r.stage === 5 ? 'Complete' : `Next: ${r.stageLabel}`}</small></td>
            <td><div className="barwrap"><div className="bar"><i style={{ width: `${r.readiness}%` }} /></div>{r.readiness}%</div></td>
            <td className="num">{r.openIncidents ? <span className="pill t-warn">{r.openIncidents}</span> : <span className="muted">0</span>}</td>
          </tr>
        ))}
        {!shown.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No systems match these filters.</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}
