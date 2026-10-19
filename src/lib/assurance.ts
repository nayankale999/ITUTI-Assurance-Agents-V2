/* Shared assessment logic: classification, obligations, control library and scoring.
   Used by both the server (to compute stored summaries) and the browser editor. */

export type FrameworkKey = 'eu' | 'uk' | 'iso' | 'nist';
export type Ctx = { high: boolean; provider: boolean; deployer: boolean; genai: boolean; agent: boolean; vendor: boolean; personal: boolean; people: boolean; fs: boolean; fsCust: boolean; t1: boolean; t2: boolean };
export type Control = { id: string; a: string; q: string; ev: string; eu: string; uk: string; iso: string; nist: string; when?: (c: Ctx) => boolean };
export type ProfileField = { k: string; label: string; type: 'text' | 'textarea' | 'select' | 'multi'; opts?: string; hint?: string; why?: string };
export type ProfileSection = { title: string; note?: string; fields: ProfileField[] };
export type Metric = { id: string; name: string; kind?: string; threshold?: string | number | null; dir?: 'above' | 'below'; readings?: { d: string; v: number }[] };
export type ControlState = { s?: string; e?: string };
export type AssessmentData = {
  profile?: Record<string, any>;
  cls?: Record<string, any>;
  ctrl?: Record<string, ControlState>;
  card?: Record<string, string>;
  metrics?: Metric[];
  aiReview?: { at: string; items: Record<string, { v: string; n: string }> };
  /** Conformity assessment answers: t text, ok confirmed by a person, from where pre-filled or proposed text came from. */
  conf?: Record<string, { t?: string; ok?: boolean; from?: string }>;
  /** Classification confirmed by a person, with a snapshot of the profile answers it was based on. */
  clsOk?: { at: string; u?: string; snap: string };
  /** Fields filled from an accepted agent proposal: v is the accepted value as JSON, so a later manual edit shows as no longer agent-sourced. */
  prov?: Record<string, Prov>;
};
export type Prov = { p: string; at: string; u: string; v: string };
export type Classification = { tier: string; reasons: string[]; flags: string[]; euScope: boolean; fria: boolean };
export type Readiness = { pct: number; den: number; met: number; partial: number; gap: number; open: number };

/* ===== Ituti AI Assurance: control library, classification and scoring =====
   Original content written from the public texts of the EU AI Act (Reg. 2024/1689),
   UK AI regulatory principles, FCA/PRA material, ISO/IEC 42001:2023 and NIST AI RMF 1.0. */

export const OPTS: Record<string, [string, string][]> = {
  lifecycle: [['plan','Idea or planning'],['dev','In development or testing'],['pilot','Pilot'],['prod','In production'],['retired','Retired']],
  regions: [['eu','European Union'],['uk','United Kingdom'],['us','United States'],['other','Other']],
  sector: [['bank','Banking and lending'],['ins','Insurance'],['wealth','Asset and wealth management'],['pay','Payments'],['public','Public sector'],['health','Healthcare'],['retail','Retail and consumer'],['other','Other']],
  func: [['credit','Credit and lending decisions'],['uw','Underwriting and pricing'],['fraud','Fraud and financial crime'],['service','Customer service'],['marketing','Marketing and sales'],['hr','HR and recruitment'],['ops','Operations'],['risk','Risk and compliance'],['it','IT and engineering'],['other','Other']],
  aiType: [['ml','Predictive or machine-learning model'],['genai','Generative AI or LLM'],['agent','Agentic workflow (takes actions)'],['vision','Computer vision or biometrics'],['rules','Rules plus ML hybrid']],
  source: [['inhouse','Built in-house'],['vendor','Vendor product'],['foundation','Built on a third-party foundation model'],['oss','Open-source model, adapted in-house']],
  role: [['provider','Provider: we develop it or put our name on it'],['deployer','Deployer: we use it under our authority'],['importer','Importer'],['distributor','Distributor']],
  affects: [['no','No direct effect on individuals'],['staff','Employees or job applicants'],['cust','Customers'],['public','Members of the public']],
  personal: [['none','No personal data'],['personal','Personal data'],['special','Special category or biometric data']],
  scale: [['s0','Fewer than 1,000 people a year'],['s1','1,000 to 100,000'],['s2','100,000 to 1 million'],['s3','More than 1 million']],
  autonomy: [['a0','Human decides; AI only informs'],['a1','AI recommends; human reviews each case'],['a2','Automated, with sample-based review'],['a3','Fully automated decisions']],
  revers: [['r0','Easily reversed, low impact'],['r1','Reversible with effort'],['r2','Hard to reverse or significant harm']],
};

