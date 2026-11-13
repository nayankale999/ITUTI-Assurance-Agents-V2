/* NIST AI Risk Management Framework 1.0 (NIST AI 100-1, January 2023): the 72 subcategories of the AI RMF Core,
 * by function and category, with a short paraphrase of each. Every control in the library names the subcategories
 * it evidences (Control.nist), so NIST coverage is computed per subcategory from the controls that apply. */
import { applicable, CONTROLS, type AssessmentData, type Control } from './assurance';

export type NistFunction = 'GOVERN' | 'MAP' | 'MEASURE' | 'MANAGE';
export type NistSub = { id: string; fn: NistFunction; text: string };

export const NIST_FUNCTIONS: [NistFunction, string][] = [
  ['GOVERN', 'A culture of risk management is cultivated and present'],
  ['MAP', 'Context is recognised and risks related to context are identified'],
  ['MEASURE', 'Identified risks are assessed, analysed or tracked'],
  ['MANAGE', 'Risks are prioritised and acted upon based on projected impact'],
];

const S: [string, string][] = [
  ['GOVERN 1.1', 'Legal and regulatory requirements involving AI are understood, managed and documented'],
  ['GOVERN 1.2', 'Characteristics of trustworthy AI are integrated into policies, processes and practices'],
  ['GOVERN 1.3', 'The level of risk management activity is set by the organisation’s risk tolerance'],
  ['GOVERN 1.4', 'The risk management process and its outcomes are set through transparent policies and controls'],
  ['GOVERN 1.5', 'The risk management process is monitored and reviewed periodically, with roles defined'],
  ['GOVERN 1.6', 'An inventory of AI systems is kept, resourced according to risk priorities'],
  ['GOVERN 1.7', 'AI systems are decommissioned and phased out safely'],
  ['GOVERN 2.1', 'Roles, responsibilities and lines of communication for AI risk are documented and clear'],
  ['GOVERN 2.2', 'Personnel and partners receive AI risk management training'],
  ['GOVERN 2.3', 'Executive leadership takes responsibility for decisions about AI risks'],
  ['GOVERN 3.1', 'Decisions across the lifecycle are informed by a diverse team'],
  ['GOVERN 3.2', 'Roles for human-AI configurations and oversight of AI systems are defined'],
  ['GOVERN 4.1', 'Policies foster critical thinking and a safety-first mindset'],
  ['GOVERN 4.2', 'Teams document and communicate the risks and impacts of the AI they build or use'],
  ['GOVERN 4.3', 'Practices enable AI testing, identification of incidents and information sharing'],
  ['GOVERN 5.1', 'Feedback from those outside the team about potential impacts is collected and integrated'],
  ['GOVERN 5.2', 'Feedback from relevant AI actors is regularly incorporated into system design and implementation'],
  ['GOVERN 6.1', 'Policies address risks from third-party software, data and intellectual property'],
  ['GOVERN 6.2', 'Contingency processes handle failures in high-risk third-party data or AI systems'],
  ['MAP 1.1', 'Intended purposes, beneficial uses, context, laws, norms and expectations are understood and documented'],
  ['MAP 1.2', 'Interdisciplinary actors with diverse competencies participate in establishing context'],
  ['MAP 1.3', 'The organisation’s mission and goals for AI are understood and documented'],
  ['MAP 1.4', 'The business value or context of use is defined, or re-evaluated for systems in use'],
  ['MAP 1.5', 'Organisational risk tolerances are determined and documented'],
  ['MAP 1.6', 'System requirements are elicited from relevant actors, considering socio-technical implications'],
  ['MAP 2.1', 'The tasks and methods the system supports are defined'],
  ['MAP 2.2', 'Knowledge limits and how outputs are used and overseen by people are documented'],
  ['MAP 2.3', 'Scientific integrity and test, evaluation, verification and validation considerations are documented'],
  ['MAP 3.1', 'Potential benefits of intended functionality and performance are examined and documented'],
  ['MAP 3.2', 'Potential costs of AI errors or poor trustworthiness, including non-monetary costs, are documented'],
  ['MAP 3.3', 'The targeted application scope is specified and documented'],
  ['MAP 3.4', 'Operator and practitioner proficiency with the system is defined, assessed and documented'],
  ['MAP 3.5', 'Processes for human oversight are defined, assessed and documented'],
  ['MAP 4.1', 'Legal and technology risks of components, including third-party data and software, are mapped'],
  ['MAP 4.2', 'Internal risk controls for components, including third-party technologies, are identified and documented'],
  ['MAP 5.1', 'Likelihood and magnitude of each identified impact, beneficial or harmful, are identified and documented'],
  ['MAP 5.2', 'Practices support regular engagement with relevant actors and integrate feedback about impacts'],
  ['MEASURE 1.1', 'Approaches and metrics for the most significant risks are selected, and unmeasured risks documented'],
  ['MEASURE 1.2', 'The appropriateness of metrics and the effectiveness of controls are regularly assessed and updated'],
  ['MEASURE 1.3', 'Internal experts not involved in development, or independent assessors, take part in regular assessments'],
  ['MEASURE 2.1', 'Test sets, metrics and details of the tools used in evaluation are documented'],
  ['MEASURE 2.2', 'Evaluations involving human subjects meet protection requirements and represent the relevant population'],
  ['MEASURE 2.3', 'Performance or assurance criteria are measured and demonstrated in conditions like deployment'],
  ['MEASURE 2.4', 'The functionality and behaviour of the system and its components are monitored in production'],
  ['MEASURE 2.5', 'The system is demonstrated to be valid and reliable, and limits of generalisability are documented'],
  ['MEASURE 2.6', 'The system is evaluated regularly for safety risks; it can fail safely'],
  ['MEASURE 2.7', 'Security and resilience are evaluated and documented'],
  ['MEASURE 2.8', 'Risks to transparency and accountability are examined and documented'],
  ['MEASURE 2.9', 'The model is explained, validated and documented, and outputs are interpreted in context'],
  ['MEASURE 2.10', 'Privacy risk is examined and documented'],
  ['MEASURE 2.11', 'Fairness and bias are evaluated and the results documented'],
  ['MEASURE 2.12', 'Environmental impact and sustainability of model training and management are assessed and documented'],
  ['MEASURE 2.13', 'The effectiveness of the evaluation metrics and processes is evaluated and documented'],
  ['MEASURE 3.1', 'Approaches are in place to identify and track existing, unanticipated and emergent risks'],
  ['MEASURE 3.2', 'Risk tracking covers settings where risks are difficult to assess with available techniques'],
  ['MEASURE 3.3', 'End users and affected communities can report problems and appeal outcomes'],
  ['MEASURE 4.1', 'Measurement approaches are connected to deployment context and informed by domain experts'],
  ['MEASURE 4.2', 'Trustworthiness results in deployment are validated with domain experts and relevant actors'],
  ['MEASURE 4.3', 'Measurable performance changes are identified from field data and stakeholder feedback'],
  ['MANAGE 1.1', 'It is determined whether the system achieves its intended purpose and whether to proceed'],
  ['MANAGE 1.2', 'Treatment of documented risks is prioritised by impact, likelihood and available resources'],
  ['MANAGE 1.3', 'Responses to high-priority risks are developed, planned and documented'],
  ['MANAGE 1.4', 'Residual risks are documented for downstream acquirers and end users'],
  ['MANAGE 2.1', 'Resources needed to manage risks are considered, along with non-AI alternatives'],
  ['MANAGE 2.2', 'Mechanisms are in place to sustain the value of deployed systems'],
  ['MANAGE 2.3', 'Procedures are followed to respond to and recover from a previously unknown risk'],
  ['MANAGE 2.4', 'Mechanisms exist to supersede, disengage or deactivate systems with inconsistent outcomes'],
  ['MANAGE 3.1', 'Risks and benefits from third-party resources are monitored and risk controls applied'],
  ['MANAGE 3.2', 'Pre-trained models used in development are monitored as part of regular maintenance'],
  ['MANAGE 4.1', 'Post-deployment monitoring covers user input, appeal and override, decommissioning and change management'],
  ['MANAGE 4.2', 'Measurable activities for continual improvement are integrated into system updates'],
  ['MANAGE 4.3', 'Incidents and errors are communicated to relevant actors, tracked, responded to and recovered from'],
];
export const NIST_SUBCATEGORIES: NistSub[] = S.map(([id, text]) => ({ id, fn: id.split(' ')[0] as NistFunction, text }));
const IDS = new Set(NIST_SUBCATEGORIES.map(s => s.id));

