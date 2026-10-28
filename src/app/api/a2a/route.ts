/* A2A protocol 0.3.0 endpoint (JSON-RPC 2.0 over HTTP): message/send, message/stream, tasks/get, tasks/cancel.
 * Authenticated with a client API key: "Authorization: Bearer ita_…" or "x-api-key: ita_…".
 * Each specialist of the assessment crew has its own endpoint under /api/a2a/agents/<specialist>. */
import { transport } from '@/lib/a2a/server';
import { agentCard } from '@/lib/a2a/card';
import { handleRpc } from '@/lib/a2a/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return Response.json(agentCard(), { headers: { 'Cache-Control': 'public, max-age=300' } });
}

export async function POST(req: Request) {
  return handleRpc(req, transport());
}
