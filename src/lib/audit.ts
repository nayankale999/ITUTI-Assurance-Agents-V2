import { db } from '@/data';

const FOLD_MS = 10 * 60 * 1000;

/** Records an action. Repeated saves of one system by one person within 10 minutes fold into one entry. */
export async function audit(entry: { orgId?: string | null; systemId?: string | null; userId?: string | null; action: string; detail?: Record<string, unknown> }) {
  try {
    const now = new Date();
    if (entry.action === 'system.updated' && entry.systemId && entry.userId) {
      const folded = await db.tx(async t => {
        const prev = await t.auditLog.first(
          { systemId: entry.systemId, userId: entry.userId, action: 'system.updated', updatedAt: { gt: new Date(now.getTime() - FOLD_MS) } },
          { orderBy: [['updatedAt', 'desc']], forUpdate: true },
        );
        if (!prev) return false;
        const a = (prev.detail as { sections?: string[] } | null)?.sections || [];
        const b = (entry.detail as { sections?: string[] } | undefined)?.sections || [];
        await t.auditLog.update({ id: prev.id }, { updatedAt: now, detail: { sections: [...new Set([...a, ...b])] } });
        return true;
      });
      if (folded) return;
    }
    await db.auditLog.insert({ orgId: entry.orgId ?? null, systemId: entry.systemId ?? null, userId: entry.userId ?? null, action: entry.action, detail: entry.detail ?? null, createdAt: now, updatedAt: now });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