export const PROFILE_SECTIONS: ProfileSection[] = [
  { title: 'Identity', fields: [
    { k:'name', label:'System name', type:'text', why:'The name used in the inventory, reports and model card.' },
    { k:'client', label:'Business unit or legal entity', type:'text', hint:'Used to group systems across subsidiaries and business units', why:'Groups systems by entity, so a multi-entity group can see its whole AI estate and each entity its own.' },
    { k:'team', label:'Team that manages it', type:'text', hint:'For example HR Technology or Credit Risk Analytics', why:'An auditor’s first question is who runs the system day to day; the team is who they will talk to.' },
    { k:'owner', label:'Responsible person', type:'text', hint:'Name and role of the person formally accountable for outcomes', why:'The AI Act and SM&CR both expect a named individual who answers for the system (Art. 26(2), Art. 17(1)(m)).' },
    { k:'description', label:'What the system does', type:'textarea', hint:'Purpose, inputs, outputs and who uses the outputs', why:'The intended purpose decides the risk tier and every obligation that follows (Art. 3(12)).' },
    { k:'lifecycle', label:'Lifecycle stage', type:'select', opts:'lifecycle', why:'Obligations apply before a system is placed on the market or put into service, so the stage tells you what is due now.' },
  ]},
  { title: 'Context', fields: [
    { k:'regions', label:'Where it is used or its outputs take effect', type:'multi', opts:'regions', why:'The EU AI Act applies when the system or its outputs are used in the EU, wherever it is built (Art. 2).' },
    { k:'sector', label:'Sector', type:'select', opts:'sector', why:'Sector decides which supervisors and rules apply alongside the AI Act, such as the FCA, PRA or insurance rules.' },
    { k:'func', label:'Business function', type:'select', opts:'func', why:'Some functions, such as credit, recruitment and insurance pricing, fall under Annex III and are presumed high-risk.' },
    { k:'role', label:'Your organisation’s role', type:'multi', opts:'role', hint:'Determines provider versus deployer obligations under the EU AI Act', why:'Providers carry the conformity assessment; deployers carry duties of use, oversight and monitoring (Art. 16, Art. 26).' },
  ]},
  { title: 'Technology and data', fields: [
    { k:'aiType', label:'Type of AI', type:'multi', opts:'aiType', why:'Generative and agentic systems bring extra risks and controls, such as hallucination testing and action limits.' },
    { k:'source', label:'Where the model comes from', type:'select', opts:'source', why:'Third-party models need supplier due diligence and the provider’s documentation (Art. 25).' },
    { k:'vendor', label:'Vendor or foundation model', type:'text', hint:'For example the product name or model family', why:'Naming the model lets the assessment agent bring in what its provider publishes.' },
    { k:'version', label:'Current version', type:'text', why:'Assessments are of a specific version; a substantial change needs reassessment (Art. 43(4)).' },
    { k:'dataSources', label:'Data sources and categories', type:'textarea', hint:'Where training and input data come from, and what kinds of data they hold', why:'Data governance obligations start from knowing each source and what it contains (Art. 10).' },
  ]},
  { title: 'Impact factors', note:'These answers drive the inherent risk score.', fields: [
    { k:'affects', label:'Who is affected by its outputs', type:'select', opts:'affects', why:'Effects on employees, customers or the public raise the stakes and bring fundamental-rights duties.' },
    { k:'personal', label:'Data processed', type:'select', opts:'personal', why:'Personal and special category data bring GDPR duties and raise the potential for harm.' },
    { k:'scale', label:'People affected each year', type:'select', opts:'scale', why:'The more people affected, the greater the impact of a systematic error.' },
    { k:'autonomy', label:'Degree of automation', type:'select', opts:'autonomy', why:'The less a person reviews each outcome, the more the controls and oversight design have to carry.' },
    { k:'revers', label:'Reversibility of a wrong outcome', type:'select', opts:'revers', why:'Harm that is hard to undo needs stronger safeguards before use.' },
  ]},
];

/* EU AI Act Article 5 screens (plain-language paraphrase) */
export const PROHIBITED: [string, string, string][] = [
  ['p1','Uses subliminal, manipulative or deceptive techniques that materially distort a person’s behaviour in a way likely to cause significant harm','Art. 5(1)(a)'],
  ['p2','Exploits vulnerabilities linked to age, disability or a social or economic situation to distort behaviour harmfully','Art. 5(1)(b)'],
  ['p3','Scores or classifies people on social behaviour or personality, leading to detrimental or disproportionate treatment','Art. 5(1)(c)'],
  ['p4','Predicts the risk of someone committing a crime based solely on profiling or personality traits','Art. 5(1)(d)'],
  ['p5','Builds or expands facial recognition databases by untargeted scraping of images from the internet or CCTV','Art. 5(1)(e)'],
  ['p6','Infers emotions of people at work or in education, other than for medical or safety reasons','Art. 5(1)(f)'],
  ['p7','Uses biometric data to infer race, political opinions, union membership, religion or sexual orientation','Art. 5(1)(g)'],
  ['p8','Performs real-time remote biometric identification in public spaces for law enforcement','Art. 5(1)(h)'],
];