/** The subcategories a control evidences, from its comma-separated nist field. */
export const nistRefs = (c: Pick<Control, 'nist'>) => (c.nist || '').split(',').map(x => x.trim()).filter(Boolean);
export const validNistRef = (id: string) => IDS.has(id);

export type SubStatus = 'met' | 'partial' | 'gap' | 'open' | 'na';
export type NistRow = NistSub & { controls: string[]; status: SubStatus | 'notApplicable' };

/** NIST AI RMF coverage for one system: each subcategory with the applicable controls that evidence it and its
 *  status (met only when every mapped control is met; not met when any is). Subcategories whose controls do not
 *  apply to this system are reported as not applicable. */
export function nistCoverage(sys: AssessmentData) {
  const list = applicable(sys);
  const ctrl = sys.ctrl || {};
  const rows: NistRow[] = NIST_SUBCATEGORIES.map(sub => {
    const cs = list.filter(c => nistRefs(c).includes(sub.id));
    if (!cs.length) return { ...sub, controls: [], status: 'notApplicable' };
    const st = cs.map(c => ctrl[c.id]?.s || 'open').filter(s => s !== 'na');
    const status: SubStatus = !st.length ? 'na' : st.every(s => s === 'met') ? 'met' : st.some(s => s === 'gap') ? 'gap' : st.some(s => s === 'met' || s === 'partial') ? 'partial' : 'open';
    return { ...sub, controls: cs.map(c => c.id), status };
  });
  const byFn = NIST_FUNCTIONS.map(([fn, label]) => {
    const r = rows.filter(x => x.fn === fn);
    const inScope = r.filter(x => x.status !== 'notApplicable' && x.status !== 'na');
    return { fn, label, total: r.length, inScope: inScope.length, met: inScope.filter(x => x.status === 'met').length, partial: inScope.filter(x => x.status === 'partial').length, gap: inScope.filter(x => x.status === 'gap').length, open: inScope.filter(x => x.status === 'open').length };
  });
  return { rows, byFn };
}

/** Subcategories no control in the library evidences (should be none). */
export const unmappedSubcategories = () => NIST_SUBCATEGORIES.filter(s => !CONTROLS.some(c => nistRefs(c).includes(s.id))).map(s => s.id);
