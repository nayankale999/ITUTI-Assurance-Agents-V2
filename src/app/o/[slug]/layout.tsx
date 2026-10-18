import { orgForPage } from '@/lib/session';
import { TopBar } from '@/components/TopBar';
import { OrgNav } from '@/components/OrgNav';

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { viewer, caps } = await orgForPage(slug);
  return (
    <>
      <TopBar viewer={viewer} current="clients" />
      <main className="wrap">
        <OrgNav slug={slug} showPeople={caps.manage} />
        {children}
      </main>
    </>
  );
}
