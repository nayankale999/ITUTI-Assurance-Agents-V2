/* OAuth token revocation (RFC 7009). */
import { revoke } from '@/lib/oauth';
import { cjson, preflight } from '@/lib/cors';
export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

export async function POST(req: Request) {
  const ok = await revoke(req, new URLSearchParams(await req.text()));
  return ok ? new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } }) : cjson({ error: 'invalid_client' }, 401);
}
