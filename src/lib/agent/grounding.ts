/* Grounding: the assessment crew may only use what the client provided, meaning the evidence documents uploaded
 * for the system and the answers people have entered in its assessment record. It never brings in outside
 * information: no web research, no model library, and no facts from the model's own general knowledge.
 *
 * Two checks enforce this on every proposal before a person sees it:
 *   1. The source checker (deterministic): every source must be an exact quote found in one of the system's
 *      documents, or in an answer recorded in its assessment. Nothing else counts as a source.
 *   2. The grounding judge (one short model call that sees ONLY the proposed value and the verified quotes): every
 *      factual statement in the value must be supported by those quotes. Anything it cannot trace is sent back.
 *
 * External research about foundation models (the model researcher) is off unless an administrator switches it on
 * with AGENT_EXTERNAL_RESEARCH=on. The judge can be turned off with AGENT_GROUNDING_JUDGE=off (not recommended). */
import type Anthropic from '@anthropic-ai/sdk';
import type { Source } from '@/data';
import { llm } from './llm';
import { externalResearchOn } from './specialists';

export { externalResearchOn };
export const groundingJudgeOn = () => (process.env.AGENT_GROUNDING_JUDGE || 'on').toLowerCase() !== 'off';
export const judgeModel = () => process.env.ANTHROPIC_MODEL_CHECKER || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

export const RESEARCH_OFF = 'External research is switched off on this installation: the agents work only from the evidence documents and the answers recorded for each AI system. An administrator can switch it on with AGENT_EXTERNAL_RESEARCH=on.';

/** The grounding rules every writing specialist works under. */
export const GROUNDING_RULES = `Grounding (strict):
- Use ONLY the client's evidence documents for this system and the assessment record you are given (answers people have entered). These are your only sources of facts.
- Do not use your own general knowledge, assumptions, typical practice, or anything you know about vendors, models, products or the organisation to supply a fact. If the documents and the record do not say it, do not propose it: list it in your summary as missing evidence.
- You may apply the rules of the EU AI Act, UK requirements, ISO/IEC 42001 and the NIST AI RMF as described in your field list to the facts in the sources. The facts themselves must come from the sources.
- Every proposal needs at least one source. A document source is {"type": "document", "document_id", "quote"}: an exact quote copied from the text you read (15 to 300 characters). A record source is {"type": "record", "path", "quote"}: an exact quote from an answer in the assessment record (for example "profile.description"). The source checker rejects anything it cannot find.
- Write values that say only what the quotes support. A grounding judge compares your value with the quotes and sends back any statement they do not support.`;

type Verdict = { ok: true } | { ok: false; error: string };

const JUDGE_SYSTEM = `ITUTI_GROUNDING_JUDGE
You check whether a proposed answer in an AI assurance assessment is grounded in the evidence quoted for it. You see only the proposed answer and the quotes. Do not use any outside knowledge.

Decide whether every factual statement in the proposed answer is supported by the quotes. Applying a regulatory rule (EU AI Act, UK requirements, ISO/IEC 42001, NIST AI RMF) to facts in the quotes is allowed; inventing or adding facts is not. A statement that something is missing or not evidenced is allowed when no quote contradicts it. Choosing one option from a list is supported when the quotes show it.

Reply with JSON only: {"supported": true} or {"supported": false, "unsupported": "<the statements not supported by the quotes, in one sentence>"}`;

/** Asks the grounding judge whether a proposed value is supported by its verified sources. */
export async function judge(field: string, value: string, sources: Source[], meter?: (model: string, msg: Anthropic.Message, ms: number) => void): Promise<Verdict> {
  if (!groundingJudgeOn()) return { ok: true };
  const quotes = sources.filter(s => s.quote).map((s, i) => `[${i + 1}] ${s.kind === 'system' ? 'Assessment record' : 'Document'} "${s.title}"${s.locator ? `, ${s.locator}` : ''}: "${s.quote}"`).join('\n');
  const model = judgeModel();
  const t0 = Date.now();
  const msg = await llm().messages.create({
    model, max_tokens: 400, system: JUDGE_SYSTEM,
    messages: [{ role: 'user', content: `Field: ${field.slice(0, 400)}\n\nProposed answer:\n${value.slice(0, 4000)}\n\nQuotes:\n${quotes}` }],
  });
  meter?.(model, msg, Date.now() - t0);
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('');
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  try {
    const v = JSON.parse(json || '') as { supported?: boolean; unsupported?: string };
    if (v.supported === true) return { ok: true };
    return { ok: false, error: `the grounding judge found statements the sources do not support: ${String(v.unsupported || 'not stated').slice(0, 300)} Remove them or cite a quote that supports them.` };
  } catch {
    return { ok: false, error: 'the grounding judge could not confirm the value is supported by the sources. Keep the value to what the quotes say.' };
  }
}
