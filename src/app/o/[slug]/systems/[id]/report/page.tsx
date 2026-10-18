import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/data';
import { requireViewer, systemAccess } from '@/lib/session';
import { PROFILE_SECTIONS, OPTS, AREAS, TIERS, classify, obligations, applicable, inherentRisk, readiness, frameworkCoverage, metricStatus, type AssessmentData } from '@/lib/assurance';
import { residualText } from '@/lib/report';
import { PrintButton } from '@/components/PrintButton';
import { currentValue, displayValue, fieldFor } from '@/lib/agent/fields';

export const metadata = { title: 'Assurance report' };
const optLabel = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];
const Tag = ({ tone, children }: { tone: string; children: React.ReactNode }) => <span className={`pill t-${tone}`}>{children}</span>;

export default async function Report({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const viewer = await requireViewer();
  const a = await systemAccess(viewer, id);
  if (!a || a.org.slug !== slug) notFound();
  const sys = a.system.data as AssessmentData;
  const p = sys.profile || {}, r = classify(sys), ir = inherentRisk(sys), rd = readiness(sys), list = applicable(sys), ctrl = sys.ctrl || {};
  const incidents = await db.incidents.find({ systemId: id }, { orderBy: [['date', 'desc'], ['createdAt', 'desc']] });
  const st = (s?: string) => ({ met: ['good', 'Met'], partial: ['warn', 'Partial'], gap: ['crit', 'Not met'], na: ['muted', 'N/A'] } as Record<string, string[]>)[s || ''] || ['muted', 'Open'];
  const tier = TIERS[r.tier] || TIERS.unknown;
  // Answers that came from an accepted agent proposal and have not been changed since
  const prov = Object.entries(sys.prov || {}).filter(([path, pv]) => { const cur = currentValue(sys, path); return cur !== undefined && JSON.stringify(cur) === pv.v; });
  const fromAgent = new Set(prov.map(([path]) => path));
  const props = prov.length ? await db.proposals.find({ id: prov.map(([, pv]) => pv.p) }) : [];
  const byId = new Map(props.map(x => [x.id, x]));
  const people = prov.length ? new Map((await db.users.find({ id: [...new Set(prov.map(([, pv]) => pv.u))] })).map(u => [u.id, u.name || u.email])) : new Map();
  const Mark = ({ path }: { path: string }) => (fromAgent.has(path) ? <span className="agent-mark" title="Proposed by the assessment agent and accepted by a reviewer">Agent</span> : null);
  return (
    <>
      <div className="doc-bar no-print"><Link href={`/o/${slug}/systems/${id}`}>&larr; Back to the system</Link><PrintButton /></div>
      <article className="doc">
        <p className="ref">AI ASSURANCE REPORT · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · {a.org.name}</p>
        <h1>{p.name || 'Untitled system'}</h1>
        <p className="muted">{p.client || ''}</p>
        <h2>Summary</h2>
        <table><tbody>
          <tr><th>EU AI Act classification</th><td><Tag tone={tier.tone}>{tier.label}</Tag></td></tr>
          <tr><th>Inherent risk</th><td>{ir ? <>{ir.score}/100 <Tag tone={ir.tone}>{ir.band}</Tag></> : 'Not scored'}</td></tr>
          <tr><th>Control readiness</th><td>{rd.pct}% ({rd.met} met, {rd.partial} partial, {rd.gap} not met, {rd.open} open, of {list.length} applicable)</td></tr>
          <tr><th>Open incidents</th><td>{incidents.filter(i => i.status !== 'closed').length}</td></tr>
          <tr><th>Position</th><td>{residualText(ir, rd.pct)}</td></tr>
        </tbody></table>
        <h2>System profile</h2>
        <table><tbody>{PROFILE_SECTIONS.flatMap(s => s.fields).filter(f => f.k !== 'name').map(f => {
          const v = p[f.k];
          const out = f.type === 'multi' ? (v || []).map((x: string) => optLabel(f.opts!, x)).join(', ') : f.type === 'select' ? optLabel(f.opts!, v) : v;
          return <tr key={f.k}><th>{f.k === 'client' ? 'Business unit' : f.label}</th><td>{out || '–'}<Mark path={`profile.${f.k}`} /></td></tr>;
        })}</tbody></table>
        <h2>Classification rationale</h2>
        <ul>{r.reasons.length ? r.reasons.map(x => <li key={x}>{x}</li>) : <li>Not yet classified.</li>}</ul>
        {r.flags.map(f => <p key={f} className="muted">Note: {f}</p>)}
        <h2>Applicable obligations</h2>
        {obligations(sys).map(o => <div key={o.region}><h3>{o.region}</h3><table><tbody>{o.items.map(([t, ref]) => <tr key={t}><td>{t}</td><td className="ref">{ref}</td></tr>)}</tbody></table></div>)}
        <h2>Framework coverage</h2>
        <table><thead><tr><th>Framework</th><th>Controls mapped</th><th>Readiness</th><th>Not met</th><th>Partial</th><th>Open</th></tr></thead>
          <tbody>{frameworkCoverage(sys).map(f => <tr key={f.key}><td>{f.name}</td><td>{f.count}</td><td>{f.r.pct}%</td><td>{f.r.gap}</td><td>{f.r.partial}</td><td>{f.r.open}</td></tr>)}</tbody></table>
        <h2>Control assessment</h2>
        {AREAS.map(([ar, name]) => {
          const items = list.filter(k => k.a === ar);
          if (!items.length) return null;
          return (
            <div key={ar}><h3>{name}</h3>
              <table><thead><tr><th style={{ width: 70 }}>Control</th><th>Requirement and evidence</th><th style={{ width: 90 }}>Status</th></tr></thead>
                <tbody>{items.map(k => { const c = ctrl[k.id] || {}; const [tone, lab] = st(c.s); return (
                  <tr key={k.id}><td className="ref">{k.id}</td><td>{k.q}<br /><span className="ref">{[k.eu && 'EU ' + k.eu, k.uk && 'UK ' + k.uk, k.iso && 'ISO 42001 ' + k.iso, k.nist && 'NIST ' + k.nist].filter(Boolean).join(' · ')}</span>{c.e && <><br /><span className="muted">Evidence: {c.e}</span></>}</td><td><Tag tone={tone}>{lab}</Tag><Mark path={`ctrl.${k.id}`} /></td></tr>
                ); })}</tbody></table></div>
          );
        })}
        {(sys.metrics || []).length > 0 && <>
          <h2>Monitoring metrics</h2>
          <table><thead><tr><th>Metric</th><th>Latest</th><th>Threshold</th><th>Status</th></tr></thead>
            <tbody>{sys.metrics!.map(m => { const l = (m.readings || []).slice(-1)[0]; const s = metricStatus(m); return (
              <tr key={m.id}><td>{m.name}</td><td>{l ? <>{l.v} <span className="ref">{l.d}</span></> : '–'}</td><td>{m.threshold !== '' && m.threshold != null ? `${m.dir === 'below' ? '≤' : '≥'} ${m.threshold}` : '–'}</td><td><Tag tone={s.tone}>{s.label}</Tag></td></tr>
            ); })}</tbody></table>
        </>}
        {incidents.length > 0 && <>
          <h2>Incidents</h2>
          <table><thead><tr><th>Date</th><th>Incident</th><th>Severity</th><th>Status</th></tr></thead>
            <tbody>{incidents.map(i => <tr key={i.id}><td>{i.date}</td><td>{i.title}{i.serious && <> <Tag tone="crit">Reportable</Tag></>}<br /><span className="muted">{i.category}</span></td><td>{i.severity}</td><td>{i.status}</td></tr>)}</tbody></table>
        </>}
        {prov.length > 0 && <>
          <h2>Answers proposed by the assessment agent</h2>
          <p className="muted">These answers were proposed by the Ituti assessment agent from the sources shown and accepted by the named reviewer. Answers changed by hand since then are not listed.</p>
          <table><thead><tr><th>Field and answer</th><th>Sources</th><th style={{ width: 140 }}>Accepted</th></tr></thead>
            <tbody>{prov.map(([path, pv]) => { const pr = byId.get(pv.p); return (
              <tr key={path}>
                <td><b>{fieldFor(path)?.label.split(':')[0] || path}</b><br /><span className="muted">{displayValue(path, currentValue(sys, path)).slice(0, 400)}</span></td>
                <td>{(pr?.sources || []).map((src, i) => <div key={i} className="ref">{src.title}{src.locator && src.kind === 'document' ? `, ${src.locator}` : ''}{src.url ? ` (${src.url})` : ''}{src.quote && src.kind === 'document' ? `: “${src.quote.slice(0, 160)}”` : ''}</div>)}</td>
                <td className="ref">{people.get(pv.u) || 'Former user'}<br />{new Date(pv.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              </tr>
            ); })}</tbody></table>
        </>}
        <p className="muted" style={{ marginTop: 32, fontSize: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>Prepared with Ituti AI Assurance. Classification is an indication based on the information recorded and is not legal advice. References: Regulation (EU) 2024/1689 (AI Act), UK AI regulatory principles and sector rules, ISO/IEC 42001:2023, NIST AI RMF 1.0.</p>
      </article>
    </>
  );
}