/* EU AI Act Annex III areas, written for a financial services reader */
export const ANNEX3: [string, string, string][] = [
  ['h_bio','Biometric identification, categorisation or emotion recognition (where not prohibited)','Annex III(1)'],
  ['h_infra','Safety component in critical infrastructure: energy, water, transport or digital infrastructure','Annex III(2)'],
  ['h_edu','Access to, assessment in, or proctoring of education and vocational training','Annex III(3)'],
  ['h_emp','Recruitment, promotion, termination, task allocation or monitoring of workers','Annex III(4)'],
  ['h_credit','Creditworthiness assessment or credit scoring of individuals (fraud detection is excluded)','Annex III(5)(b)'],
  ['h_ins','Risk assessment and pricing for individuals in life or health insurance','Annex III(5)(c)'],
  ['h_public','Eligibility for public benefits or services, or triage of emergency calls','Annex III(5)(a),(d)'],
  ['h_law','Law enforcement, migration and border control, justice or elections','Annex III(6)-(8)'],
];

export const TRANSPARENCY: [string, string, string][] = [
  ['t1','Interacts directly with people, for example a chatbot or voice agent','Art. 50(1)'],
  ['t2','Generates or alters synthetic text, audio, images or video','Art. 50(2)'],
  ['t3','Performs emotion recognition or biometric categorisation','Art. 50(3)'],
  ['t4','Produces deepfakes, or AI-generated text published to inform the public','Art. 50(4)'],
];

/* Control library. refs: eu = EU AI Act, uk = UK regime, iso = ISO/IEC 42001, nist = NIST AI RMF.
   when: applicability test over the computed context. */
export const AREAS: [string, string][] = [
  ['gov','Governance and accountability'],
  ['risk','Risk and impact'],
  ['data','Data'],
  ['doc','Documentation and records'],
  ['tx','Transparency and explainability'],
  ['hum','Human oversight'],
  ['tech','Accuracy, robustness and security'],
  ['mon','Monitoring and incidents'],
  ['conf','EU conformity and registration'],
];

