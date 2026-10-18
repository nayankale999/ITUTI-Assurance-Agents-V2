# Ituti AI Assurance

A multi-client web app for assessing AI systems against the **EU AI Act**, **UK requirements** (AI principles, FCA Consumer Duty, SM&CR, PRA SS1/23), **ISO/IEC 42001** and the **NIST AI RMF**. Runs at `assurance.ituti.tech` on Hostinger, styled to match the ITUTI Tech website (www.ituti.tech), which links to it from its AI Assurance page and a "Client login" link on every page.

For each AI system the app records a profile, classifies it under the EU AI Act, lists the obligations that apply in the EU and UK, and assesses it against up to 39 controls mapped to all four frameworks. It also keeps a model card, performance and fairness metrics, and an incident log. Printable assurance reports and model cards can be saved as PDF from the browser.

## Who can do what

| Role | Scope | Can |
|---|---|---|
| Ituti admin | Every client | Add and delete clients, invite Ituti staff, assign assessors, everything below |
| Ituti assessor | Clients assigned to them | Add, edit and delete systems; invite and manage client users |
| Client admin | Their organisation | Same as an assessor, within their organisation |
| Contributor | Their organisation | View all systems; edit only systems assigned to them; record incidents on those |
| Viewer | Their organisation | Read systems, reports and model cards |

Access is by invitation only. People sign in with a one-time link sent to their email, so there are no passwords to manage. Every change is written to an activity log for each client.

## How data is stored

All data is kept in **CSV files**, one per table, in the folder set by `DATA_DIR` (default `./data`). There is no database to install.

| File | Holds |
|---|---|
| `users.csv` | Everyone who can sign in, with their platform role |
| `organizations.csv` | Client organisations |
| `memberships.csv` | Which client users belong to which organisation, and their role |
| `assessor_assignments.csv` | Which clients each Ituti assessor works on |
| `ai_systems.csv` | One row per AI system. The full assessment is JSON in the `data` column, and the summary columns (tier, risk score, readiness) are kept alongside |
| `system_assignments.csv` | Which systems each contributor can edit |
| `incidents.csv` | Incident log entries |
| `invitations.csv` | Invitations, holding only a hash of each invitation link |
| `audit_log.csv` | Activity log, capped at the most recent 20,000 entries |
| `sessions.csv`, `verification_tokens.csv` | Sign-in sessions and pending sign-in links |

How the files are protected:

- **Safe writes.** Every write takes a lock on the file, re-reads it, applies the change, writes a temporary copy and renames it into place. A crash cannot leave a half-written file, and two simultaneous saves never lose each other's changes.
- **Version check on saves.** If two people edit the same system, the second person is warned instead of overwriting the first.
- **Spreadsheet formula protection.** Text that a spreadsheet would treat as a formula (starting with `=`, `+`, `-` or `@`) is stored with a leading apostrophe and restored when the app reads it.
- **External changes.** The app notices when a file changes on disk, for example after a restore from backup, and reloads it.
- **New columns.** A column added in a later version reads as empty for older rows, so upgrades need no migration step.

**Limits of CSV storage.** Run exactly **one copy** of the app on a server with a persistent disk. It is suitable for tens of clients and a few hundred systems. Serverless hosts such as Vercel will not work, because their disks are wiped between requests. Moving to a database later only means replacing `src/data/`; the rest of the app talks to it through the same small set of functions. A Postgres version is in this repository's git history.

**Opening the files in Excel.** Viewing is fine. Avoid editing and saving them, especially `ai_systems.csv`, while the app is running or at all:

- Excel truncates any cell over 32,767 characters, so a detailed assessment's JSON can be cut off.
- Excel reformats dates and IDs.
- If you must correct something by hand, stop the app, copy the file, edit with a plain text editor, then restart.

**Backups.** Copy the whole data folder, for example with a nightly `tar` or your host's disk snapshots. Restoring is copying the folder back.

## Deploying

You need:

