import Link from 'next/link';
import { Brand } from './Brand';
import { SignOut } from './SignOut';
import { ROLE_LABEL } from '@/lib/permissions';
import type { Viewer } from '@/lib/session';

export function TopBar({ viewer, current }: { viewer: Viewer; current?: 'clients' | 'team' }) {
  const staff = viewer.role !== 'CLIENT';
  return (
    <header className="top">
      <div className="wrap">
        <Brand />
        {staff && (
          <nav aria-label="Main">
            <Link href="/admin" aria-current={current === 'clients' ? 'page' : undefined}>Clients</Link>
            {viewer.role === 'ITUTI_ADMIN' && <Link href="/admin/team" aria-current={current === 'team' ? 'page' : undefined}>Ituti team</Link>}
          </nav>
        )}
        <div className="spacer" />
        <div className="who"><span>{viewer.name || viewer.email}</span>{staff && <span className="rolechip">{ROLE_LABEL[viewer.role]}</span>}</div>
        <SignOut />
      </div>
    </header>
  );
}
