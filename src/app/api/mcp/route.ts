/* MCP server (Model Context Protocol, Streamable HTTP transport) at /api/mcp. Two ways in:
 *  - OAuth 2.1 (Claude, watsonx Orchestrate and other clients that sign people in): the person's own rights apply;
 *  - a client API key, "Authorization: Bearer ita_…" or "x-api-key: ita_…", for service integrations.
 * Stateless: each request gets a server scoped to its organisation, so it runs on any number of app processes. */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { db } from '@/data';
import { orgForRequest } from '@/lib/apikeys';
import { accessGrant } from '@/lib/oauth';
import { capsFor, type Viewer } from '@/lib/session';
import { buildServer, type McpCtx } from '@/lib/mcp/server';
import { appUrl } from '@/lib/a2a/card';
import { CORS } from '@/lib/cors';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const deny = (status: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: status === 401 ? -32001 : -32000, message } }), { status, headers: { 'Content-Type': 'application/json', ...CORS, 'Access-Control-Expose-Headers': 'WWW-Authenticate', ...extra } });

/** Browsers may only call from this app or from allowed MCP client sites (DNS-rebinding protection). */
function originAllowed(origin: string | null) {
  if (!origin) return true;
  const allowed = [new URL(appUrl()).origin, 'https://claude.ai', 'https://claude.com', ...(process.env.MCP_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
  return allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

async function context(req: Request): Promise<McpCtx | null> {
  const key = await orgForRequest(req);
  if (key) return { org: key.org, via: `key ${key.key.prefix}`, user: null, canCreate: true };
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] || '';
  const g = await accessGrant(bearer);
  if (!g) return null;
  const [u, org] = await Promise.all([db.users.first({ id: g.userId }), db.organizations.first({ id: g.orgId })]);
  if (!u || u.disabled || !org) return null;
  const viewer: Viewer = { id: u.id, email: u.email, name: u.name, role: u.role };
  const caps = await capsFor(viewer, org.id);
  if (!caps.view) return null;
  return { org, via: 'oauth', user: viewer, canCreate: caps.createSystems };
}

export async function POST(req: Request) {
  if (!originAllowed(req.headers.get('origin'))) return deny(403, 'Origin not allowed.');
  const ctx = await context(req);
  if (!ctx) return deny(401, 'Sign in to connect (OAuth), or send an Ituti AI Assurance API key as a bearer token.', {
    'WWW-Authenticate': `Bearer resource_metadata="${appUrl()}/.well-known/oauth-protected-resource/api/mcp", scope="mcp"`,
  });
  const server = buildServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 40 * 1024 * 1024 });
  await server.connect(transport);
  try {
    const res = await transport.handleRequest(req);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  } finally {
    void server.close().catch(() => {});
  }
}

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

/** No server-initiated streams or sessions in stateless mode. */
export async function GET() {
  return new Response(JSON.stringify({ name: 'Ituti AI Assurance MCP server', transport: 'streamable-http', url: `${appUrl()}/api/mcp`, auth: ['oauth2', 'bearer API key'] }), {
    status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST', ...CORS },
  });
}
export const DELETE = GET;
