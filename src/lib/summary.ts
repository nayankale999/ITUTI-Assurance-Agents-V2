import { classify, inherentRisk, readiness, type AssessmentData } from './assurance';

/** Server-computed summary columns for an assessment record. */
export function summarise(data: AssessmentData) {
  return {
    name: String(data.profile?.name || 'Untitled system').slice(0, 200),
    tier: classify(data).tier,
    riskScore: inherentRisk(data)?.score ?? null,
    readiness: readiness(data).pct,
  };
}

export function blankAssessment(name = 'Untitled system'): AssessmentData {
  return { profile: { name, regions: [], role: [], aiType: [] }, cls: { a3: {}, t: {} }, ctrl: {}, card: {}, metrics: [] };
}
