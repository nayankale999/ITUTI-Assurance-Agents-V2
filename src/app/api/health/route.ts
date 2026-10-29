/* Health check for load balancers, the on-prem installer and monitoring. Reveals no configuration. */
import fs from 'fs/promises';
import path from 'path';
import { pool, query, ready } from '@/data/sql';
import { APP_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {};
  let migrations = 0;
  try {
    await ready();
    const rows = await query<{ n: number }>(pool(), 'SELECT COUNT(*) AS n FROM schema_migrations');
    migrations = Number(rows[0]?.n || 0);
    checks.database = 'ok';
  } catch { checks.database = 'error'; }
  try {
    const dir = path.resolve(process.env.DATA_DIR || 'data');
    await fs.mkdir(dir, { recursive: true });
    const f = path.join(dir, `.health-${process.pid}`);
    await fs.writeFile(f, 'ok'); await fs.rm(f, { force: true });
    checks.storage = 'ok';
  } catch { checks.storage = 'error'; }
  const ok = Object.values(checks).every(v => v === 'ok');
  return Response.json({ status: ok ? 'ok' : 'error', version: APP_VERSION, migrations, checks }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