export const CONTROLS: Control[] = [
  { id:'GOV-1', a:'gov', q:'A board-approved AI policy sets the principles, risk appetite and prohibited uses that apply to this system.', ev:'Policy document, approval minutes, date of last review.', eu:'Art. 17', uk:'Accountability and governance', iso:'5.2, A.2', nist:'GOVERN 1' },
  { id:'GOV-2', a:'gov', q:'A named senior individual is accountable for this system’s outcomes and has authority to suspend it.', ev:'Responsibilities map, SM&CR statement of responsibilities where relevant.', eu:'Art. 26(2)', uk:'Accountability; SM&CR', iso:'5.3, A.3', nist:'GOVERN 2' },
  { id:'GOV-3', a:'gov', q:'The system is recorded in the AI inventory with its risk classification, and the rationale is documented and reviewed on a set cycle.', ev:'Inventory entry, classification rationale, review date.', eu:'Art. 6(4), Art. 49', uk:'SS1/23 Principle 1', iso:'6.1, A.5', nist:'MAP 1' },
  { id:'GOV-4', a:'gov', q:'People who build, operate or oversee the system have role-appropriate AI literacy training.', ev:'Training records, curriculum, completion rates.', eu:'Art. 4', uk:'Accountability and governance', iso:'7.2, A.4', nist:'GOVERN 2' },
  { id:'GOV-5', a:'gov', when:(c: Ctx)=>c.vendor, q:'Vendors and foundation-model providers are assessed, with contractual rights to documentation, change notices and incident information.', ev:'Due diligence file, contract clauses, vendor risk rating.', eu:'Art. 25', uk:'Outsourcing and third-party risk (SS2/21)', iso:'A.10', nist:'GOVERN 6' },
  { id:'GOV-6', a:'gov', when:(c: Ctx)=>c.high, q:'A documented quality management system covers design, testing, change control, data management and post-market monitoring for this system.', ev:'QMS procedures, process owners, audit results.', eu:'Art. 17', uk:'SS1/23 Principle 2', iso:'Clauses 4–10', nist:'GOVERN 4' },

  { id:'RSK-1', a:'risk', q:'Risks to health, safety and fundamental rights are identified, estimated and treated across the lifecycle, and re-assessed after material changes.', ev:'Risk register entries, treatment plans, residual risk sign-off.', eu:'Art. 9', uk:'Safety, security and robustness', iso:'6.1.2, 6.1.3', nist:'MAP 4, MANAGE 1' },
  { id:'RSK-2', a:'risk', when:(c: Ctx)=>c.people, q:'An impact assessment covers effects on the people and groups affected, including fundamental rights where relevant.', ev:'Impact assessment, or fundamental rights impact assessment where Art. 27 applies.', eu:'Art. 27', uk:'Fairness', iso:'6.1.4, A.5', nist:'MAP 5' },
  { id:'RSK-3', a:'risk', when:(c: Ctx)=>c.personal, q:'A data protection impact assessment is complete and its mitigations are implemented.', ev:'DPIA, DPO sign-off, mitigation tracker.', eu:'Art. 26(9); GDPR Art. 35', uk:'UK GDPR Art. 35', iso:'A.5, A.7', nist:'MAP 5' },
  { id:'RSK-4', a:'risk', q:'Intended purpose, out-of-scope uses and reasonably foreseeable misuse are documented and communicated to users.', ev:'Use-case statement, user guidance, misuse scenarios.', eu:'Art. 9(2)(b), Art. 13', uk:'Transparency and explainability', iso:'A.9', nist:'MAP 1' },
  { id:'RSK-5', a:'risk', when:(c: Ctx)=>c.fsCust, q:'Outcomes for customers, including those with characteristics of vulnerability, are monitored and evidence good outcomes and fair value.', ev:'Outcome MI, vulnerable-customer analysis, Consumer Duty board report.', eu:'Art. 9(9)', uk:'FCA Consumer Duty (PRIN 2A)', iso:'A.5', nist:'MEASURE 2.11' },

  { id:'DAT-1', a:'data', q:'Training, validation and test data are documented: sources, collection, labelling, cleaning and known gaps.', ev:'Data sheets, lineage diagrams, data dictionary.', eu:'Art. 10(2)', uk:'SS1/23 Principle 3', iso:'A.7', nist:'MAP 2' },
  { id:'DAT-2', a:'data', q:'Data is checked to be relevant, representative and as complete and error-free as possible for the intended population.', ev:'Data quality report, representativeness analysis.', eu:'Art. 10(3)', uk:'Safety, security and robustness', iso:'A.7', nist:'MEASURE 2' },
  { id:'DAT-3', a:'data', when:(c: Ctx)=>c.people, q:'Data and outputs are examined for bias likely to affect protected groups, with mitigations recorded.', ev:'Bias testing results by group, mitigation decisions.', eu:'Art. 10(2)(f)-(g)', uk:'Fairness; Equality Act 2010', iso:'A.5, A.7', nist:'MEASURE 2.11' },
  { id:'DAT-4', a:'data', when:(c: Ctx)=>c.personal, q:'Lawful basis, minimisation and retention are documented for all personal data, including data used for training.', ev:'Record of processing, retention schedule, lawful basis assessment.', eu:'GDPR Art. 5–6', uk:'UK GDPR', iso:'A.7', nist:'GOVERN 1' },
  { id:'DAT-5', a:'data', when:(c: Ctx)=>c.genai||c.vendor, q:'Rights to use training data and model components are confirmed, including licences and copyright.', ev:'Licence register, vendor warranties, copyright review.', eu:'Art. 53(1)(c)', uk:'Accountability and governance', iso:'A.7', nist:'GOVERN 6' },

  { id:'DOC-1', a:'doc', when:(c: Ctx)=>c.high, q:'Technical documentation describes design, architecture, model choice, training approach, performance and limitations, and is kept current.', ev:'Technical file following Annex IV headings.', eu:'Art. 11, Annex IV', uk:'SS1/23 Principle 3', iso:'A.6', nist:'MAP 2' },
  { id:'DOC-2', a:'doc', q:'Events needed to trace outputs and investigate incidents are logged automatically, with defined retention.', ev:'Logging specification, sample logs, retention setting.', eu:'Art. 12, Art. 26(6)', uk:'Accountability and governance', iso:'A.6', nist:'MANAGE 4' },
  { id:'DOC-3', a:'doc', q:'Model and system versions are controlled, and material changes trigger re-validation and, where needed, re-assessment.', ev:'Change log, release approvals, re-validation evidence.', eu:'Art. 43(4)', uk:'SS1/23 Principle 3', iso:'6.3, A.6', nist:'MANAGE 2' },

  { id:'TXP-1', a:'tx', when:(c: Ctx)=>c.high&&c.provider, q:'Deployers receive instructions for use covering purpose, accuracy, limitations, oversight measures and maintenance.', ev:'Instructions for use document.', eu:'Art. 13', uk:'Transparency and explainability', iso:'A.8', nist:'GOVERN 4' },
  { id:'TXP-2', a:'tx', when:(c: Ctx)=>c.people||c.t1||c.t2, q:'People are told in clear language when they interact with AI, are subject to an AI-assisted decision, or see AI-generated content.', ev:'Customer notices, UI copy, content labels.', eu:'Art. 26(11), Art. 50', uk:'Transparency and explainability', iso:'A.8', nist:'GOVERN 4' },
  { id:'TXP-3', a:'tx', when:(c: Ctx)=>c.people, q:'Individuals can obtain a meaningful explanation of decisions that affect them.', ev:'Explanation method, sample explanations, adverse-action reasons.', eu:'Art. 86', uk:'Transparency; UK GDPR automated decision-making rules', iso:'A.8', nist:'MEASURE 2.9' },
  { id:'TXP-4', a:'tx', q:'A model card summarises purpose, data, performance, fairness, limitations and contacts, and is kept with the inventory record.', ev:'Model card (generated in this tool).', eu:'Art. 11, Art. 13', uk:'Transparency and explainability', iso:'A.6, A.8', nist:'MAP 2' },

  { id:'HUM-1', a:'hum', q:'Human oversight is designed in: overseers understand capabilities and limits, watch for automation bias, and can override outputs.', ev:'Oversight procedure, overseer training, override statistics.', eu:'Art. 14, Art. 26(2)', uk:'Accountability and governance', iso:'A.9', nist:'MANAGE 2' },
  { id:'HUM-2', a:'hum', q:'Overseers can halt the system safely through a stop control or fallback process, and the fallback has been tested.', ev:'Runbook, kill-switch test record.', eu:'Art. 14(4)(e)', uk:'Safety, security and robustness', iso:'A.9', nist:'MANAGE 2.4' },
  { id:'HUM-3', a:'hum', when:(c: Ctx)=>c.people, q:'Affected people can challenge outcomes and reach a human review, and complaints are tracked to resolution.', ev:'Appeals process, complaint MI, review turnaround.', eu:'Art. 85–86; GDPR Art. 22(3)', uk:'Contestability and redress; Consumer Duty', iso:'A.8', nist:'MANAGE 4' },
  { id:'HUM-4', a:'hum', when:(c: Ctx)=>c.agent, q:'Agent permissions, tool access and spending or action limits are scoped, logged and reviewed.', ev:'Permission matrix, action limits, review log.', eu:'Art. 14, Art. 15', uk:'Accountability and governance', iso:'A.9', nist:'MANAGE 2' },

  { id:'TEC-1', a:'tech', q:'Performance metrics are set against a baseline with acceptance thresholds, and met on independent test data.', ev:'Validation report, test set description, threshold sign-off.', eu:'Art. 15(1)-(3)', uk:'Safety, security and robustness', iso:'A.6', nist:'MEASURE 2' },
  { id:'TEC-2', a:'tech', when:(c: Ctx)=>c.high||c.fs, q:'An independent party, second line or external, validated the model before use and re-validates it on a set cycle.', ev:'Independent validation report, findings tracker.', eu:'Art. 43', uk:'SS1/23 Principle 4', iso:'9.2', nist:'MEASURE 1' },
  { id:'TEC-3', a:'tech', q:'The system is tested for errors, edge cases, drift and adversarial inputs, with fail-safes in place.', ev:'Robustness test results, fail-safe design.', eu:'Art. 15(4)', uk:'Safety, security and robustness', iso:'A.6', nist:'MEASURE 2.5–2.7' },
  { id:'TEC-4', a:'tech', q:'Security controls cover AI-specific threats such as data poisoning, model extraction and prompt injection.', ev:'Threat model, penetration test, security sign-off.', eu:'Art. 15(5)', uk:'DSIT AI Cyber Security Code of Practice', iso:'A.6; ISO 27001', nist:'MEASURE 2.7' },
  { id:'TEC-5', a:'tech', when:(c: Ctx)=>c.genai, q:'Generative outputs are evaluated for hallucination, harmful content and data leakage, with guardrails and red-teaming before release.', ev:'Evaluation results, red-team report, guardrail configuration.', eu:'Art. 15, Art. 50', uk:'Safety, security and robustness', iso:'A.6', nist:'AI 600-1 GenAI Profile' },

  { id:'MON-1', a:'mon', q:'Performance, fairness and drift are monitored in production against thresholds, with named owners and alert routes.', ev:'Monitoring dashboard, thresholds, alert history (use the Monitoring tab).', eu:'Art. 72, Art. 26(5)', uk:'SS1/23 ongoing monitoring', iso:'9.1, A.6', nist:'MEASURE 3, MANAGE 4' },
  { id:'MON-2', a:'mon', q:'Incidents are logged, triaged by severity and investigated, with lessons fed back into the risk assessment.', ev:'Incident log (use the Monitoring tab), post-incident reviews.', eu:'Art. 26(5), Art. 73', uk:'Operational resilience', iso:'10.2', nist:'MANAGE 4.3' },
  { id:'MON-3', a:'mon', when:(c: Ctx)=>c.high, q:'A route exists to report serious incidents to the market surveillance authority within the legal deadline.', ev:'Reporting procedure, authority contacts, decision log.', eu:'Art. 73', uk:'Operational resilience', iso:'10.2', nist:'MANAGE 4.3' },
  { id:'MON-4', a:'mon', q:'Retirement is planned: data and model residuals are handled, users are told and dependencies are removed.', ev:'Decommissioning plan.', eu:'Art. 20', uk:'SS1/23 Principle 3', iso:'A.6', nist:'GOVERN 1.7' },

  { id:'CNF-1', a:'conf', when:(c: Ctx)=>c.high&&c.provider, q:'The conformity assessment route is set (internal control under Annex VI or a notified body under Annex VII) and completed before use.', ev:'Conformity assessment record, notified body certificate where needed.', eu:'Art. 43', uk:'', iso:'', nist:'' },
  { id:'CNF-2', a:'conf', when:(c: Ctx)=>c.high&&c.provider, q:'An EU declaration of conformity is drawn up, CE marking applied and the system registered in the EU database.', ev:'Declaration, CE marking evidence, registration number.', eu:'Art. 47–49', uk:'', iso:'', nist:'' },
  { id:'CNF-3', a:'conf', when:(c: Ctx)=>c.high&&c.deployer, q:'Before use, the deployer confirmed the provider’s conformity and registration and assigned oversight staff.', ev:'Provider declaration on file, deployer checklist.', eu:'Art. 26', uk:'', iso:'', nist:'' },
];

