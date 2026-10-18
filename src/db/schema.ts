import { pgTable, pgEnum, text, timestamp, boolean, integer, jsonb, primaryKey, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

const id = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const created = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Platform-wide role. Ituti staff are ITUTI_ADMIN or ITUTI_ASSESSOR; everyone else is CLIENT. */
export const userRole = pgEnum('user_role', ['ITUTI_ADMIN', 'ITUTI_ASSESSOR', 'CLIENT']);
/** Role of a client user inside one client organisation. */
export const orgRole = pgEnum('org_role', ['CLIENT_ADMIN', 'CONTRIBUTOR', 'VIEWER']);

export const users = pgTable('users', {
  id: id(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image: text('image'),
  role: userRole('role').notNull().default('CLIENT'),
  disabled: boolean('disabled').notNull().default(false),
  createdAt: created(),
});

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
}, t => [index('sessions_user_idx').on(t.userId)]);

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.identifier, t.token] })]);

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: created(),
});

export const memberships = pgTable('memberships', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: orgRole('role').notNull(),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.orgId] }), index('memberships_org_idx').on(t.orgId)]);

/** An Ituti assessor's access to a client organisation. */
export const assessorAssignments = pgTable('assessor_assignments', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.orgId] })]);

export const aiSystems = pgTable('ai_systems', {
  id: id(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** profile, cls, ctrl, card, metrics, aiReview */
  data: jsonb('data').notNull(),
  tier: text('tier').notNull().default('unknown'),
  riskScore: integer('risk_score'),
  readiness: integer('readiness').notNull().default(0),
  openIncidents: integer('open_incidents').notNull().default(0),
  version: integer('version').notNull().default(1),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  updatedById: text('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('ai_systems_org_idx').on(t.orgId)]);

/** Which AI systems a client contributor may edit. */
export const systemAssignments = pgTable('system_assignments', {
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  systemId: text('system_id').notNull().references(() => aiSystems.id, { onDelete: 'cascade' }),
  createdAt: created(),
}, t => [primaryKey({ columns: [t.userId, t.systemId] })]);

export const incidents = pgTable('incidents', {
  id: id(),
  systemId: text('system_id').notNull().references(() => aiSystems.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  date: text('date').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  status: text('status').notNull().default('open'),
  serious: boolean('serious').notNull().default(false),
  notes: text('notes').notNull().default(''),
  createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('incidents_system_idx').on(t.systemId)]);

/** role holds a client role (org_id set) or an Ituti staff role (org_id null). Only a hash of the token is stored. */
export const invitations = pgTable('invitations', {
  id: id(),
  email: text('email').notNull(),
  orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedById: text('invited_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: created(),
}, t => [uniqueIndex('invitations_token_idx').on(t.tokenHash), index('invitations_email_idx').on(t.email), index('invitations_org_idx').on(t.orgId)]);

export const auditLog = pgTable('audit_log', {
  id: id(),
  orgId: text('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  systemId: text('system_id'),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  detail: jsonb('detail'),
  createdAt: created(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('audit_org_idx').on(t.orgId, t.createdAt), index('audit_system_idx').on(t.systemId, t.createdAt)]);

export type User = typeof users.$inferSelect;
export type Org = typeof organizations.$inferSelect;
export type AiSystemRow = typeof aiSystems.$inferSelect;
export type IncidentRow = typeof incidents.$inferSelect;
