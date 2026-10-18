/* NextAuth v4 adapter for email sign-in with database-style sessions, on the CSV tables. */
import type { Adapter, AdapterUser, AdapterSession, AdapterAccount, VerificationToken } from 'next-auth/adapters';
import { db, type User } from '@/data';

const toUser = (u: User): AdapterUser =>
  ({ id: u.id, email: u.email, emailVerified: u.emailVerified, name: u.name, image: u.image, role: u.role } as AdapterUser);

export function csvAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, 'id'>) {
      const email = data.email.toLowerCase();
      const u = await db.users.mutate(rows => {
        const existing = rows.find(r => r.email === email);
        if (existing) return { rows: null, result: existing };
        const created: User = { id: crypto.randomUUID(), email, name: data.name ?? null, image: data.image ?? null, emailVerified: data.emailVerified ?? null, role: 'CLIENT', disabled: false, createdAt: new Date() };
        return { rows: [...rows, created], result: created };
      });
      return toUser(u);
    },
    async getUser(id) {
      const u = db.users.first(r => r.id === id);
      return u ? toUser(u) : null;
    },
    async getUserByEmail(email) {
      const e = email.toLowerCase();
      const u = db.users.first(r => r.email === e);
      return u ? toUser(u) : null;
    },
    async getUserByAccount() {
      return null; // email sign-in only; no linked OAuth accounts
    },
    async updateUser(data) {
      const [u] = await db.users.update(r => r.id === data.id, {
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
      await db.sessions.mutate(rows => ({ rows: [...rows.filter(r => r.expires.getTime() > now), s], result: null }));
      return s as AdapterSession;
    },
    async getSessionAndUser(sessionToken) {
      const s = db.sessions.first(r => r.sessionToken === sessionToken);
      if (!s) return null;
      const u = db.users.first(r => r.id === s.userId);
      if (!u) return null;
      return { session: s as AdapterSession, user: toUser(u) };
    },
    async updateSession(data) {
      const s = db.sessions.first(r => r.sessionToken === data.sessionToken);
      if (!s) return null;
      if (!data.expires || Math.abs(data.expires.getTime() - s.expires.getTime()) < 60 * 60 * 1000) return s as AdapterSession; // avoid a write on every page view
      const [u] = await db.sessions.update(r => r.sessionToken === data.sessionToken, { expires: data.expires });
      return (u as AdapterSession) ?? null;
    },
    async deleteSession(sessionToken) {
      await db.sessions.remove(r => r.sessionToken === sessionToken);
    },
    async createVerificationToken(data) {
      const now = Date.now();
      await db.verificationTokens.mutate(rows => ({ rows: [...rows.filter(r => r.expires.getTime() > now), data], result: null }));
      return data;
    },
    async useVerificationToken({ identifier, token }) {
      const [t] = await db.verificationTokens.remove(r => r.identifier === identifier && r.token === token);
      return (t as VerificationToken) ?? null;
    },
  };
}
