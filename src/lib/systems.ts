/* Read-modify-write of a system's assessment in one transaction, so concurrent saves never lose each other's changes. */
import { db, type AiSystemRow } from '@/data';
import type { AssessmentData } from './assurance';
import { summarise } from './summary';

export type SaveOutcome = { gone: true } | { conflict: AiSystemRow } | { saved: AiSystemRow };

/** Applies change to the latest data. With expectVersion, refuses (conflict) when someone saved in between. */
export async function saveSystemData(id: string, userId: string, change: (data: AssessmentData) => AssessmentData, expectVersion?: number): Promise<SaveOutcome> {
  return db.tx(async t => {
    const cur = await t.aiSystems.first({ id }, { forUpdate: true });
    if (!cur) return { gone: true } as const;
    if (expectVersion !== undefined && cur.version !== expectVersion) return { conflict: cur };
    const data = change(cur.data as AssessmentData);
    const patch = { data, ...summarise(data), version: cur.version + 1, updatedById: userId, updatedAt: new Date() };
    await t.aiSystems.update({ id }, patch);
    return { saved: { ...cur, ...patch } };
  });
}
