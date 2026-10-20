'use client';
import { useRouter } from 'next/navigation';
import { saveBeforeLeaving } from '@/lib/resume';

/** The logo: saves any open work, then goes to the home page. */
export function HomeLink({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <a className="brand" href="/" aria-label="Ituti AI Assurance home" onClick={async e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      await saveBeforeLeaving();
      router.push('/');
      router.refresh();
    }}>{children}</a>
  );
}
