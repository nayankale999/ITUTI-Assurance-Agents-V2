/* OAuth 2.1 for the MCP server, so MCP clients such as Claude and IBM watsonx Orchestrate can connect on behalf of
 * a signed-in person: client registration (RFC 7591), authorisation code with PKCE (S256 only), refresh-token
 * rotation, revocation (RFC 7009) and metadata (RFC 8414, RFC 9728). Each grant is for one person and one client
 * organisation, chosen when they approve; the person's own rights apply to everything done with it. Tokens are
 * random and stored hashed. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { db, type OAuthClient, type OAuthGrant } from '@/data';
import { appUrl } from './a2a/card';

export const SCOPE = 'mcp';
const ACCESS_TTL = 60 * 60;            // one hour
const REFRESH_TTL = 30 * 24 * 60 * 60; // thirty days
const CODE_TTL = 5 * 60;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`;
export const mcpUrl = () => `${appUrl()}/api/mcp`;

export function authServerMetadata() {
  const base = appUrl();
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    revocation_endpoint: `${base}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
    service_documentation: 'https://www.ituti.tech/ai-assurance.html',
  };
}

export function resourceMetadata() {
  return { resource: mcpUrl(), authorization_servers: [appUrl()], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Ituti AI Assurance' };
}

/* ---------- Client registration ---------- */

/** Redirect URIs must be https, or http on this machine (for desktop and development clients). Private-use
 * schemes of native apps (com.example.app:/callback) are accepted too; fragments never. */
export function validRedirect(u: string) {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(url.protocol);
  } catch { return false; }
}

export async function registerClient(body: Record<string, unknown>) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).slice(0, 10) : [];
  if (!uris.length || !uris.every(validRedirect)) return { error: 'invalid_redirect_uri', error_description: 'Give one or more https redirect URIs (http only for localhost).' } as const;
  const name = String(body.client_name || 'MCP client').replace(/[<>]/g, '').slice(0, 200);
  const method = String(body.token_endpoint_auth_method || 'none');
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) return { error: 'invalid_client_metadata', error_description: 'Unsupported token_endpoint_auth_method.' } as const;
  const id = `mcp_${randomBytes(16).toString('hex')}`;
  const secret = method === 'none' ? null : randomBytes(32).toString('base64url');
  await db.oauthClients.insert({ id, name, redirectUris: uris, secretHash: secret ? sha(secret) : null });
  return {
    client_id: id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: method,
  } as const;
}

export const getClient = (id: string) => db.oauthClients.first({ id: String(id || '').slice(0, 64) });

/** Checks a confidential client's secret; public clients (no secret) pass. */
export function clientSecretOk(client: OAuthClient, secret: string | null) {
  if (!client.secretHash) return true;
  if (!secret) return false;
  const a = Buffer.from(sha(secret)), b = Buffer.from(client.secretHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads client credentials from HTTP Basic auth or the form. */
export function clientCredentials(req: Request, form: URLSearchParams) {
  const basic = req.headers.get('authorization')?.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const [id, secret] = Buffer.from(basic, 'base64').toString('utf8').split(':');
    return { id: decodeURIComponent(id || ''), secret: decodeURIComponent(secret || '') };
  }
  return { id: form.get('client_id') || '', secret: form.get('client_secret') };
}

/* ---------- Authorisation ---------- */

export type AuthorizeRequest = { client: OAuthClient; redirectUri: string; state: string | null; codeChallenge: string; scope: string; resource: string | null };

/** Validates an authorisation request. Errors that cannot be sent back to the client are returned as text. */
export async function checkAuthorize(q: URLSearchParams): Promise<{ ok: AuthorizeRequest } | { fatal: string } | { redirect: string }> {
  const client = await getClient(q.get('client_id') || '');
  if (!client) return { fatal: 'This application is not registered. Add the connector again.' };
  const redirectUri = q.get('redirect_uri') || (client.redirectUris.length === 1 ? client.redirectUris[0] : '');
  if (!client.redirectUris.includes(redirectUri)) return { fatal: 'The return address does not match the one the application registered.' };
  const state = q.get('state');
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error); u.searchParams.set('error_description', description);
    if (state) u.searchParams.set('state', state);
    return { redirect: u.toString() };
  };
  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only the authorization code flow is supported.');
  const codeChallenge = q.get('code_challenge') || '';
  if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) return back('invalid_request', 'PKCE with S256 is required.');
  const scope = (q.get('scope') || SCOPE).split(/\s+/).filter(Boolean);
  if (scope.some(s => s !== SCOPE)) return back('invalid_scope', `The only scope is "${SCOPE}".`);
  const resource = q.get('resource');
  if (resource && resource.replace(/\/$/, '') !== mcpUrl() && resource.replace(/\/$/, '') !== appUrl()) return back('invalid_target', 'Unknown resource.');
  return { ok: { client, redirectUri, state, codeChallenge, scope: SCOPE, resource } };
}

export async function issueCode(a: AuthorizeRequest, userId: string, orgId: string) {
  const code = token('ac_');
  await db.oauthGrants.insert({ kind: 'code', tokenHash: sha(code), clientId: a.client.id, userId, orgId, scope: a.scope, redirectUri: a.redirectUri, codeChallenge: a.codeChallenge, resource: a.resource, expiresAt: new Date(Date.now() + CODE_TTL * 1000), familyId: randomUUID() });
  const u = new URL(a.redirectUri);
  u.searchParams.set('code', code);
  if (a.state) u.searchParams.set('state', a.state);
  u.searchParams.set('iss', appUrl());
  return u.toString();
}

/* ---------- Tokens ---------- */

type TokenError = { error: string; error_description: string; status?: number };

