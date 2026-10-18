/* A2A protocol 0.3.0 endpoint (JSON-RPC 2.0 over HTTP): message/send, message/stream, tasks/get, tasks/cancel.
 * Authenticated with a client API key: "Authorization: Bearer ita_…" or "x-api-key: ita_…". */
import { ServerCallContext } from '@a2a-js/sdk/server';
import { orgForRequest } from '@/lib/apikeys';
import { OrgUser } from '@/lib/a2a/store';
import { transport } from '@/lib/a2a/server';
import { agentCard } from '@/lib/a2a/card';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const MAX_BODY = 40 * 1024 * 1024; // room for a 25 MB attachment once base64-encoded

const rpcError = (id: unknown, code: number, message: string, status = 200) =>
  Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  return Response.json(agentCard(), { headers: { 'Cache-Control': 'public, max-age=300' } });
}

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return rpcError(null, -32600, 'Request too large.', 413);
  const auth = await orgForRequest(req);
  if (!auth) return new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid API key.' } }), {
    status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
  });
  let body: unknown;
  try { body = await req.json(); } catch { return rpcError(null, -32700, 'Parse error: the body is not valid JSON.'); }
  if (Array.isArray(body)) return rpcError(null, -32600, 'Batch requests are not supported.');
  const ctx = new ServerCallContext(undefined, new OrgUser(auth.org, auth.key.prefix));
  const out = await transport().handle(body, ctx);

  if (out && typeof (out as AsyncGenerator).next === 'function' && Symbol.asyncIterator in (out as object)) {
    const gen = out as AsyncGenerator<unknown>;
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          for await (const ev of gen) ctrl.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch (e) {
          const id = (body as { id?: unknown })?.id ?? null;
          ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: e instanceof Error ? e.message : 'Internal error' } })}\n\n`));
        } finally { ctrl.close(); }
      },
      cancel() { void gen.return?.(undefined); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