export const FRAMEWORKS: [FrameworkKey, string][] = [
  ['eu','EU AI Act'],
  ['uk','UK regime'],
  ['iso','ISO/IEC 42001'],
  ['nist','NIST AI RMF'],
];

export const STATUS: [string, string][] = [['met','Met'],['partial','Partial'],['gap','Not met'],['na','N/A']];

export const TIERS: Record<string, { label: string; tone: string }> = {
  prohibited: { label:'Prohibited', tone:'crit' },
  high:       { label:'High risk', tone:'warn' },
  limited:    { label:'Limited risk', tone:'info' },
  minimal:    { label:'Minimal risk', tone:'good' },
  review:     { label:'Needs legal review', tone:'crit' },
  unknown:    { label:'Not classified', tone:'muted' },
};

export const has = (arr: unknown, v: string) => Array.isArray(arr) && arr.includes(v);
export const yes = (v: unknown) => v === 'yes';

export function context(sys: AssessmentData): Ctx {
  const p: Record<string, any> = sys.profile || {}, c: Record<string, any> = sys.cls || {};
  const fs = ['bank','ins','wealth','pay'].includes(p.sector);
  const r = classify(sys);
  return {
    high: r.tier === 'high',
    provider: has(p.role,'provider'),
    deployer: has(p.role,'deployer') || !(p.role && p.role.length),
    genai: has(p.aiType,'genai'),
    agent: has(p.aiType,'agent'),
    vendor: !!p.source && p.source !== 'inhouse',
    personal: !!p.personal && p.personal !== 'none',
    people: !!p.affects && p.affects !== 'no',
    fs,
    fsCust: fs && p.affects === 'cust',
    t1: !!(c.t && c.t.t1), t2: !!(c.t && c.t.t2),
  };
}