async function issueTokens(g: Pick<OAuthGrant, 'clientId' | 'userId' | 'orgId' | 'scope' | 'resource' | 'familyId'>) {
  const access = token('ita_oa_'), refresh = token('itr_');
  const now = Date.now();
  await db.oauthGrants.insertMany([
    { kind: 'access', tokenHash: sha(access), clientId: g.clientId, userId: g.userId, orgId: g.orgId, scope: g.scope, resource: g.resource, expiresAt: new Date(now + ACCESS_TTL * 1000), familyId: g.familyId },
    { kind: 'refresh', tokenHash: sha(refresh), clientId: g.clientId, userId: g.userId, orgId: g.orgId, scope: g.scope, resource: g.resource, expiresAt: new Date(now + REFRESH_TTL * 1000), familyId: g.familyId },
  ]);
  await db.oauthClients.update({ id: g.clientId }, { lastUsedAt: new Date() });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: g.scope };
}

/** Everything issued from one approval is revoked together (for example when a refresh token is reused). */
export async function revokeFamily(familyId: string) {
  await db.oauthGrants.update({ familyId, revokedAt: null }, { revokedAt: new Date() });
}

export async function exchange(req: Request, form: URLSearchParams): Promise<Record<string, unknown> | TokenError> {
  const creds = clientCredentials(req, form);
  const client = await getClient(creds.id);
  if (!client || !clientSecretOk(client, creds.secret)) return { error: 'invalid_client', error_description: 'Unknown client or wrong secret.', status: 401 };
  const grant = form.get('grant_type');
  if (grant === 'authorization_code') {
    const code = await db.oauthGrants.first({ tokenHash: sha(form.get('code') || ''), kind: 'code' });
    if (!code || code.clientId !== client.id) return { error: 'invalid_grant', error_description: 'Unknown authorization code.' };
    if (code.usedAt) { await revokeFamily(code.familyId); return { error: 'invalid_grant', error_description: 'The authorization code was already used.' }; }
    if (code.revokedAt || code.expiresAt < new Date()) return { error: 'invalid_grant', error_description: 'The authorization code has expired.' };
    const ru = form.get('redirect_uri');
    if (ru && ru !== code.redirectUri) return { error: 'invalid_grant', error_description: 'redirect_uri does not match.' };
    const verifier = form.get('code_verifier') || '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!verifier || challenge !== code.codeChallenge) return { error: 'invalid_grant', error_description: 'PKCE verification failed.' };
    await db.oauthGrants.update({ id: code.id }, { usedAt: new Date() });
    return issueTokens(code);
  }
  if (grant === 'refresh_token') {
    const rt = await db.oauthGrants.first({ tokenHash: sha(form.get('refresh_token') || ''), kind: 'refresh' });
    if (!rt || rt.clientId !== client.id) return { error: 'invalid_grant', error_description: 'Unknown refresh token.' };
    if (rt.usedAt) { await revokeFamily(rt.familyId); return { error: 'invalid_grant', error_description: 'The refresh token was already used; sign in again.' }; }
    if (rt.revokedAt || rt.expiresAt < new Date()) return { error: 'invalid_grant', error_description: 'The refresh token has expired or was revoked.' };
    await db.oauthGrants.update({ id: rt.id }, { usedAt: new Date() });
    return issueTokens(rt);
  }
  return { error: 'unsupported_grant_type', error_description: 'Use authorization_code or refresh_token.' };
}

export async function revoke(req: Request, form: URLSearchParams) {
  const creds = clientCredentials(req, form);
  const client = await getClient(creds.id);
  const t = form.get('token') || '';
  if (!client || !clientSecretOk(client, creds.secret)) return false;
  const g = await db.oauthGrants.first({ tokenHash: sha(t) });
  if (g && g.clientId === client.id) await revokeFamily(g.familyId);
  return true; // RFC 7009: unknown tokens are not an error
}

/** The person and client organisation behind an access token, or null. */
export async function accessGrant(bearer: string) {
  if (!bearer.startsWith('ita_oa_')) return null;
  const g = await db.oauthGrants.first({ tokenHash: sha(bearer), kind: 'access' });
  if (!g || g.revokedAt || g.expiresAt < new Date()) return null;
  if (!g.lastUsedAt || Date.now() - g.lastUsedAt.getTime() > 5 * 60e3) await db.oauthGrants.update({ id: g.id }, { lastUsedAt: new Date() });
  return g;
}

/** Applications connected with OAuth: one row per approval that still has a live refresh token. */
export async function connectedApps(filter: { orgId?: string; userId?: string }) {
  const rows = await db.oauthGrants.find({ ...filter, kind: 'refresh', revokedAt: null, usedAt: null, expiresAt: { gt: new Date() } }, { orderBy: [['createdAt', 'desc']] });
  const clients = new Map((rows.length ? await db.oauthClients.find({ id: [...new Set(rows.map(r => r.clientId))] }) : []).map(c => [c.id, c]));
  const users = new Map((rows.length ? await db.users.find({ id: [...new Set(rows.map(r => r.userId))] }) : []).map(u => [u.id, u]));
  const firsts = rows.length ? await db.oauthGrants.find({ familyId: [...new Set(rows.map(r => r.familyId))], kind: 'code' }) : [];
  return rows.map(r => ({
    familyId: r.familyId, app: clients.get(r.clientId)?.name || 'MCP client', user: users.get(r.userId)?.email || '', orgId: r.orgId,
    since: (firsts.find(f => f.familyId === r.familyId)?.createdAt || r.createdAt), lastUsed: clients.get(r.clientId)?.lastUsedAt || null,
  }));
}
