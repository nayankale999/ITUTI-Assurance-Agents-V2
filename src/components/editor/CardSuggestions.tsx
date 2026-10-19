'use client';
/* The assessment agent's model card proposals, shown where they apply: next to each model card field. */
import { useCallback, useEffect, useState } from 'react';
import type { AssessmentData } from '@/lib/assurance';

type Src = { kind: string; title: string; url?: string };
export type CardProp = { id: string; path: string; value: unknown; confidence: string; rationale: string; sources: Src[] };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

export function useCardProposals(opts: { systemId: string; version: () => number; beforeDecide: () => Promise<boolean>; onApplied: (d: AssessmentData, v: number) => void; onDecided?: () => void }) {
  const { systemId } = opts;
  const [list, setList] = useState<CardProp[]>([]);
  const [hasRun, setHasRun] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});

  const load = useCallback(async () => {
    const r = await call(`/api/systems/${systemId}/agent`, 'GET');
    if (!r.ok) return;
    setHasRun(!!r.body.run);
    setList((r.body.proposals as CardProp[]).filter(p => p.path.startsWith('card.')));
  }, [systemId]);
  useEffect(() => { load(); }, [load]);

  async function decide(action: 'accept' | 'reject', ids: string[]) {
    if (!ids.length) return;
    setBusy(action + ids[0]); setMsg({});
    if (!(await opts.beforeDecide())) { setBusy(''); setMsg({ err: 'Save or resolve your own changes first.' }); return; }
    const r = await call(`/api/systems/${systemId}/proposals`, 'POST', { action, ids, version: opts.version() });
    setBusy('');
    if (r.ok) {
      if (action === 'accept') opts.onApplied(r.body.data, r.body.version);
      setMsg({ ok: `${action === 'accept' ? 'Accepted' : 'Rejected'} ${r.body.count} suggestion${r.body.count === 1 ? '' : 's'}.` });
      opts.onDecided?.();
    } else setMsg({ err: r.body.error || 'That did not work. Refresh and try again.' });
    load();
  }
  return { list, hasRun, busy, msg, decide };
}

export function SuggestionBox({ p, canEdit, busy, decide }: { p: CardProp; canEdit: boolean; busy: string; decide: (a: 'accept' | 'reject', ids: string[]) => void }) {
  const srcs = p.sources.filter(s => s.kind !== 'web').map(s => s.title);
  return (
    <div className="suggest" role="group" aria-label="Agent suggestion">
      <div className="suggest-head"><span className="pill t-info">Agent suggestion</span><span className="muted">{p.confidence} confidence</span></div>
      <p style={{ whiteSpace: 'pre-line', margin: '6px 0' }}>{String(p.value)}</p>
      {srcs.length > 0 && <p className="muted" style={{ fontSize: 12 }}>Sources: {[...new Set(srcs)].join('; ')}</p>}
      {canEdit && <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" onClick={() => decide('accept', [p.id])} disabled={!!busy}>Accept</button>
        <button type="button" className="btn" onClick={() => decide('reject', [p.id])} disabled={!!busy}>Reject</button>
      </div>}
    </div>
  );
}
