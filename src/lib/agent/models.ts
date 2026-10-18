/* Public model library: what the providers of foundation models publish about them, researched once from
 * official sources with Claude's web search and fetch tools and shared across all clients for 90 days.
 * Every statement keeps the pages it came from. */
import type Anthropic from '@anthropic-ai/sdk';
import { db, type ModelRow, type Source } from '@/data';
import { llm, agentModel } from './llm';

export const DOSSIER_KEYS: [string, string][] = [
  ['identity', 'Provider, model and version'],
  ['released', 'Release date and status'],
  ['modalities', 'Inputs, outputs and context size'],
  ['intendedUse', 'Intended and permitted uses'],
  ['restrictions', 'Usage policy restrictions'],
  ['trainingData', 'Training data, as disclosed'],
  ['evaluations', 'Published evaluations and safety testing'],
  ['limitations', 'Known limitations and risks'],
  ['dataHandling', 'Data retention and privacy for API customers'],
  ['euAiAct', 'EU AI Act status as a general-purpose AI model'],
  ['documentation', 'Key documentation'],
];

/** Official sources the research may use. Subdomains are included. */
export const OFFICIAL_DOMAINS = [
  'anthropic.com', 'claude.com', 'openai.com', 'deepmind.google', 'ai.google.dev', 'blog.google', 'cloud.google.com', 'ai.meta.com', 'llama.com',
  'huggingface.co', 'mistral.ai', 'microsoft.com', 'aws.amazon.com', 'ibm.com', 'cohere.com', 'x.ai', 'nvidia.com', 'digital-strategy.ec.europa.eu',
];

const FRESH_DAYS = 90;

export function modelKey(provider: string, model: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim().replace(/\s+/g, '-');
  return `${norm(provider)}/${norm(model)}`.slice(0, 190);
}

const PROMPT = (provider: string, model: string) => `Research the AI model "${model}" from "${provider}" for an AI assurance assessment.
Use web search and web fetch, and rely only on what the provider itself publishes (model or system cards, documentation, usage policies, trust or privacy pages), plus the European Commission for EU AI Act matters. If the name is ambiguous, research the most recent generally available model that matches and say which one you chose.

Write your answer as these sections, each starting with a line "### <key>" exactly as listed, followed by a factual summary of at most 120 words. Cite the pages you rely on. If the provider publishes nothing on a point, write "Not published." Do not guess.
${DOSSIER_KEYS.map(([k, l]) => `### ${k}  (${l})`).join('\n')}`;

type Cite = { url?: string; title?: string; quote?: string };

/** Turns the research reply into per-section text with the sources cited in each section. */
export function parseDossier(content: Anthropic.ContentBlock[]) {
  const fetched = new Map<string, string>(); // document title -> url, for citations of fetched pages
  for (const b of content) {
    if (b.type === 'web_fetch_tool_result' && b.content.type === 'web_fetch_result') {
      const doc = b.content.content as { title?: string | null };
      fetched.set(doc.title || b.content.url, b.content.url);
    }
  }
  const text: Record<string, string> = {};
  const cites: Record<string, Cite[]> = {};
  let key = '';
  for (const b of content) {
    if (b.type !== 'text') continue;
    const heads = [...b.text.matchAll(/^###\s*([A-Za-z]+)[^\n]*$/gm)].filter(m => DOSSIER_KEYS.some(([k]) => k === m[1]));
    let pos = 0;
    for (const h of heads) {
      if (key) text[key] = (text[key] || '') + b.text.slice(pos, h.index);
      key = h[1];
      pos = h.index! + h[0].length;
    }
    if (key) text[key] = (text[key] || '') + b.text.slice(pos);
    if (key && b.citations) for (const c of b.citations) {
      const any = c as unknown as { type: string; url?: string; title?: string; cited_text?: string; document_title?: string | null };
      const url = any.url || (any.document_title ? fetched.get(any.document_title) : undefined);
      (cites[key] ||= []).push({ url, title: any.title || any.document_title || undefined, quote: any.cited_text?.slice(0, 300) });
    }
  }
  const dossier: Record<string, string> = {};
  for (const [k] of DOSSIER_KEYS) dossier[k] = (text[k] || '').replace(/\s+\n/g, '\n').trim() || 'Not found.';
  const sources: Source[] = [];
  for (const [k, list] of Object.entries(cites)) {
    const seen = new Set<string>();
    for (const c of list) {
      if (!c.url || seen.has(c.url)) continue;
      seen.add(c.url);
      sources.push({ kind: 'web', title: c.title || c.url, ref: k, url: c.url, quote: c.quote });
    }
  }
  return { dossier, sources };
}

/** Returns the library entry for a model, researching it first when missing or older than 90 days. */
export async function getModel(provider: string, model: string, onProgress?: (t: string) => void): Promise<ModelRow> {
  const mkey = modelKey(provider, model);
  const existing = await db.models.first({ mkey });
  const fresh = existing?.status === 'ready' && existing.researchedAt && Date.now() - existing.researchedAt.getTime() < FRESH_DAYS * 864e5;
  if (existing && fresh) return existing;
  if (existing?.status === 'researching' && Date.now() - existing.updatedAt.getTime() < 10 * 60e3) {
    // Another run is researching the same model: wait for it
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const row = await db.models.first({ mkey });
      if (row && row.status !== 'researching') return row;
    }
  }
  const row = existing
    ? (await db.models.update({ mkey }, { status: 'researching', updatedAt: new Date(), error: null }))[0]
    : await db.models.insert({ mkey, provider: provider.slice(0, 120), model: model.slice(0, 250), status: 'researching' });
  onProgress?.(`Researching ${provider} ${model} from the provider's published documentation`);
  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: PROMPT(provider, model) }];
    const tools: Anthropic.ToolUnion[] = [
      { type: 'web_search_20260318', name: 'web_search', max_uses: 8, allowed_domains: OFFICIAL_DOMAINS, allowed_callers: ['direct'] },
      { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 8, allowed_domains: OFFICIAL_DOMAINS, allowed_callers: ['direct'], citations: { enabled: true }, max_content_tokens: 30000 },
    ];
    const all: Anthropic.ContentBlock[] = [];
    for (let turn = 0; turn < 6; turn++) {
      const msg = await llm().messages.create({ model: agentModel(), max_tokens: 8000, tools, messages });
      all.push(...msg.content);
      if (msg.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: msg.content });
    }
    const { dossier, sources } = parseDossier(all);
    if (!sources.length) throw new Error('No official sources were found for this model.');
    const [done] = await db.models.update({ mkey }, { status: 'ready', dossier, sources, researchedAt: new Date(), updatedAt: new Date(), error: null });
    return done;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Research failed.';
    const [failed] = await db.models.update({ mkey }, { status: 'failed', error: msg.slice(0, 500), updatedAt: new Date() });
    return failed ?? { ...row, status: 'failed', error: msg };
  }
}
