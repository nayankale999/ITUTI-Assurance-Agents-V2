/* OAuth protected resource metadata for the MCP server (RFC 9728), served at /.well-known/oauth-protected-resource. */
import { resourceMetadata } from '@/lib/oauth';
import { cjson, preflight } from '@/lib/cors';
export const dynamic = 'force-dynamic';
export const GET = () => cjson(resourceMetadata());
export const OPTIONS = preflight;
