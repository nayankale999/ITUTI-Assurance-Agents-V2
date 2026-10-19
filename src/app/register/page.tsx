import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthBrand, AuthFoot } from '@/components/Brand';
import { getViewer } from '@/lib/session';
import { registrationOpen } from '@/lib/registration';
import { RegisterForm } from './RegisterForm';

export const metadata = { title: 'Create an account' };

export default async function RegisterPage() {
  if (await getViewer()) redirect('/');
  const open = registrationOpen();
  return (
    <main className="auth">
      <AuthBrand />
      <section className="panel">
        <header><h2>Create an account</h2></header>
        <div className="body">
          {open ? <>
            <p className="muted">Set up a private workspace for your organisation&rsquo;s AI systems. We will email you a one-time link to confirm your address; following it creates the workspace with you as its admin. You can then invite colleagues.</p>
            <RegisterForm />
          </> : <p className="muted">Accounts are by invitation. Ask your Ituti contact or your organisation&rsquo;s admin to invite you.</p>}
          <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>Already have an account? <Link href="/login">Sign in</Link></p>
        </div>
      </section>
      <AuthFoot />
    </main>
  );
}
