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
import { createApiKey } from '@/lib/apikeys';
import { makeSignInLink } from '@/lib/signin-link';

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
    await db.organizations.update({ id: orgId }, { name });
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
    const org = await db.organizations.first({ id: orgId });
    if (!org) return { error: 'Client not found.' };
    if (String(fd.get('confirm') || '').trim() !== org.name) return { error: `Type ${org.name} exactly to confirm.` };
    await deleteOrgCascade(orgId);
    await audit({ userId: v.id, action: 'org.deleted', detail: { name: org.name } });
  } catch (e) { return fail(e); }
  revalidatePath('/admin');
  redirect('/admin');
}

export async function setOrgAi(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can change this.' };
    const orgId = String(fd.get('orgId'));
    const on = fd.get('on') === 'true';
    const [org] = await db.organizations.update({ id: orgId }, { aiEnabled: on });
    if (!org) return { error: 'Client not found.' };
    await audit({ orgId, userId: v.id, action: on ? 'org.ai_enabled' : 'org.ai_disabled' });
    revalidatePath('/', 'layout');
    return { ok: on ? 'AI assistance switched on.' : 'AI assistance switched off.' };
  } catch (e) { return fail(e); }
}

export async function setOrgPlan(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can change plans.' };
    const orgId = String(fd.get('orgId'));
    const plan = z.enum(['per_assessment', 'enterprise', 'internal']).parse(fd.get('plan'));
    await db.organizations.update({ id: orgId }, { plan });
    await audit({ orgId, userId: v.id, action: 'org.plan', detail: { plan } });
    revalidatePath('/', 'layout');
    return { ok: 'Plan saved.' };
  } catch (e) { return fail(e); }
}

export async function createOrgApiKey(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can create API keys.' };
    const orgId = String(fd.get('orgId'));
    const name = z.string().trim().min(2).max(120).parse(fd.get('name'));
    if (!(await db.organizations.first({ id: orgId }))) return { error: 'Client not found.' };
    if ((await db.apiKeys.count({ orgId, revokedAt: null })) >= 10) return { error: 'This client already has 10 active keys. Revoke one first.' };
    const { key } = await createApiKey(orgId, name, v.id);
    await audit({ orgId, userId: v.id, action: 'apikey.created', detail: { name, prefix: key.slice(0, 12) } });
    revalidatePath('/', 'layout');
    return { ok: `Key created. Copy it now; it will not be shown again: ${key}` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Give the key a name of at least two characters.' };
    return fail(e);
  }
}

