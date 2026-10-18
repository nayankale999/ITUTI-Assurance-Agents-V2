/* The A2A agent card: what the Ituti AI Assurance agent can do and how to call it (A2A protocol 0.3.0). */
import type { AgentCard } from '@a2a-js/sdk';

export const A2A_VERSION = '0.3.0';
export const appUrl = () => (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');

export function agentCard(): AgentCard {
  const base = appUrl();
  return {
    protocolVersion: A2A_VERSION,
    name: 'Ituti AI Assurance',
    description: 'Assesses AI systems against the EU AI Act, UK requirements (AI principles, FCA Consumer Duty, SM&CR, PRA SS1/23), ISO/IEC 42001 and the NIST AI RMF. '
      + 'It records each system, classifies it under the EU AI Act, pre-fills the conformity assessment from your evidence documents and from what foundation-model providers publish, '
      + 'and reports the risk tier, control readiness and the evidence still missing. Every pre-filled answer cites its source and is reviewed by a person in Ituti AI Assurance before it is used.',
    url: `${base}/api/a2a`,
    preferredTransport: 'JSONRPC',
    version: '1.0.0',
    provider: { organization: 'ITUTI Tech Ltd', url: 'https://www.ituti.tech' },
    iconUrl: `${base}/ituti-icon.svg`,
    documentationUrl: 'https://www.ituti.tech/ai-assurance.html',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer', description: 'An Ituti AI Assurance API key, sent as a bearer token.' },
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'The same API key, sent in the x-api-key header.' },
    },
    security: [{ bearer: [] }, { apiKey: [] }],
    skills: [
      {
        id: 'portfolio', name: 'AI system portfolio',
        description: 'Lists your AI systems with their EU AI Act tier, control readiness, open incidents and assessments waiting for review.',
        tags: ['AI inventory', 'EU AI Act', 'AI governance'], examples: ['Which of our AI systems are high risk?', 'Show me our AI portfolio'],
      },
      {
        id: 'register', name: 'Register an AI system and its evidence',
        description: 'Adds an AI system from a description and attaches evidence: pasted text or attached documents (PDF, Word, Excel, CSV, text, Markdown, JSON, HTML).',
        tags: ['AI inventory', 'evidence'], examples: ['Add our CV screening tool, built on Claude, used for hiring in the UK and Ireland'],
        inputModes: ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/csv'],
      },
      {
        id: 'assess', name: 'Run a conformity assessment',
        description: 'Pre-fills the assessment for a system (profile, EU AI Act classification, 39 controls across four frameworks, model card, metrics) from its evidence. Runs take a few minutes; ask for the status afterwards.',
        tags: ['conformity assessment', 'EU AI Act', 'ISO 42001', 'NIST AI RMF'], examples: ['Assess the loan scoring model', 'Run an assessment on Talent Match'],
      },
      {
        id: 'status', name: 'Assessment results and gaps',
        description: 'Reports the outcome of an assessment: risk tier and reasons, readiness, the controls without evidence, proposals waiting for review, and links to the review screen and printable report.',
        tags: ['assurance report', 'gap analysis'], examples: ['What evidence is missing for Talent Match?', 'Is the chatbot assessment finished?'],
      },
    ],
  };
}
