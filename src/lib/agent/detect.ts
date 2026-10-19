/* Recognises foundation models named in an assessment's profile, so the agent can look them up even when the
 * client only wrote "Anthropic" or "GPT" in the vendor field. */

type Known = { provider: string; names: RegExp; family: string; model: RegExp };

const KNOWN: Known[] = [
  { provider: 'Anthropic', names: /\b(anthropic|claude)\b/i, family: 'Claude', model: /\bclaude(?:[\s-]+(?:opus|sonnet|haiku|fable|mythos|instant))?(?:[\s-]+\d+(?:\.\d+)?)?(?:[\s-]+(?:opus|sonnet|haiku|fable|mythos))?\b/i },
  { provider: 'OpenAI', names: /\b(openai|chatgpt|gpt[\s-]?\d|o\d\b)/i, family: 'GPT', model: /\b(?:gpt[\s-]?\d+(?:\.\d+)?(?:[\s-]?(?:o|mini|nano|turbo|pro))?|o\d(?:[\s-]?mini)?)\b/i },
  { provider: 'Google', names: /\b(gemini|google deepmind|vertex ai|gemma)\b/i, family: 'Gemini', model: /\b(?:gemini|gemma)(?:[\s-]+\d+(?:\.\d+)?)?(?:[\s-]+(?:pro|flash|ultra|nano|lite))*\b/i },
  { provider: 'Meta', names: /\b(llama|meta ai)\b/i, family: 'Llama', model: /\bllama[\s-]*\d+(?:\.\d+)?(?:[\s-]+\w+)?\b/i },
  { provider: 'Mistral AI', names: /\b(mistral|mixtral|codestral)\b/i, family: 'Mistral Large', model: /\b(?:mistral|mixtral|codestral)(?:[\s-]+(?:large|medium|small|\d+(?:\.\d+)?|8x\d+b))*\b/i },
  { provider: 'IBM', names: /\b(granite|watsonx)\b/i, family: 'Granite', model: /\bgranite(?:[\s-]+\d+(?:\.\d+)?)?(?:[\s-]+\w+)?\b/i },
  { provider: 'Cohere', names: /\b(cohere|command[\s-]r)\b/i, family: 'Command', model: /\bcommand(?:[\s-]+(?:r\+?|a|light))?(?:[\s-]+\d+)?\b/i },
  { provider: 'xAI', names: /\b(xai|grok)\b/i, family: 'Grok', model: /\bgrok[\s-]*\d*(?:\.\d+)?\b/i },
  { provider: 'Amazon', names: /\b(amazon nova|titan)\b/i, family: 'Nova', model: /\b(?:nova|titan)(?:[\s-]+\w+)?\b/i },
  { provider: 'Microsoft', names: /\b(phi[\s-]?\d)\b/i, family: 'Phi', model: /\bphi[\s-]?\d+(?:\.\d+)?(?:[\s-]+\w+)?\b/i },
];

const tidy = (s: string) => s.replace(/[\s-]+/g, ' ').trim().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bGpt\b/g, 'GPT');

/** Foundation models named in free text, best guess first. A bare provider name returns its main model family. */
export function detectModels(text: string): { provider: string; model: string; specific: boolean }[] {
  const out: { provider: string; model: string; specific: boolean }[] = [];
  if (!text) return out;
  for (const k of KNOWN) {
    if (!k.names.test(text)) continue;
    const m = text.match(k.model)?.[0];
    const specific = !!m && /\d/.test(m);
    const named = !!m && m.trim().split(/[\s-]+/).length > 1;
    const model = specific ? tidy(m!) : named ? `${tidy(m!)} (latest generally available version)` : `${k.family} (latest generally available model)`;
    out.push({ provider: k.provider, model, specific });
  }
  return out.slice(0, 3);
}