export async function revokeOrgApiKey(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can revoke API keys.' };
    const id = String(fd.get('id'));
    const [k] = await db.apiKeys.update({ id, revokedAt: null }, { revokedAt: new Date() });
    if (!k) return { error: 'Key not found or already revoked.' };
    await audit({ orgId: k.orgId, userId: v.id, action: 'apikey.revoked', detail: { name: k.name, prefix: k.prefix } });
    revalidatePath('/', 'layout');
    return { ok: `Revoked ${k.name}.` };
  } catch (e) { return fail(e); }
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

    const existing = await db.users.first({ email });
    if (existing && orgId) {
      if (await db.memberships.first({ userId: existing.id, orgId })) return { error: `${email} is already a member. Change their role in the list below.` };
      if (existing.role !== 'CLIENT') return { error: `${email} is Ituti staff. Assign them to this client from the Ituti team page instead.` };
    }
    if (existing && !orgId && existing.role === role) return { error: `${email} already has that role.` };

    // Replace any earlier pending invitation for the same address and scope
    const token = newToken();
    await db.tx(async t => {
      await t.invitations.update({ email, orgId, acceptedAt: null, revokedAt: null }, { revokedAt: new Date() });
      await t.invitations.insert({ email, orgId, role, tokenHash: hashToken(token), invitedById: v.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 864e5) });
    });

    const org = orgId ? await db.organizations.first({ id: orgId }) : null;
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
    const invite = await db.invitations.first({ id });
    if (!invite) return { error: 'Invitation not found.' };
    const caps = invite.orgId ? await capsFor(v, invite.orgId) : null;
    if (!canInvite(v.role, caps, invite.role)) return { error: 'You cannot revoke this invitation.' };
    await db.invitations.update({ id }, { revokedAt: new Date() });
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
    const invite = await db.invitations.first({ tokenHash: hash });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) return { error: 'This invitation is no longer valid. Ask for a new one.' };
    if (invite.email !== v.email.toLowerCase()) return { error: `This invitation is for ${invite.email}. Sign out and sign in with that address.` };
    if (invite.orgId) {
      const orgId = invite.orgId, role = invite.role as OrgRoleT;
      await db.tx(async t => {
        const m = await t.memberships.first({ userId: v.id, orgId }, { forUpdate: true });
        if (m) await t.memberships.update({ userId: v.id, orgId }, { role });
        else await t.memberships.insert({ userId: v.id, orgId, role });
      });
      const org = await db.organizations.first({ id: orgId });
      dest = org ? `/o/${org.slug}` : '/';
    } else {
      await db.users.update({ id: v.id }, { role: invite.role as 'ITUTI_ADMIN' | 'ITUTI_ASSESSOR' });
      dest = '/admin';
    }
    await db.invitations.update({ id: invite.id }, { acceptedAt: new Date() });
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
    await db.memberships.update({ orgId, userId }, { role });
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
    await db.memberships.remove({ orgId, userId });
    const systems = (await db.aiSystems.find({ orgId }, { columns: ['id'] })).map(s => s.id);
    await db.systemAssignments.remove({ userId, systemId: systems });
    const teams = (await db.teams.find({ orgId })).map(t => t.id);
    if (teams.length) { await db.teamMembers.remove({ teamId: teams, userId }); await db.teams.update({ id: teams, leadId: userId }, { leadId: null }); }
    await db.tasks.remove({ orgId, assigneeId: userId });
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
    const orgSystems = (await db.aiSystems.find({ orgId }, { columns: ['id'] })).map(s => s.id);
    const valid = [...new Set(fd.getAll('systemId').map(String))].filter(id => orgSystems.includes(id));
    await db.tx(async t => {
      await t.systemAssignments.remove({ userId, systemId: orgSystems });
      await t.systemAssignments.insertMany(valid.map(systemId => ({ userId, systemId })));
    });
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
    await db.users.update({ id: userId }, { role });
    if (role === 'CLIENT') await db.assessorAssignments.remove({ userId });
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
    const real = new Set((await db.organizations.all({ columns: ['id'] })).map(o => o.id));
    const orgIds = [...new Set(fd.getAll('orgId').map(String))].filter(id => real.has(id));
    await db.tx(async t => {
      await t.assessorAssignments.remove({ userId });
      await t.assessorAssignments.insertMany(orgIds.map(orgId => ({ userId, orgId })));
    });
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
    await db.users.update({ id: userId }, { disabled });
    if (disabled) await db.sessions.remove({ userId });
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
    const org = await db.organizations.first({ id: orgId });
    if (!org) return { error: 'Organisation not found.' };
    const name = z.string().trim().min(1).max(200).catch('Untitled system').parse(fd.get('name'));
    const data = blankAssessment(name);
    const row = await db.aiSystems.insert({ orgId, data, ...summarise(data), createdById: v.id, updatedById: v.id });
    await audit({ orgId, systemId: row.id, userId: v.id, action: 'system.created', detail: { name } });
    dest = `/o/${org.slug}/systems/${row.id}`;
  } catch (e) { return fail(e); }
  redirect(dest);
}

/* ---------- Public model card links ---------- */
export async function createShareLink(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const { systemAccess } = await import('@/lib/session');
    const a = await systemAccess(v, String(fd.get('systemId') || ''));
    if (!a || !a.canEdit) return { error: 'You cannot share this system’s model card.' };
    const token = newToken();
    await db.shares.insert({ orgId: a.org.id, systemId: a.system.id, kind: 'card', tokenHash: hashToken(token), createdById: v.id });
    await audit({ orgId: a.org.id, systemId: a.system.id, userId: v.id, action: 'share.created', detail: { kind: 'model card' } });
    revalidatePath(`/o/${a.org.slug}/systems/${a.system.id}/documents`);
    return { ok: `Public link created. Copy it now; it is not shown again: ${appUrl()}/share/${token}` };
  } catch (e) { return fail(e); }
}

