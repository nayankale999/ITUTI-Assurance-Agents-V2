/* API keys for machine access (the A2A agent endpoint). Each key belongs to one client organisation.
 * Only a SHA-256 hash is stored; the key itself is shown once, when it is created. */
import { createHash, randomBytes } from 'crypto';
import { db, type ApiKey, type Org } from '@/data';

const PREFIX = 'ita_';
export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export async function createApiKey(orgId: string, name: string, userId: string | null): Promise<{ key: string; row: ApiKey }> {
  const key = PREFIX + randomBytes(32).toString('base64url');
  const row = await db.apiKeys.insert({ orgId, name: name.slice(0, 120), prefix: key.slice(0, 12), keyHash: hashKey(key), createdById: userId });
  return { key, row };
}

/** Cleans a header value the way integration platforms tend to mangle it: surrounding quotes and spaces, and any
 *  number of "Bearer" / "Token" / "ApiKey" scheme words in front (e.g. "Bearer Bearer ita_…" when the scheme was
 *  typed into a field that already adds it). */
export function cleanKey(value: string | null | undefined): string {
  let v = (value || '').trim();
  for (let i = 0; i < 4; i++) {
    const before = v;
    v = v.replace(/^["'`]+|["'`]+$/g, '').trim();
    v = v.replace(/^(bearer|token|apikey|api-key)\s*[:=]?\s+/i, '').trim();
    if (v === before) break;
  }
  return v;
}

/** Finds the key in a request: "Authorization: Bearer …" or "x-api-key" first, then any other header whose value
 *  is an Ituti key (some platforms only let you name your own header). */
export function findKey(req: Request): { raw: string; header: string } | null {
  for (const h of ['authorization', 'x-api-key']) {
    const v = cleanKey(req.headers.get(h));
    if (v.startsWith(PREFIX)) return { raw: v, header: h };
  }
  for (const [h, value] of req.headers) {
    if (h === 'cookie') continue;
    const v = cleanKey(value);
    if (v.startsWith(PREFIX)) return { raw: v, header: h };
  }
  return null;
}

/** Why a request was refused, in words safe to return to the caller (never more than the key's public prefix). */
export async function keyFailure(req: Request): Promise<string> {
  const found = findKey(req);
  if (!found) {
    const auth = req.headers.get('authorization');
    return auth
      ? 'An Authorization header was sent, but it does not hold an Ituti AI Assurance API key (they start with "ita_"). Check the token in the connection.'
      : 'No API key was sent. Send the client API key as "Authorization: Bearer ita_…" or in an "x-api-key" header.';
  }
  const shown = found.raw.slice(0, 12);
  if (found.raw.length > 100) return `The key in the "${found.header}" header is too long to be an Ituti API key.`;
  const any = await db.apiKeys.first({ keyHash: hashKey(found.raw) });
  if (any?.revokedAt) return `The API key ${shown}… has been revoked. Create a new key on the client's page.`;
  return `The API key ${shown}… (in the "${found.header}" header) is not recognised. Make sure the whole key was pasted, exactly as shown when it was created; the shortened key listed afterwards does not work.`;
}

/** Reads a client API key from the request and returns its client, or null. */
export async function orgForRequest(req: Request): Promise<{ org: Org; key: ApiKey } | null> {
  const found = findKey(req);
  if (!found || found.raw.length > 100) return null;
  const key = await db.apiKeys.first({ keyHash: hashKey(found.raw), revokedAt: null });
  if (!key) return null;
  const org = await db.organizations.first({ id: key.orgId });
  if (!org) return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 5 * 60e3) await db.apiKeys.update({ id: key.id }, { lastUsedAt: new Date() });
  return { org, key };
}
