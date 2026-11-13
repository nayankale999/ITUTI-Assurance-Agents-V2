/* The evidence checklist: the kinds of document an assessment needs, which of them apply to a given system, and
 * which ones the uploaded documents provide. A document's kinds are detected from its name and the opening of its
 * text when it is uploaded, and people can correct them. Shared by the server and the browser. */
import { context, classify, type AssessmentData, type Ctx } from './assurance';

export type EvidenceType = {
  id: string; label: string; examples: string; controls: string[];
  /** Words that identify the document in its file name or title. */
  kw: RegExp;
  /** When the type is needed for this system; always when absent. */
  when?: (c: Ctx, fria: boolean) => boolean;
};

export const EVIDENCE_TYPES: EvidenceType[] = [
  { id: 'policy', label: 'AI policy or governance framework', examples: 'Board-approved AI policy, AI principles, risk appetite statement', controls: ['GOV-1', 'GOV-6'],
    kw: /\b(ai|artificial intelligence|model)\s+(policy|governance|principles|standard)|governance framework|responsible ai|risk appetite/i },
  { id: 'roles', label: 'Roles and accountability', examples: 'RACI, responsibilities map, SM&CR statement of responsibilities, committee terms of reference', controls: ['GOV-2', 'GOV-8'],
    kw: /\braci\b|responsibilit(y|ies) (map|matrix)|statement of responsibilities|terms of reference|accountab/i },
  { id: 'purpose', label: 'Use case and intended purpose', examples: 'Business case, use-case description, product requirements, solution overview', controls: ['RSK-4'],
    kw: /use[- ]case|intended (purpose|use)|business case|product requirements|requirements (spec|document)|solution (overview|design)|\bprd\b/i },
  { id: 'risk', label: 'Risk assessment or risk register', examples: 'AI risk assessment, risk register export, treatment plan', controls: ['RSK-1'],
    kw: /risk (assessment|register|log|analysis)|risk and control|\brcsa\b/i },
  { id: 'dpia', label: 'Data protection impact assessment', examples: 'DPIA and DPO sign-off', controls: ['RSK-3', 'DAT-4'], when: c => c.personal,
    kw: /\bdpia\b|data protection impact|privacy impact|\bpia\b/i },
  { id: 'fria', label: 'Fundamental rights or equality impact assessment', examples: 'FRIA (Art. 27), equality impact assessment, human rights impact assessment', controls: ['RSK-2'], when: (c, fria) => fria || c.people,
    kw: /\bfria\b|fundamental rights|equality impact|human rights impact|\beqia\b|algorithmic impact/i },
  { id: 'data', label: 'Data documentation', examples: 'Data sheets, data lineage, data dictionary, data quality report', controls: ['DAT-1', 'DAT-2'],
    kw: /data ?sheet|datasheet|data (lineage|dictionary|quality|catalogue|catalog|card)|dataset (description|documentation)/i },
  { id: 'bias', label: 'Bias and fairness testing', examples: 'Fairness testing results by group, disparate impact analysis', controls: ['DAT-3', 'RSK-5'], when: c => c.people,
    kw: /bias|fairness|disparate impact|equal opportunity|protected (group|characteristic)/i },
  { id: 'techdoc', label: 'Technical documentation or model card', examples: 'Model documentation, architecture, Annex IV technical file, model card, system card', controls: ['DOC-1', 'TXP-4'],
    kw: /model (card|documentation|development|design)|system card|technical (file|documentation|design)|architecture|annex iv/i },
  { id: 'validation', label: 'Validation and test report', examples: 'Independent validation report, test results, performance evaluation', controls: ['TEC-1', 'TEC-2', 'TEC-3'],
    kw: /validation|test (report|results|plan)|testing report|performance (evaluation|report)|model review|back-?test/i },
  { id: 'security', label: 'Security assessment', examples: 'Threat model, penetration test, AI security review', controls: ['TEC-4'],
    kw: /security (assessment|review|test)|threat model|penetration|pen[- ]?test|red[- ]team/i },
  { id: 'genai', label: 'Generative AI evaluation and guardrails', examples: 'Hallucination and harmful-content evaluation, red-team report, guardrail configuration', controls: ['TEC-5', 'TXP-5'], when: c => c.genai,
    kw: /hallucination|red[- ]team|guardrail|prompt injection|llm evaluation|jailbreak/i },
  { id: 'oversight', label: 'Human oversight procedure', examples: 'Oversight procedure, operating manual, runbook, override and stop process', controls: ['HUM-1', 'HUM-2', 'HUM-4'],
    kw: /human (oversight|review|in the loop)|oversight procedure|runbook|operating (manual|procedure)|\bsop\b|kill[- ]switch|override/i },
  { id: 'transparency', label: 'User information and notices', examples: 'Instructions for use, customer or employee notices, AI disclosures, explanation templates', controls: ['TXP-1', 'TXP-2', 'TXP-3', 'TXP-6'],
    kw: /instructions for use|user (guide|manual)|privacy notice|customer notice|disclosure|transparency (notice|statement)|explanation/i },
  { id: 'monitoring', label: 'Monitoring plan and reports', examples: 'Monitoring plan, model performance MI, drift reports, post-market monitoring plan', controls: ['MON-1'],
    kw: /monitoring|drift|post[- ]market|performance mi|dashboard/i },
  { id: 'incident', label: 'Incident and complaints procedure', examples: 'Incident management procedure, serious-incident reporting process, complaints process', controls: ['MON-2', 'MON-3', 'HUM-3', 'MON-5'],
    kw: /incident|complaint|escalation procedure|appeal|redress|corrective action/i },
  { id: 'change', label: 'Change management and logging', examples: 'Change log, release approvals, logging specification, retention schedule', controls: ['DOC-2', 'DOC-3', 'GOV-7'],
    kw: /change (log|management|request)|release (notes|approval)|version (history|control)|logging|audit log|retention schedule/i },
  { id: 'vendor', label: 'Vendor due diligence and contract', examples: 'Supplier assessment, contract clauses, provider documentation, licence terms', controls: ['GOV-5', 'DAT-5'], when: c => c.vendor,
    kw: /vendor|supplier|third[- ]party|due diligence|contract|master services|\bmsa\b|\bdpa\b|licen[cs]e|terms of (service|use)/i },
  { id: 'training', label: 'AI literacy and training records', examples: 'Training material, completion records for builders, operators and overseers', controls: ['GOV-4'],
    kw: /training (record|material|log|completion)|ai literacy|curriculum|e-?learning/i },
  { id: 'conformity', label: 'Conformity and registration records', examples: 'Conformity assessment record, EU declaration of conformity, CE marking, EU database registration, QMS procedures', controls: ['CNF-1', 'CNF-2', 'CNF-3', 'CNF-4', 'GOV-6'], when: (c) => c.high,
    kw: /conformity|declaration of conformity|ce mark|eu database|registration|quality management system|\bqms\b/i },
];

