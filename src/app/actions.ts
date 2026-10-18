'use server';
/* Account and organisation management. Every action re-checks the caller's rights on the server. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { getViewer, capsFor, type Viewer } from '@/lib/session';
import { canInvite, CLIENT_ROLES, ROLE_LABEL, type OrgRoleT } from '@/lib/permissions';
import { newToken, hashToken } from '@/lib/tokens';
import { sendActionEmail } from '@/lib/mail';
import { audit } from '@/lib/audit';
import { blankAssessment, summarise } from '@/lib/summary';

export type ActionState = { ok?: string; error?: string } | null;

const INVITE_DAYS = 7;
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const appUrl = () => (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');

async function viewerOrError(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new Error('Your session has ended. Sign in again.');
  return v;
}

function fail(e: unknown): ActionState {
  return { error: e instanceof Error ? e.message : 'Something went wrong. Try again.' };
}

function slugify(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'client';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/* ---------- Organisations (Ituti admin) ---------- */
export async function createOrg(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can add clients.' };
    const name = z.string().trim().min(2).max(120).parse(fd.get('name'));
    const [org] = await db.insert(schema.organizations).values({ name, slug: slugify(name) }).returning();
    await audit({ orgId: org.id, userId: v.id, action: 'org.created', detail: { name } });
    revalidatePath('/admin');
    return { ok: `Added ${name}.` };
  } catch (e) { return fail(e); }
}

export async function renameOrg(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const orgId = String(fd.get('orgId'));
    const caps = await capsFor(v, orgId);
    if (!caps.staff) return { error: 'Only Ituti staff can rename a client.' };
    const name = z.string().trim().min(2).max(120).parse(fd.get('name'));
    await db.update(schema.organizations).set({ name }).where(eq(schema.organizations.id, orgId));
    await audit({ orgId, userId: v.id, action: 'org.renamed', detail: { name } });
    revalidatePath('/', 'layout');
    return { ok: 'Name saved.' };
  } catch (e) { return fail(e); }
}

export async function deleteOrg(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can delete a client.' };
    const orgId = String(fd.get('orgId'));
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
    if (!org) return { error: 'Client not found.' };
    if (String(fd.get('confirm') || '').trim() !== org.name) return { error: `Type ${org.name} exactly to confirm.` };
    await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    await audit({ userId: v.id, action: 'org.deleted', detail: { name: org.name } });
  } catch (e) { return fail(e); }
  revalidatePath('/admin');
  redirect('/admin');
}

/* ---------- Invitations ---------- */
export async function inviteUser(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const email = emailSchema.parse(fd.get('email'));
    const role = String(fd.get('role'));
    const orgId = fd.get('orgId') ? String(fd.get('orgId')) : null;
    const caps = orgId ? await capsFor(v, orgId) : null;
    if (!canInvite(v.role, caps, role)) return { error: 'You cannot invite people with that role.' };
    if ((CLIENT_ROLES as string[]).includes(role) && !orgId) return { error: 'Choose an organisation.' };
    if (!(CLIENT_ROLES as string[]).includes(role) && orgId) return { error: 'Ituti staff are invited from the Ituti team page.' };

    const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (existing && orgId) {
      const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, existing.id), eq(schema.memberships.orgId, orgId)) });
      if (m) return { error: `${email} is already a member. Change their role in the list below.` };
      if (existing.role !== 'CLIENT') return { error: `${email} is Ituti staff. Assign them to this client from the Ituti team page instead.` };
    }
    if (existing && !orgId && existing.role === role) return { error: `${email} already has that role.` };

    // Replace any earlier pending invitation for the same address and scope
    const inv = schema.invitations;
    await db.update(inv).set({ revokedAt: new Date() }).where(and(eq(inv.email, email), orgId ? eq(inv.orgId, orgId) : isNull(inv.orgId), isNull(inv.acceptedAt), isNull(inv.revokedAt)));
    const token = newToken();
    await db.insert(inv).values({ email, orgId, role, tokenHash: hashToken(token), invitedById: v.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) });

    const org = orgId ? await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) }) : null;
    const where = org ? org.name : 'the Ituti team';
    await sendActionEmail({
      to: email,
      subject: `You are invited to ${org ? org.name + ' on ' : ''}Ituti AI Assurance`,
      heading: `Join ${where} on Ituti AI Assurance`,
      body: `${v.name || v.email} has invited you as ${ROLE_LABEL[role].toLowerCase()}. The invitation expires in ${INVITE_DAYS} days.`,
      action: 'Accept invitation',
      url: `${appUrl()}/invite/${token}`,
    });
    await audit({ orgId, userId: v.id, action: 'invite.sent', detail: { email, role } });
    revalidatePath('/', 'layout');
    return { ok: `Invitation sent to ${email}.` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Enter a valid email address.' };
    return fail(e);
  }
}

