/* Ituti AI Assurance deployment agent.
 *
 * Prepares and checks an on-premises installation from the settings in ituti.conf: validates the settings, checks
 * the database, storage, email and AI connections, creates the database, application user and every table,
 * writes the application's settings and container definition, checks the running service, creates the first
 * administrator and makes a one-time sign-in link. It also backs up the database and diagnoses problems.
 *
 * It is called by install.sh, which handles the server itself (copying files, containers or the service). Every
 * step can be re-run safely. Built into one file (installer/agent.cjs) for the release bundle.
 *
 *   node agent.cjs <command> --config ituti.conf --deploy-dir /opt/ituti-assurance [--storage /data] [--json]
 *   commands: check, db, env, verify, admin-link, backup, status, doctor [--ai]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { randomBytes, randomUUID, createHash } from 'crypto';
import mysql from 'mysql2/promise';
import nodemailer from 'nodemailer';
import { migrate, MIGRATIONS } from '../../src/data/schema';

/* ---------- Arguments, settings and output ---------- */

const argv = process.argv.slice(2);
const cmd = argv.find(a => !a.startsWith('--')) || 'help';
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name: string) => argv.includes(`--${name}`);
const VERSION = process.env.APP_VERSION || readVersion();

function readVersion() {
  for (const p of [path.join(__dirname, '..', 'VERSION'), path.join(__dirname, 'VERSION'), '/app/VERSION']) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* next */ }
  }
  return 'dev';
}

type Conf = Record<string, string>;
const SECRET_KEYS = /PASSWORD|SECRET|API_KEY|TOKEN|PRICES_KEY/;

export function parseConf(text: string): Conf {
  const out: Conf = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) throw new Error(`Cannot read this settings line: ${line.slice(0, 60)}`);
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const confPath = opt('config') || 'ituti.conf';
let C: Conf = {};
const deployDir = path.resolve(opt('deploy-dir') || '/opt/ituti-assurance');
const jsonOut = flag('json');

type Result = { step: string; status: 'ok' | 'warn' | 'fail' | 'info'; message: string; fix?: string };
const results: Result[] = [];
const redact = (s: string) => Object.entries(C).filter(([k, v]) => SECRET_KEYS.test(k) && v && v.length >= 4).reduce((acc, [, v]) => acc.split(v).join('***'), s);

