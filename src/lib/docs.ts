/* Loading a system for one of its documents, with the viewer's rights checked. */
import { notFound } from 'next/navigation';
import { requireViewer, systemAccess } from './session';
import type { AssessmentData } from './assurance';

export async function systemForDoc(slug: string, id: string) {
  const viewer = await requireViewer();
  const a = await systemAccess(viewer, id);
  if (!a || a.org.slug !== slug) notFound();
  const sys = a.system.data as AssessmentData;
  return { viewer, ...a, sys, name: String(sys.profile?.name || a.system.name || 'Untitled system') };
}

export const SYSTEM_DOCS: [string, string, string][] = [
  ['overview', 'Compliance overview', 'Where the system stands on each of the five journey steps, with what is still open.'],
  ['report', 'Compliance report', 'The full assessment: profile, classification, obligations, controls, incidents and agent provenance.'],
  ['card', 'Model card', 'Purpose, users, limits, model, data, performance, fairness, oversight and contacts. Can be shared by public link.'],
  ['conformity', 'Conformity assessment', 'Organisational, project and technical answers, with which were pre-filled and who confirmed them.'],
  ['technical', 'Technical documentation (Annex IV)', 'The technical file, arranged under the headings of Annex IV of the EU AI Act.'],
  ['plan', 'Remediation plan', 'Every open gap with the action raised to close it: owner, department, due date and status.'],
  ['audit', 'Audit trail', 'Who recorded or changed each answer, when, and whether it came from a person or the assessment agent.'],
  ['incidents', 'Incident inventory', 'Incidents logged for this system with severity, category, status and legal-review flags.'],
  ['metrics', 'Metrics report', 'Performance, fairness and drift metrics with thresholds, latest readings and history.'],
];
