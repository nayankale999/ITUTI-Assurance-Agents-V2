/* Open CORS for the OAuth and metadata endpoints, which browser-based MCP clients call directly. No cookies are
 * involved, so allowing any origin exposes nothing. */
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};
export const preflight = () => new Response(null, { status: 204, headers: CORS });
export const cjson = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', Pragma: 'no-cache', ...extra } });
