# Ituti AI Assurance: on-premises package

This package installs the complete Ituti AI Assurance platform on your own servers: the web application (the same
interface as assurance.ituti.tech), the assessment crew of agents, and the A2A agent endpoints. A deployment agent
creates the database, the application user and every table, configures the service, checks it and gives you a
first sign-in link. AI spend is tracked inside the platform, with monthly budgets, so you do not need an external
control plane.

## What you need

| | |
|---|---|
| Server | Linux (x86-64 or ARM64), 2 CPUs, 4 GB memory, 10 GB disk for the application, plus storage for documents |
| Runtime | **Docker Engine 24+** with the compose plugin (recommended), or **Node.js 22+** where containers are not allowed |
| Database | **MySQL 8.0+ or MariaDB 10.6+** of your own, or a MariaDB container on the same server (`DB_MODE=bundled`, Docker only) |
| Storage | A persistent, backed-up folder for uploaded evidence documents (local disk, SAN or NFS) |
| Network | Users reach the server over HTTPS. For the AI agents, outbound HTTPS to `api.anthropic.com`, or to your API gateway (`ANTHROPIC_BASE_URL`), directly or through a proxy (`HTTPS_PROXY`) |
| Optional | A mail server (SMTP) for sign-in emails; an Anthropic API key for the agents; IBM watsonx Orchestrate for traces |

Without a mail server, administrators issue one-time sign-in links on the **System** page. Without an API key the
platform works, but the assessment agents and evidence review stay off.

## Install in three steps

```bash
tar -xzf ituti-ai-assurance-onprem-<version>.tar.gz && cd ituti-ai-assurance-onprem-<version>
cp ituti.conf.example ituti.conf && chmod 600 ituti.conf && vi ituti.conf     # database, server, storage, address
./install.sh install --config ituti.conf
```

Run it on the server itself, or on your workstation with `DEPLOY_HOST` set: the installer then copies itself to the
server over SSH (key-based login, an account with sudo) and runs there.

### What the installer does

1. **Checks the server**: operating system, memory, Docker or Node.js, disk space, the port.
2. **Prepares the application**: loads the container image shipped in `images/`, or builds it from the bundled
   application (no source code or build tools needed), or pulls `IMAGE` from your registry. With the node runtime it
   copies the application into `DEPLOY_DIR/releases/<version>`.
3. **Runs the deployment agent's checks**: settings, database connection and version, storage (writable, free
   space), mail server login, AI key and reachability. Anything marked ✗ stops the installation with the fix.
4. **Backs up** the database first when upgrading.
5. **Database**: with `DB_ADMIN_USER` (or the bundled database) it creates the database (utf8mb4) and the application
   user with rights on that database only; then it creates or updates every table (migrations are versioned and
   only ever added). It creates the first administrator and the overall AI budget.
6. **Writes the settings** (`DEPLOY_DIR/app.env`, readable only by administrators and the service) and, for Docker,
   `docker-compose.yml` with the app, the bundled database and an HTTPS proxy as configured.
7. **Starts the service**: containers that restart automatically, or a systemd service `ituti-assurance` running as
   the unprivileged `ituti` account with a read-only view of the system.
8. **Verifies** it: health (database and storage), the main agent card, the seven specialist agents, and whether
   users can reach `APP_URL`.
9. **Prints a one-time sign-in link** for the first administrator (valid 24 hours), and keeps a copy of the
   installer and your settings in `DEPLOY_DIR` for later commands.

Every step can be run again safely. To change a setting, edit `DEPLOY_DIR/ituti.conf` and run the installer again.

## Day-to-day commands

Run on the server (or from your workstation with `DEPLOY_HOST`):

| Command | Does |
|---|---|
| `sudo /opt/ituti-assurance/installer/install.sh status` | Installed version and service health |
| `… check` | All checks, without changing anything |
| `… backup [--with-files]` | Database dump (gzip SQL, restorable with `mysql`), settings, and with `--with-files` the documents, into `BACKUP_PATH` |
| `… install` (from a newer package) | Upgrade: backs up, then installs the new version and applies new migrations |
| `… rollback` | Back to the previous version (restore the pre-upgrade backup if the database changed) |
| `… admin-link [--email you@bank.com]` | A new one-time sign-in link |
| `… doctor [--ai]` | Diagnoses problems; with `--ai`, Claude suggests fixes (findings sent with passwords and keys removed) |
| `… restart`, `stop`, `logs` | Service control |
| `… uninstall` | Removes the service; keeps the database, documents and backups |

## Spend tracking without a control plane

Every call to Claude, whether by the assessment crew, the A2A agent endpoints or evidence review, is recorded with
the client, AI system, run, agent, model, tokens and estimated cost. Administrators see it under **Spend**:

- this month's spend and a forecast for the month, daily spend, and breakdowns by client, agent, model and source;
- monthly budgets for the whole installation and per client, with an email to administrators (and the client's
  admins) at the alert level and when reached, and an optional **hard stop** that pauses new AI work;
- a CSV export of every call for your FinOps tooling.

Costs are estimated at Anthropic list prices; set `ANTHROPIC_PRICES` for your negotiated rates. If you also use IBM
watsonx Orchestrate, set the `ORCHESTRATE_*` settings and each agent's traces are sent there as well.

## The agents

The platform's agents run inside the application and are published over A2A 0.3.0 at your own address:
`APP_URL/api/a2a` (main agent) and `APP_URL/api/a2a/agents/<specialist>` for the evidence reader, model researcher (only with `AGENT_EXTERNAL_RESEARCH=true`),
risk classifier, controls assessor, documentation writer, conformity writer and source checker. Register them in any
A2A control plane with a client API key created on the client's page.

The platform is also an MCP server at `APP_URL/api/mcp`, so Claude, watsonx Orchestrate and other MCP clients can
connect to your installation directly: people sign in with OAuth and approve the connection, and their own rights
apply. If MCP clients reach the server from browsers on other sites, list those origins in `MCP_ALLOWED_ORIGINS`.

## Security notes

- The application runs unprivileged (container user 10001, or the `ituti` service account), and can write only to
  the document folder, its logs and its cache.
- Passwords and keys live in `ituti.conf` and `app.env`, both readable by administrators only (and the service for
  `app.env`). Generated secrets (session secret, bundled database passwords) are kept in `DEPLOY_DIR/secrets.env`.
- Database connections can use TLS (`DB_SSL`, `DB_SSL_CA`). Serve the app over HTTPS: give `TLS_CERT_FILE` and
  `TLS_KEY_FILE` (Docker), or put it behind your reverse proxy with `BIND_ADDRESS=127.0.0.1`.
- Client documents are sent to Anthropic only for clients whose administrator has switched AI assistance on.
- Self-service sign-up is off by default on-premises; users are invited.

## Building the package

From the repository: `onprem/build-bundle.sh` (add `--image` to include the container image, and `--deps` for the
MariaDB and Caddy images, for servers with no registry access). Tagging a commit `onprem-v<version>` builds, tests
(a real installation against MariaDB) and publishes the package as a GitHub release and the image to GitHub
Container Registry.
