'use client';
/* A live view of the assessment run as a crew of specialists, built from the run's activity log: what each one is
 * doing now, what it has finished, and who is waiting. The run is one Claude agent working through these tasks;
 * each card is one strand of that work. */
import { useEffect, useState } from 'react';

type Entry = { at: string; text: string };
type Kind = 'reader' | 'research' | 'classify' | 'controls' | 'conformity' | 'docs' | 'checker';

const CREW: { k: Kind; name: string; role: string; idle: string; icon: React.ReactNode }[] = [
  { k: 'reader', name: 'Evidence reader', role: 'Lists, searches and reads your documents', idle: 'Waiting to open the evidence',
    icon: <path d="M5 4h9l5 5v11H5zM14 4v5h5M8 13h8M8 17h5" /> },
  { k: 'research', name: 'Model researcher', role: 'Checks what the model provider publishes', idle: 'Waiting for a model to look up',
    icon: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></> },
  { k: 'classify', name: 'Risk classifier', role: 'Profile and EU AI Act classification', idle: 'Waiting for evidence',
    icon: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /> },
  { k: 'controls', name: 'Controls assessor', role: 'Rates each control against the evidence', idle: 'Waiting for the classification',
    icon: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 12l3 3 5-6" /></> },
  { k: 'docs', name: 'Documentation writer', role: 'Model card and monitoring metrics', idle: 'Waiting for findings',
    icon: <path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" /> },
  { k: 'conformity', name: 'Conformity writer', role: 'Drafts the Article 43 answers', idle: 'Waiting for the controls',
    icon: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h3" /></> },
  { k: 'checker', name: 'Source checker', role: 'Verifies every quote before you see it', idle: 'Waiting for the first proposal',
    icon: <><circle cx="12" cy="12" r="8" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></> },
];

const HUE: Record<Kind, string> = { reader: '#6C5CE7', research: '#00B8DE', classify: '#E8833A', controls: '#2BA36B', docs: '#D64F8A', conformity: '#3D7BE0', checker: '#8A6CFF' };

/** A small robot for each specialist. It scans and types while working, blinks while standing by, smiles when done
 * and dozes while waiting. Its tool is pinned to its chest. */
function Robot({ icon, hue, state }: { icon: React.ReactNode; hue: string; state: string }) {
  const happy = state === 'done', asleep = state === 'waiting' || state === 'idle';
  return (
    <span className={`robot rb-${state}`} style={{ ['--rb' as string]: hue }} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <g className="rb-body">
          <line x1="32" y1="6" x2="32" y2="13" stroke="var(--rb)" strokeWidth="2.5" strokeLinecap="round" />
          <circle className="rb-tip" cx="32" cy="5" r="3.2" fill="var(--rb)" />
          <rect x="8" y="21" width="5" height="10" rx="2.5" fill="var(--rb)" opacity=".75" />
          <rect x="51" y="21" width="5" height="10" rx="2.5" fill="var(--rb)" opacity=".75" />
          <rect x="12" y="13" width="40" height="27" rx="11" fill="var(--rb)" />
          <rect className="rb-visor" x="17" y="18" width="30" height="16" rx="8" fill="#0B1F4D" />
          <g className="rb-eyes">
            {happy ? <>
              <path d="M23 27q3-4 6 0" stroke="#7FE9FF" strokeWidth="2.4" fill="none" strokeLinecap="round" />
              <path d="M35 27q3-4 6 0" stroke="#7FE9FF" strokeWidth="2.4" fill="none" strokeLinecap="round" />
            </> : asleep ? <>
              <path d="M23 26h6M35 26h6" stroke="#7FE9FF" strokeWidth="2.2" strokeLinecap="round" opacity=".7" />
            </> : <>
              <circle className="rb-eye" cx="26" cy="26" r="3" fill="#7FE9FF" />
              <circle className="rb-eye" cx="38" cy="26" r="3" fill="#7FE9FF" />
            </>}
          </g>
          <rect x="22" y="41" width="20" height="17" rx="6" fill="var(--rb)" opacity=".9" />
          <g className="rb-arm rb-arm-l"><rect x="13" y="43" width="9" height="4" rx="2" fill="var(--rb)" opacity=".8" /></g>
          <g className="rb-arm rb-arm-r"><rect x="42" y="43" width="9" height="4" rx="2" fill="var(--rb)" opacity=".8" /></g>
          <circle cx="32" cy="49.5" r="6.2" fill="#fff" />
          <g transform="translate(26.6 44.1) scale(.45)" fill="none" stroke="var(--rb)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{icon}</g>
        </g>
        {asleep && <text className="rb-z" x="50" y="12" fontSize="9" fontWeight="700" fill="var(--rb)">z</text>}
      </svg>
    </span>
  );
}

const CTRL_AREA: Record<string, string> = { GOV: 'governance', RSK: 'risk', DAT: 'data', DOC: 'documentation', TXP: 'transparency', HUM: 'human oversight', TEC: 'accuracy and security', MON: 'monitoring', CNF: 'EU conformity' };
const CONF_PART: Record<string, string> = { O: 'organisational', P: 'project', T: 'technical' };

/** Which crew member a log line belongs to, and the task in plain words. */
function classify(text: string): { k: Kind; task: string } | null {
  let m: RegExpMatchArray | null;
  if (/^(Listed|Searched documents|Read )/.test(text)) return { k: 'reader', task: text.replace(/^Read /, 'Reading ').replace(/^Searched documents for/, 'Searching for').replace(/^Listed/, 'Found') };
  if (/^(Researching|Looked up|Could not research)/.test(text)) return { k: 'research', task: text.replace(/^Looked up/, 'Has the facts on').replace(/ in the model library$/, '') };
  if ((m = text.match(/^Rejected ([^:]+): (.*)$/))) return { k: 'checker', task: `Sent back ${m[1]}: ${m[2]}` };
  if ((m = text.match(/^Proposed (.+?)(?: \(sources checked: \d+\))?$/))) {
    const path = m[1];
    const [head, ...rest] = path.split('.');
    const key = rest.join('.');
    if (head === 'profile') return { k: 'classify', task: `Drafted the profile: ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}` };
    if (head === 'cls') return { k: 'classify', task: key.startsWith('a3.') ? 'Checking the Annex III high-risk areas' : key.startsWith('t.') ? 'Checking the transparency triggers' : /^p\d$/.test(key) ? `Screening prohibited practice ${key.slice(1)} of 8` : 'Settling the risk tier' };
    if (head === 'ctrl') return { k: 'controls', task: `Assessed ${key} (${CTRL_AREA[key.split('-')[0]] || 'control'})` };
    if (head === 'conf') return { k: 'conformity', task: `Answered ${CONF_PART[key[0]] || ''} question ${key.slice(1)}` };
    if (head === 'card') return { k: 'docs', task: `Wrote the model card: ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}` };
    if (head === 'metric') return { k: 'docs', task: `Recorded the metric “${key}”` };
  }
  return null;
}

type Use = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number; tools: number };
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const usd = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);

export function AgentCrew({ log, active, proposals, usage, only }: { log: Entry[]; active: boolean; proposals: number; usage?: Record<string, Use> | null; only?: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!active) return; const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, [active]);

  const state = new Map<Kind, { last?: Entry & { task: string }; count: number }>(CREW.map(c => [c.k, { count: 0 }]));
  let latest: Kind | null = null;
  for (const e of log) {
    const c = classify(e.text);
    if (!c) continue;
    const s = state.get(c.k)!;
    s.count++; s.last = { ...e, task: c.task }; latest = c.k;
    // Every accepted proposal passed the source checker
    if (/^Proposed /.test(e.text)) { const ch = state.get('checker')!; ch.count++; ch.last = { ...e, task: `Verified the sources for ${e.text.replace(/^Proposed /, '').replace(/ \(sources checked: \d+\)$/, '')}` }; }
  }
  const now = Date.now();
  const status = (k: Kind) => {
    const s = state.get(k)!;
    if (!s.last) return active ? 'waiting' : 'idle';
    if (!active) return 'done';
    const age = (now - new Date(s.last.at).getTime()) / 1000;
    return k === latest || age < 20 ? 'working' : 'standby';
  };
  const max = Math.max(1, ...[...state.values()].map(x => x.count));
  const working = CREW.filter(c => status(c.k) === 'working').length;
  const use = (k: Kind) => usage?.[({ docs: 'docs' } as Record<string, string>)[k] || k];
  const total = usage ? Object.values(usage).reduce((a, u) => ({ cost: a.cost + u.costUsd, tokens: a.tokens + u.input + u.output + u.cacheRead + u.cacheWrite }), { cost: 0, tokens: 0 }) : null;

  return (
    <div className={`crew ${active ? 'is-live' : ''}`} aria-live="polite">
      <div className="crew-head">
        <b>{active ? (working ? `${working} specialist${working === 1 ? '' : 's'} at work` : 'Getting started') : 'How the run went'}</b>
        <span className="muted">{only ? `${CREW.find(c => c.k === only)?.name || 'One specialist'} only · ` : ''}{proposals} proposal{proposals === 1 ? '' : 's'}{active ? ' so far · updates every few seconds; you can leave this page' : ' for you to review'}{total && total.tokens > 0 ? <> · <span title="Estimated at Anthropic list prices">{tok(total.tokens)} tokens, about {usd(total.cost)}</span></> : null}</span>
      </div>
      <ol className="crew-grid">
        {CREW.map(c => {
          const s = state.get(c.k)!, st = status(c.k);
          return (
            <li key={c.k} className={`crew-card st-${st}`}>
              <div className="crew-top">
                <Robot icon={c.icon} hue={HUE[c.k]} state={st} />
                <span className="crew-id"><b>{c.name}</b><small>{c.role}</small></span>
              </div>
              <p className="crew-task" key={s.last?.at || 'none'}>
                {st === 'working' && <span className="crew-dots" aria-hidden="true"><i /><i /><i /></span>}
                {s.last ? (st === 'working' ? s.last.task : `Last: ${s.last.task.replace(/^Reading /, 'read ').replace(/^Searching for/, 'searched for').replace(/^Checking /, 'checked ').replace(/^Screening /, 'screened ').replace(/^Settling /, 'settled ')}`) : active ? c.idle : 'Nothing to do on this run'}
              </p>
              <div className="crew-foot"><span className="crew-st">{st === 'working' ? 'Working' : st === 'done' ? 'Done' : st === 'standby' ? 'Standing by' : st === 'waiting' ? 'Waiting' : 'Not used'}</span><span className="crew-bar"><i style={{ width: `${s.count / max * 100}%` }} /></span><span className="mono muted">{s.count}</span></div>
              {(() => { const u = use(c.k); return u && (u.calls || u.tools) ? <div className="crew-use mono" title="Model calls, tokens and estimated cost">{u.calls ? `${u.calls} call${u.calls === 1 ? '' : 's'} · ${tok(u.input + u.output + u.cacheRead + u.cacheWrite)} tok · ${usd(u.costUsd)}` : `${u.tools} check${u.tools === 1 ? '' : 's'} · no model cost`}</div> : null; })()}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