function logLine(r: Result) {
  try {
    fs.mkdirSync(path.join(deployDir, 'logs'), { recursive: true });
    fs.appendFileSync(path.join(deployDir, 'logs', 'agent.log'), JSON.stringify({ at: new Date().toISOString(), cmd, ...r, message: redact(r.message), fix: r.fix && redact(r.fix) }) + '\n');
  } catch { /* the folder may not exist yet during a first check */ }
}
function say(status: Result['status'], step: string, message: string, fix?: string) {
  const r: Result = { step, status, message, fix };
  results.push(r); logLine(r);
  if (jsonOut) return;
  const mark = { ok: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✗\x1b[0m', info: '\x1b[36m›\x1b[0m' }[status];
  console.log(`  ${mark} ${redact(message)}${fix ? `\n      \x1b[2m${redact(fix)}\x1b[0m` : ''}`);
}
const heading = (t: string) => { if (!jsonOut) console.log(`\n\x1b[1m${t}\x1b[0m`); };
const failed = () => results.some(r => r.status === 'fail');

/* ---------- Secrets kept between runs ---------- */

const secretsFile = () => path.join(deployDir, 'secrets.env');
function readSecrets(): Conf { try { return parseConf(fs.readFileSync(secretsFile(), 'utf8')); } catch { return {}; } }
function writeSecrets(s: Conf) {
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(secretsFile(), Object.entries(s).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
}
/** Generated values (session secret, database passwords) are made once and reused on every later run. */
function secrets() {
  const s = readSecrets();
  let changed = false;
  const need = (k: string, make: () => string) => { if (!s[k]) { s[k] = make(); changed = true; } };
  need('NEXTAUTH_SECRET', () => randomBytes(32).toString('base64url'));
  if (C.DB_MODE === 'bundled') {
    need('DB_ROOT_PASSWORD', () => randomBytes(24).toString('base64url'));
    if (!C.DB_PASSWORD) need('DB_PASSWORD', () => randomBytes(24).toString('base64url'));
  }
  if (changed) writeSecrets(s);
  return s;
}
const dbPassword = () => C.DB_PASSWORD || readSecrets().DB_PASSWORD || '';

/* ---------- Settings checks ---------- */

const truthy = (v?: string) => /^(1|true|yes|on)$/i.test(v || '');
const isDocker = () => (C.RUNTIME || 'docker') === 'docker';
/** Where the agent itself reaches the database (inside the compose network for the bundled one). */
const dbHostForAgent = () => opt('db-host') || (C.DB_MODE === 'bundled' ? 'db' : C.DB_HOST);
const hostIsLocal = (h: string) => ['localhost', '127.0.0.1', '::1'].includes(h);

function validate(show = true) {
  if (show) heading('Settings');
  const before = results.length;
  const need = (k: string, why: string) => { if (!C[k]) say('fail', 'settings', `${k} is missing`, why); };
  need('APP_URL', 'The address users will open, for example https://ai-assurance.bank.internal');
  need('ADMIN_EMAIL', 'The email address of the first administrator.');
  need('DEPLOY_DIR', 'Where to install, for example /opt/ituti-assurance');
  need('STORAGE_PATH', 'A persistent folder for uploaded documents.');
  need('DB_NAME', 'The database name, for example ituti_assurance.');
  need('DB_USER', 'The database user the application connects as.');
  if (C.DB_MODE !== 'bundled') { need('DB_HOST', 'The database server.'); if (!C.DB_PASSWORD) say('fail', 'settings', 'DB_PASSWORD is missing', 'Give the application user\'s password, or use DB_MODE=bundled.'); }
  if (!['docker', 'node'].includes(C.RUNTIME || 'docker')) say('fail', 'settings', `RUNTIME must be docker or node, not "${C.RUNTIME}"`);
  if (!['external', 'bundled'].includes(C.DB_MODE || 'external')) say('fail', 'settings', `DB_MODE must be external or bundled, not "${C.DB_MODE}"`);
  if (C.DB_MODE === 'bundled' && !isDocker()) say('fail', 'settings', 'DB_MODE=bundled needs RUNTIME=docker', 'Use an external MySQL or MariaDB server with the node runtime.');
  try {
    const u = new URL(C.APP_URL || 'x');
    if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' && u.pathname !== '') throw new Error();
    if (u.protocol === 'http:' && !hostIsLocal(u.hostname)) say('warn', 'settings', 'APP_URL uses http', 'Serve the app over https (TLS_CERT_FILE and TLS_KEY_FILE, or your reverse proxy): sign-in links and sessions travel over it.');
  } catch { if (C.APP_URL) say('fail', 'settings', `APP_URL "${C.APP_URL}" is not a web address without a path`); }
  if (C.ADMIN_EMAIL && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(C.ADMIN_EMAIL)) say('fail', 'settings', `ADMIN_EMAIL "${C.ADMIN_EMAIL}" is not an email address`);
  if (!/^\d+$/.test(C.APP_PORT || '3000')) say('fail', 'settings', 'APP_PORT must be a number');
  if ((C.TLS_CERT_FILE && !C.TLS_KEY_FILE) || (!C.TLS_CERT_FILE && C.TLS_KEY_FILE)) say('fail', 'settings', 'Set both TLS_CERT_FILE and TLS_KEY_FILE, or neither');
  if (C.TLS_CERT_FILE && !isDocker()) say('warn', 'settings', 'TLS_CERT_FILE is only used with RUNTIME=docker', 'With the node runtime, put the app behind your reverse proxy for https.');
  if (C.MONTHLY_BUDGET_USD && !(Number(C.MONTHLY_BUDGET_USD) > 0)) say('fail', 'settings', 'MONTHLY_BUDGET_USD must be a positive number');
  if (C.ANTHROPIC_PRICES) { try { JSON.parse(C.ANTHROPIC_PRICES); } catch { say('fail', 'settings', 'ANTHROPIC_PRICES is not valid JSON'); } }
  for (const [k, v] of Object.entries(C)) {
    if (v.includes("'") && (v.includes('"') || v.includes('$'))) say('fail', 'settings', `${k} contains both a ' and a " or $`, 'Change that value; the settings file cannot carry it safely.');
  }
  if (!failed() && show) say('ok', 'settings', `Settings read from ${confPath} (${C.RUNTIME || 'docker'} runtime, ${C.DB_MODE || 'external'} database)`);
  if (!show && results.length > before && !jsonOut) console.log('  (in the settings file)');
}

/* ---------- Database ---------- */

function sslOptions(): mysql.SslOptions | undefined {
  if (!truthy(C.DB_SSL)) return undefined;
  const ca = C.DB_SSL_CA ? fs.readFileSync(opt('db-ca') || C.DB_SSL_CA, 'utf8') : undefined;
  return { ca, rejectUnauthorized: C.DB_SSL_VERIFY !== 'false' };
}

async function connect(user: string, password: string, database?: string) {
  return mysql.createConnection({ host: dbHostForAgent(), port: Number(C.DB_PORT || 3306), user, password, database, ssl: sslOptions(), connectTimeout: 10000, timezone: 'Z', multipleStatements: false });
}

function versionOk(v: string) {
  const [maj, min] = v.split(/[.-]/).map(Number);
  if (/mariadb/i.test(v)) return maj > 10 || (maj === 10 && min >= 6);
  return maj >= 8;
}

const qi = (s: string) => '`' + s.replace(/`/g, '``') + '`';

async function checkDatabase(quiet = false) {
  heading('Database');
  const admin = C.DB_MODE === 'bundled' ? { user: 'root', pass: readSecrets().DB_ROOT_PASSWORD || '' } : C.DB_ADMIN_USER ? { user: C.DB_ADMIN_USER, pass: C.DB_ADMIN_PASSWORD || '' } : null;
  try {
    const c = await connect(C.DB_USER, dbPassword(), C.DB_NAME);
    const [[row]] = await c.query('SELECT VERSION() AS v') as unknown as [[{ v: string }]];
    await c.end();
    say(versionOk(row.v) ? 'ok' : 'fail', 'database', `Connected to ${dbHostForAgent()}:${C.DB_PORT || 3306}/${C.DB_NAME} as ${C.DB_USER} (${row.v})`, versionOk(row.v) ? undefined : 'Use MySQL 8.0 or later, or MariaDB 10.6 or later.');
    return true;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (admin && /Access denied|Unknown database/i.test(m)) { if (!quiet) say('info', 'database', `The application user or database does not exist yet; it will be created with the ${C.DB_MODE === 'bundled' ? 'bundled database\'s root' : 'administrative'} account`); return true; }
    if (C.DB_MODE === 'bundled' && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED/.test(m)) { say('info', 'database', 'The bundled database is not running yet; install.sh starts it before the database step'); return true; }
    say('fail', 'database', `Cannot connect to the database: ${m}`, /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/.test(m)
      ? `Check DB_HOST and DB_PORT, and that the database server accepts connections from this server (firewall, bind-address).`
      : /Access denied/.test(m) ? 'Check DB_USER and DB_PASSWORD, or give DB_ADMIN_USER and DB_ADMIN_PASSWORD so the installer can create the user.'
      : /certificate|SSL|TLS/i.test(m) ? 'Check DB_SSL and DB_SSL_CA.' : undefined);
    return false;
  }
}

/** Creates the database and application user when an administrative account is given, then applies every migration. */
async function setupDatabase() {
  heading('Database');
  const s = secrets();
  const pass = dbPassword();
  const admin = C.DB_MODE === 'bundled' ? { user: 'root', pass: s.DB_ROOT_PASSWORD } : C.DB_ADMIN_USER ? { user: C.DB_ADMIN_USER, pass: C.DB_ADMIN_PASSWORD || '' } : null;
  if (admin) {
    let c: mysql.Connection | null = null;
    for (let i = 0; i < 30 && !c; i++) {
      try { c = await connect(admin.user, admin.pass); } catch (e) { if (i === 29) throw e; await new Promise(r => setTimeout(r, 2000)); }
    }
    const host = C.DB_USER_HOST || '%';
    await c!.query(`CREATE DATABASE IF NOT EXISTS ${qi(C.DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c!.query('CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?', [C.DB_USER, host, pass]);
    await c!.query('ALTER USER ?@? IDENTIFIED BY ?', [C.DB_USER, host, pass]);
    await c!.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, LOCK TABLES ON ${qi(C.DB_NAME)}.* TO ?@?`, [C.DB_USER, host]);
    await c!.query('FLUSH PRIVILEGES');
    await c!.end();
    say('ok', 'database', `Database ${C.DB_NAME} and user ${C.DB_USER}@${host} are in place, with rights on that database only`);
  } else say('info', 'database', 'No administrative account given: using the database and user your DBA created');

  const pool = mysql.createPool({ host: dbHostForAgent(), port: Number(C.DB_PORT || 3306), user: C.DB_USER, password: pass, database: C.DB_NAME, ssl: sslOptions(), timezone: 'Z', charset: 'utf8mb4_unicode_ci', connectionLimit: 2 });
  try {
    const [[cs]] = await pool.query('SELECT @@character_set_database AS cs') as unknown as [[{ cs: string }]];
    if (!/^utf8mb4/.test(cs.cs)) say('warn', 'database', `The database character set is ${cs.cs}`, `Ask your DBA to run: ALTER DATABASE ${C.DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const applied: string[] = [];
    await migrate(pool, (m: string) => applied.push(m.replace('[db] applied migration ', '')));
    const [rows] = await pool.query('SELECT name FROM schema_migrations') as unknown as [{ name: string }[]];
    const missing = MIGRATIONS.map(m => m[0]).filter(n => !rows.some(r => r.name === n));
    if (missing.length) say('fail', 'database', `Migrations not applied: ${missing.join(', ')}`);
    else say('ok', 'database', applied.length ? `Created or updated the tables (${applied.length} migration${applied.length === 1 ? '' : 's'}: ${applied.join(', ')})` : `All ${rows.length} migrations already applied; tables are up to date`);
    const [tables] = await pool.query('SHOW TABLES') as unknown as [Record<string, string>[]];
    say('info', 'database', `${tables.length} tables in ${C.DB_NAME}`);
    await seed(pool);
  } finally { await pool.end(); }
}

/** The first administrator, and the overall monthly budget when one is given. */
async function seed(pool: mysql.Pool) {
  const email = C.ADMIN_EMAIL.trim().toLowerCase();
  const [[u]] = await pool.query('SELECT id, role FROM users WHERE email = ?', [email]) as unknown as [[{ id: string; role: string } | undefined]];
  if (!u) {
    await pool.query('INSERT INTO users (id, email, name, role, disabled, createdAt) VALUES (?, ?, ?, ?, 0, ?)', [randomUUID(), email, C.ADMIN_NAME || null, 'ITUTI_ADMIN', new Date()]);
    say('ok', 'admin', `Created the first administrator, ${email}`);
  } else {
    if (u.role !== 'ITUTI_ADMIN') await pool.query('UPDATE users SET role = ?, disabled = 0 WHERE id = ?', ['ITUTI_ADMIN', u.id]);
    say('ok', 'admin', `${email} is an administrator`);
  }
  if (C.MONTHLY_BUDGET_USD) {
    const cents = Math.round(Number(C.MONTHLY_BUDGET_USD) * 100);
    const pct = Math.min(100, Math.max(10, Number(C.BUDGET_ALERT_PERCENT || 80)));
    const hard = truthy(C.BUDGET_HARD_STOP) ? 1 : 0;
    await pool.query(`INSERT INTO spend_budgets (scope, monthlyCents, alertPct, hardStop, alertedLevel, updatedAt) VALUES ('global', ?, ?, ?, 0, ?)
      ON DUPLICATE KEY UPDATE monthlyCents = VALUES(monthlyCents), alertPct = VALUES(alertPct), hardStop = VALUES(hardStop), updatedAt = VALUES(updatedAt)`, [cents, pct, hard, new Date()]);
    say('ok', 'budget', `Monthly AI budget $${(cents / 100).toFixed(2)}, alert at ${pct}%${hard ? ', hard stop' : ''}`);
  }
}

/* ---------- Storage ---------- */

function checkStorage() {
  heading('Storage');
  const dir = opt('storage') || C.STORAGE_PATH;
  try {
    fs.mkdirSync(path.join(dir, 'documents'), { recursive: true });
    const f = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(f, 'ok'); fs.rmSync(f);
    const st = fs.statfsSync(dir);
    const free = (st.bavail * st.bsize) / 1024 ** 3;
    const min = Number(C.STORAGE_MIN_FREE_GB || 5);
    say(free >= min ? 'ok' : 'fail', 'storage', `${C.STORAGE_PATH} is writable, ${free.toFixed(1)} GB free`, free >= min ? undefined : `Free at least ${min} GB, or point STORAGE_PATH at a larger volume.`);
  } catch (e) {
    say('fail', 'storage', `Cannot write to ${C.STORAGE_PATH}: ${e instanceof Error ? e.message : e}`, isDocker() ? 'The folder must be writable by user id 10001 (the container user): sudo chown -R 10001:10001 STORAGE_PATH' : 'Make the folder writable by the service user (ituti).');
  }
}

/* ---------- Email, AI and control plane ---------- */

async function checkEmail() {
  heading('Email');
  if (!C.SMTP_HOST) { say('warn', 'email', 'No mail server set', 'Sign-in links will not be emailed. Administrators can issue one-time links on the System page; the installer prints one for you.'); return; }
  const port = Number(C.SMTP_PORT || 587);
  const t = nodemailer.createTransport({ host: C.SMTP_HOST, port, secure: port === 465, auth: C.SMTP_USER ? { user: C.SMTP_USER, pass: C.SMTP_PASSWORD } : undefined, connectionTimeout: 10000 });
  try { await t.verify(); say('ok', 'email', `Mail server ${C.SMTP_HOST}:${port} accepted the connection${C.SMTP_USER ? ' and login' : ''}`); }
  catch (e) { say('warn', 'email', `Mail server check failed: ${e instanceof Error ? e.message : e}`, 'Check SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASSWORD, and that this server may reach it. The app will still run.'); }
}

async function checkAI() {
  heading('AI');
  if (!C.ANTHROPIC_API_KEY) { say('warn', 'ai', 'No ANTHROPIC_API_KEY', 'The platform runs, but the assessment agents and evidence review stay off until a key is added.'); return; }
  const base = (C.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/v1/models?limit=1`, { headers: { 'x-api-key': C.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) say('ok', 'ai', `Reached ${base} and the API key was accepted`);
    else if (r.status === 401 || r.status === 403) say('fail', 'ai', `${base} refused the API key (${r.status})`, 'Check ANTHROPIC_API_KEY.');
    else say('warn', 'ai', `${base} answered ${r.status}`, 'An API gateway may not offer the models list; the agents may still work.');
  } catch (e) {
    say('warn', 'ai', `Cannot reach ${base}: ${e instanceof Error ? (e.cause as Error)?.message || e.message : e}`, C.HTTPS_PROXY ? 'Check HTTPS_PROXY and that the proxy allows this host.' : 'Allow outbound HTTPS to this host, or set HTTPS_PROXY or ANTHROPIC_BASE_URL (your gateway).');
  }
  if (C.ORCHESTRATE_INSTANCE_URL && !C.ORCHESTRATE_API_KEY) say('warn', 'orchestrate', 'ORCHESTRATE_INSTANCE_URL is set without ORCHESTRATE_API_KEY', 'Traces will not be sent. Spend is still tracked on the Spend page.');
  else if (C.ORCHESTRATE_INSTANCE_URL) say('info', 'orchestrate', 'Traces will be sent to watsonx Orchestrate');
  else say('info', 'orchestrate', 'No control plane set: spend and agent use are tracked on the Spend page');
}

/* ---------- Application settings and container definition ---------- */

/** Quotes a value for the env files read by Docker Compose and Node (--env-file): taken literally either way. */
function envValue(k: string, v: string) {
  if (/[\r\n]/.test(v)) throw new Error(`${k} must be on one line`);
  if (!v.includes("'")) return `'${v}'`;
  if (!v.includes('"') && !v.includes('$')) return `"${v}"`;
  throw new Error(`${k} contains characters that cannot be written safely`);
}
const writeEnv = (file: string, vars: [string, string | undefined][], mode = 0o600) => {
  const body = vars.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${envValue(k, v!)}`).join('\n') + '\n';
  fs.writeFileSync(file, `# Written by the Ituti deployment agent on ${new Date().toISOString()}. Change ituti.conf and re-run the installer instead of editing this file.\n${body}`, { mode });
};

function writeSettings() {
  heading('Application settings');
  const s = secrets();
  const docker = isDocker();
  const hostNet = docker && C.DB_MODE !== 'bundled' && hostIsLocal(C.DB_HOST || '');
  const proxy = C.HTTPS_PROXY || '';
  const app: [string, string | undefined][] = [
    ['NODE_ENV', 'production'], ['ITUTI_DEPLOYMENT', 'onprem'], ['NEXT_TELEMETRY_DISABLED', '1'],
    ['PORT', docker && !hostNet ? '3000' : C.APP_PORT || '3000'], ['HOSTNAME', docker && !hostNet ? '0.0.0.0' : C.BIND_ADDRESS || '127.0.0.1'],
    ['NEXTAUTH_URL', C.APP_URL.replace(/\/$/, '')], ['NEXTAUTH_SECRET', s.NEXTAUTH_SECRET],
    ['DB_HOST', C.DB_MODE === 'bundled' ? 'db' : C.DB_HOST], ['DB_PORT', C.DB_PORT || '3306'], ['DB_NAME', C.DB_NAME], ['DB_USER', C.DB_USER], ['DB_PASSWORD', dbPassword()],
    ['DB_SSL', truthy(C.DB_SSL) ? 'true' : undefined], ['DB_SSL_CA', truthy(C.DB_SSL) && C.DB_SSL_CA ? (docker ? '/run/ituti/db-ca.pem' : C.DB_SSL_CA) : undefined], ['DB_SSL_VERIFY', C.DB_SSL_VERIFY],
    ['DATA_DIR', docker ? '/app/data' : C.STORAGE_PATH],
    ['BOOTSTRAP_ADMIN_EMAIL', C.ADMIN_EMAIL.trim().toLowerCase()], ['SELF_REGISTRATION', C.SELF_REGISTRATION || 'off'],
    ['SMTP_HOST', C.SMTP_HOST], ['SMTP_PORT', C.SMTP_HOST ? C.SMTP_PORT || '587' : undefined], ['SMTP_USER', C.SMTP_USER], ['SMTP_PASSWORD', C.SMTP_PASSWORD], ['EMAIL_FROM', C.EMAIL_FROM],
    ['ANTHROPIC_API_KEY', C.ANTHROPIC_API_KEY], ['ANTHROPIC_BASE_URL', C.ANTHROPIC_BASE_URL], ['ANTHROPIC_AGENT_MODEL', C.ANTHROPIC_AGENT_MODEL], ['ANTHROPIC_MODEL', C.ANTHROPIC_MODEL],
    ...['READER', 'RESEARCH', 'CLASSIFY', 'CONTROLS', 'DOCS', 'CONFORMITY'].map(k => [`ANTHROPIC_MODEL_${k}`, C[`ANTHROPIC_MODEL_${k}`]] as [string, string | undefined]),
    ['ANTHROPIC_PRICES', C.ANTHROPIC_PRICES],
    ['HTTPS_PROXY', proxy || undefined], ['NO_PROXY', proxy ? C.NO_PROXY || 'localhost,127.0.0.1' : undefined], ['NODE_USE_ENV_PROXY', proxy ? '1' : undefined],
    ['ORCHESTRATE_INSTANCE_URL', C.ORCHESTRATE_INSTANCE_URL], ['ORCHESTRATE_API_KEY', C.ORCHESTRATE_API_KEY], ['ORCHESTRATE_TENANT_ID', C.ORCHESTRATE_TENANT_ID],
    ['ORCHESTRATE_AGENT_IDS', C.ORCHESTRATE_AGENT_IDS], ['ORCHESTRATE_AUTH', C.ORCHESTRATE_AUTH], ['ORCHESTRATE_ENV', C.ORCHESTRATE_ENV],
  ];
  fs.mkdirSync(deployDir, { recursive: true });
  writeEnv(path.join(deployDir, 'app.env'), app);
  say('ok', 'settings', `Wrote ${path.join(deployDir, 'app.env')} (passwords and keys: readable by administrators and the service only)`);
  if (!docker) return;

  const image = opt('image') || C.IMAGE || `ituti-ai-assurance:${VERSION}`;
  const port = C.APP_PORT || '3000', bind = C.BIND_ADDRESS || '127.0.0.1';
  const tls = !!(C.TLS_CERT_FILE && C.TLS_KEY_FILE);
  const y: string[] = [
    '# Written by the Ituti deployment agent. Change ituti.conf and re-run the installer instead of editing this file.',
    'name: ituti-assurance',
    'services:',
  ];
  if (C.DB_MODE === 'bundled') {
    y.push(
      '  db:',
      `    image: ${C.MARIADB_IMAGE || 'mariadb:11.4'}`,
      '    restart: unless-stopped',
      '    environment:',
      `      MARIADB_ROOT_PASSWORD: "${s.DB_ROOT_PASSWORD}"`,
      '    command: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]',
      '    volumes:',
      '      - db:/var/lib/mysql',
      '    healthcheck:',
      '      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]',
      '      interval: 10s',
      '      retries: 12',
    );
  }
  y.push(
    '  app:',
    `    image: ${image}`,
    '    restart: unless-stopped',
    '    env_file: app.env',
    '    security_opt: ["no-new-privileges:true"]',
    '    volumes:',
    `      - "${C.STORAGE_PATH}:/app/data"`,
    ...(truthy(C.DB_SSL) && C.DB_SSL_CA ? [`      - "${C.DB_SSL_CA}:/run/ituti/db-ca.pem:ro"`] : []),
    ...(hostNet ? ['    network_mode: host'] : ['    ports:', `      - "${bind}:${port}:3000"`]),
    ...(C.DB_MODE === 'bundled' ? ['    depends_on:', '      db:', '        condition: service_healthy'] : []),
    '    healthcheck:',
    `      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:${hostNet ? port : 3000}/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`,
    '      interval: 30s',
    '      timeout: 10s',
    '      retries: 3',
    '      start_period: 30s',
  );
  if (tls) {
    const upstream = hostNet ? `127.0.0.1:${port}` : 'app:3000';
    fs.writeFileSync(path.join(deployDir, 'Caddyfile'), `# Written by the Ituti deployment agent.\n{\n  auto_https disable_redirects\n  admin off\n}\n${new URL(C.APP_URL).hostname}:443 {\n  tls /certs/cert.pem /certs/key.pem\n  reverse_proxy ${upstream}\n  encode gzip\n}\n`);
    y.push(
      '  proxy:',
      `    image: ${C.CADDY_IMAGE || 'caddy:2.8'}`,
      '    restart: unless-stopped',
      ...(hostNet ? ['    network_mode: host'] : ['    ports: ["443:443"]', '    depends_on: [app]']),
      '    volumes:',
      '      - ./Caddyfile:/etc/caddy/Caddyfile:ro',
      `      - "${C.TLS_CERT_FILE}:/certs/cert.pem:ro"`,
      `      - "${C.TLS_KEY_FILE}:/certs/key.pem:ro"`,
    );
  }
  if (C.DB_MODE === 'bundled') y.push('volumes:', '  db:');
  fs.writeFileSync(path.join(deployDir, 'docker-compose.yml'), y.join('\n') + '\n', { mode: 0o600 });
  say('ok', 'settings', `Wrote ${path.join(deployDir, 'docker-compose.yml')} (${[C.DB_MODE === 'bundled' && 'database', 'app', tls && 'https proxy'].filter(Boolean).join(', ')}${hostNet ? '; host networking, since the database is on this server' : ''})`);
}

/* ---------- Verification ---------- */

async function verify() {
  heading('Running service');
  const local = `http://127.0.0.1:${C.APP_PORT || 3000}`;
  const deadline = Date.now() + Number(opt('timeout') || 180) * 1000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${local}/api/health`, { signal: AbortSignal.timeout(5000) });
      const b = await r.json() as { status: string; version: string; migrations: number; checks: Record<string, string> };
      if (r.ok && b.status === 'ok') {
        say('ok', 'verify', `The app is up: version ${b.version}, ${b.migrations} migrations, database and storage ok`);
        break;
      }
      last = `health: ${JSON.stringify(b.checks)}`;
    } catch (e) { last = e instanceof Error ? (e.cause as Error)?.message || e.message : String(e); }
    await new Promise(r => setTimeout(r, 3000));
  }
  if (!results.some(r => r.step === 'verify' && r.status === 'ok')) {
    say('fail', 'verify', `The app did not become healthy at ${local} (${last})`, isDocker() ? 'See: docker compose -f DEPLOY_DIR/docker-compose.yml logs app' : 'See: journalctl -u ituti-assurance -n 100 (or DEPLOY_DIR/logs/app.log)');
    return;
  }
  for (const [p, what] of [['/.well-known/agent-card.json', 'main agent card'], ['/api/a2a/agents', 'specialist agents']] as const) {
    try {
      const r = await fetch(`${local}${p}`, { signal: AbortSignal.timeout(5000) });
      const b = await r.json() as { specialists?: unknown[]; url?: string };
      say(r.ok ? 'ok' : 'fail', 'verify', r.ok ? `The ${what} ${p === '/api/a2a/agents' ? `are published (${b.specialists?.length} specialists)` : `is published at ${b.url}`}` : `The ${what} returned ${r.status}`);
    } catch (e) { say('fail', 'verify', `The ${what} did not answer: ${e instanceof Error ? e.message : e}`); }
  }
  try {
    const r = await fetch(`${C.APP_URL.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(8000) });
    say(r.ok ? 'ok' : 'warn', 'verify', r.ok ? `Users can reach it at ${C.APP_URL}` : `${C.APP_URL} answered ${r.status}`);
  } catch {
    say('warn', 'verify', `${C.APP_URL} is not reachable from this server`, 'Point the DNS name at this server (or your load balancer) and open the port. The app itself is running.');
  }
}

/* ---------- First sign-in ---------- */

async function adminLink() {
  const s = secrets();
  const email = (opt('email') || C.ADMIN_EMAIL).trim().toLowerCase();
  const token = randomBytes(32).toString('hex');
  const hashed = createHash('sha256').update(`${token}${s.NEXTAUTH_SECRET}`).digest('hex');
  const c = await connect(C.DB_USER, dbPassword(), C.DB_NAME);
  const minutes = Number(opt('minutes') || 60 * 24);
  await c.query('INSERT INTO verification_tokens (identifier, token, expires) VALUES (?, ?, ?)', [email, hashed, new Date(Date.now() + minutes * 60e3)]);
  await c.end();
  const base = C.APP_URL.replace(/\/$/, '');
  const link = `${base}/api/auth/callback/email?${new URLSearchParams({ callbackUrl: `${base}/admin`, token, email })}`;
  if (jsonOut) { console.log(JSON.stringify({ email, link, expiresInMinutes: minutes })); return; }
  heading('First sign-in');
  console.log(`  One-time sign-in link for ${email} (works once, within ${minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`}):\n\n  ${link}\n`);
  logLine({ step: 'admin-link', status: 'info', message: `Sign-in link issued for ${email}` });
}

/* ---------- Backup ---------- */

async function backup() {
  heading('Backup');
  const dir = path.join(opt('to') || C.BACKUP_PATH || path.join(deployDir, 'backups'), `ituti-assurance-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'database.sql.gz');
  const c = await connect(C.DB_USER, dbPassword(), C.DB_NAME);
  const out = zlib.createGzip();
  const sink = fs.createWriteStream(file, { mode: 0o600 });
  out.pipe(sink);
  const w = (s: string) => new Promise<void>(res => (out.write(s) ? res() : out.once('drain', () => res())));
  await w(`-- Ituti AI Assurance database backup, version ${VERSION}, ${new Date().toISOString()}\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n`);
  const [tables] = await c.query('SHOW TABLES') as unknown as [Record<string, string>[]];
  let rowsTotal = 0;
  for (const t of tables.map(r => Object.values(r)[0])) {
    const [[ct]] = await c.query(`SHOW CREATE TABLE ${qi(t)}`) as unknown as [[Record<string, string>]];
    await w(`\nDROP TABLE IF EXISTS ${qi(t)};\n${ct['Create Table']};\n`);
    for (let off = 0; ; off += 500) {
      const [rows] = await c.query(`SELECT * FROM ${qi(t)} LIMIT 500 OFFSET ${off}`) as unknown as [Record<string, unknown>[]];
      if (!rows.length) break;
      const cols = Object.keys(rows[0]);
      await w(`INSERT INTO ${qi(t)} (${cols.map(qi).join(',')}) VALUES\n${rows.map(r => mysql.format(`(${cols.map(() => '?').join(',')})`, cols.map(k => r[k]) as Parameters<typeof mysql.format>[1])).join(',\n')};\n`);
      rowsTotal += rows.length;
      if (rows.length < 500) break;
    }
  }
  await w('SET FOREIGN_KEY_CHECKS=1;\n');
  await c.end();
  await new Promise<void>(res => { sink.on('finish', () => res()); out.end(); });
  const mb = fs.statSync(file).size / 1024 ** 2;
  say('ok', 'backup', `Database saved to ${file} (${tables.length} tables, ${rowsTotal} rows, ${mb.toFixed(1)} MB)`, `Restore with: gunzip -c ${file} | mysql -h DB_HOST -u DB_USER -p ${C.DB_NAME}`);
  if (jsonOut) console.log(JSON.stringify({ dir }));
  else console.log(`BACKUP_DIR=${dir}`);
}

/* ---------- Status and diagnosis ---------- */

async function status() {
  heading('Installation');
  let state: Record<string, string> = {};
  try { state = JSON.parse(fs.readFileSync(path.join(deployDir, 'state.json'), 'utf8')); } catch { /* none */ }
  say('info', 'status', state.version ? `Installed version ${state.version} (${state.runtime} runtime) on ${state.installedAt}` : 'No installation recorded in this folder');
  try {
    const r = await fetch(`http://127.0.0.1:${C.APP_PORT || 3000}/api/health`, { signal: AbortSignal.timeout(5000) });
    const b = await r.json() as { status: string; version: string; migrations: number; checks: Record<string, string> };
    say(b.status === 'ok' ? 'ok' : 'fail', 'status', `Service ${b.status}: version ${b.version}, ${b.migrations} migrations, ${Object.entries(b.checks).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } catch (e) { say('fail', 'status', `The service is not answering on port ${C.APP_PORT || 3000}: ${e instanceof Error ? (e.cause as Error)?.message || e.message : e}`); }
}

async function doctor() {
  validate();
  if (!failed()) { await checkDatabase(true); checkStorage(); await checkEmail(); await checkAI(); await status(); }
  const problems = results.filter(r => r.status === 'fail' || r.status === 'warn');
  heading('Diagnosis');
  if (!problems.length) { say('ok', 'doctor', 'No problems found'); return; }
  if (!flag('ai')) { say('info', 'doctor', `${problems.length} item${problems.length === 1 ? '' : 's'} above need attention. Run "doctor --ai" to have Claude suggest fixes (sends the findings and recent log lines, with passwords and keys removed).`); return; }
  if (!C.ANTHROPIC_API_KEY) { say('warn', 'doctor', 'doctor --ai needs ANTHROPIC_API_KEY in the settings'); return; }
  let tail = '';
  try { tail = fs.readFileSync(path.join(deployDir, 'logs', 'agent.log'), 'utf8').split('\n').slice(-60).join('\n'); } catch { /* none */ }
  const context = redact(JSON.stringify({ os: `${os.type()} ${os.release()} ${os.arch()}`, runtime: C.RUNTIME, dbMode: C.DB_MODE, findings: problems, recentLog: tail }).slice(0, 30000));
  const base = (C.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
  const r = await fetch(`${base}/v1/messages`, {
    method: 'POST', headers: { 'x-api-key': C.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: C.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1500, system: 'You help an IT administrator fix an on-premises installation of Ituti AI Assurance (a Next.js app with MySQL/MariaDB, run with Docker Compose or as a systemd service on Node.js 22). Give the likely cause and exact steps to fix each finding, most important first. Be brief. Never ask for passwords or keys.', messages: [{ role: 'user', content: context }] }),
  });
  const b = await r.json() as { content?: { type: string; text?: string }[]; error?: { message: string } };
  console.log('\n' + (b.content?.map(x => x.text || '').join('') || `Claude did not answer: ${b.error?.message || r.status}`) + '\n');
}

/* ---------- Main ---------- */

async function main() {
  if (cmd === 'help' || flag('help')) {
    console.log('Ituti deployment agent\nUsage: node agent.cjs <check|db|env|verify|admin-link|backup|status|doctor> --config ituti.conf --deploy-dir DIR [--storage DIR] [--json] [--ai]');
    return;
  }
  C = { DEPLOY_DIR: deployDir, ...parseConf(fs.readFileSync(confPath, 'utf8')) };
  if (opt('deploy-dir')) C.DEPLOY_DIR = deployDir;
  switch (cmd) {
    case 'check':
      validate();
      if (!failed()) { await checkDatabase(); checkStorage(); await checkEmail(); await checkAI(); }
      break;
    case 'db': validate(false); if (!failed()) await setupDatabase(); break;
    case 'env': validate(false); if (!failed()) writeSettings(); break;
    case 'verify': await verify(); break;
    case 'admin-link': await adminLink(); break;
    case 'backup': await backup(); break;
    case 'status': await status(); break;
    case 'doctor': await doctor(); break;
    default: console.error(`Unknown command ${cmd}`); process.exit(2);
  }
  if (jsonOut && cmd !== 'admin-link' && cmd !== 'backup') console.log(JSON.stringify({ ok: !failed(), results: results.map(r => ({ ...r, message: redact(r.message) })) }));
  if (failed()) process.exitCode = 1;
}

main().catch(e => {
  const m = e instanceof Error ? e.message : String(e);
  say('fail', cmd, redact(m));
  process.exitCode = 1;
});
