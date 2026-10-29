/* Access to Claude. AGENT_FAKE_LLM=1 swaps in a scripted stand-in so the agent's plumbing can be tested without an API key. */
import Anthropic from '@anthropic-ai/sdk';
import { recordCall } from '../spend';

type Client = { messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };
const g = globalThis as unknown as { __llm?: Client };

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY || process.env.AGENT_FAKE_LLM === '1';
export const agentModel = () => process.env.ANTHROPIC_AGENT_MODEL || 'claude-opus-5-5';

/** Every call is recorded in the spend ledger (see spend.ts) against the client, system, run and agent in context. */
function metered(inner: Client): Client {
  return {
    messages: {
      async create(p: Anthropic.MessageCreateParamsNonStreaming) {
        const msg = await inner.messages.create(p);
        await recordCall(p.model, msg);
        return msg;
      },
    },
  };
}

export function llm(): Client {
  if (g.__llm) return g.__llm;
  if (process.env.AGENT_FAKE_LLM === '1') {
    // Loaded lazily so the fake never ships in a normal request path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    g.__llm = metered(require('./fake').fakeClient());
    return g.__llm!;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI assistance is not set up. Add an Anthropic API key to the server settings.');
  // ANTHROPIC_BASE_URL (an API gateway or proxy) is read by the SDK itself
  g.__llm = metered(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 10 * 60e3 }));
  return g.__llm;
}
