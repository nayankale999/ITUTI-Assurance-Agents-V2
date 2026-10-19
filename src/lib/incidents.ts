/* Incident lifecycle, categories and the legal-review flag, shared by the editor, the tracker and the documents. */

export const INCIDENT_STATUSES: [string, string][] = [
  ['open', 'Open'], ['investigating', 'Investigating'], ['mitigated', 'Mitigated'], ['resolved', 'Resolved'], ['closed', 'Closed'],
];
/** Statuses that still need attention. */
export const ACTIVE_STATUSES = ['open', 'investigating', 'mitigated'];
export const isActive = (status: string) => ACTIVE_STATUSES.includes(status);

export const INCIDENT_CATEGORIES = [
  'Performance degradation', 'Bias or discrimination', 'Harmful or incorrect output', 'Privacy or personal data',
  'Security or data leak', 'Misuse', 'Outage or failure', 'Other',
];
export const SEVERITIES: [string, string, string][] = [['low', 'Low', 't-muted'], ['medium', 'Medium', 't-info'], ['high', 'High', 't-warn'], ['critical', 'Critical', 't-crit']];
export const sevTone = (s: string) => SEVERITIES.find(x => x[0] === s)?.[2] || 't-muted';
export const statusLabel = (s: string) => INCIDENT_STATUSES.find(x => x[0] === s)?.[1] || s;

const LEGAL = ['Bias or discrimination', 'Privacy or personal data', 'Security or data leak'];
/** Incidents that legal or the DPO should see: possible discrimination, personal data, or a reportable serious incident. */
export function legalReview(i: { category: string; serious: boolean; severity: string }): string | null {
  if (i.serious) return 'Possible serious incident: check the Article 73 reporting deadline';
  if (i.category === 'Bias or discrimination') return 'Possible discrimination: equality and fundamental-rights review';
  if (LEGAL.includes(i.category)) return 'Personal data or security: DPO review';
  return null;
}
