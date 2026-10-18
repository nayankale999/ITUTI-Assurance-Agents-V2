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
        const step = p.messages.filter(m => m.role === 'assistant').length;
        const results = lastResults(p);
        switch (step) {
          case 0: return msg([call('list_documents', {})]);
          case 1: return msg([call('search_documents', { query: 'independent validation' })]);
          case 2: {
            const hits = JSON.parse(results[0] || '[]') as { document_id: string; text: string }[];
            const h = hits.find(x => /validation/i.test(x.text)) || hits[0];
            const sentence = (h?.text.match(/[^.\n]*validation[^.\n]*\./i)?.[0] || h?.text.slice(0, 120) || '').trim();
            return msg([
              { type: 'text', text: 'Proposing from the validation report.' },
              call('propose', { path: 'ctrl.TEC-2', value: { s: 'met', e: `Independent second-line validation documented in the validation report: ${sentence}` }, confidence: 'high', rationale: 'The report records an independent validation.', sources: [{ type: 'document', document_id: h?.document_id, quote: sentence }] }),
              call('propose', { path: 'profile.lifecycle', value: 'prod', confidence: 'medium', rationale: 'The report describes the model in production.', sources: [{ type: 'document', document_id: h?.document_id, quote: sentence }] }),
              call('propose', { path: 'ctrl.GOV-1', value: { s: 'met', e: 'Board approved AI policy in 2019 according to the minutes.' }, confidence: 'high', rationale: 'Invented quote: must be rejected.', sources: [{ type: 'document', document_id: h?.document_id, quote: 'The board approved the AI policy on 1 January 2019.' }] }),
              call('propose', { path: 'profile.sector', value: 'spaceships', confidence: 'high', rationale: 'Invalid option: must be rejected.', sources: [{ type: 'document', document_id: h?.document_id, quote: sentence }] }),
            ]);
          }
          case 3: return msg([call('lookup_model', { provider: 'Example AI', model: 'Example Model 1' })]);
          case 4: {
            const r = JSON.parse(results[0] || '{}') as { model_key?: string };
            return msg([
              call('propose', { path: 'card.limitations', value: 'The underlying model can produce incorrect statements and should not be relied on for final credit decisions.', confidence: 'high', rationale: 'Stated in the provider model card.', sources: [{ type: 'model', model_key: r.model_key, section: 'limitations' }] }),
              call('propose', { path: 'ctrl.DAT-1', value: { s: 'met', e: 'Provider documentation describes training data.' }, confidence: 'low', rationale: 'Model sources cannot prove client controls: must be rejected.', sources: [{ type: 'model', model_key: r.model_key, section: 'limitations' }] }),
            ]);
          }
          default: return msg([call('finish', { summary: 'Pre-filled validation and model limitations. No evidence found for the AI policy (GOV-1) or data documentation (DAT-1).' })]);
        }
      },
    },
  };
}
