/* The assessment crew. Each specialist is its own agent: its own instructions, tools, fields it may propose,
 * turn limit, model, token and cost meter, A2A address and (optionally) its own Agent ID in IBM watsonx
 * Orchestrate. A coordinator runs them in order for a full assessment; each can also be called on its own. */

export type SpecialistKey = 'reader' | 'research' | 'classify' | 'controls' | 'docs' | 'conformity' | 'checker';
export type CrewKey = SpecialistKey | 'coordinator';

export type Specialist = {
  key: SpecialistKey; slug: string; name: string; role: string; description: string;
  /** Field sections this specialist may propose; empty for specialists that never propose. */
  sections: string[];
  /** Whether a model call is involved (the source checker is deterministic). */
  llm: boolean;
  turns: number;
  examples: string[];
};

/** Outside research about foundation models is off unless an administrator sets AGENT_EXTERNAL_RESEARCH=on: by
 * default the crew works only from the client's documents and assessment record (see grounding.ts). */
export const externalResearchOn = () => (process.env.AGENT_EXTERNAL_RESEARCH || '').toLowerCase() === 'on';

export const SPECIALISTS: Specialist[] = [
  {
    key: 'reader', slug: 'evidence-reader', name: 'Evidence reader', role: 'Lists, searches and reads your documents', sections: [], llm: true, turns: 14,
    description: 'Reads the evidence documents uploaded for an AI system and answers questions about them with exact quotes and locations. In a full assessment it maps which documents cover which topics for the other specialists.',
    examples: ['What does the evidence say about human oversight of the CV screening tool?', 'Which documents describe bias testing for Loan scoring?'],
  },
  {
    key: 'research', slug: 'model-researcher', name: 'Model researcher', role: 'Checks what the model provider publishes', sections: [], llm: true, turns: 6,
    description: 'Optional, off by default. When an administrator switches on outside research, looks up what a foundation-model provider publishes about a model (model or system card, usage policy, data handling, EU AI Act status) from official sources and keeps it in a shared model library.',
    examples: ['What does Anthropic publish about Claude Sonnet 5.5 limitations?', 'Look up the usage policy for GPT-5'],
  },
  {
    key: 'classify', slug: 'risk-classifier', name: 'Risk classifier', role: 'Profile and EU AI Act classification', sections: ['profile', 'cls'], llm: true, turns: 18,
    description: 'Pre-fills the AI system profile and its EU AI Act classification (prohibited-practice screens, Annex III high-risk areas, transparency triggers) from the evidence. Every answer cites its source and waits for a person to review it.',
    examples: ['Classify the CV screening tool under the EU AI Act', 'Is Talent Match high risk?'],
  },
  {
    key: 'controls', slug: 'controls-assessor', name: 'Controls assessor', role: 'Rates each control against the evidence', sections: ['ctrl'], llm: true, turns: 30,
    description: 'Rates each applicable control (EU AI Act, UK requirements, ISO/IEC 42001, NIST AI RMF) as met, partly met or not met from the client\'s own documents, with evidence notes a reviewer can sign off.',
    examples: ['Assess the controls for Loan scoring', 'Which governance controls are evidenced for the chatbot?'],
  },
  {
    key: 'docs', slug: 'documentation-writer', name: 'Documentation writer', role: 'Model card and monitoring metrics', sections: ['card', 'metric'], llm: true, turns: 12,
    description: 'Writes the model card (model, data, intended use, performance, limitations, out-of-scope uses) and the monitoring metrics from the client\'s evidence and assessment record only.',
    examples: ['Write the model card for the CV screening tool', 'Which monitoring metrics are documented for Loan scoring?'],
  },
  {
    key: 'conformity', slug: 'conformity-writer', name: 'Conformity writer', role: 'Drafts the Article 43 answers', sections: ['conf'], llm: true, turns: 24,
    description: 'Drafts answers to the organisational, project and technical conformity assessment questions (EU AI Act Article 43 and Annex VI) from the evidence, in prose a reviewer can confirm.',
    examples: ['Draft the conformity answers for Talent Match', 'Prepare the technical conformity questions for Loan scoring'],
  },
  {
    key: 'checker', slug: 'source-checker', name: 'Source checker', role: 'Keeps every answer grounded in your evidence', sections: [], llm: true, turns: 0,
    description: 'Verifies that a quote really appears in a system\'s evidence documents and returns where. In an assessment it checks every source of every proposal against the documents and the assessment record, and its grounding judge sends back any statement the quotes do not support, before a reviewer sees it.',
    examples: ['Check that "Independent validation was completed in August 2026" appears in the Loan scoring evidence'],
  },
];

export const COORDINATOR = {
  key: 'coordinator' as const, slug: 'coordinator', name: 'Assessment coordinator', role: 'Runs the crew in order',
  description: 'Runs a full assessment by handing the work to the specialists in order: evidence reader, risk classifier, controls assessor, documentation writer and conformity writer, with the source checker keeping every proposal grounded in the client\'s own evidence.',
};

/** The specialists this installation publishes: the model researcher only when outside research is switched on. */
export const activeSpecialists = () => SPECIALISTS.filter(s => s.key !== 'research' || externalResearchOn());

/** The order the coordinator runs the writing specialists in. */
export const WRITERS: SpecialistKey[] = ['classify', 'controls', 'docs', 'conformity'];

export const specialist = (k: string) => SPECIALISTS.find(s => s.key === k || s.slug === k);
export const crewName = (k: string) => (k === 'coordinator' ? COORDINATOR.name : specialist(k)?.name || k);

/** Whether a proposal path belongs to a specialist. */
export function inRemit(sp: Specialist, path: string) {
  return sp.sections.includes(path.split('.')[0]);
}

/** Model per specialist: ANTHROPIC_MODEL_<KEY> (for example ANTHROPIC_MODEL_READER=claude-sonnet-5-5), else the agent model. */
export function modelFor(k: SpecialistKey, fallback: string) {
  return process.env[`ANTHROPIC_MODEL_${k.toUpperCase()}`] || fallback;
}

/** Orchestrate Agent IDs, from ORCHESTRATE_AGENT_IDS: "coordinator=<id>,reader=<id>,..." or a JSON object. */
export function orchestrateIds(): Record<string, string> {
  const raw = (process.env.ORCHESTRATE_AGENT_IDS || '').trim();
  if (!raw) return {};
  try { if (raw.startsWith('{')) return JSON.parse(raw); } catch { return {}; }
  const out: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=').map(x => x.trim());
    if (k && v) out[specialist(k)?.key || k] = v;
  }
  return out;
}
