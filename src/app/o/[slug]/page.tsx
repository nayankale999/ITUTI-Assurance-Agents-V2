import Link from 'next/link';
import { db } from '@/data';
import { orgForPage } from '@/lib/session';
import { TIERS, OPTS } from '@/lib/assurance';
import { ROLE_LABEL } from '@/lib/permissions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createSystem, renameOrg, setOrgAi, setOrgPlan, createOrgApiKey, revokeOrgApiKey } from '@/app/actions';
import { PLAN_LABEL, monthUsage, FREE_RERUN_DAYS } from '@/lib/usage';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await db.organizations.first({ slug });
  return { title: org?.name || 'Client' };
}

const tierPill = (t: string) => { const x = TIERS[t] || TIERS.unknown; return <span className={`pill t-${x.tone}`}>{x.label}</span>; };
const fnLabel = (v: unknown) => (OPTS.func.find(o => o[0] === v) || [, ''])[1];
const riskTone = (s: number) => s >= 75 ? 'crit' : s >= 50 ? 'warn' : s >= 25 ? 'info' : 'good';

export default async function Portfolio({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { viewer, org, caps } = await orgForPage(slug);
  const systems = await db.aiSystems.find({ orgId: org.id }, { orderBy: [['updatedAt', 'desc']] });
  const editable = caps.orgRole === 'CONTRIBUTOR'
    ? new Set((await db.systemAssignments.find({ userId: viewer.id })).map(a => a.systemId))
    : null;
  const groups = new Map<string, typeof systems>();
  for (const s of systems) {
    const unit = String((s.data as { profile?: { client?: string } }).profile?.client || '') || 'No business unit set';
    groups.set(unit, [...(groups.get(unit) || []), s]);
  }
  const high = systems.filter(s => s.tier === 'high').length;
  const flagged = systems.filter(s => s.tier === 'prohibited' || s.tier === 'review').length;
  const avg = systems.length ? Math.round(systems.reduce((a, s) => a + s.readiness, 0) / systems.length) : 0;
  const inc = systems.reduce((a, s) => a + s.openIncidents, 0);
  const roleNote = caps.staff ? null : caps.orgRole ? `You are signed in as ${ROLE_LABEL[caps.orgRole].toLowerCase()}.` : null;

  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}>
        <div className="titles">
          <span className="eyebrow">AI system portfolio</span>
          <h1>{org.name}</h1>
          <p className="muted">Classify each AI system, assess it against the controls that apply, and keep its model card and monitoring in one record.{roleNote ? ` ${roleNote}` : ''}</p>
        </div>
        {caps.createSystems && (
          <ActionForm action={createSystem} className="formrow" style={{ alignItems: 'center' }}>
            <input type="hidden" name="orgId" value={org.id} />
            <input type="text" name="name" id="new-system" placeholder="System name" aria-label="New system name" style={{ width: 220 }} />
            <Submit className="btn primary">+ Add AI system</Submit>
          </ActionForm>
        )}
      </section>
      <section className="stats" aria-label="Portfolio summary">
        <div className="stat"><b>{systems.length}</b><span>AI systems</span></div>
        <div className="stat"><b>{high}</b><span>High risk (EU AI Act)</span></div>
        <div className={`stat ${flagged ? 'alert' : ''}`}><b>{flagged}</b><span>Prohibited or needing legal review</span></div>
        <div className="stat"><b>{avg}%</b><span>Average control readiness</span></div>
        <div className={`stat ${inc ? 'alert' : ''}`}><b>{inc}</b><span>Open incidents</span></div>
      </section>
      <section className="panel">
        {systems.length ? (
          <div className="scroll"><table className="ledger">
            <thead><tr><th>System</th><th>EU AI Act tier</th><th className="num">Inherent risk</th><th>Control readiness</th><th className="num">Open incidents</th><th>Updated</th></tr></thead>
            <tbody>{[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unit, list]) => (
              <GroupRows key={unit} unit={unit} rows={list.map(s => (
                <tr key={s.id}>
                  <td><Link href={`/o/${org.slug}/systems/${s.id}`} className="sysname" style={{ textDecoration: 'none', color: 'inherit' }}>{s.name}<small>{fnLabel((s.data as { profile?: { func?: string } }).profile?.func) || 'Function not set'}{editable && !editable.has(s.id) ? ' · read only' : ''}</small></Link></td>
                  <td>{tierPill(s.tier)}</td>
                  <td className="num">{s.riskScore != null ? <span className={`pill t-${riskTone(s.riskScore)}`}>{s.riskScore}</span> : <span className="muted">–</span>}</td>
                  <td><div className="barwrap"><div className="bar"><i style={{ width: `${s.readiness}%` }} /></div>{s.readiness}%</div></td>
                  <td className="num">{s.openIncidents ? <span className="pill t-warn">{s.openIncidents}</span> : <span className="muted">0</span>}</td>
                  <td className="muted mono">{s.updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                </tr>
              ))} />
            ))}</tbody>
          </table></div>
        ) : (
          <div className="empty"><h3>No AI systems recorded yet</h3><p>{caps.createSystems ? 'Add the first system above to classify it and start the assessment.' : 'Your organisation’s admin or Ituti assessor will add systems here.'}</p></div>
        )}
      </section>
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
          {viewer.role === 'ITUTI_ADMIN' && <AgentAccess orgId={org.id} plan={org.plan} aiEnabled={org.aiEnabled} />}
          {viewer.role === 'ITUTI_ADMIN' && <DeleteOrg orgId={org.id} name={org.name} />}
        </div></section>
      )}
    </>
  );
}

function GroupRows({ unit, rows }: { unit: string; rows: React.ReactNode[] }) {
  return (<>
    <tr className="group"><td colSpan={6}>{unit} · {rows.length}</td></tr>
    {rows}
  </>);
}

import { deleteOrg } from '@/app/actions';
const day = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

async function AgentAccess({ orgId, plan, aiEnabled }: { orgId: string; plan: string; aiEnabled: boolean }) {
  const keys = await db.apiKeys.find({ orgId }, { orderBy: [['createdAt', 'desc']] });
  const use = await monthUsage(orgId);
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
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
      <p className="muted">Agent card: <span className="mono">{base}/.well-known/agent-card.json</span> · endpoint: <span className="mono">{base}/api/a2a</span>{!aiEnabled && <> · <b>switch AI assistance on above, or the agent will refuse to run assessments</b></>}</p>
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
