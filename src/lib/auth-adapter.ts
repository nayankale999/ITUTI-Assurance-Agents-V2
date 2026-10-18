/* Minimal NextAuth v4 adapter for email sign-in with database sessions, on Drizzle. */
import type { Adapter, AdapterUser, AdapterSession, AdapterAccount, VerificationToken } from 'next-auth/adapters';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

const toUser = (u: typeof schema.users.$inferSelect): AdapterUser =>
  ({ id: u.id, email: u.email, emailVerified: u.emailVerified, name: u.name, image: u.image, role: u.role } as AdapterUser);

export function drizzleAdapter(): Adapter {
  return {
    async createUser(data: Omit<AdapterUser, 'id'>) {
      const [u] = await db.insert(schema.users).values({ email: data.email.toLowerCase(), name: data.name ?? null, image: data.image ?? null, emailVerified: data.emailVerified ?? null }).returning();
      return toUser(u);
    },
    async getUser(id) {
      const u = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
      return u ? toUser(u) : null;
    },
    async getUserByEmail(email) {
      const u = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase()) });
      return u ? toUser(u) : null;
    },
    async getUserByAccount() {
      return null; // email sign-in only; no linked OAuth accounts
    },
    async updateUser(data) {
      const [u] = await db.update(schema.users).set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
        ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
      }).where(eq(schema.users.id, data.id!)).returning();
      return toUser(u);
    },
    async linkAccount(account: AdapterAccount) {
      return account;
    },
    async createSession(data) {
      const [s] = await db.insert(schema.sessions).values({ sessionToken: data.sessionToken, userId: data.userId, expires: data.expires }).returning();
      return s as AdapterSession;
    },
    async getSessionAndUser(sessionToken) {
      const s = await db.query.sessions.findFirst({ where: eq(schema.sessions.sessionToken, sessionToken) });
      if (!s) return null;
      const u = await db.query.users.findFirst({ where: eq(schema.users.id, s.userId) });
      if (!u) return null;
      return { session: s as AdapterSession, user: toUser(u) };
    },
    async updateSession(data) {
      const [s] = await db.update(schema.sessions).set({ ...(data.expires ? { expires: data.expires } : {}) }).where(eq(schema.sessions.sessionToken, data.sessionToken)).returning();
      return (s as AdapterSession) ?? null;
    },
    async deleteSession(sessionToken) {
      await db.delete(schema.sessions).where(eq(schema.sessions.sessionToken, sessionToken));
    },
    async createVerificationToken(data) {
      await db.insert(schema.verificationTokens).values(data);
      return data;
    },
    async useVerificationToken({ identifier, token }) {
      const [t] = await db.delete(schema.verificationTokens)
        .where(and(eq(schema.verificationTokens.identifier, identifier), eq(schema.verificationTokens.token, token)))
        .returning();
      return (t as VerificationToken) ?? null;
    },
  };
}
