import { and, desc, eq, gt } from 'drizzle-orm';
import { db, schema } from '@/db';

/** Records an action. Repeated saves of one system by one person within 10 minutes fold into one entry. */
export async function audit(entry: { orgId?: string | null; systemId?: string | null; userId?: string | null; action: string; detail?: Record<string, unknown> }) {
  try {
    const a = schema.auditLog;
    if (entry.action === 'system.updated' && entry.systemId && entry.userId) {
      const recent = await db.query.auditLog.findFirst({
        where: and(eq(a.systemId, entry.systemId), eq(a.userId, entry.userId), eq(a.action, 'system.updated'), gt(a.updatedAt, new Date(Date.now() - 10 * 60 * 1000))),
        orderBy: desc(a.updatedAt),
      });
      if (recent) {
        const prev = (recent.detail as { sections?: string[] } | null)?.sections || [];
        const next = (entry.detail as { sections?: string[] } | undefined)?.sections || [];
        await db.update(a).set({ updatedAt: new Date(), detail: { sections: [...new Set([...prev, ...next])] } }).where(eq(a.id, recent.id));
        return;
      }
    }
    await db.insert(a).values({ orgId: entry.orgId ?? null, systemId: entry.systemId ?? null, userId: entry.userId ?? null, action: entry.action, detail: entry.detail ?? null });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
