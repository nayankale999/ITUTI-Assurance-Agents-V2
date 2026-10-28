/* The assessment crew's A2A agents, with the address to register each one at. */
import { SPECIALISTS } from '@/lib/agent/specialists';
import { specialistUrl } from '@/lib/a2a/specialist';
import { appUrl } from '@/lib/a2a/card';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    main: { name: 'Ituti AI Assurance', url: `${appUrl()}/api/a2a`, card: `${appUrl()}/.well-known/agent-card.json` },
    specialists: SPECIALISTS.map(s => ({ key: s.key, name: s.name, description: s.description, url: specialistUrl(s), card: `${specialistUrl(s)}/.well-known/agent-card.json` })),
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
