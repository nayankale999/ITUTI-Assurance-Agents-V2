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

## The assessment agent

On each system's **Evidence and agent** tab:

1. **Upload evidence.** Policies, design documents, validation and test reports, impact assessments, model cards, contracts and risk register exports, as PDF, Word, Excel, CSV, text, Markdown, JSON or HTML (25 MB each, 40 per system). The text is extracted and split into passages that keep their page, sheet rows or section, so every fact can be cited.
2. **Pre-fill with agent.** Claude works through the profile, EU AI Act classification, the controls, the model card and monitoring metrics. It searches and reads the documents and, for vendor or foundation models, looks the model up in the shared **public model library**: what the provider publishes (model or system card, usage policy, data handling, EU AI Act status), researched with web search and fetch restricted to official provider domains and kept for 90 days for every client.
3. **Review.** Each proposal shows the value, what it would replace, a confidence level, the rationale and its sources with quotes. Accept, edit and accept, or reject. Nothing changes the assessment until someone with edit rights accepts it.

Safeguards:

- **Quotes are checked.** A document source must quote text that the server finds in that document; otherwise the proposal is refused and the agent is told why. Values must be valid for the field.
- **Client controls need client evidence.** A control can only be proposed as met or partial on the strength of the client's own documents, never public model information.
- **Provenance.** Accepted answers are marked "Agent" in the report, with an appendix listing each one's sources and who accepted it when. If someone later changes the answer by hand, the mark goes.
- **Per-client consent.** AI assistance (the agent and evidence review) is off for every client until an Ituti admin switches it on from the client's overview page, because documents and assessment text are sent to Anthropic's API. Agree this with the client first; consider a zero-data-retention arrangement with Anthropic.
- **Isolation.** Searches and quotes are limited to the system being assessed. Text in documents is treated as data, never as instructions.

Runs happen in the background (a few minutes; up to 20) and continue if the page is closed. Settings: `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_AGENT_MODEL` (default `claude-opus-5-5`).

## How data is stored

Data is kept in **MySQL or MariaDB**. The tables are created automatically on first start (`src/data/schema.ts`), and later versions add their changes the same way. Uploaded files are kept in the folder set by `DATA_DIR`, with their extracted text in the database.

| Table | Holds |
|---|---|
| `users`, `sessions`, `verification_tokens` | Everyone who can sign in, and their sessions and pending sign-in links |
| `organizations` | Client organisations, including whether AI assistance is on |
| `memberships`, `assessor_assignments`, `system_assignments` | Who belongs to which client, which clients each assessor covers, which systems each contributor can edit |
| `ai_systems` | One row per AI system: the full assessment as JSON, with the summary columns (tier, risk score, readiness) alongside |
| `incidents` | Incident log entries |
| `invitations` | Invitations, holding only a hash of each invitation link |
| `audit_log` | Activity log for each client |
| `documents`, `document_chunks` | Uploaded evidence and its extracted text, with a full-text index |
| `model_library` | Public information about foundation models, with source pages |
| `agent_runs`, `proposals` | Agent runs, and every proposal with its sources and who accepted or rejected it |

Saves that read before writing run in a transaction, and saves to a system carry a version number, so if two people edit the same system the second is warned instead of overwriting the first.

**Moving from the CSV version.** On first start against an empty database, CSV files found in `DATA_DIR` are imported once. The files are left in place as a backup.

