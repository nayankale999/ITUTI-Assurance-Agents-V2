/* The formal conformity assessment: long-form questions in three parts (organisation, project, technical) that
 * together evidence what Article 43 of the EU AI Act asks of a high-risk system, with Annex IV in mind.
 * Original wording, written from the public text of Regulation (EU) 2024/1689. Answers already recorded elsewhere
 * in the assessment pre-fill each question and are flagged until a person confirms them. */
import { OPTS, TRANSPARENCY, classify, inherentRisk, has, type AssessmentData } from './assurance';
import { cardValue } from './report';

export type ConfPart = 'org' | 'project' | 'tech';
export type ConfQuestion = { id: string; part: ConfPart; topic: string; q: string; why: string; ref: string; genai?: boolean };
export type ConfAnswer = { t?: string; ok?: boolean; from?: string };

export const CONF_PARTS: [ConfPart, string, string][] = [
  ['org', 'Organisational', 'The values, governance and management system the organisation applies to every AI system.'],
  ['project', 'Project', 'This system’s purpose, people affected, data, risks, accountability and oversight.'],
  ['tech', 'Technical', 'How the model is built, tested, secured, explained and monitored.'],
];

export const CONF_MAX = 2500;

export const CONF_QUESTIONS: ConfQuestion[] = [
  // Organisational
  { id: 'O1', part: 'org', topic: 'Values', q: 'Which principles guide how your organisation develops and uses AI, and where are they written down and approved?', why: 'Assessors start from the organisation’s stated values: every later answer is checked for consistency with them.', ref: 'Art. 17(1); Recital 27' },
  { id: 'O2', part: 'org', topic: 'Embedding the values', q: 'How are those principles communicated and embedded: training, AI literacy, procedures and incentives?', why: 'Article 4 requires staff who operate or use AI to have sufficient AI literacy, and principles only work if people know them.', ref: 'Art. 4' },
  { id: 'O3', part: 'org', topic: 'Governance structure', q: 'Describe the governance structure for AI: committees, roles, decision rights and how issues are escalated.', why: 'An accountability framework that sets out who decides and who answers for AI is part of the quality management system.', ref: 'Art. 17(1)(m); Art. 26(2)' },
  { id: 'O4', part: 'org', topic: 'Quality management system', q: 'Which quality management system covers AI: design control, testing, change management, data management, record-keeping and post-market monitoring?', why: 'Providers of high-risk systems must run a documented quality management system; it is one of the things a conformity assessment examines.', ref: 'Art. 17; Annex VI(3)' },
  { id: 'O5', part: 'org', topic: 'Suppliers and third parties', q: 'How do you assess and contract with suppliers of AI models, data and components, including rights to documentation, change notices and incident information?', why: 'Responsibilities pass along the value chain: you need the supplier information to meet your own obligations.', ref: 'Art. 25' },
  { id: 'O6', part: 'org', topic: 'Records and authorities', q: 'How long are the technical documentation, quality management records, declaration of conformity and logs kept, and how would you provide them to a market surveillance authority on request?', why: 'Providers keep the documentation for 10 years and logs for at least six months, and must cooperate with competent authorities.', ref: 'Art. 18; Art. 19; Art. 21' },
  // Project
  { id: 'P1', part: 'project', topic: 'Intended purpose', q: 'What is the system’s intended purpose and the business objective it serves? Include the decisions or tasks it supports.', why: 'Every obligation is judged against the intended purpose stated by the provider; it also decides the risk tier.', ref: 'Art. 3(12); Annex IV(1)(a)' },
  { id: 'P2', part: 'project', topic: 'Users', q: 'Who uses the system or its outputs, and what competence and training do they need?', why: 'Instructions for use and oversight must fit the people who actually operate the system.', ref: 'Art. 13(3); Art. 26(2)' },
  { id: 'P3', part: 'project', topic: 'People affected', q: 'Who is affected by the system’s outputs, how many people, and in what way?', why: 'The scale and nature of the effect on people drive the risk assessment and any fundamental rights assessment.', ref: 'Art. 9(9); Art. 27(1)(c)' },
  { id: 'P4', part: 'project', topic: 'Misuse and limits', q: 'Which uses are out of scope, and what reasonably foreseeable misuse have you identified? How do you prevent it?', why: 'Risk management must cover foreseeable misuse, not only intended use.', ref: 'Art. 9(2)(b); Art. 13(3)(b)(iii)' },
  { id: 'P5', part: 'project', topic: 'Need and alternatives', q: 'Why is an AI system needed for this task, and which alternatives (including non-AI options) did you consider?', why: 'Proportionality: assessors look for evidence that the benefits justify the risks introduced.', ref: 'Art. 9(5); Recital 65' },
  { id: 'P6', part: 'project', topic: 'Data sources', q: 'Which data sources does the system use for training, validation, testing and operation, and where does each come from?', why: 'Data governance starts with knowing the origin and original purpose of every dataset.', ref: 'Art. 10(2)(b); Annex IV(2)(d)' },
  { id: 'P7', part: 'project', topic: 'Data preparation', q: 'How was the data collected, labelled, cleaned and enriched, and what assumptions does it rest on?', why: 'Preparation choices shape what the model learns; they must be recorded so they can be challenged.', ref: 'Art. 10(2)(c)-(d)' },
  { id: 'P8', part: 'project', topic: 'Representativeness and bias', q: 'How have you checked that the data is relevant, representative and free of bias likely to harm people, and what did you change as a result?', why: 'High-risk systems must examine data for possible biases and take measures to detect, prevent and mitigate them.', ref: 'Art. 10(2)(f)-(g); Art. 10(3)' },
  { id: 'P9', part: 'project', topic: 'Personal data', q: 'Which personal or special category data is processed, on what lawful basis, and what does the data protection impact assessment conclude?', why: 'GDPR applies alongside the AI Act; special category data for bias testing needs specific safeguards.', ref: 'Art. 10(5); GDPR Art. 35' },
  { id: 'P10', part: 'project', topic: 'Risks identified', q: 'Which risks to health, safety and fundamental rights have you identified, and how likely and severe is each?', why: 'A continuous, documented risk management process is the backbone of the conformity assessment.', ref: 'Art. 9(2)(a)' },
  { id: 'P11', part: 'project', topic: 'Risk treatment', q: 'Which measures address each risk, what residual risk remains, and who accepted it and when?', why: 'Residual risk must be judged acceptable, and the measures and their testing documented.', ref: 'Art. 9(4)-(5)' },
  { id: 'P12', part: 'project', topic: 'Fundamental rights', q: 'What is the impact on fundamental rights such as non-discrimination, privacy and access to services, and how is it mitigated?', why: 'Some deployers must complete a fundamental rights impact assessment; providers must consider these rights in their risk management.', ref: 'Art. 27; Art. 9(2)(a)' },
  { id: 'P13', part: 'project', topic: 'Accountability', q: 'Who is accountable for the system, who approved it for use, and on what evidence?', why: 'A named person must answer for the system and its sign-off.', ref: 'Art. 17(1)(m); Art. 26(2)' },
  { id: 'P14', part: 'project', topic: 'Human oversight', q: 'How do people oversee the system: what they review, how they can override or stop it, and how automation bias is countered?', why: 'High-risk systems must be designed so people can understand, monitor and override them.', ref: 'Art. 14' },
  { id: 'P15', part: 'project', topic: 'Transparency', q: 'What are users and affected people told about the system, when and how? Include AI disclosures and explanations of decisions.', why: 'Instructions for use, AI disclosures and information to affected people are separate duties that all need evidence.', ref: 'Art. 13; Art. 26(11); Art. 50' },
  { id: 'P16', part: 'project', topic: 'Stakeholders', q: 'Which stakeholders were consulted (users, affected groups, experts, works councils) and what changed as a result?', why: 'Engaging those affected is good evidence that risks to them were properly understood.', ref: 'Art. 27; Recital 64' },
  { id: 'P17', part: 'project', topic: 'Record-keeping', q: 'Which events are logged automatically, for how long are the logs kept, and who can access them?', why: 'Automatic logs make outputs traceable and incidents investigable; deployers must keep them for at least six months.', ref: 'Art. 12; Art. 19; Art. 26(6)' },
  { id: 'P18', part: 'project', topic: 'Post-market monitoring', q: 'How is the system monitored after release, and how are serious incidents identified and reported to the authority in time?', why: 'Post-market monitoring and serious-incident reporting continue for the system’s whole life.', ref: 'Art. 72; Art. 73' },
  { id: 'P19', part: 'project', topic: 'Role in the value chain', q: 'What is your organisation’s role for this system (provider, deployer, importer, distributor, authorised representative), and has anything been done that could make you its provider: your name or trademark on it, a substantial modification, or a new intended purpose?', why: 'Obligations follow the role, and a deployer or distributor that rebrands, substantially modifies or repurposes a high-risk system becomes its provider.', ref: 'Art. 3(3)-(7); Art. 22–25' },
  { id: 'P20', part: 'project', topic: 'Corrective action', q: 'If the system is found not to conform or to present a risk, how would you correct, withdraw, disable or recall it, and whom would you inform?', why: 'Providers must act at once on non-conformity and inform the others in the value chain and, where there is a risk, the authorities.', ref: 'Art. 20; Art. 79' },
  // Technical
  { id: 'T1', part: 'tech', topic: 'Model and architecture', q: 'Describe the model type, architecture and how the system’s components fit together.', why: 'Annex IV asks for a general description of the system and its design.', ref: 'Annex IV(1)-(2)(b)' },
  { id: 'T2', part: 'tech', topic: 'Third-party components', q: 'Which pre-trained models, tools or components from third parties are used, in which versions, and how were they assessed?', why: 'Components from others, including general-purpose models, must be identified and their limits understood.', ref: 'Annex IV(2)(a); Art. 25(4)' },
  { id: 'T3', part: 'tech', topic: 'Design choices', q: 'Which key design choices and assumptions were made, and what trade-offs (for example accuracy against explainability) did you accept?', why: 'Assessors need the rationale behind the design, not just the result.', ref: 'Annex IV(2)(b)' },
  { id: 'T4', part: 'tech', topic: 'Training and testing', q: 'How was the model trained, validated and tested, on which datasets, and how were test sets kept independent?', why: 'Validation and testing procedures, and the data used, are part of the technical documentation.', ref: 'Annex IV(2)(d), (g)' },
  { id: 'T5', part: 'tech', topic: 'Performance targets', q: 'Which accuracy and performance metrics do you use, with which acceptance thresholds, and why are they appropriate for the purpose?', why: 'Accuracy levels and metrics must be declared in the instructions for use.', ref: 'Art. 15(1)-(3)' },
  { id: 'T6', part: 'tech', topic: 'Results', q: 'What results did the system achieve against those thresholds and against a baseline, and who validated them?', why: 'Evidence of meeting the declared performance, ideally independently validated, is central to conformity.', ref: 'Annex IV(2)(g); Annex IV(3)' },
  { id: 'T7', part: 'tech', topic: 'Fairness', q: 'Which fairness metrics were measured across groups, with what results, and what was done about any disparity?', why: 'Bias testing results show whether the measures in the data and design actually worked.', ref: 'Art. 10(2)(f); Art. 15' },
  { id: 'T8', part: 'tech', topic: 'Robustness', q: 'How does the system handle errors, unusual inputs and failures? Describe fail-safes and fallback procedures.', why: 'High-risk systems must be resilient to errors and faults, with technical redundancy where needed.', ref: 'Art. 15(4)' },
  { id: 'T9', part: 'tech', topic: 'Security', q: 'Which security measures protect against AI-specific attacks such as data poisoning, model extraction, adversarial inputs and prompt injection?', why: 'Cybersecurity proportionate to the risks, including AI-specific threats, is required.', ref: 'Art. 15(5)' },
  { id: 'T10', part: 'tech', topic: 'Explainability', q: 'How can the system’s outputs be interpreted by overseers and explained to affected people?', why: 'Deployers must be able to interpret outputs; affected people may have a right to an explanation.', ref: 'Art. 13(1); Art. 86' },
  { id: 'T11', part: 'tech', topic: 'Generative safeguards', q: 'For generative components: how are hallucination, harmful content and data leakage tested and controlled, and how is synthetic content marked?', why: 'Generative outputs bring their own risks and marking duties.', ref: 'Art. 50(2); Art. 15', genai: true },
  { id: 'T12', part: 'tech', topic: 'Change management', q: 'How are model and system versions controlled, and which changes trigger re-validation or a new conformity assessment?', why: 'A substantial modification requires a new conformity assessment, so you need to recognise one.', ref: 'Art. 43(4); Annex IV(6)' },
  { id: 'T13', part: 'tech', topic: 'Production monitoring', q: 'Which metrics are monitored in production (performance, fairness, drift), against which thresholds, and who acts on alerts?', why: 'Monitoring evidences that the system keeps performing as declared once in use.', ref: 'Art. 72; Art. 26(5)' },
  { id: 'T14', part: 'tech', topic: 'Logging implementation', q: 'How is logging implemented technically: what is captured for each output, and how is integrity protected?', why: 'Logs are only useful as evidence if they are complete and cannot be altered unnoticed.', ref: 'Art. 12(2)-(3)' },
  { id: 'T15', part: 'tech', topic: 'Retraining and retirement', q: 'What triggers retraining or retirement of the model, and how is a retired model handled?', why: 'The lifecycle does not end at deployment; assessors look for a planned end state.', ref: 'Art. 9(2); Art. 72' },
];

