/* AI spend across the installation: by client, agent, model and source, with monthly budgets. Works with or
 * without an external control plane such as IBM watsonx Orchestrate. */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/data';
import { requireViewer } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { SiteFoot } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/ActionForm';
import { saveBudget, removeBudget } from '@/app/actions';
import { spendReport, spendMonths, budgets, money, monthKey, AGENT_LABEL, SOURCE_LABEL, type BudgetState } from '@/lib/spend';
import { tracingOn } from '@/lib/telemetry';

export const metadata = { title: 'AI spend' };
export const dynamic = 'force-dynamic';

const tok = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function BudgetBar({ b }: { b: BudgetState }) {
  const tone = b.over ? 'crit' : b.warn ? 'warn' : 'good';
  return (
    <div className="budget">
      <div className="budget-bar" role="img" aria-label={`${b.pct}% of budget used`}><i className={`b-${tone}`} style={{ width: `${Math.min(100, b.pct)}%` }} /><span style={{ left: `${b.alertPct}%` }} title={`Alert at ${b.alertPct}%`} /></div>
      <small className="muted">{money(b.spent)} of {money(b.limit)} ({b.pct}%){b.hardStop ? ' · stops new AI work when reached' : ' · alerts only'}</small>
    </div>
  );
}

type Row = { k: string; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
function Breakdown({ title, rows, label, total }: { title: string; rows: Row[]; label: (k: string) => React.ReactNode; total: number }) {
  return (
    <section className="panel"><header><h3>{title}</h3></header>
      {rows.length ? <div className="scroll"><table className="ledger finops">
        <thead><tr><th>{title.replace(/^By /, '').replace(/^./, c => c.toUpperCase())}</th><th className="num">Calls</th><th className="num">Input</th><th className="num">Cached</th><th className="num">Output</th><th className="num">Est. cost</th><th>Share</th></tr></thead>
        <tbody>{rows.map(r => (
          <tr key={r.k}><td>{label(r.k)}</td><td className="num">{r.calls.toLocaleString('en-GB')}</td><td className="num">{tok(r.input + r.cacheWrite)}</td><td className="num">{tok(r.cacheRead)}</td><td className="num">{tok(r.output)}</td><td className="num"><b>{money(r.cost)}</b></td>
            <td><div className="barwrap"><div className="bar"><i style={{ width: `${total ? (r.cost / total) * 100 : 0}%` }} /></div>{total ? Math.round((r.cost / total) * 100) : 0}%</div></td></tr>
        ))}</tbody>
      </table></div> : <div className="body"><p className="muted">No AI use this month.</p></div>}
    </section>
  );
}

export default async function SpendPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const viewer = await requireViewer();
  if (viewer.role !== 'ITUTI_ADMIN') notFound();
  const sp = await searchParams;
  const m = /^\d{4}-\d{2}$/.test(sp.m || '') ? sp.m! : monthKey();
  const current = m === monthKey();
  const [rep, months, orgs, saved] = await Promise.all([spendReport(m), spendMonths(), db.organizations.all({ orderBy: [['name', 'asc']] }), db.spendBudgets.all()]);
  const orgName = new Map(orgs.map(o => [o.id, o.name]));
  const global = (await budgets()).global;
  const orgBudgets = await Promise.all(saved.filter(b => b.scope !== 'global').map(async b => ({ b, st: (await budgets(b.scope)).org })));
  const maxDay = Math.max(...rep.daily.map(d => d.cost), 0.0001);

  return (
    <>
      <TopBar viewer={viewer} current="spend" />
      <main className="wrap">
        <section className="pf-head">
          <div className="titles">
            <span className="eyebrow">FinOps</span>
            <h1>AI spend</h1>
            <p className="muted">Every call to Claude made by the assessment crew, the agent endpoints and evidence review, priced at list rates. {tracingOn() ? 'Traces are also sent to watsonx Orchestrate.' : 'No external control plane is needed.'}</p>
          </div>
          <form className="formrow" style={{ alignItems: 'flex-end' }}>
            <label className="field"><span>Month</span>
              <select name="m" defaultValue={m}>{months.map(k => <option key={k} value={k}>{monthLabel(k)}</option>)}</select></label>
            <button className="btn">Show</button>
            <a className="btn" href={`/admin/spend/export.csv?m=${m}`}>Download CSV</a>
          </form>
        </section>

        <section className="stats" aria-label="Spend summary">
          <div className="stat"><b>{money(rep.total.cost)}</b><span>{current ? 'Spent this month' : `Spent in ${monthLabel(m)}`}</span></div>
          {current && <div className="stat"><b>{money(rep.forecast)}</b><span>Forecast for the month</span></div>}
          <div className={`stat ${global?.over ? 'alert' : ''}`}><b>{global ? `${global.pct}%` : '–'}</b><span>{global ? `Of the ${money(global.limit)} monthly budget` : 'No overall budget set'}</span></div>
          <div className="stat"><b>{rep.total.calls.toLocaleString('en-GB')}</b><span>Model calls</span></div>
          <div className="stat"><b>{tok(rep.total.tokens)}</b><span>Tokens</span></div>
        </section>

        <section className="panel"><header><h3>Daily spend</h3><small className="muted">{monthLabel(m)}, UTC</small></header>
          <div className="body">
            <div className="daybars" role="img" aria-label="Spend per day">
              {rep.daily.map(d => <div key={d.d} className="daybar" title={`${d.d}: ${money(d.cost)}`}><i style={{ height: `${(d.cost / maxDay) * 100}%` }} /><span>{Number(d.d.slice(8))}</span></div>)}
            </div>
          </div>
        </section>

        <div className="grid2 spend-grid">
          <Breakdown title="By client" rows={rep.byOrg} total={rep.total.cost} label={k => k ? (orgName.has(k) ? <Link href={`/o/${orgs.find(o => o.id === k)!.slug}`}>{orgName.get(k)}</Link> : 'Deleted client') : 'Not linked to a client'} />
          <Breakdown title="By agent" rows={rep.byAgent} total={rep.total.cost} label={k => AGENT_LABEL[k] || k} />
          <Breakdown title="By model" rows={rep.byModel} total={rep.total.cost} label={k => <span className="mono">{k}</span>} />
          <Breakdown title="By source" rows={rep.bySource} total={rep.total.cost} label={k => SOURCE_LABEL[k] || k} />
        </div>

        <section className="panel"><header><div><h3>Budgets</h3><small className="muted">Monthly limits in US dollars. Admins (and the client&rsquo;s admins, for a client budget) are emailed at the alert level and when the budget is reached. With a hard stop, new assessments, agent requests and reviews are refused until the budget is raised or the month ends.</small></div></header>
          <div className="body">
            {(global || orgBudgets.length > 0) && (
              <table className="ledger"><thead><tr><th>Scope</th><th style={{ width: '50%' }}>This month</th><th /></tr></thead>
                <tbody>
                  {global && <tr><td><b>All clients</b></td><td><BudgetBar b={global} /></td><td className="num"><ActionForm action={removeBudget}><input type="hidden" name="scope" value="global" /><Submit className="linkbtn">Remove</Submit></ActionForm></td></tr>}
                  {orgBudgets.map(({ b, st }) => <tr key={b.scope}><td>{orgName.get(b.scope) || 'Deleted client'}</td><td>{st ? <BudgetBar b={st} /> : null}</td><td className="num"><ActionForm action={removeBudget}><input type="hidden" name="scope" value={b.scope} /><Submit className="linkbtn">Remove</Submit></ActionForm></td></tr>)}
                </tbody></table>
            )}
            <ActionForm action={saveBudget} className="formrow" style={{ alignItems: 'flex-end' }}>
              <label className="field"><span>Applies to</span>
                <select name="scope" defaultValue="global"><option value="global">All clients</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
              <label className="field"><span>Monthly budget (USD)</span><input type="number" name="monthly" min={1} step="0.01" required placeholder="e.g. 500" /></label>
              <label className="field" style={{ flex: '0 0 120px' }}><span>Alert at (%)</span><input type="number" name="alertPct" min={10} max={100} defaultValue={80} /></label>
              <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" name="hardStop" /> Stop new AI work when reached</label>
              <Submit className="btn primary">Save budget</Submit>
            </ActionForm>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Costs are estimates at Anthropic list prices; set ANTHROPIC_PRICES on the server for negotiated rates. Web searches (only when outside research is switched on) are billed separately by Anthropic and are not included.</p>
          </div>
        </section>
      </main>
      <SiteFoot />
    </>
  );
}
