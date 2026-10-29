/* Dynamic client registration (RFC 7591) for MCP clients. */
import { registerClient } from '@/lib/oauth';
import { cjson, preflight } from '@/lib/cors';
export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export async function POST(req: Request) {
  if (Number(req.headers.get('content-length') || 0) > 20000) return cjson({ error: 'invalid_client_metadata', error_description: 'Too large.' }, 400);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return cjson({ error: 'invalid_client_metadata', error_description: 'Send JSON client metadata.' }, 400);
  const out = await registerClient(body as Record<string, unknown>);
  return 'error' in out ? cjson(out, 400) : cjson(out, 201);
}