/** How a question is numbered on screen and in documents: Organisational 1, Project 4, Technical 12. */
export function confLabel(id: string) {
  const part = ({ O: 'Organisational', P: 'Project', T: 'Technical' } as Record<string, string>)[id[0]] || '';
  return `${part} ${id.slice(1)}`;
}

export function questionsFor(sys: AssessmentData): ConfQuestion[] {
  const genai = has(sys.profile?.aiType, 'genai') || has(sys.profile?.aiType, 'agent');
  return CONF_QUESTIONS.filter(q => !q.genai || genai);
}

const opt = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];
const STATUS_WORD: Record<string, string> = { met: 'In place', partial: 'Partly in place', gap: 'Not in place', na: 'Not applicable' };
const lines = (...xs: (string | number | false | null | undefined)[]) => xs.filter(x => typeof x === 'string' && x).join('\n');

/** Text already recorded elsewhere in the assessment that answers a question, and where it came from. */
export function prefill(sys: AssessmentData, id: string): { t: string; from: string } | null {
  const p: Record<string, any> = sys.profile || {};
  const ctrl = sys.ctrl || {};
  const card = (k: string) => (sys.card?.[k] || '').trim();
  const c = (cid: string) => { const x = ctrl[cid]; return x?.e?.trim() ? `${STATUS_WORD[x.s || ''] || 'Evidence'} (${cid}): ${x.e.trim()}` : ''; };
  const cls = classify(sys);
  const metrics = sys.metrics || [];
  const pick = (from: string, ...parts: (string | number | false | null | undefined)[]) => { const t = lines(...parts).trim(); return t ? { t: t.slice(0, CONF_MAX), from } : null; };
  switch (id) {
    case 'O1': return pick('Controls', c('GOV-1'));
    case 'O2': return pick('Controls', c('GOV-4'));
    case 'O3': return pick('Profile and controls', p.owner && `Accountable owner: ${p.owner}`, c('GOV-2'));
    case 'O4': return pick('Controls', c('GOV-6'), c('DOC-3'));
    case 'O6': return pick('Controls', c('CNF-4'));
    case 'O5': return pick('Profile and controls', p.vendor && `Third-party model or product: ${p.vendor}`, c('GOV-5'));
    case 'P1': return pick('Profile and model card', card('purpose') || p.description, p.func && `Business function: ${opt('func', p.func)}`);
    case 'P2': return pick('Model card', card('users'));
    case 'P3': return pick('Profile', p.affects && `Affected: ${opt('affects', p.affects)}`, p.scale && `People affected each year: ${opt('scale', p.scale)}`, p.revers && `Reversibility of a wrong outcome: ${opt('revers', p.revers)}`);
    case 'P4': return pick('Model card and controls', card('outOfScope'), c('RSK-4'));
    case 'P6': return pick('Profile and model card', p.dataSources, card('data'));
    case 'P7': return pick('Controls', c('DAT-1'));
    case 'P8': return pick('Controls', c('DAT-2'), c('DAT-3'));
    case 'P9': return pick('Profile and controls', p.personal && `Data processed: ${opt('personal', p.personal)}`, c('DAT-4'), c('RSK-3'));
    case 'P10': {
      const ir = inherentRisk(sys);
      return pick('Classification and controls', cls.reasons.length ? `EU AI Act classification: ${cls.reasons.join('; ')}` : '', ir && `Inherent risk score ${ir.score}/100 (${ir.band})`, c('RSK-1'));
    }
    case 'P11': return pick('Controls', c('RSK-1'));
    case 'P12': return pick('Controls', c('RSK-2'));
    case 'P13': return pick('Profile and controls', p.owner && `Accountable owner: ${p.owner}`, c('GOV-2'));
    case 'P14': return pick('Profile, model card and controls', p.autonomy && `Degree of automation: ${opt('autonomy', p.autonomy)}`, card('oversight'), c('HUM-1'), c('HUM-2'));
    case 'P15': {
      const tx = TRANSPARENCY.filter(([k]) => sys.cls?.t?.[k]).map(([, t, ref]) => `${t} (${ref})`);
      return pick('Classification and controls', tx.length && `Transparency triggers: ${tx.join('; ')}`, c('TXP-1'), c('TXP-2'));
    }
    case 'P19': {
      const roles = (p.role || []) as string[];
      return pick('Profile and controls', roles.length && `Role: ${roles.map(x => opt('role', x)).join(', ')}`, p.established && `Provider established: ${opt('established', p.established)}`, c('GOV-7'), c('CNF-5'), c('CNF-6'));
    }
    case 'P20': return pick('Controls', c('MON-5'));
    case 'P17': return pick('Controls', c('DOC-2'));
    case 'P18': return pick('Controls', c('MON-1'), c('MON-2'), c('MON-3'));
    case 'T1': return pick('Profile and model card', (p.aiType || []).length && `Type of AI: ${(p.aiType as string[]).map(x => opt('aiType', x)).join(', ')}`, card('model'));
    case 'T2': return pick('Profile and controls', p.vendor && `${opt('source', p.source) || 'Third-party component'}: ${p.vendor}${p.version ? `, version ${p.version}` : ''}`, c('GOV-5'), c('DAT-5'));
    case 'T4': return pick('Controls', c('TEC-1'), c('TEC-2'));
    case 'T5': return pick('Monitoring', metrics.length && metrics.map(m => `${m.name}${m.threshold !== '' && m.threshold != null ? `: threshold ${m.dir === 'below' ? '≤' : '≥'} ${m.threshold}` : ''}`).join('\n'));
    case 'T6': return pick('Model card and controls', card('performance') || cardValue(sys, 'performance'), c('TEC-1'));
    case 'T7': return pick('Model card and controls', card('fairness'), c('DAT-3'));
    case 'T8': return pick('Controls', c('TEC-3'), c('HUM-2'));
    case 'T9': return pick('Controls', c('TEC-4'));
    case 'T10': return pick('Controls', c('TXP-3'));
    case 'T11': return pick('Controls', c('TEC-5'));
    case 'T12': return pick('Profile and controls', p.version && `Current version: ${p.version}`, c('DOC-3'));
    case 'T13': return pick('Monitoring and controls', metrics.length && `Monitored metrics: ${metrics.map(m => m.name).join(', ')}`, c('MON-1'));
    case 'T14': return pick('Controls', c('DOC-2'));
    case 'T15': return pick('Controls', c('MON-4'));
    default: return null;
  }
}

