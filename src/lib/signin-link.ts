/* One-time sign-in links made without email, for installations where no mail server is available yet (the
 * on-prem installer prints one for the first administrator) and for admins helping a colleague in. The token is
 * stored hashed exactly as NextAuth's email provider stores it, so the normal sign-in callback accepts it. */
import { createHash, randomBytes } from 'crypto';
import { db } from '@/data';

export function hashSignInToken(token: string, secret = process.env.NEXTAUTH_SECRET || '') {
  return createHash('sha256').update(`${token}${secret}`).digest('hex');
}

export async function makeSignInLink(email: string, minutes = 60) {
  const identifier = email.trim().toLowerCase();
  const token = randomBytes(32).toString('hex');
  await db.verificationTokens.insert({ identifier, token: hashSignInToken(token), expires: new Date(Date.now() + minutes * 60e3) });
  const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  return `${base}/api/auth/callback/email?${new URLSearchParams({ callbackUrl: `${base}/`, token, email: identifier })}`;
}
