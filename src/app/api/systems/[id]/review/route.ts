import Anthropic from '@anthropic-ai/sdk';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { apiViewer, loadSystem, json, err, sameOriginJson } from '@/lib/api';
import { applicable, classify, TIERS, OPTS, type AssessmentData } from '@/lib/assurance';
import { summarise } from '@/lib/summary';
import { audit } from '@/lib/audit';

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

const label = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];

function buildPrompt(sys: AssessmentData) {
  const p = sys.profile || {};
  const list = applicable(sys).filter(k => { const c = sys.ctrl?.[k.id]; return c?.s && c.s !== 'na'; });
  const lines = list.map(k => {
    const c = sys.ctrl![k.id];
    return `${k.id} | requirement: ${k.q} | expected evidence: ${k.ev} | recorded status: ${c.s} | evidence: ${(c.e || '(none)').slice(0, 700)}`;
  }).join('\n');
  return { count: list.length, prompt: `You are a senior AI assurance reviewer checking an assessment of an AI system against the EU AI Act, UK requirements, ISO/IEC 42001 and the NIST AI RMF.
System: ${p.name || ''}. ${p.description || ''}
Sector: ${label('sector', p.sector)}. Function: ${label('func', p.func)}. EU AI Act tier: ${TIERS[classify(sys).tier].label}.

For each control below, judge whether the recorded status is supported by the evidence text.
- "supported": the evidence is specific enough to justify the status.
- "weak": the status may be right but the evidence is vague, undated or missing a key element.
- "missing": the status claims more than the evidence shows, or there is no evidence.
Write a note of at most 30 words that names the specific evidence or action needed. Be direct.

Reply with only a JSON array of objects {"id": string, "verdict": "supported"|"weak"|"missing", "note": string}, one per control, for example [{"id":"GOV-1","verdict":"weak","note":"Name the approving committee and date."}].

Controls:
${lines}` };
}

function parseItems(text: string) {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  if (start < 0 || end < start) return null;
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const items: Record<string, { v: string; n: string }> = {};
    for (const r of arr) if (r && typeof r.id === 'string') items[r.id.slice(0, 20)] = { v: ['supported', 'weak', 'missing'].includes(r.verdict) ? r.verdict : 'weak', n: String(r.note || '').slice(0, 300) };
    return items;
  } catch { return null; }
}

export async function POST(req: Request, { params }: Ctx) {
  const bad = sameOriginJson(req); if (bad) return err(400, bad);
  const v = await apiViewer(); if (!v) return err(401, 'Sign in again.');
  if (!process.env.ANTHROPIC_API_KEY) return err(503, 'AI review is not set up. Add an Anthropic API key to the server settings.');
  const { id } = await params;
  const a = await loadSystem(v, id); if (!a) return err(404, 'Not found.');
  if (!a.canEdit) return err(403, 'You cannot run a review on this system.');
  const sys = a.system.data as AssessmentData;
  const last = sys.aiReview?.at ? Date.parse(sys.aiReview.at) : 0;
  if (Date.now() - last < 60_000) return err(429, 'A review ran less than a minute ago. Try again shortly.');
  const { prompt, count } = buildPrompt(sys);
  if (!count) return err(400, 'Set a status on at least one control first.');

  let text = '';
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  } catch (e) {
    console.error('[review] Anthropic call failed', e);
    return err(502, 'The AI service did not respond. Try again in a few minutes.');
  }
  const items = parseItems(text);
  if (!items) return err(502, 'The review came back in an unexpected format. Try again.');

  // Merge the review into the latest saved record without overwriting concurrent edits
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await db.query.aiSystems.findFirst({ where: eq(schema.aiSystems.id, id) });
    if (!cur) return err(404, 'Not found.');
    const data = { ...(cur.data as AssessmentData), aiReview: { at: new Date().toISOString(), items } };
    const [row] = await db.update(schema.aiSystems)
      .set({ data, ...summarise(data), version: sql`${schema.aiSystems.version} + 1`, updatedById: v.id, updatedAt: new Date() })
      .where(and(eq(schema.aiSystems.id, id), eq(schema.aiSystems.version, cur.version)))
      .returning({ version: schema.aiSystems.version });
    if (row) {
      await audit({ orgId: a.system.orgId, systemId: id, userId: v.id, action: 'review.run', detail: { controls: count } });
      return json({ aiReview: data.aiReview, version: row.version });
    }
  }
  return err(409, 'The record kept changing during the review. Try again.');
}
