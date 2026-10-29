/* Installation status for administrators: version, database, storage, email, AI and observability settings,
 * and one-time sign-in links for installations without a mail server. Shows no secrets. */
import fs from 'fs/promises';
import path from 'path';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/data';
import { pool, query, ready } from '@/data/sql';
import { requireViewer } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { SiteFoot } from '@/components/Brand';
import { ActionForm, Submit } from '@/components/ActionForm';
import { issueSignInLink } from '@/app/actions';
import { APP_VERSION, DEPLOYMENT } from '@/lib/version';
import { tracingOn } from '@/lib/telemetry';
import { orchestrateIds } from '@/lib/agent/specialists';
import { agentModel } from '@/lib/agent/llm';
import { budgets, money } from '@/lib/spend';

export const metadata = { title: 'System' };
export const dynamic = 'force-dynamic';

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
const Ok = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => <span className={`pill ${ok ? 't-good' : 't-warn'}`}>{children}</span>;

export default async function SystemPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'ITUTI_ADMIN') notFound();
  await ready();
  const [ver] = await query<{ v: string }>(pool(), 'SELECT VERSION() AS v');
  const migs = await query<{ name: string; appliedAt: Date }>(pool(), 'SELECT name, appliedAt FROM schema_migrations ORDER BY name');
  const dir = path.resolve(process.env.DATA_DIR || 'data');
  let disk: { free: number; total: number } | null = null;
  try { const s = await fs.statfs(dir); disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { disk = null; }
  const [docs] = await query<{ n: number; size: number | null }>(pool(), 'SELECT COUNT(*) AS n, SUM(size) AS size FROM documents');
  const users = await db.users.count({ disabled: false });
  const orgs = await db.organizations.count({});
  const smtp = !!process.env.SMTP_HOST;
  const ai = !!process.env.ANTHROPIC_API_KEY || process.env.AGENT_FAKE_LLM === '1';
  const ids = orchestrateIds();
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const g = (await budgets()).global;
  const rows: [string, React.ReactNode][] = [
    ['Version', <><b>{APP_VERSION}</b> · {DEPLOYMENT} · Node.js {process.version.slice(1)}</>],
    ['Address', <span className="mono">{process.env.NEXTAUTH_URL || '(not set)'}</span>],
    ['Database', <>{ver?.v} · {migs.length} migrations applied (latest {migs[migs.length - 1]?.name})</>],
    ['Document storage', <><span className="mono">{dir}</span>{disk ? <> · {gb(disk.free)} free of {gb(disk.total)}</> : null} · {Number(docs?.n || 0)} documents, {gb(Number(docs?.size || 0))}{disk && disk.free < 5 * 1024 ** 3 ? <> <Ok ok={false}>Low on space</Ok></> : null}</>],
    ['Email', smtp ? <><Ok ok>Configured</Ok> <span className="mono">{process.env.SMTP_HOST}:{process.env.SMTP_PORT || 587}</span></> : <><Ok ok={false}>No mail server</Ok> Sign-in links are not emailed; issue them below.</>],
    ['AI (Claude)', ai ? <><Ok ok>Configured</Ok> agent model <span className="mono">{agentModel()}</span>{process.env.ANTHROPIC_BASE_URL ? <> · through gateway <span className="mono">{process.env.ANTHROPIC_BASE_URL}</span></> : ' · direct to Anthropic'}{proxy ? ' · via outbound proxy' : ''}</> : <Ok ok={false}>Not configured: assessments, agents and reviews are off</Ok>],
    ['Cost estimates', process.env.ANTHROPIC_PRICES ? 'Custom prices (ANTHROPIC_PRICES)' : 'Anthropic list prices'],
    ['AI budget', g ? <>{money(g.spent)} of {money(g.limit)} this month{g.hardStop ? ', hard stop' : ''} · <Link href="/admin/spend">Spend</Link></> : <>No overall budget · <Link href="/admin/spend">Set one</Link></>],
    ['MCP server', <><span className="mono">{process.env.NEXTAUTH_URL || ''}/api/mcp</span> · OAuth sign-in or client API key</>],
    ['Control plane', tracingOn() ? <><Ok ok>Sending traces to watsonx Orchestrate</Ok> {Object.keys(ids).length} agent IDs set</> : 'None: spend and agent use are tracked on the Spend page'],
    ['Self sign-up', process.env.SELF_REGISTRATION === 'off' ? 'Off (invitation only)' : 'Open at /register'],
    ['Usage', `${orgs} client${orgs === 1 ? '' : 's'}, ${users} active user${users === 1 ? '' : 's'}`],
  ];
  return (
    <>
      <TopBar viewer={viewer} current="system" />
      <main className="wrap">
        <section className="pf-head"><div className="titles"><span className="eyebrow">Administration</span><h1>System</h1><p className="muted">How this installation is set up. Settings are changed in the server&rsquo;s environment file (on-premises: re-run the installer).</p></div></section>
        <section className="panel"><div className="scroll"><table className="ledger"><tbody>
          {rows.map(([k, v]) => <tr key={k}><th scope="row" style={{ width: 190 }}>{k}</th><td>{v}</td></tr>)}
        </tbody></table></div></section>
        <section className="panel"><header><div><h3>One-time sign-in link</h3><small className="muted">For a user who cannot receive email. The link works once, within 60 minutes. Share it privately.</small></div></header>
          <div className="body">
            <ActionForm action={issueSignInLink} className="formrow" style={{ alignItems: 'flex-end' }}>
              <label className="field"><span>User&rsquo;s email address</span><input type="email" name="email" required placeholder="name@company.com" /></label>
              <Submit>Make link</Submit>
            </ActionForm>
          </div>
        </section>
        <section className="panel"><header><h3>Database migrations</h3></header>
          <div className="scroll"><table className="ledger"><thead><tr><th>Migration</th><th>Applied</th></tr></thead>
            <tbody>{migs.map(m => <tr key={m.name}><td className="mono">{m.name}</td><td className="muted">{new Date(m.appliedAt).toLocaleString('en-GB')}</td></tr>)}</tbody></table></div>
        </section>
      </main>
      <SiteFoot />
    </>
  );
}
