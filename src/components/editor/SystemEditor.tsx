'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  OPTS, PROFILE_SECTIONS, PROHIBITED, ANNEX3, TRANSPARENCY, AREAS, STATUS, TIERS,
  classify, obligations, applicable, inherentRisk, readiness, frameworkCoverage, metricStatus,
  type AssessmentData, type Control, type Metric, type ProfileField,
} from '@/lib/assurance';
import { CARD_FIELDS, cardValue, residualText } from '@/lib/report';

type Incident = { id: string; title: string; date: string; severity: string; category: string; status: string; serious: boolean; notes: string };
type Props = {
  org: { slug: string; name: string };
  system: { id: string; data: AssessmentData; version: number };
  canEdit: boolean;
  canDelete: boolean;
  incidents: Incident[];
  aiEnabled: boolean;
};

const TABS = [['profile', 'Profile'], ['classify', 'Classification'], ['controls', 'Controls'], ['report', 'Report'], ['card', 'Model card'], ['monitor', 'Monitoring']] as const;
type Tab = (typeof TABS)[number][0];
const optLabel = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];
const today = () => new Date().toISOString().slice(0, 10);
const shortId = () => Math.random().toString(36).slice(2, 10);

async function api(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body: out as Record<string, any> };
}

function TierPill({ tier }: { tier: string }) {
  const t = TIERS[tier] || TIERS.unknown;
  return <span className={`pill t-${t.tone}`}>{t.label}</span>;
}

