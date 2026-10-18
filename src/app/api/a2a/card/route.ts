import { agentCard } from '@/lib/a2a/card';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(agentCard(), { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
