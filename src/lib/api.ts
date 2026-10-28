import { NextResponse } from 'next/server';
import { db } from '@/data';
import { getViewer, systemAccess, type Viewer } from './session';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export const err = (status: number, error: string) => json({ error }, status);

/** Rejects cross-site uploads: the Origin header, when present, must be this app's own. */
export function sameOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  const expected = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : null;
  if (!origin) return 'Missing origin.';
  if (expected && origin !== expected) return 'Cross-site request refused.';
  return null;
}

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
  const open = await db.incidents.count({ systemId, kind: 'incident', status: ['open', 'investigating', 'mitigated'] });
  await db.aiSystems.update({ id: systemId, openIncidents: { ne: open } }, { openIncidents: open });
  return open;
}

/** The client organisation for an API or download route, when the signed-in person may view it. */
export async function orgForApi(slug: string) {
  const v = await getViewer();
  if (!v) return null;
  const org = await db.organizations.first({ slug });
  if (!org) return null;
  const { capsFor } = await import('./session');
  const caps = await capsFor(v, org.id);
  return caps.view ? { viewer: v, org, caps } : null;
}

/** A CSV download; cells that could be read as formulas are neutralised. */
export function csvResponse(filename: string, header: string[], rows: unknown[][]) {
  const q = (x: unknown) => { let s = String(x ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const body = [header, ...rows].map(r => r.map(q).join(',')).join('\r\n');
  return new Response('﻿' + body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
}
