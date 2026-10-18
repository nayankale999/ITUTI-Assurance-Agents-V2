import { db } from '@/data';

const FOLD_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 20_000;

/** Records an action. Repeated saves of one system by one person within 10 minutes fold into one entry. */
export async function audit(entry: { orgId?: string | null; systemId?: string | null; userId?: string | null; action: string; detail?: Record<string, unknown> }) {
  try {
    await db.auditLog.mutate(rows => {
      const now = new Date();
      if (entry.action === 'system.updated' && entry.systemId && entry.userId) {
        const i = rows.findLastIndex(r => r.systemId === entry.systemId && r.userId === entry.userId && r.action === 'system.updated' && now.getTime() - r.updatedAt.getTime() < FOLD_MS);
        if (i >= 0) {
          const prev = (rows[i].detail as { sections?: string[] } | null)?.sections || [];
          const next = (entry.detail as { sections?: string[] } | undefined)?.sections || [];
          const out = [...rows];
          out[i] = { ...rows[i], updatedAt: now, detail: { sections: [...new Set([...prev, ...next])] } };
          return { rows: out, result: null };
        }
      }
      const row = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, orgId: entry.orgId ?? null, systemId: entry.systemId ?? null, userId: entry.userId ?? null, action: entry.action, detail: entry.detail ?? null };
      // Keep the file bounded: drop the oldest entries beyond the cap
      const out = [...rows, row];
      return { rows: out.length > MAX_ENTRIES ? out.slice(out.length - MAX_ENTRIES) : out, result: null };
    });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
