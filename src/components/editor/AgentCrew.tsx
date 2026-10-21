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

const CTRL_AREA: Record<string, string> = { GOV: 'governance', RSK: 'risk', DAT: 'data', DOC: 'documentation', TXP: 'transparency', HUM: 'human oversight', TEC: 'accuracy and security', MON: 'monitoring', CNF: 'EU conformity' };
const CONF_PART: Record<string, string> = { O: 'organisational', P: 'project', T: 'technical' };

/** Which crew member a log line belongs to, and the task in plain words. */
function classify(text: string): { k: Kind; task: string } | null {
  let m: RegExpMatchArray | null;
  if (/^(Listed|Searched documents|Read )/.test(text)) return { k: 'reader', task: text.replace(/^Read /, 'Reading ').replace(/^Searched documents for/, 'Searching for').replace(/^Listed/, 'Found') };
  if (/^(Researching|Looked up|Could not research)/.test(text)) return { k: 'research', task: text.replace(/^Looked up/, 'Has the facts on').replace(/ in the model library$/, '') };
  if ((m = text.match(/^Rejected ([^:]+): (.*)$/))) return { k: 'checker', task: `Sent back ${m[1]}: ${m[2]}` };
  if ((m = text.match(/^Proposed (\S+)/))) {
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

export function AgentCrew({ log, active, proposals }: { log: Entry[]; active: boolean; proposals: number }) {
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
    if (/^Proposed /.test(e.text)) { const ch = state.get('checker')!; ch.count++; ch.last = { ...e, task: `Verified the sources for ${e.text.split(' ')[1]}` }; }
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

  return (
    <div className={`crew ${active ? 'is-live' : ''}`} aria-live="polite">
      <div className="crew-head">
        <b>{active ? (working ? `${working} specialist${working === 1 ? '' : 's'} at work` : 'Getting started') : 'How the run went'}</b>
        <span className="muted">{proposals} proposal{proposals === 1 ? '' : 's'} so far{active ? ' · updates every few seconds; you can leave this page' : ''}</span>
      </div>
      <ol className="crew-grid">
        {CREW.map(c => {
          const s = state.get(c.k)!, st = status(c.k);
          return (
            <li key={c.k} className={`crew-card st-${st}`}>
              <div className="crew-top">
                <span className="crew-av" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{c.icon}</svg>
                  {st === 'working' && <i className="crew-ring" />}
                </span>
                <span className="crew-id"><b>{c.name}</b><small>{c.role}</small></span>
                <span className="crew-st">{st === 'working' ? 'Working' : st === 'done' ? 'Done' : st === 'standby' ? 'Standing by' : st === 'waiting' ? 'Waiting' : 'Not used'}</span>
              </div>
              <p className="crew-task" key={s.last?.at || 'none'}>
                {st === 'working' && <span className="crew-dots" aria-hidden="true"><i /><i /><i /></span>}
                {s.last ? s.last.task : active ? c.idle : 'Nothing to do on this run'}
              </p>
              <div className="crew-foot"><span className="crew-bar"><i style={{ width: `${s.count / max * 100}%` }} /></span><span className="mono muted">{s.count}</span></div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
