import Link from 'next/link';
import { orgForPage } from '@/lib/session';
import { inventory, riskSummary, scoreTone } from '@/lib/portfolio';

export const metadata = { title: 'Risk management' };

const BAR: Record<string, string> = { good: 'var(--good)', info: 'var(--info)', warn: 'var(--warn)', crit: 'var(--crit)', muted: 'var(--line-strong)' };

export default async function Risk({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org } = await orgForPage(slug);
  const rows = await inventory(org.id);
  const sum = riskSummary(rows);
  const max = Math.max(1, ...sum.dist.map(d => d.count));
  const ranked = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const avgTier = sum.avg == null ? null : sum.avg >= 4 ? 'Prohibited' : sum.avg >= 3 ? 'High' : sum.avg >= 2 ? 'Limited' : 'Minimal';
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}><div className="titles"><span className="eyebrow">{org.name}</span><h1>Risk management</h1>
        <p className="muted">Every system is scored on the EU AI Act&rsquo;s four tiers from 1 (minimal) to 4 (prohibited). The whole number is the tier; the decimal shows where the system sits within it, from its impact factors. A score near the top of a tier, or a system flagged for reassessment, is where to look first.</p></div>
        <Link className="btn" href={`/o/${slug}/documents/risk`}>Risk assessment summary (PDF)</Link></section>

      <div className="grid2">
        <section className="panel"><header><h3>Portfolio risk score</h3></header><div className="body">
          {sum.avg != null ? <>
            <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}><span className="big-num">{sum.avg.toFixed(2)}</span><span className={`pill t-${scoreTone(sum.avg)}`}>{avgTier} on average</span></div>
            <p className="muted" style={{ fontSize: 13 }}>Average across {rows.filter(r => r.score != null).length} classified system{rows.filter(r => r.score != null).length === 1 ? '' : 's'}. Report this to management to show whether the portfolio is drifting towards the high-risk end.</p>
          </> : <p className="muted">No system is classified yet. Complete the classification step for each system.</p>}
          <div className="scale4" aria-hidden="true">
            <div style={{ background: 'var(--good-soft)' }}><b>1</b> Minimal</div><div style={{ background: 'var(--info-soft)' }}><b>2</b> Limited</div>
            <div style={{ background: 'var(--warn-soft)' }}><b>3</b> High</div><div style={{ background: 'var(--crit-soft)' }}><b>4</b> Prohibited</div>
          </div>
        </div></section>
        <section className="panel"><header><h3>Risk distribution</h3><span className="muted">{rows.length} systems</span></header><div className="body">
          <div className="dist">{sum.dist.filter(d => d.count || ['minimal', 'limited', 'high', 'prohibited'].includes(d.key)).map(d => (
            <div className="row" key={d.key}><span>{d.label}</span><span className="track"><i style={{ width: `${d.count / max * 100}%`, background: BAR[d.tone] }} /></span><b className="num">{d.count}</b></div>
          ))}</div>
        </div></section>
      </div>

      {(sum.flagged.length > 0 || sum.unconfirmed.length > 0) && (
        <section className="panel"><header><h3>Needs attention</h3></header>
          <div className="scroll"><table className="ledger"><thead><tr><th>System</th><th>Why</th><th /></tr></thead><tbody>
            {sum.flagged.map(r => <tr key={r.id}><td><b>{r.name}</b></td><td><span className="pill t-warn">Reassess</span> Changed since the classification was confirmed: {r.reassess.join(', ')}</td><td className="num"><Link className="btn" href={`/o/${slug}/systems/${r.id}?tab=classify`}>Review</Link></td></tr>)}
            {sum.unconfirmed.map(r => <tr key={r.id}><td><b>{r.name}</b></td><td><span className="pill t-info">Unconfirmed</span> The classification is computed but nobody has confirmed it yet</td><td className="num"><Link className="btn" href={`/o/${slug}/systems/${r.id}?tab=classify`}>Confirm</Link></td></tr>)}
          </tbody></table></div>
        </section>
      )}

      <section className="panel"><header><h3>Risk score and classification per system</h3></header>
        {rows.length ? <div className="scroll"><table className="ledger">
          <thead><tr><th>System</th><th className="num">Score</th><th>Tier</th><th>Basis for the classification</th><th>Conformity assessment</th></tr></thead>
          <tbody>{ranked.map(r => (
            <tr key={r.id}>
              <td><Link href={`/o/${slug}/systems/${r.id}`} className="sysname" style={{ textDecoration: 'none', color: 'inherit' }}>{r.name}<small>{[r.unit, r.func].filter(Boolean).join(' · ')}</small></Link></td>
              <td className="num">{r.score != null ? <span className={`pill t-${scoreTone(r.score)}`}>{r.score.toFixed(1)}</span> : <span className="muted">–</span>}</td>
              <td><span className={`pill t-${r.tierTone}`}>{r.tierLabel}</span>{r.reassess.length > 0 && <span className="pill t-warn" style={{ marginLeft: 4 }}>Review needed</span>}</td>
              <td style={{ fontSize: 12.5 }}>{r.basis.length ? r.basis.slice(0, 2).join('; ') + (r.basis.length > 2 ? ` (+${r.basis.length - 2} more)` : '') : <span className="muted">Not classified yet</span>}</td>
              <td style={{ fontSize: 12.5 }}>{r.art43 ? <><span className="pill t-warn">Art. 43 likely</span> {r.conf}% confirmed</> : <span className="muted">Not required on current answers</span>}</td>
            </tr>
          ))}</tbody>
        </table></div> : <div className="empty"><p>No systems yet. <Link href={`/o/${slug}`}>Add one in the inventory.</Link></p></div>}
      </section>
      <p className="muted" style={{ fontSize: 12 }}>The score is computed from the answers recorded for each system. It is a structured starting point, not legal advice.</p>
    </>
  );
}