export function classify(sys: AssessmentData): Classification {
  const p: Record<string, any> = sys.profile || {}, c: Record<string, any> = sys.cls || {};
  const reasons: string[] = [], flags: string[] = [];
  const pro = PROHIBITED.filter(([k]) => c[k] === 'yes');
  const unsure = PROHIBITED.filter(([k]) => c[k] === 'unsure');
  const answered = PROHIBITED.every(([k]) => c[k]);
  const areas = ANNEX3.filter(([k]) => c.a3 && c.a3[k]);
  const tx = TRANSPARENCY.filter(([k]) => c.t && c.t[k]);
  let tier: string;
  if (pro.length) {
    tier = 'prohibited';
    pro.forEach(([, t, ref]) => reasons.push(`${ref}: ${t}`));
  } else if (unsure.length) {
    tier = 'review';
    unsure.forEach(([, t, ref]) => reasons.push(`Unresolved prohibited-practice screen, ${ref}`));
  } else if (yes(c.annex1)) {
    tier = 'high';
    reasons.push('Art. 6(1): safety component of, or itself, a product under EU product-safety law (Annex I)');
  } else if (areas.length && (yes(c.profiling) || c.exempt !== 'yes')) {
    tier = 'high';
    areas.forEach(([, t, ref]) => reasons.push(`Art. 6(2), ${ref}: ${t}`));
    if (yes(c.profiling)) reasons.push('Profiling of individuals: the Art. 6(3) exemption cannot apply');
  } else if (tx.length) {
    tier = 'limited';
    if (areas.length) reasons.push('Annex III area selected but Art. 6(3) exemption claimed; document the assessment (Art. 6(4))');
    tx.forEach(([, t, ref]) => reasons.push(`${ref}: ${t}`));
  } else if (answered || areas.length || c.annex1) {
    tier = 'minimal';
    if (areas.length) reasons.push('Annex III area selected but Art. 6(3) exemption claimed; document the assessment (Art. 6(4))');
    else reasons.push('No prohibited practice, high-risk use or transparency trigger identified');
  } else {
    tier = 'unknown';
  }
  if (!answered && tier !== 'prohibited') flags.push('Complete all eight prohibited-practice screens');
  const regions = p.regions || [];
  const euScope = !regions.length || has(regions,'eu');
  if (!euScope) flags.push('Not deployed in the EU. The AI Act can still apply if outputs are used in the EU (Art. 2(1)(c)).');
  if (yes(c.gpai)) flags.push('You place a general-purpose AI model on the market: GPAI provider duties apply (Art. 53–55)');
  const fria = tier === 'high' && (has(p.role,'deployer') || !(p.role||[]).length) &&
    (p.sector === 'public' || (c.a3 && (c.a3.h_credit || c.a3.h_ins)));
  return { tier, reasons, flags, euScope, fria };
}