export type ConfState = 'done' | 'review' | 'open';
/** done: answered and confirmed; review: pre-filled or proposed text waiting for a person; open: nothing yet. */
export function answerState(sys: AssessmentData, q: ConfQuestion): { state: ConfState; text: string; from?: string } {
  const a = sys.conf?.[q.id];
  if (a?.t?.trim()) return { state: a.ok ? 'done' : 'review', text: a.t, from: a.from };
  const pf = prefill(sys, q.id);
  if (pf) return { state: 'review', text: pf.t, from: pf.from };
  return { state: 'open', text: '' };
}

export function confProgress(sys: AssessmentData) {
  const qs = questionsFor(sys);
  const parts = CONF_PARTS.map(([key, label]) => {
    const list = qs.filter(q => q.part === key);
    const st = list.map(q => answerState(sys, q).state);
    return { key, label, total: list.length, done: st.filter(s => s === 'done').length, review: st.filter(s => s === 'review').length };
  });
  const total = parts.reduce((a, x) => a + x.total, 0), done = parts.reduce((a, x) => a + x.done, 0);
  return { parts, total, done, pct: total ? Math.round(done / total * 100) : 0 };
}

/** Whether Article 43 applies to this organisation for this system, and by which route. */
export function art43(sys: AssessmentData): { required: boolean; likely: boolean; text: string } {
  const r = classify(sys);
  const role: string[] = sys.profile?.role || [];
  const provider = role.includes('provider');
  if (r.tier !== 'high') return { required: false, likely: false, text: r.tier === 'unknown' ? 'Classify the system first: a conformity assessment is required for high-risk systems.' : 'Not a high-risk system on the current classification, so Article 43 does not apply. The questionnaire is still a sound internal assessment.' };
  const bio = !!sys.cls?.a3?.h_bio;
  const route = bio ? 'For biometric systems the route is internal control (Annex VI) only where harmonised standards are applied in full; otherwise a notified body (Annex VII).' : 'For this Annex III area the route is internal control under Annex VI.';
  if (provider) return { required: true, likely: true, text: `High-risk and you are the provider: a conformity assessment under Article 43 is required before the system is placed on the market or put into service. ${route}` };
  if (!role.length) return { required: false, likely: true, text: `High-risk: Article 43 is likely required. Record your organisation’s role in the profile; providers must complete it, deployers must check the provider has. ${route}` };
  return { required: false, likely: false, text: 'High-risk, and you are a deployer: the provider carries out the Article 43 assessment. Use this questionnaire to evidence your own checks (Art. 26) and your fundamental rights impact assessment where needed (Art. 27).' };
}
