'use client';
/* Remembers where each person was working (system, tab, sub-section and scroll position) in this browser, so
 * they can carry on from the same place, and lets open editors save before the app navigates away. */

export type Place = { slug: string; systemId: string; name: string; tab: string; part?: string; scroll?: number; at: number };
const KEY = 'ituti.resume.v1';

function read(): Record<string, Place> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export function remember(p: Omit<Place, 'at'>) {
  try {
    const all = read();
    all[p.systemId] = { ...all[p.systemId], ...p, at: Date.now() };
    // Keep the 30 most recent systems
    const keep = Object.values(all).sort((a, b) => b.at - a.at).slice(0, 30);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep.map(x => [x.systemId, x]))));
  } catch { /* storage unavailable: nothing to remember */ }
}

export function placeFor(systemId: string): Place | null { return read()[systemId] || null; }

export function lastPlace(slug?: string): Place | null {
  const list = Object.values(read()).filter(p => !slug || p.slug === slug).sort((a, b) => b.at - a.at);
  return list[0] || null;
}

export function forget(systemId: string) {
  try { const all = read(); delete all[systemId]; localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

/* Editors register a save function; anything that navigates away first waits for them (up to a few seconds). */
type Saver = () => Promise<unknown>;
const savers = new Set<Saver>();
export function onLeave(fn: Saver) { savers.add(fn); return () => { savers.delete(fn); }; }
export async function saveBeforeLeaving() {
  if (!savers.size) return;
  await Promise.race([Promise.allSettled([...savers].map(f => f())), new Promise(r => setTimeout(r, 4000))]);
}
