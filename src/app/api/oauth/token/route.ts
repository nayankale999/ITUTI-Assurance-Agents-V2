/* OAuth token endpoint: authorization_code (with PKCE) and refresh_token grants. */
import { exchange } from '@/lib/oauth';
import { cjson, preflight } from '@/lib/cors';
export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

async function form(req: Request) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const j = await req.json().catch(() => ({}));
    return new URLSearchParams(Object.entries(j as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

export async function POST(req: Request) {
  const out = await exchange(req, await form(req));
  if ('error' in out && typeof out.error === 'string') {
    const { status, ...body } = out as { status?: number; error: string; error_description: string };
    return cjson(body, status || 400, status === 401 ? { 'WWW-Authenticate': 'Basic realm="ituti-ai-assurance"' } : {});
  }
  return cjson(out);
}