export async function revokeInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const invite = await db.query.invitations.findFirst({ where: eq(schema.invitations.id, String(fd.get('id'))) });
    if (!invite) return { error: 'Invitation not found.' };
    const caps = invite.orgId ? await capsFor(v, invite.orgId) : null;
    if (!canInvite(v.role, caps, invite.role)) return { error: 'You cannot revoke this invitation.' };
    await db.update(schema.invitations).set({ revokedAt: new Date() }).where(eq(schema.invitations.id, invite.id));
    await audit({ orgId: invite.orgId, userId: v.id, action: 'invite.revoked', detail: { email: invite.email } });
    revalidatePath('/', 'layout');
    return { ok: 'Invitation revoked.' };
  } catch (e) { return fail(e); }
}

/** Accepts an invitation for the signed-in user. Called from the invitation page's button, never on page load. */
export async function acceptInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  let dest = '/';
  try {
    const v = await viewerOrError();
    const token = String(fd.get('token') || '');
    const inv = schema.invitations;
    const invite = await db.query.invitations.findFirst({ where: eq(inv.tokenHash, hashToken(token)) });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) return { error: 'This invitation is no longer valid. Ask for a new one.' };
    if (invite.email !== v.email.toLowerCase()) return { error: `This invitation is for ${invite.email}. Sign out and sign in with that address.` };
    if (invite.orgId) {
      await db.insert(schema.memberships).values({ userId: v.id, orgId: invite.orgId, role: invite.role as OrgRoleT })
        .onConflictDoUpdate({ target: [schema.memberships.userId, schema.memberships.orgId], set: { role: invite.role as OrgRoleT } });
      const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, invite.orgId) });
      dest = org ? `/o/${org.slug}` : '/';
    } else {
      await db.update(schema.users).set({ role: invite.role as 'ITUTI_ADMIN' | 'ITUTI_ASSESSOR' }).where(eq(schema.users.id, v.id));
      dest = '/admin';
    }
    await db.update(inv).set({ acceptedAt: new Date() }).where(eq(inv.id, invite.id));
    await audit({ orgId: invite.orgId, userId: v.id, action: 'invite.accepted', detail: { role: invite.role } });
  } catch (e) { return fail(e); }
  redirect(dest);
}

/* ---------- Client members ---------- */
export async function changeMemberRole(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const orgId = String(fd.get('orgId')), userId = String(fd.get('userId'));
    const role = z.enum(['CLIENT_ADMIN', 'CONTRIBUTOR', 'VIEWER']).parse(fd.get('role'));
    if (!(await capsFor(v, orgId)).manage) return { error: 'You cannot manage members here.' };
    if (userId === v.id) return { error: 'You cannot change your own role.' };
    await db.update(schema.memberships).set({ role }).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
    await audit({ orgId, userId: v.id, action: 'member.role', detail: { member: userId, role } });
    revalidatePath('/', 'layout');
    return { ok: 'Role updated.' };
  } catch (e) { return fail(e); }
}

export async function removeMember(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const orgId = String(fd.get('orgId')), userId = String(fd.get('userId'));
    if (!(await capsFor(v, orgId)).manage) return { error: 'You cannot manage members here.' };
    if (userId === v.id) return { error: 'You cannot remove yourself.' };
    await db.delete(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
    const systems = await db.query.aiSystems.findMany({ where: eq(schema.aiSystems.orgId, orgId), columns: { id: true } });
    if (systems.length) await db.delete(schema.systemAssignments).where(and(eq(schema.systemAssignments.userId, userId), inArray(schema.systemAssignments.systemId, systems.map(s => s.id))));
    await audit({ orgId, userId: v.id, action: 'member.removed', detail: { member: userId } });
    revalidatePath('/', 'layout');
    return { ok: 'Member removed.' };
  } catch (e) { return fail(e); }
}

