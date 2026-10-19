import { systemForDoc } from '@/lib/docs';
import { OPTS } from '@/lib/assurance';
import { CONF_QUESTIONS, answerState, confLabel } from '@/lib/conformity';
import { cardValue } from '@/lib/report';
import { DocShell } from '@/components/DocShell';

export const metadata = { title: 'Technical documentation (Annex IV)' };
const opt = (k: string, v: unknown) => (OPTS[k].find(o => o[0] === v) || [, ''])[1];

/* The technical file arranged under the headings of Annex IV of the EU AI Act, compiled from the record. */
export default async function Technical({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const d = await systemForDoc(slug, id);
  const sys = d.sys, p: Record<string, any> = sys.profile || {};
  const conf = (qid: string) => { const q = CONF_QUESTIONS.find(x => x.id === qid)!; const st = answerState(sys, q); return { label: `${q.topic} (${confLabel(qid)})`, text: st.text, note: st.state === 'review' ? 'Pre-filled, not yet confirmed' : '' }; };
  const ctrl = (cid: string, what: string) => ({ label: `${what} (control ${cid})`, text: sys.ctrl?.[cid]?.e || '', note: '' });
  const card = (k: string, label: string) => ({ label, text: cardValue(sys, k), note: '' });
  const plain = (label: string, text: string) => ({ label, text, note: '' });
  const sections: [string, string, { label: string; text: string; note: string }[]][] = [
    ['1', 'General description of the AI system', [
      plain('Name and version', `${p.name || d.name}${p.version ? `, version ${p.version}` : ''}`),
      plain('Organisation and role', `${d.org.name}; ${(p.role || []).map((x: string) => opt('role', x)).join(', ') || 'role not recorded'}`),
      conf('P1'), conf('P2'), plain('Where it is used', (p.regions || []).map((x: string) => opt('regions', x)).join(', ')),
      plain('Components from others', p.vendor ? `${opt('source', p.source) || 'Third-party'}: ${p.vendor}` : ''),
      ctrl('TXP-1', 'Instructions for use'),
    ]],
    ['2', 'Elements of the system and its development', [
      conf('T1'), conf('T2'), conf('T3'), conf('P6'), conf('P7'), conf('P8'), conf('P14'), conf('T4'), conf('T5'), conf('T6'), conf('T7'), conf('T9'),
    ]],
    ['3', 'Monitoring, functioning and control', [card('limitations', 'Capabilities and limitations'), conf('P4'), conf('T8'), conf('T10'), conf('P15')]],
    ['4', 'Appropriateness of the performance metrics', [conf('T5'), card('performance', 'Recorded performance')]],
    ['5', 'Risk management system (Art. 9)', [conf('P10'), conf('P11'), conf('P12'), ctrl('RSK-1', 'Risk management evidence')]],
    ['6', 'Changes made through the lifecycle', [conf('T12'), ctrl('DOC-3', 'Version and change control')]],
    ['7', 'Harmonised standards and specifications applied', [plain('Standards', '')]],
    ['8', 'EU declaration of conformity', [ctrl('CNF-2', 'Declaration, CE marking and registration')]],
    ['9', 'Post-market monitoring (Art. 72)', [conf('P18'), conf('T13'), conf('T14'), ctrl('MON-1', 'Production monitoring evidence')]],
  ];
  const missing = sections.reduce((a, [, , items]) => a + items.filter(i => !i.text.trim()).length, 0);
  return (
    <DocShell back={`/o/${slug}/systems/${id}/documents`} backLabel="Document centre" kind="Technical documentation, Annex IV" org={d.org.name} title={d.name}
      subtitle={missing ? `${missing} item${missing === 1 ? '' : 's'} still to complete. Fill them on the Conformity and Controls tabs.` : 'All Annex IV headings have content.'}>
      <p className="muted" style={{ fontSize: 12 }}>Arranged under the headings of Annex IV of Regulation (EU) 2024/1689. Content comes from the system&rsquo;s profile, conformity assessment, controls and model card. Items marked as not yet confirmed were pre-filled and need review.</p>
      {sections.map(([n, title, items]) => (
        <section key={n}>
          <h2>{n}. {title}</h2>
          <table><tbody>{items.map((i, k) => <tr key={k}><th style={{ width: 230 }}>{i.label}</th><td style={{ whiteSpace: 'pre-wrap' }}>{i.text.trim() || <span className="muted">Not yet recorded</span>}{i.note && i.text.trim() && <div className="muted" style={{ fontSize: 11 }}>{i.note}</div>}</td></tr>)}</tbody></table>
        </section>
      ))}
    </DocShell>
  );
}
