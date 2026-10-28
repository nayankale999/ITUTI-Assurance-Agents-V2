/* Writes one watsonx Orchestrate external-agent file per specialist into ibm/specialists/. Run: npx tsx scripts/ibm-yaml.ts */
import fs from 'fs';
import { SPECIALISTS } from '../src/lib/agent/specialists';

const base = 'https://assurance.ituti.tech';
const wrap = (s: string) => s.match(/.{1,110}(\s|$)/g)!.map(l => `  ${l.trim()}`).join('\n');
for (const s of SPECIALISTS) {
  const name = `ituti_${s.key === 'docs' ? 'documentation' : s.slug.replace(/-/g, '_')}`.replace('ituti_ituti', 'ituti');
  const body = `# watsonx Orchestrate external agent: the ${s.name} of Ituti AI Assurance (A2A protocol 0.3.0).
# Import with the watsonx Orchestrate ADK:  orchestrate agents import -f ibm/specialists/${s.slug}.yaml
# Or in the UI: add an external agent, choose A2A 0.3.0 and enter the api_url below.
# Replace the token with the client's Ituti AI Assurance API key. Never commit a real key.
spec_version: v1
kind: external
name: ${name}
title: "Ituti AI Assurance: ${s.name}"
nickname: ${name}
provider: external_chat/A2A/0.3.0
description: >
${wrap(s.description)}
tags:
  - AI governance
  - EU AI Act
  - Ituti AI Assurance crew
api_url: ${base}/api/a2a/agents/${s.slug}
auth_scheme: BEARER_TOKEN
auth_config:
  token: ita_REPLACE_WITH_CLIENT_API_KEY
chat_params:
  stream: true
  sendHistory: true
  pushNotifications: false
`;
  fs.writeFileSync(`ibm/specialists/${s.slug}.yaml`, body);
}
console.log(`Wrote ${SPECIALISTS.length} files`);
