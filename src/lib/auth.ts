import type { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import { db } from '@/data';
import { csvAdapter } from './auth-adapter';
import { sendActionEmail } from './mail';

const normalise = (e: string) => e.trim().toLowerCase();
export const bootstrapEmail = () => normalise(process.env.BOOTSTRAP_ADMIN_EMAIL || '');

/** Only existing users, people with a pending invitation, or the bootstrap admin may request a sign-in link. */
export async function mayRequestSignIn(email: string) {
  const e = normalise(email);
  if (!e) return false;
  if (e === bootstrapEmail()) return true;
  const user = db.users.first(u => u.email === e);
  if (user) return !user.disabled;
  const now = Date.now();
  return !!db.invitations.first(i => i.email === e && !i.acceptedAt && !i.revokedAt && i.expiresAt.getTime() > now);
}

export const authOptions: NextAuthOptions = {
  adapter: csvAdapter(),
  session: { strategy: 'database', maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: '/login', verifyRequest: '/login/check-email', error: '/login' },
  providers: [
    EmailProvider({
      maxAge: 15 * 60,
      normalizeIdentifier: normalise,
      async sendVerificationRequest({ identifier, url }) {
        await sendActionEmail({
          to: identifier,
          subject: 'Your sign-in link for Ituti AI Assurance',
          heading: 'Sign in to Ituti AI Assurance',
          body: 'Use the button below to sign in. The link works once and expires in 15 minutes. If you did not ask to sign in, you can ignore this email.',
          action: 'Sign in',
          url,
        });
      },
    }),
  ],
  callbacks: {
    async signIn({ user, email }) {
      const address = normalise(user.email || '');
      if (email?.verificationRequest) return mayRequestSignIn(address);
      const existing = db.users.first(u => u.email === address);
      if (existing?.disabled) return false;
      return true;
    },
    async session({ session, user }) {
      const u = user as unknown as { id: string; role: string };
      if (session.user) {
        (session.user as Record<string, unknown>).id = u.id;
        (session.user as Record<string, unknown>).role = u.role;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.email && normalise(user.email) === bootstrapEmail()) {
        await db.users.update(u => u.id === user.id, { role: 'ITUTI_ADMIN' });
      }
    },
  },
};
