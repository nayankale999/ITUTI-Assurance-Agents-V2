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

/** Reads a key from "Authorization: Bearer …" or "x-api-key". Returns the key's client, or null. */
export async function orgForRequest(req: Request): Promise<{ org: Org; key: ApiKey } | null> {
  const auth = req.headers.get('authorization') || '';
  const raw = (auth.match(/^Bearer\s+(\S+)$/i)?.[1] || req.headers.get('x-api-key') || '').trim();
  if (!raw.startsWith(PREFIX) || raw.length > 100) return null;
  const key = await db.apiKeys.first({ keyHash: hashKey(raw), revokedAt: null });
  if (!key) return null;
  const org = await db.organizations.first({ id: key.orgId });
  if (!org) return null;
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 5 * 60e3) await db.apiKeys.update({ id: key.id }, { lastUsedAt: new Date() });
  return { org, key };
}