1. **A server with a persistent disk.** A small Linux VM is enough (Azure, AWS Lightsail, DigitalOcean, Hetzner). Docker is the simplest way to run it. Put a reverse proxy such as Caddy or nginx in front to handle HTTPS.
2. **SMTP for email.** With Microsoft 365, enable *Authenticated SMTP* on the sending mailbox (it is off by default in many tenants). Postmark or SendGrid also work.
3. **DNS.** Point `assurance.ituti.tech` at the server, then make sure HTTPS works.

### With Docker

```bash
cp .env.example .env          # fill in every value; generate NEXTAUTH_SECRET with: openssl rand -base64 32
mkdir -p data && sudo chown 10001:10001 data
docker compose up -d --build
```

The CSV files appear in `./data` next to `docker-compose.yml`.

### Without Docker

```bash
cp .env.example .env          # set DATA_DIR to a folder on persistent storage
npm ci
npm run build
npm start                     # serves on port 3000; run it under systemd or pm2 so it restarts
```

### First sign-in

Sign in with the `BOOTSTRAP_ADMIN_EMAIL` address. The first sign-in makes that account an Ituti admin. Then:

1. Add a client.
2. Invite the client's lead as **Client admin**.
3. Invite colleagues from the **Ituti team** page.

### Environment variables

See `.env.example`. These are required: `DATA_DIR`, `NEXTAUTH_URL` (the public https URL), `NEXTAUTH_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, and the `SMTP_*` and `EMAIL_FROM` settings. `ANTHROPIC_API_KEY` is optional. Without it the AI review button is hidden.

### Upgrading

Pull, rebuild and restart. The data folder is untouched.

## Developing

```bash
npm ci
cp .env.example .env.local    # DATA_DIR="./data", NEXTAUTH_URL="http://localhost:3000", SMTP_HOST="" (empty)
npm run data:demo             # optional: adds a clearly labelled example client with one completed system
npm run dev
```

With `SMTP_HOST` empty, sign-in and invitation links are printed to the server log instead of emailed.

### Tests

- `npm test` runs the unit tests for:
  - the role model;
  - EU AI Act classification and scoring;
  - CSV storage: awkward text, formula protection, external edits, and simultaneous writes from three processes.
- `npm run build && npm run test:e2e` starts the built app with a fresh temporary data folder and runs 41 end-to-end checks. These cover role access, cross-client isolation, saving and version conflicts, cross-site request refusal, incidents, cascading deletes, the sign-in allow-list, invitations and the bootstrap admin. Real data is never touched.

## Where things are

| Path | What |
|---|---|
| `src/lib/assurance.ts` | Control library, EU AI Act classification, UK obligations, risk score, readiness. The content is here. |
| `src/data/csv.ts` | CSV storage engine: locking, atomic writes, caching, encoding |
| `src/data/index.ts` | The tables, their columns, and cascading deletes |
| `src/lib/permissions.ts` | The role model as pure functions |
| `src/lib/session.ts` | Loads the signed-in user and their rights over a client or system |
| `src/app/actions.ts` | Server actions for clients, invitations, members, staff and system creation |
| `src/app/api/` | JSON endpoints for saving systems, incidents, CSV export and AI review |
| `src/components/editor/SystemEditor.tsx` | The six-tab assessment editor |

## Security and data protection notes

- Sign-in links are single use and expire after 15 minutes. Only existing users, people with a pending invitation, and the bootstrap admin can request one. Sessions last 14 days and end immediately when an account is disabled.
- Every page and endpoint checks the user's rights on the server. Clients cannot see each other's data.
- Writes must come from the app's own origin as JSON.
- **The data folder holds all client data in plain text.** Keep it on an encrypted disk, restrict who can log in to the server, and encrypt backups.
- **AI review sends the system's profile and the evidence text to Anthropic's API.** Check this is covered by your agreements with clients before enabling it, and consider a zero-data-retention arrangement with Anthropic.
- Classification is an indication based on the answers recorded and is not legal advice. The control library paraphrases the public texts of Regulation (EU) 2024/1689, UK guidance, ISO/IEC 42001:2023 and NIST AI RMF 1.0. Review it against current guidance periodically, as regulators publish updates.
