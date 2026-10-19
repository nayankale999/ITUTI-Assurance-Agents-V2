'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function OrgNav({ slug, showPeople }: { slug: string; showPeople: boolean }) {
  const path = usePathname();
  const base = `/o/${slug}`;
  const items: [string, string][] = [
    [base, 'AI inventory'], [`${base}/risk`, 'Risk management'], [`${base}/incidents`, 'Incident tracker'], [`${base}/documents`, 'Documents'],
    ...(showPeople ? [[`${base}/people`, 'People'], [`${base}/activity`, 'Activity']] as [string, string][] : []),
  ];
  if (path.includes('/systems/')) return null;
  const current = (href: string) => (href === base ? path === base : path.startsWith(href));
  return (
    <nav className="subnav" aria-label="Client">
      {items.map(([href, label]) => <Link key={href} href={href} aria-current={current(href) ? 'page' : undefined}>{label}</Link>)}
    </nav>
  );
}
