'use client';
import { useActionState, useEffect, useRef } from 'react';
import { signIn } from 'next-auth/react';
import { registerClient, type RegisterState } from './actions';

export function RegisterForm() {
  const [state, action, pending] = useActionState<RegisterState, FormData>(registerClient, null);
  const sent = useRef('');
  useEffect(() => {
    if (state?.email && sent.current !== state.email) {
      sent.current = state.email;
      signIn('email', { email: state.email, callbackUrl: '/' });
    }
  }, [state]);
  const busy = pending || !!state?.email;
  return (
    <form action={action} style={{ display: 'grid', gap: 12 }}>
      {state?.error && <p className="err" role="alert">{state.error}</p>}
      <label className="field"><span>Your name</span><input name="name" id="name" required autoComplete="name" maxLength={120} /></label>
      <label className="field"><span>Work email</span><input type="email" name="email" id="email" required autoComplete="email" maxLength={254} /></label>
      <label className="field"><span>Organisation</span><input name="orgName" id="orgName" required autoComplete="organization" maxLength={120} /></label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
        <input type="checkbox" name="terms" required style={{ marginTop: 3 }} />
        <span>I am authorised to register my organisation, and I understand that Ituti will review the sign-up before AI assistance is switched on.</span>
      </label>
      <button className="btn primary" disabled={busy}>{busy ? 'Sending your link…' : 'Create account'}</button>
    </form>
  );
}