/** Detects a document's evidence kinds from its name and the opening of its text (its title and introduction). */
export function detectKinds(name: string, text: string): string[] {
  const title = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-.]+/g, ' ');
  const head = text.slice(0, 1500);
  return EVIDENCE_TYPES.filter(t => t.kw.test(title) || t.kw.test(head)).map(t => t.id);
}

export type ChecklistDoc = { id: string; name: string; status: string; kinds: string[] | null };
export type ChecklistItem = EvidenceType & { needed: boolean; provided: { id: string; name: string }[]; unreadable: { id: string; name: string }[] };

/** The checklist for a system: every evidence type, whether it is needed for this system, and the documents that provide it. */
export function evidenceChecklist(sys: AssessmentData, docs: ChecklistDoc[]) {
  const c = context(sys);
  const fria = classify(sys).fria;
  const items: ChecklistItem[] = EVIDENCE_TYPES.map(t => ({
    ...t,
    needed: !t.when || t.when(c, fria),
    provided: docs.filter(d => d.status === 'ready' && (d.kinds || []).includes(t.id)).map(d => ({ id: d.id, name: d.name })),
    unreadable: docs.filter(d => d.status !== 'ready' && (d.kinds || []).includes(t.id)).map(d => ({ id: d.id, name: d.name })),
  }));
  const needed = items.filter(i => i.needed);
  return { items, needed: needed.length, provided: needed.filter(i => i.provided.length).length };
}

export const validKinds = (v: unknown): string[] | null => Array.isArray(v) && v.every(x => typeof x === 'string' && EVIDENCE_TYPES.some(t => t.id === x)) ? [...new Set(v as string[])] : null;
