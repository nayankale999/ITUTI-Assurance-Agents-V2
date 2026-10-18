/* A2A tasks are kept in the database, so any app process can answer tasks/get, and are scoped to the
 * client whose API key created them: one client can never read another's tasks. */
import type { Task } from '@a2a-js/sdk';
import type { TaskStore, User, ServerCallContext } from '@a2a-js/sdk/server';
import { db, type Org } from '@/data';

export class OrgUser implements User {
  constructor(readonly org: Org, readonly keyPrefix: string) {}
  get isAuthenticated() { return true; }
  get userName() { return `${this.org.slug}:${this.keyPrefix}`; }
}

export const orgOf = (ctx?: ServerCallContext): Org | null => (ctx?.user instanceof OrgUser ? ctx.user.org : null);

export class DbTaskStore implements TaskStore {
  async save(task: Task, ctx?: ServerCallContext) {
    const org = orgOf(ctx);
    if (!org) throw new Error('No client for this task.');
    const now = new Date();
    // Keep the stored history short: long conversations live in a2a_contexts
    const slim = { ...task, history: (task.history || []).slice(-20) };
    await db.tx(async t => {
      const cur = await t.a2aTasks.first({ id: task.id }, { forUpdate: true });
      if (cur && cur.orgId !== org.id) throw new Error('Task belongs to another client.');
      if (cur) await t.a2aTasks.update({ id: task.id }, { task: slim, updatedAt: now });
      else await t.a2aTasks.insert({ id: task.id, orgId: org.id, contextId: task.contextId, task: slim, createdAt: now, updatedAt: now });
    });
  }

  async load(taskId: string, ctx?: ServerCallContext): Promise<Task | undefined> {
    const org = orgOf(ctx);
    if (!org) return undefined;
    const row = await db.a2aTasks.first({ id: String(taskId).slice(0, 64), orgId: org.id });
    return (row?.task as Task) || undefined;
  }
}
