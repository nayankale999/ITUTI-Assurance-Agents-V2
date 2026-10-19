import { systemForDoc } from '@/lib/docs';
import { CONF_PARTS, questionsFor, answerState, confProgress, art43 } from '@/lib/conformity';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Conformity assessment' };

export default async function Conformity({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const qs = questionsFor(d.sys), cp = confProgress(d.sys), a43 = art43(d.sys);
  const LABEL = { done: 'Confirmed', review: 'Pre-filled, not yet confirmed', open: 'Not answered' };
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Conformity assessment" org={d.org.name} title={d.name}
      subtitle={`${cp.done} of ${cp.total} questions confirmed · ${cp.parts.map(x => `${x.label} ${x.done}/${x.total}`).join(' · ')}`}>
      <p>{a43.text}</p>
      {CONF_PARTS.map(([key, label, desc]) => (
        <section key={key}>
          <h2>{label} assessment</h2>
          <p className="muted">{desc}</p>
          {qs.filter(q => q.part === key).map(q => {
            const st = answerState(d.sys, q);
            return (
              <div key={q.id} style={{ breakInside: 'avoid', marginBottom: 14 }}>
                <h3>{q.id.slice(1)}. {q.topic} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>({q.ref})</span></h3>
                <p style={{ margin: '4px 0' }}><i>{q.q}</i></p>
                <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{st.text || '–'}</p>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>{LABEL[st.state]}{st.from ? ` · source: ${st.from}` : ''}</p>
              </div>
            );
          })}
        </section>
      ))}
    </DocShell>
  );
}
