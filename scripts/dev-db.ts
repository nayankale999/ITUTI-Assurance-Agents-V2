/* Starts a throwaway local Postgres (port 5433) for development and tests. Ctrl+C to stop. */
import EmbeddedPostgres from 'embedded-postgres';

async function main() {
  const pg = new EmbeddedPostgres({ databaseDir: process.env.PGDATA_DIR || require('path').resolve('.pgdata'), user: 'assurance', password: 'assurance', port: 5433, persistent: true });
  const fs = await import('fs');
  const dir = process.env.PGDATA_DIR || require('path').resolve('.pgdata');
  if (!fs.existsSync(dir + '/PG_VERSION')) await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('assurance'); } catch {}
  console.log('Postgres ready: postgresql://assurance:assurance@localhost:5433/assurance');
  const stop = async () => { await pg.stop(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
main().catch(e => { console.error(e); process.exit(1); });
