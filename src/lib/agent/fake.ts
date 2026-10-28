/* Test-only stand-in for Claude, enabled with AGENT_FAKE_LLM=1. It follows a fixed script that exercises every
 * agent tool, including one proposal with an invented quote that the server must reject. */
import type Anthropic from '@anthropic-ai/sdk';

let n = 0;
const id = () => `toolu_fake_${++n}`;

function msg(content: unknown[], stop: Anthropic.StopReason = 'tool_use'): Anthropic.Message {
  return {
    id: `msg_fake_${++n}`, type: 'message', role: 'assistant', model: 'fake', stop_reason: stop, stop_sequence: null,
    content: content as Anthropic.ContentBlock[],
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as Anthropic.Usage,
  } as Anthropic.Message;
}
const call = (name: string, input: unknown) => ({ type: 'tool_use', id: id(), name, input });

function lastResults(p: Anthropic.MessageCreateParamsNonStreaming): string[] {
  const last = p.messages[p.messages.length - 1];
  return Array.isArray(last.content) ? (last.content as { type: string; content?: unknown }[]).filter(b => b.type === 'tool_result').map(b => String(b.content)) : [];
}

export function fakeClient() {
  return {
    messages: {
      async create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        // Model research
        if ((p.tools || []).some(t => 'type' in t && String(t.type).startsWith('web_search'))) {
          const cite = (url: string, text: string) => [{ type: 'web_search_result_location', url, title: 'Example model card', encrypted_index: 'x', cited_text: text }];
          return msg([
            { type: 'text', text: '### identity\nExample Model 1 from Example AI.\n### released\nGenerally available since 2026.\n### limitations\n' },
            { type: 'text', text: 'Can produce incorrect statements and should not be relied on for final credit decisions.', citations: cite('https://huggingface.co/example/model', 'Can produce incorrect statements') },
            { type: 'text', text: '\n### trainingData\nNot published.' },
          ], 'end_turn');
        }
        // The A2A assistant: one tool call chosen from the latest user text, then a reply quoting the result
        if (typeof p.system === 'string' && p.system.startsWith('ITUTI_A2A_ASSISTANT')) {
          const last = p.messages[p.messages.length - 1];
          if (Array.isArray(last.content)) {
            const out = lastResults(p)[0] || '';
            return msg([{ type: 'text', text: `RESULT ${out.slice(0, 8000)}` }], 'end_turn');
          }
          const text = String(last.content).toLowerCase();
          const sys = (text.match(/"([^"]+)"/)?.[1]) || 'Loan scoring';
          if (text.includes('portfolio')) return msg([call('list_systems', {})]);
          if (text.includes('register')) return msg([call('create_system', { name: sys, description: 'Registered through A2A for testing.' })]);
          if (text.includes('attach')) return msg([call('attach_files', { system: sys })]);
          if (text.includes('assess')) return msg([call('start_assessment', { system: sys, confirmed: text.includes('confirm') })]);
          if (text.includes('status')) return msg([call('assessment_status', { system: sys })]);
          return msg([{ type: 'text', text: 'I can list your AI systems, register one, run an assessment or report its status.' }], 'end_turn');
        }
        // A specialist called over A2A: one tool chosen from the latest user text, then a reply quoting the result
        if (typeof p.system === 'string' && p.system.startsWith('ITUTI_A2A_SPECIALIST:')) {
          const last = p.messages[p.messages.length - 1];
          if (Array.isArray(last.content)) return msg([{ type: 'text', text: `RESULT ${(lastResults(p)[0] || '').slice(0, 8000)}` }], 'end_turn');
          const raw = String(last.content);
          const text = raw.toLowerCase();
          const sys = (raw.match(/"([^"]+)"/)?.[1]) || 'Loan scoring';
          const quote = raw.match(/«([^»]+)»/)?.[1] || '';
          if (text.includes('verify')) return msg([call('verify_quote', { system: sys, quote })]);
          if (text.includes('search')) return msg([call('search_evidence', { system: sys, query: 'independent validation' })]);
          if (text.includes('look up')) return msg([call('lookup_model', { provider: 'Example AI', model: 'Example Model 1' })]);
          if (text.includes('results')) return msg([call('results', { system: sys })]);
          if (text.includes('start')) return msg([call('start', { system: sys, confirmed: text.includes('confirm') })]);
          return msg([{ type: 'text', text: 'I can help with my part of the assessment.' }], 'end_turn');
        }
        // The assessment crew: each specialist follows its own short script, chosen from its system prompt
        const sysText = Array.isArray(p.system) ? p.system.map(b => b.text).join('') : String(p.system || '');
        const who = sysText.match(/^SPECIALIST:(\w+)/)?.[1] || '';
        const step = p.messages.filter(m => m.role === 'assistant').length;
        const results = lastResults(p);
        const docId = () => String(p.messages[0].content).match(/document_id[^a-f0-9-]*([a-f0-9-]{36})/)?.[1];
        const firstHit = (raw: string) => {
          const hits = JSON.parse(raw || '[]') as { document_id: string; text: string }[];
          const h = hits.find(x => /validation/i.test(x.text)) || hits[0];
          return { id: h?.document_id, sentence: (h?.text.match(/[^.\n]*validation[^.\n]*\./i)?.[0] || h?.text.slice(0, 120) || '').trim() };
        };
        if (who === 'reader') {
          if (step === 0) return msg([call('list_documents', {})]);
          if (step === 1) return msg([call('search_documents', { query: 'independent validation' })]);
          const h = firstHit(results[0]);
          return msg([call('finish', { summary: `validation-report.md: model validation and performance. Accuracy and testing: document_id ${h.id}, section 0: "${h.sentence}"` })]);
        }
        if (who === 'classify') {
          if (step === 0) return msg([call('search_documents', { query: 'independent validation' })]);
          if (step === 1) {
            const h = firstHit(results[0]);
            return msg([
              call('propose', { path: 'profile.lifecycle', value: 'prod', confidence: 'medium', rationale: 'The report describes the model in production.', sources: [{ type: 'document', document_id: h.id, quote: h.sentence }] }),
              call('propose', { path: 'profile.sector', value: 'spaceships', confidence: 'high', rationale: 'Invalid option: must be rejected.', sources: [{ type: 'document', document_id: h.id, quote: h.sentence }] }),
              call('propose', { path: 'ctrl.GOV-3', value: { s: 'met', e: 'Out of remit.' }, confidence: 'high', rationale: 'Belongs to the controls assessor: must be rejected.', sources: [{ type: 'document', document_id: h.id, quote: h.sentence }] }),
            ]);
          }
          return msg([call('finish', { summary: 'Profile: in production. Classification not settled from the evidence.' })]);
        }
        if (who === 'controls') {
          if (step === 0) return msg([call('search_documents', { query: 'independent validation' })]);
          if (step === 1) {
            const h = firstHit(results[0]);
            return msg([
              { type: 'text', text: 'Proposing from the validation report.' },
              call('propose', { path: 'ctrl.TEC-2', value: { s: 'met', e: `Independent second-line validation documented in the validation report: ${h.sentence}` }, confidence: 'high', rationale: 'The report records an independent validation.', sources: [{ type: 'document', document_id: h.id, quote: h.sentence }] }),
              call('propose', { path: 'ctrl.GOV-1', value: { s: 'met', e: 'Board approved AI policy in 2019 according to the minutes.' }, confidence: 'high', rationale: 'Invented quote: must be rejected.', sources: [{ type: 'document', document_id: h.id, quote: 'The board approved the AI policy on 1 January 2019.' }] }),
              call('propose', { path: 'ctrl.DAT-1', value: { s: 'met', e: 'Provider documentation describes training data.' }, confidence: 'low', rationale: 'Model sources cannot prove client controls: must be rejected.', sources: [{ type: 'model', model_key: 'example-ai/example-model-1', section: 'limitations' }] }),
            ]);
          }
          return msg([call('finish', { summary: 'Validation evidenced (TEC-2). No evidence found for the AI policy (GOV-1) or data documentation (DAT-1).' })]);
        }
        if (who === 'docs') {
          if (step === 0) return msg([call('lookup_model', { provider: 'Example AI', model: 'Example Model 1' })]);
          if (step === 1) {
            const r = JSON.parse(results[0] || '{}') as { model_key?: string };
            return msg([call('propose', { path: 'card.limitations', value: 'The underlying model can produce incorrect statements and should not be relied on for final credit decisions.', confidence: 'high', rationale: 'Stated in the provider model card.', sources: [{ type: 'model', model_key: r.model_key, section: 'limitations' }] })]);
          }
          return msg([call('finish', { summary: 'Model card limitations from the provider.' })]);
        }
        if (who === 'conformity') return msg([call('finish', { summary: 'No conformity answers beyond what is pre-filled.' })]);
        void docId;
        return msg([{ type: 'text', text: 'Unknown script.' }], 'end_turn');
      },
    },
  };
}
