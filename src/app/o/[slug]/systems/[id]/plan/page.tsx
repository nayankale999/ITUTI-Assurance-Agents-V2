import { systemForDoc } from '@/lib/docs';
import { planFor } from '@/lib/plan';
import { statusLabel } from '@/lib/incidents';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Remediation plan' };

export default async function RemediationPlan({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const plan = await planFor(id, d.sys);
  const done = plan.actions.filter(a => ['resolved', 'closed'].includes(a.status));
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Remediation plan" org={d.org.name} title={d.name}
      subtitle={`${plan.rows.length} open gap${plan.rows.length === 1 ? '' : 's'}: ${plan.withAction} with an action, ${plan.withoutAction} without; ${plan.overdue} action${plan.overdue === 1 ? '' : 's'} overdue`}>
      <h2>Open gaps and their actions</h2>
      {plan.rows.length ? <table><thead><tr><th>Gap</th><th>Priority</th><th>Owner</th><th>Department</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>{plan.rows.map(({ gap: g, action: a }) => (
          <tr key={g.ref}><td><b>{g.title}</b><div className="muted">{g.area} · {g.status}</div><div style={{ whiteSpace: 'pre-wrap' }}>{a ? a.notes : g.suggested}</div></td>
            <td>{g.severity}</td><td>{a?.ownerName || <i>No action raised</i>}</td><td>{a?.department || '–'}</td><td>{a?.due || '–'}</td><td>{a ? statusLabel(a.status) : '–'}</td></tr>
        ))}</tbody></table> : <p>No open gaps.</p>}
      {plan.closable.length > 0 && <><h2>Actions whose gap has since closed</h2><ul>{plan.closable.map(a => <li key={a.id}>{a.title} ({a.ownerName}, {a.department}): ready to mark resolved</li>)}</ul></>}
      {done.length > 0 && <><h2>Completed actions</h2><table><thead><tr><th>Action</th><th>Owner</th><th>Department</th><th>Status</th></tr></thead>
        <tbody>{done.map(a => <tr key={a.id}><td>{a.title}</td><td>{a.ownerName}</td><td>{a.department}</td><td>{statusLabel(a.status)}</td></tr>)}</tbody></table></>}
    </DocShell>
  );
}
