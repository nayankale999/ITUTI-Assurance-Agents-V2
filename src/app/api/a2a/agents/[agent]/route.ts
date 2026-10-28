/* One specialist of the assessment crew as an A2A agent. GET returns its agent card (also served at
 * /api/a2a/agents/<specialist>/.well-known/agent-card.json); POST takes JSON-RPC like the main endpoint. */
import { specialist } from '@/lib/agent/specialists';
import { specialistCard, specialistTransport } from '@/lib/a2a/specialist';
import { handleRpc } from '@/lib/a2a/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Ctx = { params: Promise<{ agent: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const sp = specialist((await params).agent);
  if (!sp) return Response.json({ error: 'No such agent.' }, { status: 404 });
  return Response.json(specialistCard(sp), { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}

export async function POST(req: Request, { params }: Ctx) {
  const t = specialistTransport((await params).agent);
  if (!t) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32601, message: 'No such agent.' } }, { status: 404 });
  return handleRpc(req, t.transport);
}
