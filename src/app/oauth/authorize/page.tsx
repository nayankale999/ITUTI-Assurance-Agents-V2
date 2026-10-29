/* Approval screen for MCP clients connecting with OAuth (Claude, IBM watsonx Orchestrate and others). The person
 * chooses which client organisation the application may work on; their own rights then apply to everything it does. */
import { redirect } from 'next/navigation';
import { getViewer, visibleOrgs, capsFor } from '@/lib/session';
import { checkAuthorize } from '@/lib/oauth';
import { decideOAuth } from '@/app/actions';
import { Brand } from '@/components/Brand';

export const metadata = { title: 'Connect an application' };
export const dynamic = 'force-dynamic';

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])) as [string, string][]);
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${q}`)}`);
  const check = await checkAuthorize(q);
  if ('redirect' in check) redirect(check.redirect);
  const orgs = 'ok' in check ? (await Promise.all((await visibleOrgs(viewer)).map(async o => ({ o, caps: await capsFor(viewer, o.id) })))).filter(x => x.caps.view) : [];
  return (
    <main className="wrap" style={{ maxWidth: 560, paddingTop: 48 }}>
      <Brand />
      <section className="panel" style={{ marginTop: 24 }}>
        {'fatal' in check ? (
          <div className="body"><h1 style={{ fontSize: 22 }}>This connection cannot be completed</h1><p className="muted">{check.fatal}</p></div>
        ) : (
          <form action={decideOAuth} className="body oauth">
            <h1 style={{ fontSize: 22, margin: 0 }}>Connect {check.ok.client.name}</h1>
            <p className="muted" style={{ margin: 0 }}><b>{check.ok.client.name}</b> wants to use Ituti AI Assurance as <b>{viewer.name || viewer.email}</b>. It will be able to read the AI systems, evidence, assessments, gaps, incidents and AI spend of the organisation you choose, register systems, add evidence, start assessments and record incidents, within your own rights. It cannot accept proposals or change settings.</p>
            <input type="hidden" name="query" value={q.toString()} />
            {orgs.length ? (
              <label className="field"><span>Organisation</span>
                <select name="orgId" required defaultValue={orgs[0].o.id}>{orgs.map(({ o }) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            ) : <p className="err">You do not have access to any organisation yet.</p>}
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>After approving you return to {new URL(check.ok.redirectUri).host}. You can disconnect it at any time from the organisation&rsquo;s page.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn primary" name="decision" value="allow" disabled={!orgs.length}>Allow</button>
              <button className="btn" name="decision" value="deny" formNoValidate>Deny</button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
