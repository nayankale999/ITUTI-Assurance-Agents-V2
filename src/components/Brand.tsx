import Link from 'next/link';

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Home">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect x="1" y="1" width="28" height="28" rx="7" fill="var(--accent)" /><path d="M9 21V12M15 21V9M21 21v-6" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" /></svg>
      <span style={{ display: 'grid', textAlign: 'left' }}><b>Ituti AI Assurance</b><span className="sub">EU AI Act · UK · ISO 42001 · NIST</span></span>
    </Link>
  );
}
