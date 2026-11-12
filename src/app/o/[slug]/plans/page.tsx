import { db } from '@/data';
import { orgForPage } from '@/lib/session';
import { ActionForm, Submit } from '@/components/ActionForm';
import { requestUpgrade } from '@/app/actions';
import { SUBSCRIPTIONS, SUBSCRIPTION_LABEL, TIER_INFO, limitText, systemQuota, upgradesFrom, pendingUpgrade } from '@/lib/subscription';

export const metadata = { title: 'Plans' };

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function Plans({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { org, caps } = await orgForPage(slug);
  const quota = await systemQuota(org);
  const pending = await pendingUpgrade(org.id);
  const asker = pending ? await db.users.first({ id: pending.requestedById }) : null;
  const ups = upgradesFrom(org.subscription);
  const current = SUBSCRIPTION_LABEL[org.subscription];
  return (
    <>
      <section className="pf-head" style={{ marginTop: 8 }}>
        <div className="titles">
          <span className="eyebrow">{org.name}</span>
          <h1>Plans</h1>
          <p className="muted">
            You are on <b>{current}</b>: {quota.limit == null ? `${quota.used} AI systems, no limit.` : `${quota.used} of ${quota.limit} AI systems used.`}
            {quota.full && ' You have used all of them; move to a larger plan to add more.'}
          </p>
        </div>
      </section>

      {pending && (
        <section className="panel"><div className="body">
          <p><span className="pill t-info">Upgrade requested</span>{' '}
            {asker?.name || asker?.email || 'Your admin'} asked to move to <b>{SUBSCRIPTION_LABEL[pending.toTier]}</b> on {day(pending.createdAt)}.
            The Ituti team will confirm by email. Your systems stay as they are in the meantime.</p>
        </div></section>
      )}

      <section className="grid3" aria-label="Plans">
        {SUBSCRIPTIONS.map(k => {
          const info = TIER_INFO[k];
          const isCurrent = k === org.subscription;
          const canAsk = caps.manage && ups.includes(k) && pending?.toTier !== k;
          return (
            <div key={k} className="panel" style={{ display: 'flex', flexDirection: 'column', ...(isCurrent ? { borderColor: 'var(--violet)', boxShadow: '0 0 0 1px var(--violet)' } : {}) }}>
              <header><h3 style={{ margin: 0 }}>{SUBSCRIPTION_LABEL[k]}</h3>{isCurrent && <span className="pill t-info">Your plan</span>}</header>
              <div className="body" style={{ display: 'grid', gap: 10, flex: 1, alignContent: 'start' }}>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--heading)' }}>{limitText(k).replace(/^./, c => c.toUpperCase())}</p>
                <p className="muted" style={{ margin: 0 }}>{info.summary}</p>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>{info.points.map(p => <li key={p}>{p}</li>)}</ul>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{k === 'free' ? 'No charge.' : 'Pricing on request.'}</p>
              </div>
              {canAsk && (
                <div className="body" style={{ borderTop: '1px solid var(--line)' }}>
                  <ActionForm action={requestUpgrade} style={{ display: 'grid', gap: 8 }}>
                    <input type="hidden" name="orgId" value={org.id} />
                    <input type="hidden" name="toTier" value={k} />
                    <label className="field"><span>Anything we should know? (optional)</span>
                      <textarea name="message" id={`upgrade-msg-${k}`} maxLength={1000} placeholder="For example: we have 6 credit and fraud models to assess before next year." />
                    </label>
                    <Submit className="btn primary">Request {SUBSCRIPTION_LABEL[k]}</Submit>
                  </ActionForm>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel"><div className="body">
        <p style={{ margin: 0 }}>
          {caps.manage
            ? <>Requests go to the Ituti team, who confirm the plan with you and switch it on. </>
            : <>Only your organisation&rsquo;s admin can request a plan change. </>}
          Questions about plans or pricing? Email <a href={`mailto:info@itutitech.com?subject=${encodeURIComponent(`Plans for ${org.name}`)}`}>info@itutitech.com</a> or
          call <a href="tel:+447356083963">+44 (0)7356 083963</a>.
        </p>
      </div></section>
    </>
  );
}
