import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireViewer, visibleOrgs } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { SiteFoot } from '@/components/Brand';

export default async function Home() {
  const viewer = await requireViewer();
  if (viewer.role !== 'CLIENT') redirect('/admin');
  const orgs = await visibleOrgs(viewer);
  if (orgs.length === 1) redirect(`/o/${orgs[0].slug}`);
  return (
    <>
      <TopBar viewer={viewer} />
      <main className="wrap">
        <h1>Your organisations</h1>
        {orgs.length ? (
          <section className="panel"><table className="table"><tbody>
            {orgs.map(o => <tr key={o.id}><td><Link href={`/o/${o.slug}`}><b>{o.name}</b></Link></td></tr>)}
          </tbody></table></section>
        ) : (
          <section className="panel"><div className="empty"><h3>No access yet</h3><p>Your account is not linked to an organisation. Ask your Ituti contact or your organisation&rsquo;s admin to invite you.</p></div></section>
        )}
      </main>
      <SiteFoot />
    </>
  );
}
