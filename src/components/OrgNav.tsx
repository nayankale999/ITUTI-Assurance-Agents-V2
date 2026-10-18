'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function OrgNav({ slug, showPeople }: { slug: string; showPeople: boolean }) {
  const path = usePathname();
  const base = `/o/${slug}`;
  const items: [string, string][] = [[base, 'AI systems'], ...(showPeople ? [[`${base}/people`, 'People'], [`${base}/activity`, 'Activity']] as [string, string][] : [])];
  if (path.includes('/systems/')) return null;
  return (
    <nav className="subnav" aria-label="Client">
      {items.map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}
    </nav>
  );
}
