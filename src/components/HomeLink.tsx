'use client';
import { saveBeforeLeaving } from '@/lib/resume';

/** The logo: saves any open work, then loads the home page afresh. */
export function HomeLink({ children }: { children: React.ReactNode }) {
  return (
    <a className="brand" href="/" aria-label="Ituti AI Assurance home" onClick={async e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      await saveBeforeLeaving();
      // A full page load always lands on the home page with up-to-date figures
      window.location.assign('/');
    }}>{children}</a>
  );
}
