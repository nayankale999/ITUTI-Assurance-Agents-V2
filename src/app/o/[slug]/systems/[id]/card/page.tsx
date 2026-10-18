import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer, systemAccess } from '@/lib/session';
import { TIERS, classify, type AssessmentData } from '@/lib/assurance';
import { CARD_FIELDS, cardValue } from '@/lib/report';
import { PrintButton } from '@/components/PrintButton';

export const metadata = { title: 'Model card' };

export default async function Card({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const viewer = await requireViewer();
  const a = await systemAccess(viewer, id);
  if (!a || a.org.slug !== slug) notFound();
  const sys = a.system.data as AssessmentData;
  const p = sys.profile || {};
  const tier = TIERS[classify(sys).tier] || TIERS.unknown;
  return (
    <>
      <div className="doc-bar no-print"><Link href={`/o/${slug}/systems/${id}`}>&larr; Back to the system</Link><PrintButton /></div>
      <article className="doc">
        <p className="ref">MODEL CARD · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <h1>{p.name || 'Untitled system'}</h1>
        <p className="muted">{a.org.name}{p.version ? ` · version ${p.version}` : ''} · <span className={`pill t-${tier.tone}`}>{tier.label}</span></p>
        <dl style={{ marginTop: 20 }}>{CARD_FIELDS.map(([k, l]) => <div key={k} style={{ display: 'contents' }}><dt>{l}</dt><dd>{cardValue(sys, k) || <span className="muted">Not provided</span>}</dd></div>)}</dl>
        <p className="muted" style={{ marginTop: 32, fontSize: 12 }}>Prepared with Ituti AI Assurance.</p>
      </article>
    </>
  );
}
