import type { Org } from '@/data';
import { aiConfigured } from './llm';

/** Why AI assistance is unavailable for a client, or null when it can be used. */
export function aiBlocked(org: Org): string | null {
  if (!aiConfigured()) return 'AI assistance is not set up on this server yet: an Anthropic API key is needed.';
  if (!org.aiEnabled) return 'AI assistance is switched off for this client. An Ituti admin can switch it on from the client’s overview page once the client has agreed.';
  return null;
}