export async function setContributorSystems(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const orgId = String(fd.get('orgId')), userId = String(fd.get('userId'));
    if (!(await capsFor(v, orgId)).manage) return { error: 'You cannot manage members here.' };
    const wanted = fd.getAll('systemId').map(String);
    const orgSystems = (await db.query.aiSystems.findMany({ where: eq(schema.aiSystems.orgId, orgId), columns: { id: true } })).map(s => s.id);
    const valid = wanted.filter(id => orgSystems.includes(id));
    if (orgSystems.length) await db.delete(schema.systemAssignments).where(and(eq(schema.systemAssignments.userId, userId), inArray(schema.systemAssignments.systemId, orgSystems)));
    if (valid.length) await db.insert(schema.systemAssignments).values(valid.map(systemId => ({ userId, systemId })));
    await audit({ orgId, userId: v.id, action: 'member.systems', detail: { member: userId, systems: valid.length } });
    revalidatePath('/', 'layout');
    return { ok: 'Assignments saved.' };
  } catch (e) { return fail(e); }
}

/* ---------- Ituti team (admin only) ---------- */
export async function setStaffRole(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can change staff roles.' };
    const userId = String(fd.get('userId'));
    const role = z.enum(['ITUTI_ADMIN', 'ITUTI_ASSESSOR', 'CLIENT']).parse(fd.get('role'));
    if (userId === v.id) return { error: 'You cannot change your own role.' };
    await db.update(schema.users).set({ role }).where(eq(schema.users.id, userId));
    if (role === 'CLIENT') await db.delete(schema.assessorAssignments).where(eq(schema.assessorAssignments.userId, userId));
    await audit({ userId: v.id, action: 'staff.role', detail: { member: userId, role } });
    revalidatePath('/admin/team');
    return { ok: 'Role updated.' };
  } catch (e) { return fail(e); }
}

export async function setAssessorOrgs(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can assign clients.' };
    const userId = String(fd.get('userId'));
    const orgIds = fd.getAll('orgId').map(String);
    await db.delete(schema.assessorAssignments).where(eq(schema.assessorAssignments.userId, userId));
    if (orgIds.length) {
      const real = (await db.query.organizations.findMany({ where: inArray(schema.organizations.id, orgIds), columns: { id: true } })).map(o => o.id);
      if (real.length) await db.insert(schema.assessorAssignments).values(real.map(orgId => ({ userId, orgId })));
    }
    await audit({ userId: v.id, action: 'staff.assignments', detail: { member: userId, orgs: orgIds.length } });
    revalidatePath('/admin/team');
    return { ok: 'Client assignments saved.' };
  } catch (e) { return fail(e); }
}

export async function setUserDisabled(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can do this.' };
    const userId = String(fd.get('userId'));
    const disabled = fd.get('disabled') === 'true';
    if (userId === v.id) return { error: 'You cannot disable your own account.' };
    await db.update(schema.users).set({ disabled }).where(eq(schema.users.id, userId));
    if (disabled) await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await audit({ userId: v.id, action: disabled ? 'user.disabled' : 'user.enabled', detail: { member: userId } });
    revalidatePath('/admin/team');
    return { ok: disabled ? 'Account disabled and signed out.' : 'Account enabled.' };
  } catch (e) { return fail(e); }
}

/* ---------- Systems ---------- */
export async function createSystem(_: ActionState, fd: FormData): Promise<ActionState> {
  let dest = '';
  try {
    const v = await viewerOrError();
    const orgId = String(fd.get('orgId'));
    const caps = await capsFor(v, orgId);
    if (!caps.createSystems) return { error: 'You cannot add systems here.' };
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
    if (!org) return { error: 'Organisation not found.' };
    const name = z.string().trim().min(1).max(200).catch('Untitled system').parse(fd.get('name'));
    const data = blankAssessment(name);
    const [row] = await db.insert(schema.aiSystems).values({ orgId, data, ...summarise(data), createdById: v.id, updatedById: v.id }).returning();
    await audit({ orgId, systemId: row.id, userId: v.id, action: 'system.created', detail: { name } });
    dest = `/o/${org.slug}/systems/${row.id}`;
  } catch (e) { return fail(e); }
  redirect(dest);
}
