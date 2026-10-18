/* Adds a clearly labelled example client with one completed system, for demos and training. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import { summarise } from '../src/lib/summary';
import type { AssessmentData } from '../src/lib/assurance';

const data: AssessmentData = {
  profile: { name: 'Personal loan decisioning', client: 'Retail Credit', owner: 'Head of Retail Credit Risk',
    description: 'Scores unsecured personal loan applications using bureau, income and account data, and recommends approve, refer or decline. Underwriters review referrals and every decline.',
    lifecycle: 'prod', regions: ['uk', 'eu'], sector: 'bank', func: 'credit', role: ['deployer'], aiType: ['ml'], source: 'vendor', vendor: 'Gradient-boosted scorecard from a credit-analytics vendor', version: '3.2',
    affects: 'cust', personal: 'personal', scale: 's2', autonomy: 'a1', revers: 'r1' },
  cls: { p1: 'no', p2: 'no', p3: 'no', p4: 'no', p5: 'no', p6: 'no', p7: 'no', p8: 'no', a3: { h_credit: true }, annex1: 'no', profiling: 'yes', exempt: 'no', t: {}, gpai: 'no' },
  ctrl: {
    'GOV-1': { s: 'met', e: 'Group AI Policy v2.1 approved by Board Risk Committee, March 2026.' },
    'GOV-2': { s: 'met', e: 'Chief Credit Officer holds SMF responsibility; documented in the responsibilities map.' },
    'GOV-3': { s: 'partial', e: 'In inventory; classification rationale drafted, awaiting second-line review.' },
    'GOV-5': { s: 'partial', e: 'Vendor due diligence complete; contract lacks a right to model change notices.' },
    'RSK-1': { s: 'met', e: 'Risk register CR-114 updated after v3.2 release.' },
    'RSK-2': { s: 'gap', e: '' },
    'RSK-3': { s: 'met', e: 'DPIA-2025-031 signed off by the DPO.' },
    'DAT-3': { s: 'partial', e: 'Approval-rate parity by age band and sex tested; no proxy analysis for ethnicity.' },
    'TEC-1': { s: 'met', e: 'Gini 0.61 on out-of-time sample against 0.55 acceptance threshold.' },
    'TEC-2': { s: 'gap', e: '' },
    'HUM-1': { s: 'met', e: 'Underwriters review every decline; override rate reported monthly.' },
  },
  card: {},
  metrics: [
    { id: 'm1', name: 'Gini (out-of-time)', kind: 'Performance', threshold: '0.55', dir: 'above', readings: [{ d: '2026-05-01', v: 0.62 }, { d: '2026-06-01', v: 0.61 }, { d: '2026-07-01', v: 0.6 }, { d: '2026-08-01', v: 0.59 }, { d: '2026-09-01', v: 0.57 }] },
    { id: 'm2', name: 'Approval-rate ratio, age 18–25 vs all', kind: 'Fairness', threshold: '0.8', dir: 'above', readings: [{ d: '2026-05-01', v: 0.86 }, { d: '2026-06-01', v: 0.84 }, { d: '2026-07-01', v: 0.83 }, { d: '2026-08-01', v: 0.79 }, { d: '2026-09-01', v: 0.78 }] },
  ],
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  const slug = 'example-bank';
  let org = await db.query.organizations.findFirst({ where: eq(schema.organizations.slug, slug) });
  if (!org) [org] = await db.insert(schema.organizations).values({ name: 'Example Bank plc (demo)', slug }).returning();
  const [sys] = await db.insert(schema.aiSystems).values({ orgId: org.id, data, ...summarise(data), openIncidents: 1 }).returning();
  await db.insert(schema.incidents).values({ systemId: sys.id, title: 'Fairness ratio for applicants aged 18–25 fell below 0.8', date: '2026-09-03', severity: 'high', category: 'Bias or discrimination', status: 'investigating', notes: 'Investigating feature drift in months-at-address.' });
  console.log(`Demo client ready at /o/${slug}`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