**Backups.** Back up the database (for example a nightly `mysqldump`, or your host's database backups) and the `DATA_DIR` folder.

## Deploying

### Live: Hostinger

The app runs at **https://assurance.ituti.tech** as a Node.js website on the Hostinger Business plan (account `u860433774`), built from the `main` branch of this repository:

- **Build:** Next.js, Node 22, `npm run build`, started with `npm start`. Pushing to `main` rebuilds and redeploys.
- **Database:** a MySQL database on the same Hostinger account, reached at `127.0.0.1`. Its settings (`DB_*`, `DATABASE_URL`) were written by Hostinger.
- **Files:** `DATA_DIR=/home/u860433774/assurance-data`, outside the website folder so rebuilds never touch it. Uploaded evidence is kept here.
- **Email:** sent from `assurance@ituti.tech` via `smtp.hostinger.com:465`.
- **DNS:** an `A` record for `assurance` in the ituti.tech zone points at the hosting server.
- **Environment variables** are set in hPanel (Websites → assurance.ituti.tech → Node.js → Environment variables), never in the repository.

Hostinger may run more than one process for the app. That is fine: the processes share the database, and schema changes are applied once under a database lock.

### Elsewhere

You need:

1. **A server with a persistent disk and a MySQL or MariaDB database.** A small Linux VM is enough (Azure, AWS Lightsail, DigitalOcean, Hetzner). Docker is the simplest way to run it. Put a reverse proxy such as Caddy or nginx in front to handle HTTPS.
2. **SMTP for email.** With Microsoft 365, enable *Authenticated SMTP* on the sending mailbox (it is off by default in many tenants). Postmark or SendGrid also work.
3. **DNS.** Point `assurance.ituti.tech` at the server, then make sure HTTPS works.

### With Docker

```bash
cp .env.example .env          # fill in every value; generate NEXTAUTH_SECRET with: openssl rand -base64 32
mkdir -p data && sudo chown 10001:10001 data
docker compose up -d --build
```

This runs the app and a MariaDB database. Uploaded documents appear in `./data`; the database is kept in a Docker volume.

### Without Docker

```bash
cp .env.example .env          # set DATABASE_URL, and DATA_DIR to a folder on persistent storage
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

See `.env.example`. These are required: `DATABASE_URL` (or the `DB_*` settings), `DATA_DIR`, `NEXTAUTH_URL` (the public https URL), `NEXTAUTH_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, and the `SMTP_*` and `EMAIL_FROM` settings. `ANTHROPIC_API_KEY` is optional. Without it the agent and AI review are unavailable.

### Upgrading

Pull, rebuild and restart. Database changes are applied automatically on start, and the data folder is untouched.

## Developing

```bash
npm ci
cp .env.example .env.local    # DATABASE_URL of a local MariaDB, DATA_DIR="./data", NEXTAUTH_URL="http://localhost:3000", SMTP_HOST="" (empty)
npm run data:demo             # optional: adds a clearly labelled example client with one completed system
npm run dev
```

With `SMTP_HOST` empty, sign-in and invitation links are printed to the server log instead of emailed.

### Tests

Set `TEST_DATABASE_URL` to a server URL whose user may create databases named `assurance_test_*`, for example `mysql://app:pass@127.0.0.1:3306/`. Each run creates its own database and drops it afterwards, so real data is never touched.

- `npm test` runs the unit tests for:
  - the role model;
  - EU AI Act classification and scoring;
  - the agent's field validation, and parsing of model research;
  - the database layer: filters, transactions, concurrent saves, the CSV import, and document extraction and search (skipped without `TEST_DATABASE_URL`).
- `npm run build && npm run test:e2e` starts the built app and runs 62 end-to-end checks. These cover role access, cross-client isolation, saving and version conflicts, cross-site request refusal, incidents, cascading deletes, the sign-in allow-list, invitations, the bootstrap admin, document upload and download rights, and a full agent run. The agent run uses a scripted stand-in for Claude (`AGENT_FAKE_LLM=1`, for tests only), including proposals with an invented quote, an invalid value and model-only control evidence, all of which must be refused.

## Where things are

| Path | What |
|---|---|
| `src/lib/assurance.ts` | Control library, EU AI Act classification, UK obligations, risk score, readiness. The content is here. |
| `src/data/sql.ts` | Database access: filters, transactions, encoding |
| `src/data/schema.ts` | Tables and migrations, applied automatically |
| `src/data/index.ts` | The tables, their columns, and cascading deletes |
| `src/data/csv-import.ts` | One-off import from the earlier CSV storage |
| `src/lib/documents.ts` | Document storage, text extraction and search |
| `src/lib/agent/` | The assessment agent: fields it may fill (`fields.ts`), the run loop and tools (`runner.ts`), the public model library (`models.ts`) |
| `src/lib/permissions.ts` | The role model as pure functions |
| `src/lib/session.ts` | Loads the signed-in user and their rights over a client or system |
| `src/app/actions.ts` | Server actions for clients, invitations, members, staff and system creation |
| `src/app/api/` | JSON endpoints for saving systems, incidents, CSV export and AI review |
| `src/components/editor/SystemEditor.tsx` | The assessment editor |
| `src/components/editor/AgentPanel.tsx` | The Evidence and agent tab |

## Security and data protection notes

- Sign-in links are single use and expire after 15 minutes. Only existing users, people with a pending invitation, and the bootstrap admin can request one. Sessions last 14 days and end immediately when an account is disabled.
- Every page and endpoint checks the user's rights on the server. Clients cannot see each other's data.
- Writes must come from the app's own origin as JSON.
- **The database and data folder hold all client data.** Keep them on encrypted storage, restrict who can reach the server, and encrypt backups.
- **The agent and AI review send documents and assessment text to Anthropic's API**, only for clients where an Ituti admin has switched AI assistance on. Check this is covered by your agreements with clients, and consider a zero-data-retention arrangement with Anthropic. Model research only fetches public pages from official provider domains.
- Classification is an indication based on the answers recorded and is not legal advice. The control library paraphrases the public texts of Regulation (EU) 2024/1689, UK guidance, ISO/IEC 42001:2023 and NIST AI RMF 1.0. Review it against current guidance periodically, as regulators publish updates.
