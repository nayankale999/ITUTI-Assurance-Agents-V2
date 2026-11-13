import Link from 'next/link';
import { db } from '@/data';
import { orgForPage } from '@/lib/session';
import { ROLE_LABEL } from '@/lib/permissions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createSystem, renameOrg, setOrgAi, setOrgPlan, setOrgSubscription, decideUpgrade, createOrgApiKey, revokeOrgApiKey, revokeConnectedApp } from '@/app/actions';
import { SUBSCRIPTION_LABEL, SUBSCRIPTIONS, limitText, systemLimit, pendingUpgrade } from '@/lib/subscription';
import { connectedApps } from '@/lib/oauth';
import { PLAN_LABEL, monthUsage, FREE_RERUN_DAYS } from '@/lib/usage';
import { inventory } from '@/lib/portfolio';
import { InventoryTable } from '@/components/InventoryTable';
import { ResumeBanner } from '@/components/ResumeBanner';
import { activeSpecialists, COORDINATOR, crewName, orchestrateIds } from '@/lib/agent/specialists';
import { crewUsage, tokens } from '@/lib/finops';
import { usd } from '@/lib/agent/pricing';
import { tracingOn } from '@/lib/telemetry';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await db.organizations.first({ slug });
  return { title: org?.name || 'Client' };
}


