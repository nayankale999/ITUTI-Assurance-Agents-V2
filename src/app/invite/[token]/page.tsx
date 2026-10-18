import { AuthBrand, AuthFoot } from '@/components/Brand';
import Link from 'next/link';
import { db } from '@/data';
import { getViewer } from '@/lib/session';
import { hashToken } from '@/lib/tokens';
import { ROLE_LABEL } from '@/lib/permissions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { acceptInvite } from '@/app/actions';
import { SignOut } from '@/components/SignOut';

export const metadata = { title: 'Invitation' };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hash = hashToken(token);
  const invite = db.invitations.first(i => i.tokenHash === hash);
  const valid = invite && !invite.revokedAt && !invite.acceptedAt && invite.expiresAt > new Date();
  const org = invite?.orgId ? db.organizations.first(o => o.id === invite.orgId) ?? null : null;
  const viewer = await getViewer();
  const where = org ? org.name : 'the Ituti team';
  return (
    <main className="auth">
      <AuthBrand />
      <section className="panel">
        <header><h2>{valid ? `Join ${where}` : 'Invitation unavailable'}</h2></header>
        <div className="body">
          {!valid ? (
            <p>This invitation has expired, was revoked or has already been used. Ask the person who invited you to send a new one.</p>
          ) : !viewer ? (<>
            <p>You have been invited to Ituti AI Assurance as <b>{ROLE_LABEL[invite.role].toLowerCase()}</b>{org ? <> for <b>{org.name}</b></> : null}.</p>
            <p className="muted">Sign in with <b>{invite.email}</b> to accept.</p>
            <Link className="btn primary" href={`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(invite.email)}`}>Sign in to accept</Link>
          </>) : viewer.email.toLowerCase() !== invite.email ? (<>
            <p>This invitation is for <b>{invite.email}</b>, but you are signed in as <b>{viewer.email}</b>.</p>
            <SignOut />
          </>) : (<>
            <p>Accept to join {where} as <b>{ROLE_LABEL[invite.role].toLowerCase()}</b>.</p>
            <ActionForm action={acceptInvite} style={{ display: 'grid', gap: 10 }}>
              <input type="hidden" name="token" value={token} />
              <Submit className="btn primary">Accept invitation</Submit>
            </ActionForm>
          </>)}
        </div>
      </section>
    <AuthFoot />
    </main>
  );
}
