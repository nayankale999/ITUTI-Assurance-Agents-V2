/* Subscription tiers. Every client is on one of three: Free (self-service sign-ups, such as visitors from an event
 * QR code), Standard and Enterprise. The tier decides how many AI systems the client can keep in its inventory;
 * an Ituti admin sets it on the client's page. It is separate from the billing plan in usage.ts, which decides
 * whether assessments are charged. Limits can be changed with SYSTEM_LIMITS, e.g. "free=2,standard=10,enterprise=unlimited". */
import { db, type Db, type Subscription } from '@/data';

export const SUBSCRIPTIONS: Subscription[] = ['free', 'standard', 'enterprise'];
export const SUBSCRIPTION_LABEL: Record<Subscription, string> = { free: 'Free', standard: 'Standard', enterprise: 'Enterprise' };
const DEFAULT_LIMITS: Record<Subscription, number | null> = { free: 2, standard: 10, enterprise: null };

/** The tier limits, with any SYSTEM_LIMITS overrides applied. null means no limit. */
export function systemLimits(env = process.env.SYSTEM_LIMITS): Record<Subscription, number | null> {
  const out = { ...DEFAULT_LIMITS };
  for (const part of (env || '').split(',')) {
    const [k, v] = part.split('=').map(s => s.trim().toLowerCase());
    if (!(SUBSCRIPTIONS as string[]).includes(k) || !v) continue;
    if (v === 'unlimited' || v === 'none') out[k as Subscription] = null;
    else if (/^\d+$/.test(v)) out[k as Subscription] = Number(v);
  }
  return out;
}

export const systemLimit = (sub: Subscription) => systemLimits()[sub];

export function limitText(sub: Subscription) {
  const n = systemLimit(sub);
  return n == null ? 'unlimited AI systems' : `up to ${n} AI system${n === 1 ? '' : 's'}`;
}

export function limitReached(sub: Subscription) {
  return `The ${SUBSCRIPTION_LABEL[sub]} plan includes ${limitText(sub)}, and this organisation has reached it. ` +
    'Contact your Ituti representative to move to a larger plan.';
}

/** How many systems the organisation has against its limit. */
export async function systemQuota(org: { id: string; subscription: Subscription }, t: Db = db) {
  const used = await t.aiSystems.count({ orgId: org.id });
  const limit = systemLimit(org.subscription);
  return { used, limit, full: limit != null && used >= limit };
}

/** Inserts a system only if the organisation is under its limit. The organisation row is locked first, so two
 * requests at once cannot both take the last place. Returns null when the limit is reached. */
export async function insertSystemWithinLimit<R>(orgId: string, insert: (t: Db) => Promise<R>): Promise<R | null> {
  return db.tx(async t => {
    const org = await t.organizations.first({ id: orgId }, { forUpdate: true });
    if (!org) throw new Error('Organisation not found.');
    if ((await systemQuota(org, t)).full) return null;
    return insert(t);
  });
}

/** A sign-up source from a link such as /register?source=fintech-connect: lower-case letters, digits and hyphens. */
export function cleanSource(v: unknown) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(s) ? s : null;
}