export default async function Portfolio({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { viewer, org, caps } = await orgForPage(slug);
  const rows = await inventory(org.id);
  const editable = caps.orgRole === 'CONTRIBUTOR'
    ? new Set((await db.systemAssignments.find({ userId: viewer.id })).map(a => a.systemId))
    : null;
  const high = rows.filter(s => s.tier === 'high').length;
  const flagged = rows.filter(s => s.tier === 'prohibited' || s.tier === 'review').length;
  const review = rows.filter(s => s.reassess.length).length;
  const inc = rows.reduce((a, s) => a + s.openIncidents, 0);
  const complete = rows.filter(s => s.stage === 5).length;
  const roleNote = caps.staff ? null : caps.orgRole ? `You are signed in as ${ROLE_LABEL[caps.orgRole].toLowerCase()}.` : null;
  const limit = systemLimit(org.subscription);
  const full = limit != null && rows.length >= limit;
  const pending = await pendingUpgrade(org.id);

  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}>
        <div className="titles">
          <span className="eyebrow">AI inventory</span>
          <h1>{org.name}</h1>
          <p className="muted">One record of every AI system: who is responsible for it, what it is for, its EU AI Act risk tier and how far its assessment has got.{roleNote ? ` ${roleNote}` : ''}</p>
        </div>
        {caps.createSystems && !full && (
          <ActionForm action={createSystem} className="formrow" style={{ alignItems: 'center' }}>
            <input type="hidden" name="orgId" value={org.id} />
            <input type="text" name="name" id="new-system" placeholder="System name" aria-label="New system name" style={{ width: 220 }} />
            <Submit className="btn primary">+ Add AI system</Submit>
          </ActionForm>
        )}
      </section>
      <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        <span className="pill t-info">{SUBSCRIPTION_LABEL[org.subscription]}</span>{' '}
        {limit == null ? 'Unlimited AI systems.' : `${rows.length} of ${limit} AI system${limit === 1 ? '' : 's'} used.`}
        {pending ? <> <Link href={`/o/${org.slug}/plans`}>Upgrade to {SUBSCRIPTION_LABEL[pending.toTier]} requested</Link>; Ituti will confirm by email.</>
          : full && caps.createSystems ? <> Your {SUBSCRIPTION_LABEL[org.subscription]} plan includes {limitText(org.subscription)}. To add more, <Link href={`/o/${org.slug}/plans`} className="btn primary" style={{ padding: '3px 12px', marginLeft: 4 }}>Upgrade your plan</Link></>
          : caps.manage && org.subscription !== 'enterprise' ? <> <Link href={`/o/${org.slug}/plans`}>Compare plans</Link></> : null}
      </p>
      <ResumeBanner slug={org.slug} systemIds={rows.map(r => r.id)} />
      <section className="stats" aria-label="Inventory summary">
        <div className="stat"><b>{rows.length}</b><span>AI systems</span></div>
        <div className="stat"><b>{high}</b><span>High risk (EU AI Act)</span></div>
        <div className={`stat ${flagged ? 'alert' : ''}`}><b>{flagged}</b><span>Prohibited or needing legal review</span></div>
        <div className={`stat ${review ? 'alert' : ''}`}><b>{review}</b><span>Flagged for reassessment</span></div>
        <div className="stat"><b>{complete}</b><span>Compliance journey complete</span></div>
        <div className={`stat ${inc ? 'alert' : ''}`}><b>{inc}</b><span>Open incidents</span></div>
      </section>
      {rows.length ? <>
        <InventoryTable rows={rows} slug={org.slug} readOnly={editable ? rows.filter(r => !editable.has(r.id)).map(r => r.id) : null} />
        <p className="muted" style={{ fontSize: 13 }}>Export: <Link href={`/o/${org.slug}/documents/inventory`}>AI inventory report (PDF)</Link> · <a href={`/o/${org.slug}/documents/inventory.csv`}>spreadsheet (CSV)</a></p>
      </> : (
        <section className="panel"><div className="empty"><h3>No AI systems recorded yet</h3><p>{caps.createSystems ? 'Add the first system above. A short guided profile puts it in the inventory with its risk tier.' : 'Your organisation’s admin or Ituti assessor will add systems here.'}</p></div></section>
      )}
      {caps.manage && <ConnectedApps orgId={org.id} />}
      {caps.staff && (
        <section className="panel"><header><h3>Client settings</h3></header><div className="body">
          <ActionForm action={renameOrg} className="formrow">
            <input type="hidden" name="orgId" value={org.id} />
            <label className="field"><span>Client name</span><input type="text" name="name" id="org-rename" defaultValue={org.name} required minLength={2} maxLength={120} /></label>
            <Submit>Save name</Submit>
          </ActionForm>
          {viewer.role === 'ITUTI_ADMIN' && (
            <ActionForm action={setOrgAi} className="formrow" style={{ alignItems: 'center' }}>
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="on" value={org.aiEnabled ? 'false' : 'true'} />
              <div className="field" style={{ flex: '1 1 420px' }}>
                <span>AI assistance is <b>{org.aiEnabled ? 'on' : 'off'}</b> for this client</span>
                <small className="muted">When on, the assessment agent and AI review send this client’s documents and assessment text to Anthropic’s API. Switch it on only once the client has agreed.</small>
              </div>
              <Submit className={org.aiEnabled ? 'btn' : 'btn primary'}>{org.aiEnabled ? 'Switch off' : 'Switch on'}</Submit>
            </ActionForm>
          )}
          {viewer.role === 'ITUTI_ADMIN' && pending && <UpgradeDecision requestId={pending.id} toTier={pending.toTier} message={pending.message} requestedById={pending.requestedById} createdAt={pending.createdAt} from={org.subscription} />}
          {viewer.role === 'ITUTI_ADMIN' && (
            <ActionForm action={setOrgSubscription} className="formrow" style={{ alignItems: 'flex-end' }}>
              <input type="hidden" name="orgId" value={org.id} />
              <label className="field"><span>Subscription</span>
                <select name="subscription" id="org-subscription" defaultValue={org.subscription}>{SUBSCRIPTIONS.map(k => <option key={k} value={k}>{SUBSCRIPTION_LABEL[k]} ({limitText(k)})</option>)}</select>
              </label>
              <Submit>Save subscription</Submit>
              <small className="muted" style={{ flex: '1 1 260px' }}>{org.signupSource ? <>Signed up through the <b>{org.signupSource}</b> link. </> : null}Lowering the subscription keeps existing systems; the client just cannot add more until it is under the limit.</small>
            </ActionForm>
          )}
          {viewer.role === 'ITUTI_ADMIN' && <AgentAccess orgId={org.id} plan={org.plan} aiEnabled={org.aiEnabled} />}
          {viewer.role === 'ITUTI_ADMIN' && <DeleteOrg orgId={org.id} name={org.name} />}
        </div></section>
      )}
    </>
  );
}

import { deleteOrg } from '@/app/actions';
import type { Subscription } from '@/data';

