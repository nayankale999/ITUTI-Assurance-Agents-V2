'use server';
/* Account and organisation management. Every action re-checks the caller's rights on the server. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db, deleteOrg as deleteOrgCascade } from '@/data';
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
    const org = await db.organizations.insert({ name, slug: slugify(name) });
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
    await db.organizations.update(o => o.id === orgId, { name });
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
    const org = db.organizations.first(o => o.id === orgId);
    if (!org) return { error: 'Client not found.' };
    if (String(fd.get('confirm') || '').trim() !== org.name) return { error: `Type ${org.name} exactly to confirm.` };
    await deleteOrgCascade(orgId);
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

    const existing = db.users.first(u => u.email === email);
    if (existing && orgId) {
      if (db.memberships.first(m => m.userId === existing.id && m.orgId === orgId)) return { error: `${email} is already a member. Change their role in the list below.` };
      if (existing.role !== 'CLIENT') return { error: `${email} is Ituti staff. Assign them to this client from the Ituti team page instead.` };
    }
    if (existing && !orgId && existing.role === role) return { error: `${email} already has that role.` };

    // Replace any earlier pending invitation for the same address and scope
    const token = newToken();
    await db.invitations.mutate(rows => {
      const now = new Date();
      const out = rows.map(i => (i.email === email && i.orgId === orgId && !i.acceptedAt && !i.revokedAt ? { ...i, revokedAt: now } : i));
      out.push({ id: crypto.randomUUID(), email, orgId, role, tokenHash: hashToken(token), invitedById: v.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5), acceptedAt: null, revokedAt: null, createdAt: now });
      return { rows: out, result: null };
    });

    const org = orgId ? db.organizations.first(o => o.id === orgId) : null;
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
    const id = String(fd.get('id'));
    const invite = db.invitations.first(i => i.id === id);
    if (!invite) return { error: 'Invitation not found.' };
    const caps = invite.orgId ? await capsFor(v, invite.orgId) : null;
    if (!canInvite(v.role, caps, invite.role)) return { error: 'You cannot revoke this invitation.' };
    await db.invitations.update(i => i.id === id, { revokedAt: new Date() });
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
    const hash = hashToken(String(fd.get('token') || ''));
    const invite = db.invitations.first(i => i.tokenHash === hash);
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) return { error: 'This invitation is no longer valid. Ask for a new one.' };
    if (invite.email !== v.email.toLowerCase()) return { error: `This invitation is for ${invite.email}. Sign out and sign in with that address.` };
    if (invite.orgId) {
      const orgId = invite.orgId, role = invite.role as OrgRoleT;
      await db.memberships.mutate(rows => {
        const i = rows.findIndex(m => m.userId === v.id && m.orgId === orgId);
        if (i < 0) return { rows: [...rows, { userId: v.id, orgId, role, createdAt: new Date() }], result: null };
        const out = [...rows]; out[i] = { ...rows[i], role };
        return { rows: out, result: null };
      });
      const org = db.organizations.first(o => o.id === orgId);
      dest = org ? `/o/${org.slug}` : '/';
    } else {
      await db.users.update(u => u.id === v.id, { role: invite.role as 'ITUTI_ADMIN' | 'ITUTI_ASSESSOR' });
      dest = '/admin';
    }
    await db.invitations.update(i => i.id === invite.id, { acceptedAt: new Date() });
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
    await db.memberships.update(m => m.orgId === orgId && m.userId === userId, { role });
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
    await db.memberships.remove(m => m.orgId === orgId && m.userId === userId);
    const systems = new Set(db.aiSystems.find(s => s.orgId === orgId).map(s => s.id));
    await db.systemAssignments.remove(a => a.userId === userId && systems.has(a.systemId));
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
    const orgSystems = new Set(db.aiSystems.find(s => s.orgId === orgId).map(s => s.id));
    const valid = [...new Set(fd.getAll('systemId').map(String))].filter(id => orgSystems.has(id));
    await db.systemAssignments.mutate(rows => ({
      rows: [...rows.filter(a => !(a.userId === userId && orgSystems.has(a.systemId))), ...valid.map(systemId => ({ userId, systemId, createdAt: new Date() }))],
      result: null,
    }));
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
    await db.users.update(u => u.id === userId, { role });
    if (role === 'CLIENT') await db.assessorAssignments.remove(a => a.userId === userId);
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
    const real = new Set(db.organizations.all().map(o => o.id));
    const orgIds = [...new Set(fd.getAll('orgId').map(String))].filter(id => real.has(id));
    await db.assessorAssignments.mutate(rows => ({
      rows: [...rows.filter(a => a.userId !== userId), ...orgIds.map(orgId => ({ userId, orgId, createdAt: new Date() }))],
      result: null,
    }));
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
    await db.users.update(u => u.id === userId, { disabled });
    if (disabled) await db.sessions.remove(s => s.userId === userId);
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
    const org = db.organizations.first(o => o.id === orgId);
    if (!org) return { error: 'Organisation not found.' };
    const name = z.string().trim().min(1).max(200).catch('Untitled system').parse(fd.get('name'));
    const data = blankAssessment(name);
    const row = await db.aiSystems.insert({ orgId, data, ...summarise(data), createdById: v.id, updatedById: v.id });
    await audit({ orgId, systemId: row.id, userId: v.id, action: 'system.created', detail: { name } });
    dest = `/o/${org.slug}/systems/${row.id}`;
  } catch (e) { return fail(e); }
  redirect(dest);
}
