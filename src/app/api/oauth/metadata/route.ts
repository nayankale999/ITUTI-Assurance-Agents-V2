/* OAuth authorization server metadata (RFC 8414), served at /.well-known/oauth-authorization-server. */
import { authServerMetadata } from '@/lib/oauth';
import { cjson, preflight } from '@/lib/cors';
export const dynamic = 'force-dynamic';
export const GET = () => cjson(authServerMetadata());
export const OPTIONS = preflight;