export async function revokeShareLink(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const link = await db.shares.first({ id: String(fd.get('id') || '') });
    if (!link) return { error: 'Link not found.' };
    const { systemAccess } = await import('@/lib/session');
    const a = await systemAccess(v, link.systemId);
    if (!a || !a.canEdit) return { error: 'You cannot change this system’s links.' };
    await db.shares.update({ id: link.id }, { revokedAt: new Date() });
    await audit({ orgId: a.org.id, systemId: a.system.id, userId: v.id, action: 'share.revoked', detail: { kind: 'model card' } });
    revalidatePath(`/o/${a.org.slug}/systems/${a.system.id}/documents`);
    return { ok: 'Link revoked.' };
  } catch (e) { return fail(e); }
}

/* ---------- Teams ---------- */
async function teamOrg(v: Viewer, orgId: string) {
  if (!(await capsFor(v, orgId)).manage) throw new Error('Only client admins and Ituti staff can manage teams.');
  const members = new Set((await db.memberships.find({ orgId })).map(m => m.userId));
  const systems = new Set((await db.aiSystems.find({ orgId }, { columns: ['id'] })).map(s => s.id));
  return { members, systems };
}

export async function createTeam(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const orgId = String(fd.get('orgId') || '');
    const { members } = await teamOrg(v, orgId);
    const name = z.string().trim().min(2).max(120).parse(fd.get('name'));
    const leadId = String(fd.get('leadId') || '') || null;
    if (leadId && !members.has(leadId)) return { error: 'The team lead must be a member of this organisation.' };
    if (await db.teams.first({ orgId, name })) return { error: 'A team with that name already exists.' };
    const team = await db.teams.insert({ orgId, name, leadId });
    if (leadId) await db.teamMembers.insert({ teamId: team.id, userId: leadId });
    await audit({ orgId, userId: v.id, action: 'team.created', detail: { title: name } });
    revalidatePath('/', 'layout');
    return { ok: `Team “${name}” created. Add members and systems below.` };
  } catch (e) {
    if (e instanceof z.ZodError) return { error: 'Give the team a name of at least two characters.' };
    return fail(e);
  }
}

export async function updateTeam(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const team = await db.teams.first({ id: String(fd.get('teamId') || '') });
    if (!team) return { error: 'Team not found.' };
    const { members, systems } = await teamOrg(v, team.orgId);
    const leadId = String(fd.get('leadId') || '') || null;
    const want = new Set(fd.getAll('member').map(String).filter(id => members.has(id)));
    if (leadId) { if (!members.has(leadId)) return { error: 'The team lead must be a member of this organisation.' }; want.add(leadId); }
    const sys = new Set(fd.getAll('system').map(String).filter(id => systems.has(id)));
    const name = z.string().trim().min(2).max(120).parse(fd.get('name') || team.name);
    await db.tx(async t => {
      await t.teams.update({ id: team.id }, { name, leadId });
      await t.teamMembers.remove({ teamId: team.id });
      if (want.size) await t.teamMembers.insertMany([...want].map(userId => ({ teamId: team.id, userId })));
      await t.teamSystems.remove({ teamId: team.id });
      if (sys.size) await t.teamSystems.insertMany([...sys].map(systemId => ({ teamId: team.id, systemId })));
      // Open tasks for people who left the team, or on systems the team no longer covers, are withdrawn
      const open = await t.tasks.find({ teamId: team.id, status: ['todo', 'doing'] });
      const gone = open.filter(x => !want.has(x.assigneeId) || !sys.has(x.systemId)).map(x => x.id);
      if (gone.length) await t.tasks.remove({ id: gone });
    });
    await audit({ orgId: team.orgId, userId: v.id, action: 'team.updated', detail: { title: name } });
    revalidatePath('/', 'layout');
    return { ok: 'Team saved.' };
  } catch (e) { return fail(e); }
}

export async function deleteTeam(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const team = await db.teams.first({ id: String(fd.get('teamId') || '') });
    if (!team) return { error: 'Team not found.' };
    await teamOrg(v, team.orgId);
    await db.tx(async t => {
      await t.tasks.remove({ teamId: team.id, status: ['todo', 'doing'] });
      await t.tasks.update({ teamId: team.id }, { teamId: null });
      await t.teamMembers.remove({ teamId: team.id });
      await t.teamSystems.remove({ teamId: team.id });
      await t.teams.remove({ id: team.id });
    });
    await audit({ orgId: team.orgId, userId: v.id, action: 'team.deleted', detail: { title: team.name } });
    revalidatePath('/', 'layout');
    return { ok: 'Team deleted.' };
  } catch (e) { return fail(e); }
}