function Seg({ value, options, onChange, ro, plain }: { value?: string; options: [string, string][]; onChange: (v: string) => void; ro?: boolean; plain?: boolean }) {
  return (
    <div className="seg" role="group">
      {options.map(([k, l]) => (
        <button key={k} type="button" className={plain ? 'v-plain' : `v-${k}`} aria-pressed={value === k} disabled={ro} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function Chip({ on, label, onToggle, ro, title }: { on: boolean; label: string; onToggle: () => void; ro?: boolean; title?: string }) {
  return <button type="button" className="chk" aria-pressed={on} onClick={onToggle} disabled={ro} title={title}>{label}</button>;
}

function Refs({ k }: { k: Control }) {
  return (
    <div className="refs">
      {k.eu && <span className="ref"><b>EU</b> {k.eu}</span>}
      {k.uk && <span className="ref"><b>UK</b> {k.uk}</span>}
      {k.iso && <span className="ref"><b>ISO</b> {k.iso}</span>}
      {k.nist && <span className="ref"><b>NIST</b> {k.nist}</span>}
    </div>
  );
}

export function SystemEditor(props: Props) {
  const { org, canEdit, canDelete, aiEnabled } = props;
  const ro = !canEdit;
  const router = useRouter();
  const [data, setData] = useState<AssessmentData>(props.system.data);
  const [tab, setTab] = useState<Tab>('profile');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState('');
  const [conflict, setConflict] = useState<{ data: AssessmentData; version: number } | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>(props.incidents);
  const [armed, setArmed] = useState<string | null>(null);
  const [ctlFilter, setCtlFilter] = useState<'all' | 'open' | 'gaps'>('all');
  const [ai, setAi] = useState<{ running: boolean; error: string }>({ running: false, error: '' });

  const version = useRef(props.system.version);
  const latest = useRef(data);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);
  latest.current = data;

  const flush = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    setSaveState('saving');
    const r = await api(`/api/systems/${props.system.id}`, 'PUT', { data: latest.current, version: version.current }).catch(() => null);
    inflight.current = false;
    if (!r) { setSaveState('error'); setSaveMsg('Offline. Changes will save when you edit again.'); return; }
    if (r.ok) { version.current = r.body.version; setSaveState('saved'); setSaveMsg(''); }
    else if (r.status === 409 && r.body.current) { setConflict(r.body.current); setSaveState('error'); setSaveMsg('Not saved: a newer version exists.'); return; }
    else { setSaveState('error'); setSaveMsg(r.body.error || 'Not saved.'); return; }
    if (again.current) { again.current = false; flush(); }
  }, [props.system.id]);

  const mutate = useCallback((fn: (d: AssessmentData) => void) => {
    if (ro) return;
    setData(prev => { const next = structuredClone(prev); fn(next); return next; });
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; if (!conflictRef.current) flush(); }, 800);
  }, [ro, flush]);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (saveState === 'dirty' || saveState === 'saving') { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const p = data.profile || {};
  const cls = useMemo(() => classify(data), [data]);
  const ir = useMemo(() => inherentRisk(data), [data]);
  const rd = useMemo(() => readiness(data), [data]);

  const setProfile = (k: string, v: unknown) => mutate(d => { d.profile = { ...(d.profile || {}), [k]: v }; });
  const toggleProfile = (k: string, v: string) => mutate(d => {
    const arr: string[] = [...((d.profile || {})[k] || [])];
    const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v);
    d.profile = { ...(d.profile || {}), [k]: arr };
  });
  const setCls = (k: string, v: unknown) => mutate(d => { d.cls = { ...(d.cls || {}), [k]: v }; });
  const toggleClsObj = (group: 'a3' | 't', k: string) => mutate(d => {
    const c = d.cls || {}; const obj = { ...(c[group] || {}) }; obj[k] = !obj[k]; d.cls = { ...c, [group]: obj };
  });
  const setCtrl = (id: string, patch: { s?: string; e?: string }) => mutate(d => {
    const cur = (d.ctrl || {})[id] || {};
    const next = { ...cur, ...patch };
    if (patch.s !== undefined && cur.s === patch.s) delete next.s;
    d.ctrl = { ...(d.ctrl || {}), [id]: next };
  });

  async function deleteSystem() {
    if (armed !== 'sys') { setArmed('sys'); return; }
    const r = await api(`/api/systems/${props.system.id}`, 'DELETE', {});
    if (r.ok) router.push(r.body.redirect || `/o/${org.slug}`);
    else setSaveMsg(r.body.error || 'Could not delete.');
  }

  async function runReview() {
    setAi({ running: true, error: '' });
    if (timer.current) { clearTimeout(timer.current); timer.current = null; await flush(); }
    const r = await api(`/api/systems/${props.system.id}/review`, 'POST', {}).catch(() => null);
    if (r?.ok) {
      version.current = r.body.version;
      setData(prev => ({ ...prev, aiReview: r.body.aiReview }));
      setAi({ running: false, error: '' });
    } else setAi({ running: false, error: r?.body.error || 'The review did not complete. Try again.' });
  }

  function resolveConflict(keepMine: boolean) {
    if (!conflict) return;
    version.current = conflict.version;
    if (!keepMine) setData(conflict.data);
    setConflict(null);
    setSaveMsg('');
    if (keepMine) flush(); else setSaveState('saved');
  }

  const done: Record<Tab, boolean> = {
    profile: !!(p.name && p.affects && p.regions?.length),
    classify: cls.tier !== 'unknown',
    controls: rd.open === 0 && rd.den > 0,
    report: false,
    card: !!data.card?.purpose,
    monitor: !!data.metrics?.length,
  };

  return (
    <>
      <section className="sys-head">
        <div className="crumbs"><Link href={`/o/${org.slug}`}>{org.name}</Link><span>/</span><span>{p.client || 'No business unit set'}</span>
          <span style={{ flex: 1 }} />
          <span className={`savestate ${saveState === 'error' ? 'err' : ''}`} aria-live="polite">
            {ro ? 'Read only' : saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? saveMsg : ''}
          </span>
        </div>
        {conflict && (
          <div className="conflict" role="alert">
            <span>Someone else saved a newer version of this system while you were editing.</span>
            <button className="btn" onClick={() => resolveConflict(false)}>Load their version</button>
            <button className="btn" onClick={() => resolveConflict(true)}>Keep mine and overwrite</button>
          </div>
        )}
        {ro && <div className="readonly-note">You can view this system but not edit it. Ask your organisation&rsquo;s admin if you need edit access.</div>}
        <div className="sys-title">
          <div><h1>{p.name || 'Untitled system'}</h1><p className="muted">{p.description ? (p.description.length > 200 ? p.description.slice(0, 200) + '…' : p.description) : 'Describe the system on the Profile tab.'}</p></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn" href={`/o/${org.slug}/systems/${props.system.id}/report`}>Assurance report</Link>
            <Link className="btn" href={`/o/${org.slug}/systems/${props.system.id}/card`}>Model card</Link>
            {canDelete && <button className={`btn danger ${armed === 'sys' ? 'armed' : ''}`} onClick={deleteSystem}>{armed === 'sys' ? 'Confirm delete' : 'Delete'}</button>}
          </div>
        </div>
        <div className="gauges">
          <div className="gauge"><span className="k">EU AI Act classification</span><span className="v"><TierPill tier={cls.tier} /></span><span className="muted" style={{ fontSize: 12 }}>{cls.euScope ? (cls.reasons[0] ? cls.reasons[0].split(':')[0] : 'Complete the Classification tab') : 'Outside EU deployment'}</span></div>
          <div className="gauge"><span className="k">Inherent risk score</span><span className="v">{ir ? <>{ir.score}<small>/ 100</small> <span className={`pill t-${ir.tone}`}>{ir.band}</span></> : <small>Answer the impact factors on the Profile tab</small>}</span></div>
          <div className="gauge"><span className="k">Control readiness</span><span className="v">{rd.pct}%<small>{rd.met} met · {rd.partial} partial · {rd.gap} not met · {rd.open} open</small></span></div>
        </div>
      </section>

      <nav className="tabs" role="tablist">
        {TABS.map(([k, l], i) => (
          <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); window.scrollTo(0, 0); }}>
            <span className="mono">{i + 1}</span>{l}{k !== 'report' && <span className={`dot ${done[k] ? 'done' : ''}`} />}
          </button>
        ))}
      </nav>

      {tab === 'profile' && <ProfileTab p={p} ro={ro} setProfile={setProfile} toggleProfile={toggleProfile} next={() => setTab('classify')} />}
      {tab === 'classify' && <ClassifyTab data={data} ro={ro} setCls={setCls} toggleClsObj={toggleClsObj} next={() => setTab('controls')} />}
      {tab === 'controls' && <ControlsTab data={data} ro={ro} setCtrl={setCtrl} filter={ctlFilter} setFilter={setCtlFilter} ai={ai} aiEnabled={aiEnabled} runReview={runReview} />}
      {tab === 'report' && <ReportTab data={data} incidents={incidents} reportHref={`/o/${org.slug}/systems/${props.system.id}/report`} />}
      {tab === 'card' && <CardTab data={data} ro={ro} mutate={mutate} cardHref={`/o/${org.slug}/systems/${props.system.id}/card`} />}
      {tab === 'monitor' && <MonitorTab data={data} ro={ro} mutate={mutate} systemId={props.system.id} incidents={incidents} setIncidents={setIncidents} armed={armed} setArmed={setArmed} />}
    </>
  );
}

