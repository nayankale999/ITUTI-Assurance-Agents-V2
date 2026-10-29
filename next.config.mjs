import { createHash } from 'crypto';

// Server actions get new IDs on every build unless this key is fixed, which breaks pages left open across a
// redeploy ("Failed to find Server Action"). Derive a stable key from the app secret when none is set.
if (!process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY && process.env.NEXTAUTH_SECRET) {
  process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY = createHash('sha256').update('server-actions:' + process.env.NEXTAUTH_SECRET).digest('base64');
}

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];
const nextConfig = {
  // Docker builds set NEXT_OUTPUT=standalone; hosts that run `next start` (Hostinger) leave it unset.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/.well-known/agent-card.json', destination: '/api/a2a/card' },
      { source: '/.well-known/agent.json', destination: '/api/a2a/card' },
      { source: '/api/a2a/agents/:agent/.well-known/agent-card.json', destination: '/api/a2a/agents/:agent' },
      // OAuth discovery for MCP clients
      { source: '/.well-known/oauth-authorization-server', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-authorization-server/:path*', destination: '/api/oauth/metadata' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth/resource' },
      { source: '/.well-known/oauth-protected-resource/:path*', destination: '/api/oauth/resource' },
      { source: '/api/a2a/agents/:agent/.well-known/agent.json', destination: '/api/a2a/agents/:agent' },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