export function obligations(sys: AssessmentData): { region: string; items: [string, string][] }[] {
  const p: Record<string, any> = sys.profile || {}, r = classify(sys), x = context(sys);
  const out: { region: string; items: [string, string][] }[] = [];
  const regions = p.regions || [];
  const eu = !regions.length || has(regions,'eu'), uk = has(regions,'uk'), us = has(regions,'us');
  if (eu) {
    const list: [string, string][] = [];
    if (r.tier === 'prohibited') list.push(['Stop or redesign: the practice is banned in the EU','Art. 5']);
    if (r.tier === 'review') list.push(['Resolve the prohibited-practice screens with legal counsel before going further','Art. 5']);
    if (r.tier === 'high') {
      if (x.provider) list.push(['Provider duties: risk management, data governance, technical documentation, logging, transparency, oversight, accuracy, QMS, conformity assessment, registration','Art. 8–17, 43–49']);
      if (x.deployer) list.push(['Deployer duties: use per instructions, assign trained oversight, monitor, keep logs, inform affected people','Art. 26']);
      if (r.fria) list.push(['Fundamental rights impact assessment before first use','Art. 27']);
    }
    if (r.tier === 'limited') list.push(['Transparency: tell people they are dealing with AI and label synthetic content','Art. 50']);
    list.push(['AI literacy for staff who operate or use the system','Art. 4']);
    if (x.personal) list.push(['GDPR applies alongside the AI Act','GDPR']);
    out.push({ region:'European Union', items:list });
  }
  if (uk) {
    const list: [string, string][] = [['Apply the five cross-sector AI principles through your sector regulators','UK AI principles']];
    if (x.personal) list.push(['UK GDPR and Data Protection Act 2018, including rules on automated decision-making','UK GDPR']);
    if (x.people) list.push(['Avoid discrimination against protected characteristics','Equality Act 2010']);
    if (x.fsCust) list.push(['Evidence good customer outcomes, fair value and support for vulnerable customers','FCA Consumer Duty']);
    if (x.fs) list.push(['Name a senior manager accountable for the system','SM&CR']);
    if (p.sector === 'bank' && ['credit','uw','risk','fraud'].includes(p.func)) list.push(['Model risk management principles (expected of banks with internal-model approval; good practice for others)','PRA SS1/23']);
    if (x.vendor && x.fs) list.push(['Third-party and outsourcing risk management','PRA SS2/21']);
    out.push({ region:'United Kingdom', items:list });
  }
  if (us) out.push({ region:'United States', items:[['Map applicable federal and state AI and consumer-protection laws; NIST AI RMF is the common baseline','NIST AI RMF']] });
  out.push({ region:'Standards', items:[['ISO/IEC 42001 management-system controls and NIST AI RMF functions map to every control below','ISO 42001 · NIST']] });
  return out;
}