async function UpgradeDecision({ requestId, toTier, message, requestedById, createdAt, from }: { requestId: string; toTier: Subscription; message: string | null; requestedById: string; createdAt: Date; from: Subscription }) {
  const who = await db.users.first({ id: requestedById });
  return (
    <div className="field" style={{ border: '1px solid var(--violet)', borderRadius: 8, padding: 12, gap: 8 }}>
      <span><span className="pill t-info">Upgrade requested</span> {who?.name || who?.email} ({who?.email}) asked on {day(createdAt)} to move from {SUBSCRIPTION_LABEL[from]} to <b>{SUBSCRIPTION_LABEL[toTier]}</b> ({limitText(toTier)}).</span>
      {message && <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--line-strong)' }} className="muted">{message}</blockquote>}
      <div className="formrow" style={{ gap: 8 }}>
        <ActionForm action={decideUpgrade}><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="decision" value="approve" /><Submit className="btn primary">Approve: move to {SUBSCRIPTION_LABEL[toTier]}</Submit></ActionForm>
        <ActionForm action={decideUpgrade}><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="decision" value="decline" /><Submit>Decline</Submit></ActionForm>
      </div>
    </div>
  );
}
const day = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

async function AgentAccess({ orgId, plan, aiEnabled }: { orgId: string; plan: string; aiEnabled: boolean }) {
  const keys = await db.apiKeys.find({ orgId }, { orderBy: [['createdAt', 'desc']] });
  const use = await monthUsage(orgId);
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  const now = new Date();
  const crew = await crewUsage(orgId, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const ids = orchestrateIds();
  return (
    <div className="agent-access">
      <h4>Billing and agent access (IBM watsonx Orchestrate)</h4>
      <ActionForm action={setOrgPlan} className="formrow" style={{ alignItems: 'flex-end' }}>
        <input type="hidden" name="orgId" value={orgId} />
        <label className="field"><span>Plan</span>
          <select name="plan" id="org-plan" defaultValue={plan}>{Object.entries(PLAN_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <Submit>Save plan</Submit>
      </ActionForm>
      <p className="muted">This month: <b>{use.total}</b> assessment{use.total === 1 ? '' : 's'} ({use.billable} billable, {use.viaAgent} through the agent endpoint). An assessment is counted when a pre-fill run completes; re-runs on the same system within {FREE_RERUN_DAYS} days are included.</p>
      <p className="muted">MCP server: <span className="mono">{base}/api/mcp</span> (OAuth sign-in, or this client&rsquo;s API key as a bearer token) · A2A agent card: <span className="mono">{base}/.well-known/agent-card.json</span> · endpoint: <span className="mono">{base}/api/a2a</span>{!aiEnabled && <> · <b>switch AI assistance on above, or the agent will refuse to run assessments</b></>}</p>
      <details className="crew-agents">
        <summary>Register the assessment crew as separate agents ({activeSpecialists().length + 1} addresses)</summary>
        <p className="muted">In watsonx Orchestrate, add each as an external A2A agent (protocol 0.3.0) with this client&rsquo;s API key as the bearer token. Each specialist then has its own Agent ID, runs, latency and token use. {tracingOn() ? 'Traces are being sent to Orchestrate.' : 'To send traces, set the ORCHESTRATE_* settings on the server (see the README).'}</p>
        <table className="ledger"><thead><tr><th>Agent</th><th>Address to register</th><th>Orchestrate ID</th></tr></thead>
          <tbody>
            <tr><td><b>Ituti AI Assurance</b><small className="muted" style={{ display: 'block' }}>Main agent: portfolio, registration, full assessments</small></td><td className="mono" style={{ fontSize: 12 }}>{base}/api/a2a</td><td className="muted mono" style={{ fontSize: 12 }}>{ids.coordinator ? `${ids.coordinator.slice(0, 8)}… (coordinator)` : '–'}</td></tr>
            {activeSpecialists().map(s => <tr key={s.key}><td><b>{s.name}</b><small className="muted" style={{ display: 'block' }}>{s.role}</small></td><td className="mono" style={{ fontSize: 12 }}>{base}/api/a2a/agents/{s.slug}</td><td className="muted mono" style={{ fontSize: 12 }}>{ids[s.key] ? `${ids[s.key].slice(0, 8)}…` : '–'}</td></tr>)}
          </tbody></table>
      </details>
      <h4 style={{ marginTop: 18 }}>Model use this month, by agent</h4>
      {crew.rows.length ? <>
        <div className="scroll"><table className="ledger finops"><thead><tr><th>Agent</th><th>Model</th><th className="num">Calls</th><th className="num">Input</th><th className="num">Cached</th><th className="num">Output</th><th className="num">Proposals</th><th className="num">Est. cost</th></tr></thead>
          <tbody>{crew.rows.map(r => (
            <tr key={r.key}><td>{r.key === 'coordinator' ? COORDINATOR.name : crewName(r.key)}</td><td className="mono muted" style={{ fontSize: 12 }}>{r.calls ? r.model : 'no model'}</td><td className="num">{r.calls || (r.tools ? `${r.tools} checks` : 0)}</td><td className="num">{tokens(r.input + r.cacheWrite)}</td><td className="num">{tokens(r.cacheRead)}</td><td className="num">{tokens(r.output)}</td><td className="num">{r.proposals || ''}</td><td className="num"><b>{usd(r.costUsd)}</b></td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={7}><b>{crew.runs} run{crew.runs === 1 ? '' : 's'}</b>{crew.legacyTokens ? <span className="muted"> · {tokens(crew.legacyTokens)} tokens from earlier runs without a breakdown</span> : null}</td><td className="num"><b>{usd(crew.total.cost)}</b></td></tr></tfoot>
        </table></div>
        <p className="muted" style={{ fontSize: 12 }}>Estimates at Anthropic list prices (set ANTHROPIC_PRICES to change them). Web searches by the model researcher are billed separately by Anthropic and not included.</p>
      </> : <p className="muted">No assessment runs this month.</p>}
      {keys.length > 0 && (
        <table className="ledger"><thead><tr><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead>
          <tbody>{keys.map(k => (
            <tr key={k.id}>
              <td>{k.name}<small className="muted mono" style={{ display: 'block' }}>{k.prefix}…</small></td>
              <td className="muted">{day(k.createdAt)}</td>
              <td className="muted">{k.revokedAt ? `Revoked ${day(k.revokedAt)}` : day(k.lastUsedAt)}</td>
              <td className="num">{!k.revokedAt && <ActionForm action={revokeOrgApiKey} confirm="Revoking stops every integration using this key."><input type="hidden" name="id" value={k.id} /><Submit className="linkbtn">Revoke</Submit></ActionForm>}</td>
            </tr>
          ))}</tbody></table>
      )}
      <ActionForm action={createOrgApiKey} className="formrow" resetOnSuccess>
        <input type="hidden" name="orgId" value={orgId} />
        <label className="field"><span>New API key for this client</span><input type="text" name="name" id="key-name" placeholder="e.g. watsonx Orchestrate production" required minLength={2} maxLength={120} /></label>
        <Submit>Create key</Submit>
      </ActionForm>
    </div>
  );
}
/** MCP clients (Claude, watsonx Orchestrate and others) people have connected to this organisation with OAuth. */
async function ConnectedApps({ orgId }: { orgId: string }) {
  const apps = await connectedApps({ orgId });
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  return (
    <section className="panel"><header><div><h3>Connected AI applications</h3><small className="muted">Add Ituti AI Assurance to Claude, IBM watsonx Orchestrate or any MCP client with the address <span className="mono">{base}/api/mcp</span>. Each person signs in and approves the connection; their own rights apply.</small></div></header>
      {apps.length ? <div className="scroll"><table className="ledger"><thead><tr><th>Application</th><th>Connected by</th><th>Since</th><th>Last used</th><th /></tr></thead>
        <tbody>{apps.map(a => (
          <tr key={a.familyId}><td>{a.app}</td><td>{a.user}</td><td className="muted">{day(a.since)}</td><td className="muted">{day(a.lastUsed)}</td>
            <td className="num"><ActionForm action={revokeConnectedApp} confirm="The application loses access until someone connects it again."><input type="hidden" name="familyId" value={a.familyId} /><Submit className="linkbtn">Disconnect</Submit></ActionForm></td></tr>
        ))}</tbody></table></div> : <div className="body"><p className="muted" style={{ margin: 0 }}>No applications connected yet.</p></div>}
    </section>
  );
}

function DeleteOrg({ orgId, name }: { orgId: string; name: string }) {
  return (
    <details>
      <summary className="muted" style={{ cursor: 'pointer' }}>Delete this client</summary>
      <ActionForm action={deleteOrg} className="formrow" style={{ marginTop: 10 }}>
        <input type="hidden" name="orgId" value={orgId} />
        <label className="field"><span>Deletes every system, incident and membership. Type <b>{name}</b> to confirm.</span><input type="text" name="confirm" id="org-delete-confirm" autoComplete="off" /></label>
        <Submit className="btn danger">Delete client</Submit>
      </ActionForm>
    </details>
  );
}