/* ---------- Profile ---------- */
function Field({ f, p, ro, setProfile, toggleProfile }: { f: ProfileField; p: Record<string, any>; ro: boolean; setProfile: (k: string, v: unknown) => void; toggleProfile: (k: string, v: string) => void }) {
  const id = `f-${f.k}`, v = p[f.k];
  const wide = f.type === 'textarea' || f.type === 'multi';
  if (f.type === 'multi') return (
    <div className={`field ${wide ? 'span2' : ''}`}>
      <span>{f.label}</span>
      <div className="checks" role="group" aria-label={f.label}>{OPTS[f.opts!].map(([k, l]) => <Chip key={k} on={(v || []).includes(k)} label={l} ro={ro} onToggle={() => toggleProfile(f.k, k)} />)}</div>
      {f.hint && <small>{f.hint}</small>}
    </div>
  );
  return (
    <label className={`field ${wide ? 'span2' : ''}`}>
      <span>{f.label}</span>
      {f.type === 'text' && <input type="text" id={id} value={v || ''} readOnly={ro} maxLength={300} onChange={e => setProfile(f.k, e.target.value)} />}
      {f.type === 'textarea' && <textarea id={id} value={v || ''} readOnly={ro} maxLength={5000} onChange={e => setProfile(f.k, e.target.value)} />}
      {f.type === 'select' && (
        <select id={id} value={v || ''} disabled={ro} onChange={e => setProfile(f.k, e.target.value)}>
          <option value="">Choose…</option>
          {OPTS[f.opts!].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      )}
      {f.hint && <small>{f.hint}</small>}
    </label>
  );
}

function ProfileTab({ p, ro, setProfile, toggleProfile, next }: { p: Record<string, any>; ro: boolean; setProfile: (k: string, v: unknown) => void; toggleProfile: (k: string, v: string) => void; next: () => void }) {
  const sections = PROFILE_SECTIONS.map(s => s.title === 'Identity'
    ? { ...s, fields: s.fields.map(f => f.k === 'client' ? { ...f, label: 'Business unit', hint: 'Used to group systems within this client' } : f) }
    : s);
  return (
    <>
      <section className="panel">
        {sections.map(sec => (
          <div className="formsec" key={sec.title}>
            <div><h3>{sec.title}</h3>{sec.note && <small className="muted">{sec.note}</small>}</div>
            <div className="grid2">{sec.fields.map(f => <Field key={f.k} f={f} p={p} ro={ro} setProfile={setProfile} toggleProfile={toggleProfile} />)}</div>
          </div>
        ))}
      </section>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" onClick={next}>Continue to classification</button></div>
    </>
  );
}

/* ---------- Classification ---------- */
function Obligations({ data }: { data: AssessmentData }) {
  return (
    <div className="oblig">
      {obligations(data).map(o => (
        <div key={o.region}><h4>{o.region}</h4><ul>{o.items.map(([t, ref]) => <li key={t}><span>{t}</span><span className="ref">{ref}</span></li>)}</ul></div>
      ))}
    </div>
  );
}

function ClassifyTab({ data, ro, setCls, toggleClsObj, next }: { data: AssessmentData; ro: boolean; setCls: (k: string, v: unknown) => void; toggleClsObj: (g: 'a3' | 't', k: string) => void; next: () => void }) {
  const c = data.cls || {}, r = classify(data);
  const yn: [string, string][] = [['no', 'No'], ['yes', 'Yes'], ['unsure', 'Unsure']];
  const two: [string, string][] = [['no', 'No'], ['yes', 'Yes']];
  return (
    <>
      <section className="panel">
        <div className="verdict">
          <div>
            <span className="eyebrow">Result</span>
            <div className="tierbig"><TierPill tier={r.tier} /></div>
            {r.reasons.length ? <ul className="reasons">{r.reasons.map(x => <li key={x}>{x}</li>)}</ul> : <p className="muted">Answer the screens below to classify the system.</p>}
            {r.flags.map(f => <div key={f} className="flag">{f}</div>)}
            {r.fria && <div className="flag">A fundamental rights impact assessment is required before first use (Art. 27).</div>}
            <p className="muted" style={{ fontSize: 12 }}>An indication based on your answers, not legal advice. Record who confirmed the classification in control GOV-3.</p>
          </div>
          <div><span className="eyebrow">What applies</span><Obligations data={data} /></div>
        </div>
      </section>

      <section className="panel"><header><div><h3>Step 1. Prohibited practices</h3><small className="muted">EU AI Act Article 5. Answer every screen.</small></div></header>
        <div className="qlist">{PROHIBITED.map(([k, t, ref]) => (
          <div className="q" key={k}><div><p>{t}</p><span className="ref">{ref}</span></div><Seg value={c[k]} options={yn} ro={ro} onChange={v => setCls(k, v)} /></div>
        ))}</div></section>

      <section className="panel"><header><div><h3>Step 2. High-risk uses</h3><small className="muted">Select every area the system is used in.</small></div></header>
        <div className="body"><div className="checks">{ANNEX3.map(([k, t, ref]) => <Chip key={k} on={!!c.a3?.[k]} label={t} title={ref} ro={ro} onToggle={() => toggleClsObj('a3', k)} />)}</div></div>
        <div className="qlist">
          <div className="q"><div><p>Is it a safety component of, or itself, a product covered by EU product-safety law such as medical devices or machinery?</p><span className="ref">Art. 6(1), Annex I</span></div><Seg value={c.annex1} options={two} ro={ro} onChange={v => setCls('annex1', v)} /></div>
          <div className="q"><div><p>Does it profile individuals, meaning it evaluates personal aspects such as economic situation, behaviour or reliability?</p><span className="ref">Art. 6(3)</span></div><Seg value={c.profiling} options={two} ro={ro} onChange={v => setCls('profiling', v)} /></div>
          <div className="q"><div><p>Does it only perform a narrow procedural task, improve a completed human activity, detect patterns without replacing human assessment, or prepare an assessment?</p><span className="ref">Art. 6(3) exemption</span></div><Seg value={c.exempt} options={two} ro={ro} onChange={v => setCls('exempt', v)} /></div>
        </div></section>

      <section className="panel"><header><div><h3>Step 3. Transparency and general-purpose AI</h3><small className="muted">Select any that apply.</small></div></header>
        <div className="body"><div className="checks">{TRANSPARENCY.map(([k, t, ref]) => <Chip key={k} on={!!c.t?.[k]} label={t} title={ref} ro={ro} onToggle={() => toggleClsObj('t', k)} />)}</div></div>
        <div className="qlist"><div className="q"><div><p>Do you place a general-purpose AI model on the market, rather than only using one?</p><span className="ref">Art. 51–55</span></div><Seg value={c.gpai} options={two} ro={ro} onChange={v => setCls('gpai', v)} /></div></div>
      </section>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button className="btn primary" onClick={next}>Continue to controls</button></div>
    </>
  );
}

/* ---------- Controls ---------- */
function ControlsTab({ data, ro, setCtrl, filter, setFilter, ai, aiEnabled, runReview }: {
  data: AssessmentData; ro: boolean; setCtrl: (id: string, p: { s?: string; e?: string }) => void;
  filter: 'all' | 'open' | 'gaps'; setFilter: (f: 'all' | 'open' | 'gaps') => void;
  ai: { running: boolean; error: string }; aiEnabled: boolean; runReview: () => void;
}) {
  const list = applicable(data), rd = readiness(data, list), ctrl = data.ctrl || {};
  const notes = data.aiReview?.items || {};
  const total = Math.max(1, rd.den);
  const show = (k: Control) => {
    const s = ctrl[k.id]?.s;
    if (filter === 'gaps') return s !== 'met' && s !== 'na';
    if (filter === 'open') return !s;
    return true;
  };
  const stripe = (s?: string) => s === 'met' ? 'var(--good)' : s === 'partial' ? 'var(--warn)' : s === 'gap' ? 'var(--crit)' : 'transparent';
  const vtone: Record<string, string> = { supported: 'good', weak: 'warn', missing: 'crit' };
  const any = list.some(show);
  return (
    <section className="panel">
      <header>
        <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 240 }}>
          <h3>{list.length} controls apply to this system</h3>
          <div className="progress" aria-label="Status mix">
            <i style={{ width: `${rd.met / total * 100}%`, background: 'var(--good)' }} />
            <i style={{ width: `${rd.partial / total * 100}%`, background: 'var(--warn)' }} />
            <i style={{ width: `${rd.gap / total * 100}%`, background: 'var(--crit)' }} />
          </div>
          <div className="legend">
            <span style={{ ['--c' as string]: 'var(--good)' }}>Met {rd.met}</span><span style={{ ['--c' as string]: 'var(--warn)' }}>Partial {rd.partial}</span>
            <span style={{ ['--c' as string]: 'var(--crit)' }}>Not met {rd.gap}</span><span style={{ ['--c' as string]: 'var(--line-strong)' }}>Open {rd.open}</span>
          </div>
        </div>
        <div className="ctl-toolbar">
          <Seg value={filter} plain options={[['all', 'All'], ['open', 'Open'], ['gaps', 'Gaps']]} onChange={v => setFilter(v as 'all' | 'open' | 'gaps')} />
          {aiEnabled && !ro && <button className="btn" onClick={runReview} disabled={ai.running}>{ai.running ? 'Reviewing evidence…' : 'Review evidence with Claude'}</button>}
        </div>
      </header>
      {ai.error && <div className="body"><div className="flag">{ai.error}</div></div>}
      {data.aiReview && <div className="body" style={{ paddingBlock: 10 }}><span className="muted" style={{ fontSize: 12 }}>Last AI review {new Date(data.aiReview.at).toLocaleString('en-GB')}. Claude&rsquo;s notes are prompts for the assessor, not a verdict.</span></div>}
      {AREAS.map(([a, name]) => {
        const items = list.filter(k => k.a === a && show(k));
        if (!items.length) return null;
        return (
          <div key={a}>
            <div className="areah"><h3>{name}</h3><span className="muted mono">{list.filter(k => k.a === a).length} controls</span></div>
            {items.map(k => {
              const c = ctrl[k.id] || {}, n = notes[k.id];
              return (
                <div className="ctl" key={k.id} style={{ ['--stripe' as string]: stripe(c.s) }}>
                  <div className="cid">{k.id}</div>
                  <div className="main">
                    <div className="row1"><p>{k.q}</p><Seg value={c.s} options={STATUS} ro={ro} onChange={v => setCtrl(k.id, { s: v })} /></div>
                    <Refs k={k} />
                    {c.s && c.s !== 'na'
                      ? <label className="field"><span className="evhint">Evidence: {k.ev}</span><textarea id={`ev-${k.id}`} value={c.e || ''} readOnly={ro} maxLength={5000} placeholder="Document names, dates, owners, results" onChange={e => setCtrl(k.id, { e: e.target.value })} /></label>
                      : <span className="evhint">Expected evidence: {k.ev}</span>}
                    {n && <div className="ai-note"><span className={`pill t-${vtone[n.v] || 'muted'}`}>{n.v === 'supported' ? 'Supported' : n.v === 'missing' ? 'Missing evidence' : 'Weak evidence'}</span><span>{n.n}</span></div>}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {!any && <div className="empty"><p>No controls match this filter.</p></div>}
    </section>
  );
}

/* ---------- Report (on-screen summary) ---------- */
function ReportTab({ data, incidents, reportHref }: { data: AssessmentData; incidents: Incident[]; reportHref: string }) {
  const r = classify(data), ir = inherentRisk(data), cov = frameworkCoverage(data), list = applicable(data), ctrl = data.ctrl || {};
  const order: Record<string, number> = { gap: 0, partial: 1 };
  const gaps = list.filter(k => { const s = ctrl[k.id]?.s; return s !== 'met' && s !== 'na'; })
    .sort((a, b) => (order[ctrl[a.id]?.s || ''] ?? 2) - (order[ctrl[b.id]?.s || ''] ?? 2));
  const openInc = incidents.filter(i => i.status !== 'closed');
  return (
    <>
      <section className="panel"><header><h3>Framework coverage</h3><div className="spacer" /><Link className="btn primary" href={reportHref}>Open printable report</Link></header>
        <div className="scroll"><table className="cov"><thead><tr><th>Framework</th><th className="num">Controls mapped</th><th>Readiness</th><th className="num">Not met</th><th className="num">Partial</th><th className="num">Open</th></tr></thead>
          <tbody>{cov.map(f => <tr key={f.key}><td><b>{f.name}</b></td><td className="num">{f.count}</td><td><div className="barwrap"><div className="bar"><i style={{ width: `${f.r.pct}%` }} /></div>{f.r.pct}%</div></td><td className="num">{f.r.gap}</td><td className="num">{f.r.partial}</td><td className="num">{f.r.open}</td></tr>)}</tbody></table></div>
      </section>
      <div className="grid2">
        <section className="panel"><header><h3>Classification and obligations</h3></header><div className="body">
          <div><TierPill tier={r.tier} /></div>
          {r.reasons.length > 0 && <ul className="reasons">{r.reasons.map(x => <li key={x}>{x}</li>)}</ul>}
          <Obligations data={data} />
        </div></section>
        <section className="panel"><header><h3>Risk position</h3></header><div className="body">
          <p>Inherent risk {ir ? <><b>{ir.score}/100</b> <span className={`pill t-${ir.tone}`}>{ir.band}</span></> : <span className="muted">not yet scored</span>}</p>
          <p>Control readiness <b>{readiness(data).pct}%</b> across {list.length} applicable controls.</p>
          <p>Open incidents <b>{openInc.length}</b>{openInc.some(i => i.serious) && <> <span className="pill t-crit">Includes a reportable incident</span></>}.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>{residualText(ir, readiness(data).pct)}</p>
        </div></section>
      </div>
      <section className="panel"><header><h3>Gaps to close</h3><span className="muted">{gaps.length} controls not yet met</span></header>
        <div className="gaps">{gaps.length ? gaps.map(k => {
          const s = ctrl[k.id]?.s;
          return <div className="gap" key={k.id}><span className="mono muted">{k.id}</span><span>{k.q}{ctrl[k.id]?.e && <><br /><span className="muted">{ctrl[k.id].e}</span></>}</span>
            {s === 'gap' ? <span className="pill t-crit">Not met</span> : s === 'partial' ? <span className="pill t-warn">Partial</span> : <span className="pill t-muted">Open</span>}</div>;
        }) : <div className="empty"><p>Every applicable control is met or not applicable.</p></div>}</div>
      </section>
    </>
  );
}

/* ---------- Model card ---------- */
function CardTab({ data, ro, mutate, cardHref }: { data: AssessmentData; ro: boolean; mutate: (fn: (d: AssessmentData) => void) => void; cardHref: string }) {
  const p = data.profile || {};
  return (
    <div className="grid2">
      <section className="panel"><header><h3>Model card content</h3></header><div className="body">
        <p className="muted" style={{ fontSize: 12.5 }}>Empty fields fall back to what the profile and monitoring already say.</p>
        {CARD_FIELDS.map(([k, l]) => (
          <label className="field" key={k}><span>{l}</span>
            <textarea id={`card-${k}`} value={data.card?.[k] || ''} readOnly={ro} maxLength={5000} placeholder={cardValue({ ...data, card: {} }, k)} onChange={e => mutate(d => { d.card = { ...(d.card || {}), [k]: e.target.value }; })} />
          </label>
        ))}
      </div></section>
      <section className="panel"><header><h3>Preview</h3><div className="spacer" /><Link className="btn primary" href={cardHref}>Open printable card</Link></header><div className="body">
        <div className="card-prev">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'start' }}>
            <div><span className="eyebrow">Model card</span><h2>{p.name || 'Untitled system'}</h2><p className="muted">{p.client || ''}{p.version ? ` · version ${p.version}` : ''}</p></div>
            <TierPill tier={classify(data).tier} />
          </div>
          <dl>{CARD_FIELDS.map(([k, l]) => <div key={k} style={{ display: 'contents' }}><dt>{l}</dt><dd>{cardValue(data, k) || <span className="muted">Not provided</span>}</dd></div>)}</dl>
        </div>
      </div></section>
    </div>
  );
}

/* ---------- Monitoring ---------- */
function Spark({ m }: { m: Metric }) {
  const rs = (m.readings || []).slice(-12);
  if (rs.length < 2) return <svg viewBox="0 0 240 48" aria-hidden="true"><line x1="0" y1="40" x2="240" y2="40" stroke="var(--line)" strokeDasharray="3 3" /></svg>;
  const vals = rs.map(r => +r.v), t = m.threshold === '' || m.threshold == null ? NaN : +m.threshold;
  const lo = Math.min(...vals, isNaN(t) ? Infinity : t), hi = Math.max(...vals, isNaN(t) ? -Infinity : t);
  const span = hi - lo || 1, X = (i: number) => 4 + i * (232 / (rs.length - 1)), Y = (v: number) => 42 - (v - lo) / span * 36;
  const pts = rs.map((r, i) => `${X(i).toFixed(1)},${Y(+r.v).toFixed(1)}`).join(' ');
  const st = metricStatus(m), col = st.tone === 'crit' ? 'var(--crit)' : st.tone === 'warn' ? 'var(--warn)' : 'var(--accent)';
  return (
    <svg viewBox="0 0 240 48" role="img" aria-label={`Trend of ${m.name}`}>
      {!isNaN(t) && <line x1="0" x2="240" y1={Y(t)} y2={Y(t)} stroke="var(--line-strong)" strokeDasharray="4 3" />}
      <polygon points={`4,46 ${pts} 236,46`} fill={col} fillOpacity=".12" />
      <polyline points={pts} fill="none" stroke={col} strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={X(rs.length - 1)} cy={Y(vals[vals.length - 1])} r="3.2" fill={col} />
    </svg>
  );
}

function MonitorTab({ data, ro, mutate, systemId, incidents, setIncidents, armed, setArmed }: {
  data: AssessmentData; ro: boolean; mutate: (fn: (d: AssessmentData) => void) => void; systemId: string;
  incidents: Incident[]; setIncidents: (f: (l: Incident[]) => Incident[]) => void; armed: string | null; setArmed: (s: string | null) => void;
}) {
  const ms = data.metrics || [];
  const [msg, setMsg] = useState('');
  const sev: Record<string, string> = { low: 't-muted', medium: 't-info', high: 't-warn', critical: 't-crit' };

  function addMetric(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim(); if (!name) return;
    mutate(d => { d.metrics = [...(d.metrics || []), { id: shortId(), name, kind: String(fd.get('kind')), threshold: String(fd.get('threshold') || ''), dir: fd.get('dir') === 'below' ? 'below' : 'above', readings: [] }]; });
    e.currentTarget.reset();
  }
  function addReading(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = parseFloat(String(fd.get('v'))); if (isNaN(v)) return;
    const dte = String(fd.get('d') || today());
    mutate(d => { d.metrics = (d.metrics || []).map(m => m.id !== id ? m : { ...m, readings: [...(m.readings || []), { d: dte, v }].sort((a, b) => a.d.localeCompare(b.d)).slice(-120) }); });
    (e.currentTarget.elements.namedItem('v') as HTMLInputElement).value = '';
  }
  function removeMetric(id: string) {
    if (armed !== `m-${id}`) { setArmed(`m-${id}`); return; }
    setArmed(null);
    mutate(d => { d.metrics = (d.metrics || []).filter(m => m.id !== id); });
  }
  async function addIncident(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const body = { title: String(fd.get('title') || ''), date: String(fd.get('date') || today()), severity: String(fd.get('severity')), category: String(fd.get('category')), serious: fd.get('serious') === 'yes', notes: String(fd.get('notes') || '') };
    const r = await api(`/api/systems/${systemId}/incidents`, 'POST', body);
    if (r.ok) { setIncidents(l => [r.body.incident, ...l].sort((a, b) => b.date.localeCompare(a.date))); form.reset(); setMsg('Incident recorded.'); }
    else setMsg(r.body.error || 'Could not record the incident.');
  }
  async function setStatus(id: string, status: string) {
    const r = await api(`/api/incidents/${id}`, 'PATCH', { status });
    if (r.ok) setIncidents(l => l.map(i => i.id === id ? { ...i, status } : i));
    else setMsg(r.body.error || 'Could not update the incident.');
  }
  async function deleteIncident(id: string) {
    if (armed !== `i-${id}`) { setArmed(`i-${id}`); return; }
    setArmed(null);
    const r = await api(`/api/incidents/${id}`, 'DELETE', {});
    if (r.ok) setIncidents(l => l.filter(i => i.id !== id));
    else setMsg(r.body.error || 'Could not delete the incident.');
  }

  return (
    <>
      <section className="panel"><header><div><h3>Performance and fairness metrics</h3><small className="muted">Record readings from your monitoring. A dashed line marks the threshold.</small></div></header>
        <div className="body">
          {ms.length ? <div className="metrics">{ms.map(m => {
            const st = metricStatus(m), last = (m.readings || []).slice(-1)[0];
            return (
              <div className="metric" key={m.id}>
                <div className="mh"><div><b>{m.name}</b><div className="muted" style={{ fontSize: 12 }}>{m.kind}{m.threshold !== '' && m.threshold != null ? ` · threshold ${m.dir === 'below' ? '≤' : '≥'} ${m.threshold}` : ''}</div></div><span className={`pill t-${st.tone}`}>{st.label}</span></div>
                <div className="val">{last ? last.v : '–'}<span className="muted mono" style={{ fontSize: 11, marginLeft: 8 }}>{last?.d}</span></div>
                <Spark m={m} />
                {!ro && <>
                  <form className="addr" onSubmit={e => addReading(e, m.id)}><input type="date" name="d" defaultValue={today()} aria-label="Reading date" required /><input type="number" step="any" name="v" placeholder="Value" aria-label="Reading value" required /><button className="btn">Add</button></form>
                  <button className={`btn ghost danger ${armed === `m-${m.id}` ? 'armed' : ''}`} style={{ justifySelf: 'start', fontSize: 12 }} onClick={() => removeMetric(m.id)}>{armed === `m-${m.id}` ? 'Confirm remove' : 'Remove metric'}</button>
                </>}
              </div>
            );
          })}</div> : <p className="muted">No metrics yet. Add the measures you agreed as acceptance criteria.</p>}
          {!ro && (
            <form className="inline-form" onSubmit={addMetric}>
              <label className="field"><span>Metric</span><input type="text" name="name" placeholder="e.g. AUC, approval-rate ratio" required maxLength={200} /></label>
              <label className="field"><span>Type</span><select name="kind"><option>Performance</option><option>Fairness</option><option>Drift</option><option>Reliability</option><option>Usage</option></select></label>
              <label className="field"><span>Threshold</span><input type="number" step="any" name="threshold" placeholder="0.8" /></label>
              <label className="field"><span>Healthy when</span><select name="dir"><option value="above">At or above</option><option value="below">At or below</option></select></label>
              <button className="btn primary">Add metric</button>
            </form>
          )}
        </div></section>

      <section className="panel"><header><div><h3>Incident log</h3><small className="muted">Serious incidents involving high-risk systems may need reporting to the authority (EU AI Act Art. 73).</small></div><div className="spacer" />
        <a className="btn" href={`/api/systems/${systemId}/incidents?format=csv`}>Export CSV</a></header>
        {!ro && <div className="body">
          <form className="grid3" onSubmit={addIncident}>
            <label className="field span2"><span>What happened</span><input type="text" name="title" required maxLength={300} placeholder="Short description" /></label>
            <label className="field"><span>Date</span><input type="date" name="date" defaultValue={today()} required /></label>
            <label className="field"><span>Severity</span><select name="severity" defaultValue="medium"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label>
            <label className="field"><span>Category</span><select name="category"><option>Performance degradation</option><option>Bias or discrimination</option><option>Harmful or incorrect output</option><option>Security or data leak</option><option>Misuse</option><option>Outage or failure</option><option>Other</option></select></label>
            <label className="field"><span>Reportable serious incident?</span><select name="serious"><option value="no">No</option><option value="yes">Yes or possibly</option></select></label>
            <label className="field span2"><span>Details and actions</span><textarea name="notes" maxLength={5000} placeholder="Impact, people affected, containment, next steps" /></label>
            <div style={{ display: 'flex', alignItems: 'end' }}><button className="btn primary">Record incident</button></div>
          </form>
          {msg && <p className="muted" role="status">{msg}</p>}
        </div>}
        <div className="scroll"><table className="ledger"><thead><tr><th>Date</th><th>Incident</th><th>Severity</th><th>Status</th><th /></tr></thead><tbody>
          {incidents.length ? incidents.map(i => (
            <tr key={i.id}>
              <td className="mono">{i.date}</td>
              <td><b>{i.title}</b>{i.serious && <> <span className="pill t-crit">Reportable</span></>}<div className="muted" style={{ fontSize: 12 }}>{i.category}{i.notes ? ` · ${i.notes}` : ''}</div></td>
              <td><span className={`pill ${sev[i.severity] || 't-muted'}`}>{i.severity}</span></td>
              <td>{ro ? i.status : <select value={i.status} aria-label="Status" style={{ width: 'auto' }} onChange={e => setStatus(i.id, e.target.value)}>{['open', 'investigating', 'mitigated', 'closed'].map(s => <option key={s}>{s}</option>)}</select>}</td>
              <td>{!ro && <button className={`btn ghost danger ${armed === `i-${i.id}` ? 'armed' : ''}`} onClick={() => deleteIncident(i.id)}>{armed === `i-${i.id}` ? 'Confirm' : 'Delete'}</button>}</td>
            </tr>
          )) : <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>No incidents recorded.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}
