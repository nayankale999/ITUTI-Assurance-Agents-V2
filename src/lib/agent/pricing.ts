/* Estimated cost of Claude calls, for FinOps reporting. Prices are US dollars per million tokens at Anthropic's
 * list prices; override them with ANTHROPIC_PRICES, a JSON object keyed by model id, for example
 * {"claude-opus-5-5": {"input": 4, "output": 20, "cacheWrite": 5, "cacheRead": 0.2}}.
 * Web searches are charged separately by Anthropic and are not included. */
import type Anthropic from '@anthropic-ai/sdk';
import type { SpecialistUsage } from '@/data';

export type Price = { input: number; output: number; cacheWrite: number; cacheRead: number };

const DEFAULTS: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

let cached: Record<string, Price> | null = null;
export function prices(): Record<string, Price> {
  if (cached) return cached;
  let extra: Record<string, Partial<Price>> = {};
  try { extra = process.env.ANTHROPIC_PRICES ? JSON.parse(process.env.ANTHROPIC_PRICES) : {}; } catch { console.error('[pricing] ANTHROPIC_PRICES is not valid JSON; using the defaults'); }
  const out: Record<string, Price> = { ...DEFAULTS };
  for (const [k, v] of Object.entries(extra)) out[k] = { ...(out[k] || DEFAULTS['claude-opus-5-5']), ...v } as Price;
  return (cached = out);
}

/** The price for a model id, matching dated or suffixed ids to their family. */
export function priceFor(model: string): Price | null {
  const p = prices();
  if (p[model]) return p[model];
  const key = Object.keys(p).sort((a, b) => b.length - a.length).find(k => model.startsWith(k));
  return key ? p[key] : null;
}

export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

export function tokensOf(u: Anthropic.Usage | undefined | null): Tokens {
  return { input: u?.input_tokens || 0, output: u?.output_tokens || 0, cacheRead: u?.cache_read_input_tokens || 0, cacheWrite: u?.cache_creation_input_tokens || 0 };
}

export function costOf(model: string, t: Tokens): number {
  const p = priceFor(model);
  if (!p) return 0;
  return (t.input * p.input + t.output * p.output + t.cacheWrite * p.cacheWrite + t.cacheRead * p.cacheRead) / 1e6;
}

export const emptyUsage = (model = ''): SpecialistUsage => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, ms: 0, proposals: 0, tools: 0, model });

export const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);
