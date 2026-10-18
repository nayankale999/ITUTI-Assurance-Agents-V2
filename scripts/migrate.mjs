// Applies database migrations from ./drizzle. Run on every deploy: node scripts/migrate.mjs
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  console.log('Database is up to date.');
} finally { await pool.end(); }
