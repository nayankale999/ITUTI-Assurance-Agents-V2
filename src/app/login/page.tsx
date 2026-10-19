import { AuthBrand, AuthFoot } from '@/components/Brand';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/session';
import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { registrationOpen } from '@/lib/registration';

export const metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  AccessDenied: 'That email address does not have an account yet. Create one below, or ask your organisation’s admin to invite you.',
  Verification: 'That sign-in link has expired or was already used. Request a new one.',
  EmailSignin: 'We could not send the sign-in email. Try again in a minute.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; callbackUrl?: string; email?: string }> }) {
  const sp = await searchParams;
  if (await getViewer()) redirect(sp.callbackUrl && sp.callbackUrl.startsWith('/') ? sp.callbackUrl : '/');
  const open = registrationOpen();
  let error = sp.error ? (ERRORS[sp.error] || 'Sign-in failed. Try again.') : null;
  if (sp.error === 'AccessDenied' && !open) error = 'That email address does not have access. Ask your Ituti contact or your organisation’s admin to invite you.';
  return (
    <main className="auth">
      <AuthBrand />
      <section className="panel">
        <header><h2>Sign in</h2></header>
        <div className="body">
          <p className="muted">Enter your work email and we will send you a one-time sign-in link.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <LoginForm callbackUrl={sp.callbackUrl && sp.callbackUrl.startsWith('/') ? sp.callbackUrl : '/'} defaultEmail={sp.email || ''} />
          {open && <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>New to Ituti AI Assurance? <Link href="/register">Create an account</Link></p>}
        </div>
      </section>
    <AuthFoot />
    </main>
  );
}