export function applicable(sys: AssessmentData): Control[] {
  const x = context(sys);
  return CONTROLS.filter(k => !k.when || k.when(x));
}

export function inherentRisk(sys: AssessmentData): { score: number; band: string; tone: string; partial: boolean } | null {
  const p: Record<string, any> = sys.profile || {};
  const pick = (key: string, table: Record<string, number>): number | null => table[p[key]] ?? null;
  const parts = [
    pick('affects', { no:0, staff:2, cust:3, public:3 }),
    pick('personal', { none:0, personal:2, special:3 }),
    pick('scale', { s0:0, s1:1, s2:2, s3:3 }),
    pick('autonomy', { a0:0, a1:1, a2:2, a3:3 }),
    pick('revers', { r0:0, r1:1.5, r2:3 }),
  ];
  const known = parts.filter((v): v is number => v !== null);
  if (known.length < 3) return null;
  const tier = classify(sys).tier;
  const tierPts = ({ prohibited:3, review:3, high:3, limited:1, minimal:0, unknown:1 } as Record<string, number>)[tier];
  const tech = (has(p.aiType,'genai') || has(p.aiType,'agent')) ? 1 : 0;
  const sum = known.reduce((a,b)=>a+b,0) + tierPts + tech;
  const max = known.length*3 + 3 + 1;
  const score = Math.round(sum / max * 100);
  const band = score >= 75 ? ['Severe','crit'] : score >= 50 ? ['Elevated','warn'] : score >= 25 ? ['Moderate','info'] : ['Low','good'];
  return { score, band: band[0], tone: band[1], partial: known.length < 5 };
}

export function readiness(sys: AssessmentData, list?: Control[]): Readiness {
  list = list || applicable(sys);
  const ctrl: Record<string, { s?: string; e?: string }> = sys.ctrl || {};
  let num = 0, den = 0, met = 0, partial = 0, gap = 0, open = 0;
  for (const k of list) {
    const s = ctrl[k.id] && ctrl[k.id].s;
    if (s === 'na') continue;
    den++;
    if (s === 'met') { num += 1; met++; }
    else if (s === 'partial') { num += 0.5; partial++; }
    else if (s === 'gap') gap++;
    else open++;
  }
  return { pct: den ? Math.round(num/den*100) : 0, den, met, partial, gap, open };
}

export function frameworkCoverage(sys: AssessmentData) {
  const list = applicable(sys);
  return FRAMEWORKS.map(([key, name]) => {
    const mapped = list.filter(k => !!k[key]);
    return { key, name, count: mapped.length, r: readiness(sys, mapped) };
  });
}

export function metricStatus(m: Metric): { tone: string; label: string } {
  const last = (m.readings || []).slice(-1)[0];
  const thr = m.threshold as unknown;
  if (!last || thr === '' || thr == null || isNaN(+(thr as number))) return { tone:'muted', label: last ? 'No threshold' : 'No data' };
  const v = +last.v, t = +(thr as number);
  const ok = m.dir === 'below' ? v <= t : v >= t;
  if (ok) return { tone:'good', label:'Within threshold' };
  const margin = Math.abs(v - t) / (Math.abs(t) || 1);
  return margin > 0.1 ? { tone:'crit', label:'Breach' } : { tone:'warn', label:'Near breach' };
}


/* "Why we ask" notes for the classification questions, in plain language. */
export const WHY: Record<string, string> = {
  prohibited: 'Article 5 bans a short list of practices outright in the EU since February 2025. If any applies, nothing else in the assessment matters until it is resolved.',
  annex3: 'Systems used in the areas listed in Annex III are presumed high-risk, because they can decide access to work, money, insurance, education or public services.',
  annex1: 'AI that is a safety component of a product already regulated by EU product-safety law (machinery, medical devices, toys and others) is high-risk through that route.',
  profiling: 'A system that profiles people can never use the Article 6(3) exemption, so this answer can keep a system in the high-risk tier.',
  exempt: 'An Annex III system is not high-risk if it only performs a narrow, preparatory or supporting task. You must document why (Art. 6(4)).',
  transparency: 'Article 50 adds disclosure duties for chatbots, synthetic content, emotion recognition and deepfakes, whatever the risk tier.',
  gpai: 'Organisations that place a general-purpose model on the market take on separate provider duties. Using someone else’s model through an API does not count.',
  confirm: 'Confirming records who accepted the classification and the answers it was based on. If those answers change later, the system is flagged for reassessment.',
};
