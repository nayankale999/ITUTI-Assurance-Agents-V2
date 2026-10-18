// Creates or restores the first Ituti admin from BOOTSTRAP_ADMIN_EMAIL. Safe to run more than once.
import pg from 'pg';
import { randomUUID } from 'crypto';

const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
if (!email) { console.error('BOOTSTRAP_ADMIN_EMAIL is not set'); process.exit(1); }
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(
    `insert into users (id, email, role) values ($1, $2, 'ITUTI_ADMIN')
     on conflict (email) do update set role = 'ITUTI_ADMIN', disabled = false`, [randomUUID(), email]);
  console.log(`Ituti admin ready: ${email}`);
} finally { await pool.end(); }
