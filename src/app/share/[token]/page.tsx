import { notFound } from 'next/navigation';
import { db } from '@/data';
import { hashToken } from '@/lib/tokens';
import { TIERS, classify, type AssessmentData } from '@/lib/assurance';
import { CARD_FIELDS, cardValue } from '@/lib/report';
import { PrintButton } from '@/components/PrintButton';

export const metadata = { title: 'Model card', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/* A model card shared by public link: read-only, no sign-in, and nothing beyond the card itself. */
export default async function SharedCard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) notFound();
  const link = await db.shares.first({ tokenHash: hashToken(token), revokedAt: null });
  if (!link) notFound();
  const sys = await db.aiSystems.first({ id: link.systemId });
  const org = sys ? await db.organizations.first({ id: sys.orgId }) : null;
  if (!sys || !org) notFound();
  await db.shares.update({ id: link.id }, { lastViewedAt: new Date() });
  const d = sys.data as AssessmentData;
  const p = d.profile || {};
  const tier = TIERS[classify(d).tier] || TIERS.unknown;
  return (
    <main className="wrap">
      <div className="doc-bar no-print"><span className="muted">Shared by {org.name} · read-only</span><PrintButton label="Download as PDF" /></div>
      <article className="doc">
        <p className="ref">MODEL CARD · {org.name} · updated {sys.updatedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <h1>{p.name || sys.name}</h1>
        <p className="muted">{p.version ? `Version ${p.version} · ` : ''}EU AI Act classification: <span className={`pill t-${tier.tone}`}>{tier.label}</span></p>
        <dl style={{ marginTop: 20 }}>{CARD_FIELDS.map(([k, l]) => <div key={k} style={{ display: 'contents' }}><dt>{l}</dt><dd>{cardValue(d, k) || <span className="muted">Not provided</span>}</dd></div>)}</dl>
        <p className="flag" style={{ marginTop: 24 }}>This system should not be used for purposes outside the intended use described above.</p>
        <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>Published by {org.name} with Ituti AI Assurance. The classification is computed from the organisation&rsquo;s own answers and is not legal advice.</p>
      </article>
    </main>
  );
}
