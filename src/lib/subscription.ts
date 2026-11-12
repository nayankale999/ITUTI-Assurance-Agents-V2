/* Subscription tiers. Every client is on one of three: Free (self-service sign-ups, such as visitors from an event
 * QR code), Standard and Enterprise. The tier decides how many AI systems the client can keep in its inventory;
 * an Ituti admin sets it on the client's page, or approves a client admin's upgrade request from the Plans page. It is separate from the billing plan in usage.ts, which decides
 * whether assessments are charged. Limits can be changed with SYSTEM_LIMITS, e.g. "free=2,standard=10,enterprise=unlimited". */
import { db, type Db, type Subscription } from '@/data';
import { audit } from './audit';
import { sendActionEmail } from './mail';
import { appUrl } from './a2a/card';

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

export function limitReached(sub: Subscription, slug?: string) {
  return `The ${SUBSCRIPTION_LABEL[sub]} plan includes ${limitText(sub)}, and this organisation has reached it. ` +
    (slug ? `An admin can request a larger plan at ${plansUrl(slug)}.` : 'Contact your Ituti representative to move to a larger plan.');
}

export const plansUrl = (slug: string) => `${appUrl()}/o/${slug}/plans`;

/** What each tier offers, for the Plans page. Only the system limit is enforced by the app; the rest describes the service. */
export const TIER_INFO: Record<Subscription, { summary: string; points: string[] }> = {
  free: { summary: 'Try the platform on your first AI systems.', points: ['EU AI Act classification and the full compliance journey', 'Conformity assessment, reports and model cards'] },
  standard: { summary: 'For a team assessing a portfolio of AI systems.', points: ['Everything in Free', 'Teams, tasks and gap action plans across the portfolio', 'Connect Claude, Copilot Studio or watsonx Orchestrate'] },
  enterprise: { summary: 'For organisation-wide AI governance.', points: ['Everything in Standard', 'Flat-fee assessment billing available', 'On-premises installation available'] },
};

/** The tiers above this one, smallest first. */
export const upgradesFrom = (sub: Subscription) => SUBSCRIPTIONS.slice(SUBSCRIPTIONS.indexOf(sub) + 1);

export const pendingUpgrade = (orgId: string) => db.upgradeRequests.first({ orgId, status: 'pending' }, { orderBy: [['createdAt', 'desc']] });

async function ituti() {
  const admins = (await db.users.find({ role: 'ITUTI_ADMIN', disabled: false }, { columns: ['email'] })).map(u => u.email);
  const boot = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  return [...new Set([...admins, ...(boot ? [boot] : [])])].slice(0, 20);
}

/** A client admin asks to move up. One pending request per client; asking again replaces the earlier one. */
export async function requestUpgrade(input: { orgId: string; toTier: Subscription; message: string | null; user: { id: string; name: string | null; email: string } }) {
  const org = await db.organizations.first({ id: input.orgId });
  if (!org) throw new Error('Organisation not found.');
  if (!upgradesFrom(org.subscription).includes(input.toTier)) throw new Error(`You are already on ${SUBSCRIPTION_LABEL[org.subscription]}.`);
  const req = await db.tx(async t => {
    await t.upgradeRequests.update({ orgId: org.id, status: 'pending' }, { status: 'declined', decidedAt: new Date() });
    return t.upgradeRequests.insert({ orgId: org.id, fromTier: org.subscription, toTier: input.toTier, message: input.message, requestedById: input.user.id });
  });
  await audit({ orgId: org.id, userId: input.user.id, action: 'org.upgrade_requested', detail: { from: org.subscription, to: input.toTier } });
  const used = await db.aiSystems.count({ orgId: org.id });
  for (const to of await ituti()) {
    await sendActionEmail({
      to,
      subject: `Upgrade request: ${org.name} to ${SUBSCRIPTION_LABEL[input.toTier]}`,
      heading: `${org.name} wants to move to ${SUBSCRIPTION_LABEL[input.toTier]}`,
      body: `${input.user.name || input.user.email} (${input.user.email}) asked to move ${org.name} from ${SUBSCRIPTION_LABEL[org.subscription]} to ` +
        `${SUBSCRIPTION_LABEL[input.toTier]}. They have ${used} AI system${used === 1 ? '' : 's'}${org.signupSource ? ` and signed up through the ${org.signupSource} link` : ''}.` +
        (input.message ? ` Their message: “${input.message}”` : '') + ' Approve or decline it in the client’s settings.',
      action: 'Open the client', url: `${appUrl()}/o/${org.slug}`,
    }).catch(e => console.error('[upgrade] admin email failed', e));
  }
  return req;
}

/** An Ituti admin approves (the client moves to the requested tier) or declines; the requester is told by email. */
export async function decideUpgrade(input: { requestId: string; approve: boolean; adminId: string }) {
  const done = await db.tx(async t => {
    const r = await t.upgradeRequests.first({ id: input.requestId, status: 'pending' }, { forUpdate: true });
    if (!r) return null;
    await t.upgradeRequests.update({ id: r.id }, { status: input.approve ? 'approved' : 'declined', decidedById: input.adminId, decidedAt: new Date() });
    if (input.approve) await t.organizations.update({ id: r.orgId }, { subscription: r.toTier });
    return r;
  });
  if (!done) throw new Error('That request has already been decided.');
  const org = await db.organizations.first({ id: done.orgId });
  await audit({ orgId: done.orgId, userId: input.adminId, action: input.approve ? 'org.upgrade_approved' : 'org.upgrade_declined', detail: { to: done.toTier } });
  const who = await db.users.first({ id: done.requestedById });
  if (who && org) {
    await sendActionEmail({
      to: who.email,
      subject: input.approve ? `${org.name} is now on ${SUBSCRIPTION_LABEL[done.toTier]}` : `Your ${SUBSCRIPTION_LABEL[done.toTier]} request for ${org.name}`,
      heading: input.approve ? `Welcome to ${SUBSCRIPTION_LABEL[done.toTier]}` : 'About your upgrade request',
      body: input.approve
        ? `${org.name} has moved to the ${SUBSCRIPTION_LABEL[done.toTier]} plan, with ${limitText(done.toTier)}. You can add systems straight away.`
        : `Your request to move ${org.name} to ${SUBSCRIPTION_LABEL[done.toTier]} has not been approved yet. The Ituti team will be in touch, or reply to info@itutitech.com.`,
      action: 'Open your workspace', url: `${appUrl()}/o/${org.slug}`,
    }).catch(e => console.error('[upgrade] client email failed', e));
  }
  return done;
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
