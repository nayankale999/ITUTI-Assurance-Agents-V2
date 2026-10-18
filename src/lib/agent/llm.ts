/* Access to Claude. AGENT_FAKE_LLM=1 swaps in a scripted stand-in so the agent's plumbing can be tested without an API key. */
import Anthropic from '@anthropic-ai/sdk';

type Client = { messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> } };
const g = globalThis as unknown as { __llm?: Client };

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY || process.env.AGENT_FAKE_LLM === '1';
export const agentModel = () => process.env.ANTHROPIC_AGENT_MODEL || 'claude-opus-5-5';

export function llm(): Client {
  if (g.__llm) return g.__llm;
  if (process.env.AGENT_FAKE_LLM === '1') {
    // Loaded lazily so the fake never ships in a normal request path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    g.__llm = require('./fake').fakeClient();
    return g.__llm!;
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('AI assistance is not set up. Add an Anthropic API key to the server settings.');
  g.__llm = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: 10 * 60e3 });
  return g.__llm;
}
