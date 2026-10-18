/* NextAuth v4 adapter for email sign-in with database-style sessions. */
import type { Adapter, AdapterUser, AdapterSession, AdapterAccount, VerificationToken } from 'next-auth/adapters';
import { db, type User } from '@/data';

const toUser = (u: User): AdapterUser =>
  ({ id: u.id, email: u.email, emailVerified: u.emailVerified, name: u.name, image: u.image, role: u.role } as AdapterUser);

export function dbAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, 'id'>) {
      const email = data.email.toLowerCase();
      const u = await db.tx(async t => {
        const existing = await t.users.first({ email }, { forUpdate: true });
        if (existing) return existing;
        const created: User = { id: crypto.randomUUID(), email, name: data.name ?? null, image: data.image ?? null, emailVerified: data.emailVerified ?? null, role: 'CLIENT', disabled: false, createdAt: new Date() };
        return t.users.insert(created);
      });
      return toUser(u);
    },
    async getUser(id) {
      const u = await db.users.first({ id });
      return u ? toUser(u) : null;
    },
    async getUserByEmail(email) {
      const e = email.toLowerCase();
      const u = await db.users.first({ email: e });
      return u ? toUser(u) : null;
    },
    async getUserByAccount() {
      return null; // email sign-in only; no linked OAuth accounts
    },
    async updateUser(data) {
      const [u] = await db.users.update({ id: data.id }, {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
      });
      return toUser(u);
    },
    async linkAccount(account: AdapterAccount) {
      return account;
    },
    async createSession(data) {
      const now = Date.now();
      const s = { sessionToken: data.sessionToken, userId: data.userId, expires: data.expires };
      // Store the new session and drop expired ones in the same write
      await db.sessions.remove({ expires: { lt: new Date(now) } });
      await db.sessions.insert(s);
      return s as AdapterSession;
    },
    async getSessionAndUser(sessionToken) {
      const s = await db.sessions.first({ sessionToken });
      if (!s) return null;
      const u = await db.users.first({ id: s.userId });
      if (!u) return null;
      return { session: s as AdapterSession, user: toUser(u) };
    },
    async updateSession(data) {
      const s = await db.sessions.first({ sessionToken: data.sessionToken });
      if (!s) return null;
      if (!data.expires || Math.abs(data.expires.getTime() - s.expires.getTime()) < 60 * 60 * 1000) return s as AdapterSession; // avoid a write on every page view
      const [u] = await db.sessions.update({ sessionToken: data.sessionToken }, { expires: data.expires });
      return (u as AdapterSession) ?? null;
    },
    async deleteSession(sessionToken) {
      await db.sessions.remove({ sessionToken });
    },
    async createVerificationToken(data) {
      const now = Date.now();
      await db.verificationTokens.remove({ expires: { lt: new Date(now) } });
      await db.verificationTokens.insert(data);
      return data;
    },
    async useVerificationToken({ identifier, token }) {
      const [t] = await db.verificationTokens.remove({ identifier, token });
      return (t as VerificationToken) ?? null;
    },
  };
}
