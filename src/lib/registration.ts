/* Self-service sign-up for new clients. A person gives their name, work email and organisation; once they prove
 * the email address by following the sign-in link, a workspace is created for the organisation with them as its
 * client admin, on the Free subscription. AI assistance stays off until an Ituti admin turns it on, and Ituti admins
 * are told by email. A sign-up link can carry a source (/register?source=fintech-connect) that is kept on the client.
 * Set SELF_REGISTRATION=off to go back to invitation-only access. */
import { db, type User } from '@/data';
import { audit } from './audit';
import { sendActionEmail } from './mail';
import { SUBSCRIPTION_LABEL, limitText } from './subscription';

const DAYS = 7;
export const registrationOpen = () => (process.env.SELF_REGISTRATION || 'open').toLowerCase() !== 'off';
const appUrl = () => (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function liveRegistration(email: string) {
  return db.registrations.first({ email, completedAt: null, expiresAt: { gt: new Date() } }, { orderBy: [['createdAt', 'desc']] });
}

/** Records a sign-up request. Returns 'existing' when the address already has access, so the caller just signs them in. */
export async function startRegistration(input: { email: string; name: string; orgName: string; source?: string | null }): Promise<'created' | 'existing'> {
  const user = await db.users.first({ email: input.email });
  if (user) {
    if (user.disabled) throw new Error('This account is disabled. Contact your Ituti representative.');
    const member = user.role !== 'CLIENT' || (await db.memberships.count({ userId: user.id })) > 0;
    if (member) return 'existing';
  }
  await db.tx(async t => {
    await t.registrations.update({ email: input.email, completedAt: null }, { expiresAt: new Date() });
    await t.registrations.insert({ email: input.email, name: input.name, orgName: input.orgName, source: input.source ?? null, expiresAt: new Date(Date.now() + DAYS * 864e5) });
  });
  return 'created';
}

/** Called after a successful sign-in: turns a pending sign-up into a workspace. Safe to call on every sign-in. */
export async function completeRegistration(user: Pick<User, 'id' | 'email' | 'name' | 'role'>) {
  const email = user.email.toLowerCase();
  const reg = await liveRegistration(email);
  if (!reg) return null;
  if (user.role !== 'CLIENT') { await db.registrations.update({ id: reg.id }, { completedAt: new Date() }); return null; }
  const org = await db.tx(async t => {
    const r = await t.registrations.first({ id: reg.id, completedAt: null }, { forUpdate: true });
    if (!r) return null;
    const o = await t.organizations.insert({ name: r.orgName, slug: slugify(r.orgName), subscription: 'free', signupSource: r.source });
    await t.memberships.insert({ userId: user.id, orgId: o.id, role: 'CLIENT_ADMIN' });
    if (!user.name) await t.users.update({ id: user.id }, { name: r.name });
    await t.registrations.update({ id: r.id }, { completedAt: new Date(), orgId: o.id });
    return o;
  });
  if (!org) return null;
  await audit({ orgId: org.id, userId: user.id, action: 'org.registered', detail: { name: org.name, email, source: org.signupSource } });
  await notifyAdmins(org, reg.name, email).catch(e => console.error('[register] admin email failed', e));
  return org;
}

async function notifyAdmins(org: { name: string; slug: string; signupSource: string | null }, name: string, email: string) {
  const admins = (await db.users.find({ role: 'ITUTI_ADMIN', disabled: false }, { columns: ['email'] })).map(u => u.email);
  const boot = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const to = [...new Set([...admins, ...(boot ? [boot] : [])])];
  for (const a of to.slice(0, 20)) {
    await sendActionEmail({
      to: a,
      subject: `New client sign-up: ${org.name}${org.signupSource ? ` (${org.signupSource})` : ''}`,
      heading: `${org.name} has signed up`,
      body: `${name} (${email}) created a workspace for ${org.name}${org.signupSource ? `, from the ${org.signupSource} sign-up link` : ''}. ` +
        `It is on the ${SUBSCRIPTION_LABEL.free} subscription (${limitText('free')}). AI assistance is off for new clients: check the sign-up, ` +
        `set the subscription and plan, and turn AI assistance on in the client's settings when you are ready.`,
      action: 'Open the client',
      url: `${appUrl()}/o/${org.slug}`,
    });
  }
}
