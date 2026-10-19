import Link from 'next/link';
import { PrintButton } from './PrintButton';

/** A printable document page: a back link and print button on screen, the document itself on paper. */
export function DocShell({ back, backLabel, kind, org, title, subtitle, children }: { back: string; backLabel: string; kind: string; org: string; title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <>
      <div className="doc-bar no-print"><Link href={back}>&larr; {backLabel}</Link><PrintButton label="Download as PDF" /></div>
      <article className="doc">
        <p className="ref">{kind.toUpperCase()} · {date} · {org}</p>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        <p className="muted" style={{ marginTop: 32, fontSize: 12 }}>Prepared with Ituti AI Assurance from the record kept for each system. Classifications and scores are computed from the answers recorded and are not legal advice.</p>
      </article>
    </>
  );
}
