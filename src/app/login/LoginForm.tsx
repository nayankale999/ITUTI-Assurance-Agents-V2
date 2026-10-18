'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export function LoginForm({ callbackUrl, defaultEmail }: { callbackUrl: string; defaultEmail: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const email = new FormData(e.currentTarget).get('email') as string;
        await signIn('email', { email, callbackUrl });
      }}
      style={{ display: 'grid', gap: 12 }}
    >
      <label className="field"><span>Work email</span><input type="email" name="email" id="email" required autoComplete="email" defaultValue={defaultEmail} /></label>
      <button className="btn primary" disabled={busy}>{busy ? 'Sending link…' : 'Email me a sign-in link'}</button>
    </form>
  );
}
