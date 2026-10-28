'use client';
/* Evidence documents, the assessment agent's runs, and the review of its proposals. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssessmentData } from '@/lib/assurance';
import { AgentCrew } from './AgentCrew';

type Doc = { id: string; name: string; size: number; pages: number; chars: number; status: string; error: string | null; createdAt: string };
type Src = { kind: string; title: string; ref: string; locator?: string; quote?: string; url?: string };
type Prop = { id: string; path: string; label: string; section: string; kind: string; value: unknown; display: string; previous: string | null; rationale: string; confidence: 'high' | 'medium' | 'low'; sources: Src[] };
type Run = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; log: { at: string; text: string }[]; summary: string | null; error: string | null; proposals: number; createdAt: string; finishedAt: string | null; usage?: Record<string, any> | null; specialist?: string | null };

type Props = {
  systemId: string;
  canEdit: boolean;
  canUpload: boolean;
  canDecide: (path: string) => boolean;
  aiEnabled: boolean;
  blockedReason: string | null;
  accept: string;
  version: () => number;
  beforeDecide: () => Promise<boolean>;
  onApplied: (data: AssessmentData, version: number) => void;
  onPending: (n: number) => void;
};

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: out as Record<string, any> };
}

const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const time = (s: string) => new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const CONF: Record<string, string> = { high: 't-good', medium: 't-info', low: 't-warn' };

export function AgentPanel(props: Props) {
  const { systemId, canEdit, aiEnabled, blockedReason } = props;
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [proposals, setProposals] = useState<Prop[]>([]);
  const [decided, setDecided] = useState(0);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState('');
  const [section, setSection] = useState('All');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ s?: string; e?: string; t?: string }>({});
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const onPending = props.onPending;

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([call(`/api/systems/${systemId}/documents`, 'GET'), call(`/api/systems/${systemId}/agent`, 'GET')]);
    if (d.ok) setDocs(d.body.documents);
    if (a.ok) { setRun(a.body.run); setProposals(a.body.proposals); setDecided(a.body.decided); onPending(a.body.proposals.length); }
  }, [systemId, onPending]);

  useEffect(() => { load(); }, [load]);
  const active = run && (run.status === 'queued' || run.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    setBusy('upload'); setMsg({});
    const errors: string[] = [];
    for (let i = 0; i < list.length; i += 4) {
      const fd = new FormData();
      list.slice(i, i + 4).forEach(f => fd.append('file', f));
      const res = await fetch(`/api/systems/${systemId}/documents`, { method: 'POST', body: fd }).catch(() => null);
      const out = res ? await res.json().catch(() => ({})) : { error: 'Upload failed. Check your connection.' };
      if (out.errors) errors.push(...out.errors);
      else if (res && !res.ok && out.error) errors.push(out.error);
    }
    if (fileRef.current) fileRef.current.value = '';
    setBusy('');
    setMsg(errors.length ? { err: errors.join(' ') } : { ok: `Uploaded ${list.length} file${list.length === 1 ? '' : 's'}.` });
    load();
  }

  async function removeDoc(d: Doc) {
    if (busy !== `rm-${d.id}`) { setBusy(`rm-${d.id}`); setTimeout(() => setBusy(b => (b === `rm-${d.id}` ? '' : b)), 4000); return; }
    setBusy('');
    const r = await call(`/api/documents/${d.id}`, 'DELETE', {});
    setMsg(r.ok ? { ok: `Removed ${d.name}.` } : { err: r.body.error || 'Could not remove.' });
    load();
  }

  async function start() {
    setMsg({});
    const r = await call(`/api/systems/${systemId}/agent`, 'POST', {});
    if (!r.ok) { setMsg({ err: r.body.error || 'Could not start the agent.' }); return; }
    load();
  }

  async function decide(action: 'accept' | 'reject', ids: string[], value?: unknown) {
    if (!ids.length) return;
    setBusy(action + ids[0]); setMsg({});
    if (!(await props.beforeDecide())) { setBusy(''); setMsg({ err: 'Save or resolve your own changes first.' }); return; }
    const r = await call(`/api/systems/${systemId}/proposals`, 'POST', { action, ids, version: props.version(), ...(value !== undefined ? { value } : {}) });
    setBusy('');
    if (r.ok) {
      if (action === 'accept') props.onApplied(r.body.data, r.body.version);
      setEditing(null);
      setMsg({ ok: `${action === 'accept' ? 'Accepted' : 'Rejected'} ${r.body.count} proposal${r.body.count === 1 ? '' : 's'}.` });
    } else setMsg({ err: r.body.error || 'That did not work. Refresh and try again.' });
    load();
  }

  function startEdit(p: Prop) {
    setEditing(p.id);
    if (p.kind === 'control') { const v = p.value as { s: string; e: string }; setDraft({ s: v.s, e: v.e }); }
    else setDraft({ t: String(p.value ?? '') });
  }
  function saveEdit(p: Prop) {
    const value = p.kind === 'control' ? { s: draft.s, e: draft.e } : draft.t;
    decide('accept', [p.id], value);
  }

  const sections = ['All', ...[...new Set(proposals.map(p => p.section))]];
  const shown = proposals.filter(p => section === 'All' || p.section === section);
  const highIds = shown.filter(p => p.confidence === 'high' && props.canDecide(p.path)).map(p => p.id);
  const ready = (docs || []).filter(d => d.status === 'ready').length;

  return (
    <div className="agent">
      {msg.err && <div className="banner err" role="alert">{msg.err}</div>}
      {msg.ok && <div className="banner" role="status">{msg.ok}</div>}

      <section className="panel">
        <header><div><h3>Evidence documents</h3><small className="muted">Policies, design documents, validation and test reports, impact assessments, model cards, contracts, risk register exports. The agent reads these; they stay with this system.</small></div></header>
        <div className="body">
          {props.canUpload && (
            <label
              className={`dropzone ${drag ? 'over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
            >
              <input ref={fileRef} type="file" multiple accept={props.accept} onChange={e => e.target.files && upload(e.target.files)} disabled={busy === 'upload'} />
              <b>{busy === 'upload' ? 'Uploading and reading…' : 'Drop files here or choose files'}</b>
              <small className="muted">PDF, Word, Excel, CSV, text, Markdown, JSON or HTML, up to 25 MB each. Scanned PDFs without a text layer cannot be read.</small>
            </label>
          )}
          {docs === null ? <p className="muted">Loading…</p> : docs.length ? (
            <table className="ledger docs">
              <thead><tr><th>Document</th><th className="size">Size</th><th>Read</th><th /></tr></thead>
              <tbody>{docs.map(d => (
                <tr key={d.id}>
                  <td><a href={`/api/documents/${d.id}`}>{d.name}</a>{d.error && <small className={d.status === 'failed' ? 'err' : 'muted'}>{d.error}</small>}</td>
                  <td className="muted mono size">{kb(d.size)}</td>
                  <td>{d.status === 'ready' ? <span className="pill t-good">{d.pages ? `${d.pages} page${d.pages === 1 ? '' : 's'}` : d.chars < 1000 ? `${d.chars} characters` : `${Math.round(d.chars / 1000)}k characters`}</span> : <span className="pill t-crit">Unreadable</span>}</td>
                  <td className="num">{canEdit && <button className={`linkbtn ${busy === `rm-${d.id}` ? 'armed' : ''}`} onClick={() => removeDoc(d)}>{busy === `rm-${d.id}` ? 'Confirm remove' : 'Remove'}</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          ) : <p className="muted">No documents yet.{canEdit ? ' Upload what the client has, then run the agent.' : ''}</p>}
        </div>
      </section>

      <section className="panel">
        <header>
          <div><h3>Assessment agent</h3><small className="muted">Reads the documents and, for vendor or foundation models, what the provider publishes. It proposes answers with sources; nothing changes until you accept it.</small></div>
          {canEdit && aiEnabled && <button className="btn primary" onClick={start} disabled={!!active}>{active ? 'Agent running…' : run ? 'Run again' : 'Pre-fill with agent'}</button>}
        </header>
        <div className="body">
          {!aiEnabled && <p className="muted">{blockedReason}</p>}
          {aiEnabled && !run && <p className="muted">{ready ? `Ready to read ${ready} document${ready === 1 ? '' : 's'}.` : 'Upload documents first for the best results. Without them the agent can only use public information about the model.'} A run usually takes a few minutes; you can leave this page while it works.</p>}
          {run && (
            <div className="runbox">
              <p>
                <span className={`pill ${run.status === 'completed' ? 't-good' : run.status === 'failed' ? 't-crit' : 't-info'}`}>{run.status === 'queued' ? 'Starting' : run.status === 'running' ? 'Running' : run.status === 'completed' ? 'Finished' : 'Stopped'}</span>{' '}
                <span className="muted">Started {new Date(run.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {run.proposals} proposal{run.proposals === 1 ? '' : 's'}</span>
              </p>
              {run.error && <p className="err">{run.error}</p>}
              <AgentCrew log={run.log} active={!!active} proposals={run.proposals} usage={run.usage} only={run.specialist} />
              {run.summary && <div className="summary"><b>Agent summary</b><p>{run.summary}</p></div>}
              <details>
                <summary className="muted">Full activity log</summary>
                <ol className="runlog">{run.log.map((l, i) => <li key={i}><span className="mono muted">{time(l.at)}</span> {l.text}</li>)}</ol>
              </details>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <div><h3>Proposals to review{proposals.length ? ` (${proposals.length})` : ''}</h3><small className="muted">{decided ? `${decided} already reviewed. ` : ''}Check each source before accepting. Accepted answers are marked as agent-proposed in the report.</small></div>
          {highIds.length > 1 && <button className="btn" onClick={() => decide('accept', highIds)} disabled={!!busy}>Accept {highIds.length} high-confidence</button>}
        </header>
        <div className="body">
          {proposals.length > 0 && (
            <div className="seg" role="group" style={{ marginBottom: 12 }}>
              {sections.map(s => <button key={s} type="button" className="v-plain" aria-pressed={section === s} onClick={() => setSection(s)}>{s}{s !== 'All' ? ` · ${proposals.filter(p => p.section === s).length}` : ''}</button>)}
            </div>
          )}
          {!proposals.length && <p className="muted">{active ? 'Proposals appear here as the agent works.' : 'Nothing waiting for review.'}</p>}
          <div className="proposals">
            {shown.map(p => (
              <article className="prop" key={p.id}>
                <header>
                  <span className="mono muted">{p.path}</span>
                  <span className={`pill ${CONF[p.confidence]}`}>{p.confidence} confidence</span>
                </header>
                <h4>{p.label}</h4>
                {editing === p.id ? (
                  <div className="edit">
                    {p.kind === 'control' ? (<>
                      <select value={draft.s} onChange={e => setDraft({ ...draft, s: e.target.value })} aria-label="Status">
                        <option value="met">Met</option><option value="partial">Partial</option><option value="gap">Not met</option><option value="na">N/A</option>
                      </select>
                      <textarea value={draft.e} onChange={e => setDraft({ ...draft, e: e.target.value })} rows={4} aria-label="Evidence" />
                    </>) : <textarea value={draft.t} onChange={e => setDraft({ ...draft, t: e.target.value })} rows={3} aria-label="Value" />}
                  </div>
                ) : <p className="val">{p.display}</p>}
                {p.previous && <p className="muted prev">Replaces: {p.previous}</p>}
                <p className="why">{p.rationale}</p>
                <ul className="srcs">{p.sources.map((s, i) => (
                  <li key={i}>
                    {s.kind === 'document' ? <a href={`/api/documents/${s.ref}`}>{s.title}</a> : s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a> : <span>{s.title}</span>}
                    {s.locator && s.kind === 'document' && <span className="muted">, {s.locator}</span>}
                    {s.quote && <q>{s.quote}</q>}
                  </li>
                ))}</ul>
                {props.canDecide(p.path) && (
                  <div className="row-actions">
                    {editing === p.id ? (<>
                      <button className="btn primary" onClick={() => saveEdit(p)} disabled={!!busy}>Accept edited</button>
                      <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
                    </>) : (<>
                      <button className="btn primary" onClick={() => decide('accept', [p.id])} disabled={!!busy}>Accept</button>
                      {(p.kind === 'control' || p.kind === 'text') && <button className="btn" onClick={() => startEdit(p)} disabled={!!busy}>Edit</button>}
                      <button className="btn" onClick={() => decide('reject', [p.id])} disabled={!!busy}>Reject</button>
                    </>)}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
