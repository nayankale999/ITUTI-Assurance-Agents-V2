import Link from 'next/link';
import { db } from '@/data';
import { systemForDoc, SYSTEM_DOCS } from '@/lib/docs';
import { TIERS, classify } from '@/lib/assurance';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createShareLink, revokeShareLink } from '@/app/actions';

export const metadata = { title: 'Document centre' };

export default async function SystemDocuments({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const tier = TIERS[classify(d.sys).tier] || TIERS.unknown;
  const links = await db.shares.find({ systemId: id, kind: 'card', revokedAt: null }, { orderBy: [['createdAt', 'desc']] });
  const canShare = d.canEdit;
  return (
    <>
      <section className="sys-head">
        <div className="crumbs"><Link href={`/o/${slug}`}>{d.org.name}</Link><span>/</span><Link href={`/o/${slug}/systems/${id}`}>{d.name}</Link><span>/</span><span>Documents</span></div>
        <div className="sys-title"><div><h1>Document centre</h1><p className="muted">{d.name} · <span className={`pill t-${tier.tone}`}>{tier.label}</span>. Every document is compiled from the system&rsquo;s record. Open one and choose Download as PDF.</p></div>
          <Link className="btn" href={`/o/${slug}/systems/${id}`}>Back to the system</Link></div>
      </section>
      <section className="panel"><div className="doclist">
        {SYSTEM_DOCS.map(([k, t, desc]) => <Link key={k} className="docitem" href={`/o/${slug}/systems/${id}/${k}`}><b>{t}</b><span>{desc}</span></Link>)}
      </div></section>
      <section className="panel"><header><div><h3>Public model card link</h3><small className="muted">A read-only page showing only the model card, for a regulator, customer or partner. No sign-in is needed, so anyone with the link can open it until you revoke it.</small></div></header>
        <div className="body">
          {links.length ? <table className="ledger"><thead><tr><th>Created</th><th>Last opened</th><th /></tr></thead><tbody>
            {links.map(l => <tr key={l.id}><td>{l.createdAt.toLocaleDateString('en-GB')}</td><td className="muted">{l.lastViewedAt ? l.lastViewedAt.toLocaleString('en-GB') : 'Not yet'}</td>
              <td className="num">{canShare && <ActionForm action={revokeShareLink} confirm="Anyone using this link will no longer be able to open the model card."><input type="hidden" name="id" value={l.id} /><Submit className="linkbtn">Revoke</Submit></ActionForm>}</td></tr>)}
          </tbody></table> : <p className="muted">No public link yet.</p>}
          {canShare && <ActionForm action={createShareLink} className="formrow"><input type="hidden" name="systemId" value={id} /><Submit>Create a public link</Submit></ActionForm>}
          {!canShare && <p className="muted" style={{ fontSize: 13 }}>People who can edit this system can create a public link.</p>}
        </div>
      </section>
    </>
  );
}
