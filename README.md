# Ituti AI Assurance

A multi-client web app for assessing AI systems against the **EU AI Act**, **UK requirements** (AI principles, FCA Consumer Duty, SM&CR, PRA SS1/23), **ISO/IEC 42001** and the **NIST AI RMF**. Intended to run at `assurance.itutitech.com`.

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

## Stack

- Next.js 15 (App Router) and React 19
- PostgreSQL with Drizzle ORM; migrations live in `drizzle/`
- NextAuth email sign-in, with sessions stored in the database
- Nodemailer over SMTP for sign-in links and invitations
- Optional: Anthropic API for "Review evidence with Claude"

## Deploying

You need four things:

1. **A Postgres database**, version 15 or later. Use a managed service (Azure Database for PostgreSQL, AWS RDS, DigitalOcean, Neon) or the bundled one in `docker-compose.yml`. Turn on automated backups.
2. **A host for the app.** Choose one:
   - **A Linux VM with Docker:** `docker compose up -d --build`, with a reverse proxy such as Caddy or nginx handling HTTPS.
   - **A container service** (Azure App Service, AWS App Runner, Google Cloud Run): build the `Dockerfile`.
   - **Vercel:** set the environment variables in the project and add `npm run db:migrate` before the build command.
3. **SMTP for email.** With Microsoft 365, enable *Authenticated SMTP* on the sending mailbox (it is off by default in many tenants). Postmark or SendGrid also work.
4. **DNS.** Point `assurance.itutitech.com` at the host, for example with a CNAME record. Then make sure HTTPS works.

### First deploy

```bash
cp .env.example .env              # fill in every value; generate NEXTAUTH_SECRET with: openssl rand -base64 32
npm ci
npm run db:migrate                # creates the tables
npm run db:seed                   # makes BOOTSTRAP_ADMIN_EMAIL an Ituti admin
npm run build && npm start
```

With Docker the container applies migrations itself on start. Run the seed once with `docker compose exec app node scripts/seed.mjs`.

Then sign in with the bootstrap admin email:

1. Add a client.
2. Invite the client's lead as **Client admin**.
3. Invite colleagues from the **Ituti team** page.

### Environment variables

See `.env.example`. These are required: `DATABASE_URL`, `NEXTAUTH_URL` (the public https URL), `NEXTAUTH_SECRET`, `BOOTSTRAP_ADMIN_EMAIL`, and the `SMTP_*` and `EMAIL_FROM` settings. `ANTHROPIC_API_KEY` is optional. Without it the AI review button is hidden.

### Upgrading

Pull, rebuild and restart. Schema changes ship as new files in `drizzle/` and are applied by `npm run db:migrate`, or automatically by the Docker image.

## Developing

```bash
npm ci
npm run db:local                  # throwaway Postgres on port 5433 (leave running)
cp .env.example .env.local        # DATABASE_URL=postgresql://assurance:assurance@localhost:5433/assurance, NEXTAUTH_URL=http://localhost:3000, SMTP_HOST empty
npm run db:migrate && npm run db:seed && npm run db:demo
npm run dev
```

With `SMTP_HOST` empty, sign-in and invitation links are printed to the server log instead of emailed. `npm run db:demo` adds a clearly labelled example client with one completed system.

To change the schema, edit `src/db/schema.ts`, run `npm run db:generate`, and commit the new migration.

### Tests

- `npm test` runs the unit tests for permissions and the classification and scoring logic.
- `npm run build && npm run test:e2e` starts the built app against `DATABASE_URL` and runs 36 end-to-end checks. These cover role access, cross-client isolation, saving and version conflicts, cross-site request refusal, incidents, deletion, the sign-in allow-list and invitations. The test creates its own data with a unique prefix and removes it afterwards. Point it at a development database, never production.

## Where things are

| Path | What |
|---|---|
| `src/lib/assurance.ts` | Control library, EU AI Act classification, UK obligations, risk score, readiness. The content is here. |
| `src/lib/permissions.ts` | The role model as pure functions |
| `src/lib/session.ts` | Loads the signed-in user and their rights over a client or system |
| `src/app/actions.ts` | Server actions for clients, invitations, members, staff and system creation |
| `src/app/api/` | JSON endpoints for saving systems, incidents, CSV export and AI review |
| `src/components/editor/SystemEditor.tsx` | The six-tab assessment editor |
| `src/db/schema.ts` | Database schema |

## Security and data protection notes

- Sign-in links are single use and expire after 15 minutes. Only existing users, people with a pending invitation, and the bootstrap admin can request one. Sessions last 14 days and end immediately when an account is disabled.
- Every page and endpoint checks the user's rights on the server. Clients cannot see each other's data.
- Writes must come from the app's own origin as JSON. Saves use version numbers, so one person cannot silently overwrite another's changes.
- **AI review sends the system's profile and the evidence text to Anthropic's API.** Check this is covered by your agreements with clients before enabling it, and consider a zero-data-retention arrangement with Anthropic.
- Classification is an indication based on the answers recorded and is not legal advice. The control library paraphrases the public texts of Regulation (EU) 2024/1689, UK guidance, ISO/IEC 42001:2023 and NIST AI RMF 1.0. Review it against current guidance periodically, as regulators publish updates.
