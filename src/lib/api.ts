import { NextResponse } from 'next/server';
import { db } from '@/data';
import { getViewer, systemAccess, type Viewer } from './session';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const err = (status: number, error: string) => json({ error }, status);

/** Rejects cross-site writes: mutating requests must be JSON from this app's own origin. */
export function sameOriginJson(req: Request): string | null {
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return 'Requests must be JSON.';
  const origin = req.headers.get('origin');
  const expected = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  if (origin && expected && origin !== expected) return 'Cross-site request refused.';
  return null;
}

export async function apiViewer(): Promise<Viewer | null> {
  return getViewer();
}

export async function loadSystem(viewer: Viewer, id: string) {
  return systemAccess(viewer, id);
}

/** Recomputes the open-incident count for a system. */
export async function refreshIncidentCount(systemId: string) {
  const open = await db.incidents.count({ systemId, status: { ne: 'closed' } });
  await db.aiSystems.update({ id: systemId, openIncidents: { ne: open } }, { openIncidents: open });
  return open;
}