/* ---------- AI spend budgets ---------- */

export async function saveBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can set budgets.' };
    const scope = String(fd.get('scope') || 'global');
    if (scope !== 'global' && !(await db.organizations.first({ id: scope }))) return { error: 'Choose a client.' };
    const usd = Number(String(fd.get('monthly') || '').replace(/[,$£\s]/g, ''));
    if (!Number.isFinite(usd) || usd <= 0 || usd > 10_000_000) return { error: 'Enter a monthly budget in US dollars.' };
    const alertPct = Math.min(100, Math.max(10, Math.round(Number(fd.get('alertPct')) || 80)));
    const row = { monthlyCents: Math.round(usd * 100), alertPct, hardStop: fd.get('hardStop') === 'on', updatedById: v.id, updatedAt: new Date(), alertedMonth: null, alertedLevel: 0 };
    if (await db.spendBudgets.first({ scope })) await db.spendBudgets.update({ scope }, row);
    else await db.spendBudgets.insert({ scope, ...row });
    await audit({ orgId: scope === 'global' ? null : scope, userId: v.id, action: 'spend.budget', detail: { title: `Monthly AI budget $${usd.toFixed(2)}${row.hardStop ? ', hard stop' : ''}` } });
    revalidatePath('/admin/spend');
    return { ok: 'Budget saved.' };
  } catch (e) { return fail(e); }
}

export async function removeBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can remove budgets.' };
    await db.spendBudgets.remove({ scope: String(fd.get('scope') || '') });
    revalidatePath('/admin/spend');
    return { ok: 'Budget removed.' };
  } catch (e) { return fail(e); }
}

/** Makes a one-time sign-in link for a user, for installations without a mail server. Shown once to the admin. */
export async function issueSignInLink(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    if (v.role !== 'ITUTI_ADMIN') return { error: 'Only Ituti admins can issue sign-in links.' };
    const email = z.string().trim().toLowerCase().email().parse(fd.get('email'));
    const user = await db.users.first({ email });
    if (!user) return { error: 'No user has that address. Invite them first.' };
    if (user.disabled) return { error: 'That account is disabled.' };
    const link = await makeSignInLink(email, 60);
    await audit({ userId: v.id, action: 'user.signin_link', detail: { title: `One-time sign-in link for ${email}` } });
    return { ok: `Give this link to ${email} privately. It works once, within 60 minutes: ${link}` };
  } catch (e) { return fail(e); }
}

/* ---------- OAuth approval for MCP clients ---------- */

export async function decideOAuth(fd: FormData) {
  const v = await getViewer();
  if (!v) redirect('/login');
  const { checkAuthorize, issueCode } = await import('@/lib/oauth');
  const q = new URLSearchParams(String(fd.get('query') || ''));
  const check = await checkAuthorize(q);
  if ('fatal' in check) throw new Error(check.fatal);
  if ('redirect' in check) redirect(check.redirect);
  const a = check.ok;
  if (fd.get('decision') !== 'allow') {
    const u = new URL(a.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (a.state) u.searchParams.set('state', a.state);
    redirect(u.toString());
  }
  const orgId = String(fd.get('orgId') || '');
  const caps = await capsFor(v, orgId);
  if (!caps.view) throw new Error('You cannot open that organisation.');
  const url = await issueCode(a, v.id, orgId);
  await audit({ orgId, userId: v.id, action: 'oauth.approved', detail: { title: `Connected ${a.client.name}` } });
  redirect(url);
}

export async function revokeConnectedApp(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const v = await viewerOrError();
    const familyId = String(fd.get('familyId') || '');
    const g = await db.oauthGrants.first({ familyId });
    if (!g) return { ok: 'Already disconnected.' };
    const caps = await capsFor(v, g.orgId);
    if (g.userId !== v.id && !caps.manage) return { error: 'You cannot disconnect this application.' };
    const { revokeFamily } = await import('@/lib/oauth');
    await revokeFamily(familyId);
    await audit({ orgId: g.orgId, userId: v.id, action: 'oauth.revoked', detail: { title: 'Disconnected an application' } });
    revalidatePath('/', 'layout');
    return { ok: 'Disconnected.' };
  } catch (e) { return fail(e); }
}
