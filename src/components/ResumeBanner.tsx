'use client';
/* "Continue where you left off": the system and tab this person last worked on, in this browser. */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { lastPlace, forget, type Place } from '@/lib/resume';

const TAB_LABEL: Record<string, string> = {
  agent: 'Evidence and agent', profile: 'Profile', classify: 'Classification', controls: 'Controls', conformity: 'Conformity',
  report: 'Report', card: 'Model card', monitor: 'Monitoring', team: 'Team',
};

export function ResumeBanner({ slug, systemIds }: { slug?: string; systemIds: string[] }) {
  const [p, setP] = useState<Place | null>(null);
  useEffect(() => {
    const last = lastPlace(slug);
    if (last && !systemIds.includes(last.systemId)) { forget(last.systemId); return; }
    if (last && Date.now() - last.at < 30 * 864e5) setP(last);
  }, [slug, systemIds]);
  if (!p) return null;
  return (
    <div className="resume" role="status">
      <span>Continue where you left off: <b>{p.name}</b>, {TAB_LABEL[p.tab] || p.tab} tab{p.tab === 'conformity' && p.part ? ` (${({ org: 'organisational', project: 'project', tech: 'technical' } as Record<string, string>)[p.part] || p.part} part)` : ''}. Your changes were saved.</span>
      <Link className="btn primary" href={`/o/${p.slug}/systems/${p.systemId}?tab=${p.tab}`}>Continue</Link>
      <button type="button" className="linkish" onClick={() => setP(null)}>Dismiss</button>
    </div>
  );
}
