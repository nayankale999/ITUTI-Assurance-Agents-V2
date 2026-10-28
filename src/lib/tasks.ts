/* Work that a team lead hands to team members on one AI system. A task's scope says which part of the record
 * the member may change: the whole profile, the classification, one control or a control area, one conformity
 * question or part, the model card, monitoring and incidents, evidence uploads, or the review of agent proposals.
 * Shared by the browser (to unlock the right fields) and the server (to refuse anything else). */
import { AREAS, CONTROLS } from './assurance';
import { CONF_QUESTIONS, CONF_PARTS, confLabel } from './conformity';

export const TASK_STATUS: [string, string][] = [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']];

/** Every scope a lead can assign, grouped for a picker: [scope, label, group]. */
export function scopeOptions(): [string, string, string][] {
  const out: [string, string, string][] = [
    ['profile', 'Complete the profile', 'Assessment steps'],
    ['classify', 'Complete the classification and transparency check', 'Assessment steps'],
    ['evidence', 'Upload evidence documents', 'Assessment steps'],
    ['review', 'Review all agent proposals', 'Assessment steps'],
    ['card', 'Write the model card', 'Assessment steps'],
    ['monitor', 'Maintain monitoring metrics and incidents', 'Assessment steps'],
    ['plan', 'Manage the gap action plan', 'Assessment steps'],
    ['controls', 'Assess all controls', 'Controls'],
    ...AREAS.map(([a, l]) => [`ctrlArea:${a}`, `Assess ${l.toLowerCase()} controls`, 'Controls'] as [string, string, string]),
    ...CONTROLS.map(c => [`ctrl:${c.id}`, `Assess control ${c.id}`, 'Single controls'] as [string, string, string]),
    ['conformity', 'Answer the whole conformity assessment', 'Conformity assessment'],
    ...CONF_PARTS.map(([k, l]) => [`confPart:${k}`, `Answer the ${l.toLowerCase()} questions`, 'Conformity assessment'] as [string, string, string]),
    ...CONF_QUESTIONS.map(q => [`conf:${q.id}`, `Answer ${confLabel(q.id)}: ${q.topic}`, 'Single conformity questions'] as [string, string, string]),
  ];
  return out;
}
const LABELS = new Map(scopeOptions().map(([k, l]) => [k, l]));
export const scopeLabel = (s: string) => LABELS.get(s) || s;
export const validScope = (s: string) => LABELS.has(s);

/** The tab where a scope's work is done. */
export function scopeTab(s: string): string {
  if (s === 'profile') return 'profile';
  if (s === 'classify') return 'classify';
  if (s === 'evidence' || s === 'review') return 'agent';
  if (s === 'card') return 'card';
  if (s === 'monitor') return 'monitor';
  if (s === 'plan') return 'plan';
  if (s.startsWith('conf')) return 'conformity';
  return 'controls';
}

const AREA_OF = new Map(CONTROLS.map(c => [c.id, c.a]));
const PART_OF = new Map(CONF_QUESTIONS.map(q => [q.id, q.part]));

/** Whether a set of scopes lets a person change the field at this path (as written in the change history). */
export function pathAllowed(scopes: string[], path: string): boolean {
  const has = (s: string) => scopes.includes(s);
  const [head, ...rest] = path.split('.');
  const key = rest.join('.');
  if (head === 'profile') return has('profile');
  if (head === 'cls' || head === 'clsOk') return has('classify');
  if (head === 'card') return has('card');
  if (head === 'metric' || head === 'metrics') return has('monitor');
  if (head === 'ctrl') return has('controls') || has(`ctrl:${key}`) || has(`ctrlArea:${AREA_OF.get(key)}`);
  if (head === 'conf') return has('conformity') || has(`conf:${key}`) || has(`confPart:${PART_OF.get(key)}`);
  return false;
}

/** Whether a person with these scopes may accept or reject an agent proposal for this field. */
export const proposalAllowed = (scopes: string[], path: string) => scopes.includes('review') || pathAllowed(scopes, path);
