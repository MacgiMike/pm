# Lockred Projects

Multi-tenant project management: directives and KPIs, plan with tollgates, swim lanes that roll up task progress, budget posts with invoice booking, reports, external task links, a support portal, an operator console, affiliate partners with their own monthly-resetting demo portals, and Stripe billing.

- **Web:** Next.js 15 (React 19), port **47813**
- **API:** NestJS 11 + Prisma 6, port **47814** (internal)
- **Database:** PostgreSQL 17 with row-level security
- **Runs on:** Docker Compose behind Traefik on the external network `proxy`
- **Address:** every tenant lives under one host, e.g. `https://pm.lockred.app/<tenant>`

All dependencies use permissive licenses (MIT, Apache-2.0, BSD, ISC, OFL fonts). There is no copyleft code. Acknowledgments are shown at `/terms#acknowledgments` and listed in `THIRD_PARTY_NOTICES.md`.

---

## Deploying on Ubuntu 26.04

### 1. Prerequisites

- Docker Engine with the Compose plugin
- Traefik already running, attached to the external Docker network `proxy`, with an HTTPS entrypoint and a certificate resolver
- A DNS record for your host (e.g. `pm.lockred.app`) pointing at the server

If the `proxy` network doesn’t exist yet: `docker network create proxy`.

### 2. Get the code and configure

```bash
git clone https://github.com/MacgiMike/pm.git lockred && cd lockred
cp .env.example .env
nano .env
```

At minimum, set these in `.env`:

| Variable | What to put |
|---|---|
| `APP_HOST` / `APP_URL` | `pm.lockred.app` / `https://pm.lockred.app` |
| `TRAEFIK_ENTRYPOINT` | Your Traefik HTTPS entrypoint name (often `websecure`) |
| `TRAEFIK_CERTRESOLVER` | Your certificate resolver name exactly as in Traefik’s static config, or empty if you use a default/wildcard certificate |
| `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD` | `openssl rand -hex 32` (two different values) |
| `APP_SECRET` | `openssl rand -hex 32` |
| `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` | Your first operator login |
| `SMTP_*`, `MAIL_FROM` | Your mail provider (invites, task links, reports) |

Leave the Stripe variables empty until you’ve set up Stripe (step 5). Everything else works without them.

### 3. Start

```bash
docker compose up -d --build
docker compose logs -f api   # wait for "API listening on :47814"
```

The API runs database migrations on every start. On first start it also:
- creates the operator account from `OPERATOR_EMAIL` / `OPERATOR_PASSWORD`, and
- creates the public demo at `/demo`.

### 4. First sign-in

1. Open `https://pm.lockred.app/login` and sign in with the operator email and password.
2. You’ll be asked to set up 2-step sign-in. The operator console (`/ops`) requires it.
3. After that, change `OPERATOR_PASSWORD` in `.env` to something else or remove it. It is only used when no operator exists.

### 5. Stripe

1. In Stripe, create a product with three **recurring, per-unit** prices (Starter, Team, Business). Put their price IDs in `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_TEAM` and `STRIPE_PRICE_BUSINESS`.
2. Set `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint at `https://pm.lockred.app/api/billing/webhook` with these events:
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `account.updated`.
   Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
4. Turn on the **Customer portal** in Stripe (Settings → Billing → Customer portal) so customers can change card, plan and cancel.
5. For affiliate payouts, turn on **Stripe Connect** (Express accounts).
6. `docker compose up -d` to apply.

**Without Stripe:** trials never expire, and you manage plans and seats by hand in the operator console.

### 6. Updating

```bash
git pull
docker compose up -d --build
```

---

## How it fits together

```
Internet → Traefik (proxy network, TLS; routers lockredpm-web / lockredpm-api)
             ├─ Host(pm.lockred.app) && PathPrefix(/api) → api:47814 (NestJS)
             └─ Host(pm.lockred.app)                     → web:47813 (Next.js)
api ─ internal network ─ db (PostgreSQL 17)   backup (nightly pg_dump → volume "backups")
```

### Tenant isolation, defense in depth

1. **Database:** every tenant table has a row-level-security policy. The API reads and writes tenant data as the restricted `lockred_app` role, inside a transaction pinned to one tenant (`app.tenant_id`). Postgres itself refuses to return or write another tenant’s rows, even if application code has a bug.
2. **API:** each request resolves the session → tenant membership → project access.
3. **Projects are deny-by-default.** Only project members see a project. Tenant admins and portfolio managers get read-only access. Anyone else gets a 404, so they can’t even tell the project exists.

### Roles

| Where | Role | Can |
|---|---|---|
| Organization | Admin | Everything in the tenant: users, settings, billing, audit log, export. Read-only on projects they’re not on. |
| Organization | Portfolio manager | See every project and its progress; change project owners. Edit only projects they’re on. |
| Organization | Member | Only projects they’ve been added to. |
| Project | Owner | Everything, including who has access. |
| Project | Co-lead | Everything except giving or removing access. |
| Project | Contributor | Tasks, lanes, progress, comments, files. **No budget**, KPIs or settings. |
| Task | Task link (external) | One task only: progress, comments, files. No login. |

Task links are 256-bit random tokens stored as SHA-256 hashes. They can be revoked, expire, and stop working when the team marks the task done (if set to “until done”). Sending a new link invalidates the old one.

### Progress and health

- **Task → lane → project:** a lane’s progress is the average of its tasks, weighted by estimated hours (no estimate counts as 1 h). The project total uses the same weighting across all tasks.
- **Planned progress:** where each task should be today, assuming even progress between its start and due date.
- **Health:** *At risk* when behind plan by more than the risk threshold (default 5 pts) or when the budget forecast is over. *Behind* when behind by more than the behind threshold (default 10 pts) or already over budget. Admins change the thresholds under Admin → Reporting rules.
- **Forecast at finish** = spent + budget × (1 − progress).
- A nightly job stores each project’s progress so reports can draw the actual S-curve.

### Scheduled jobs (API container)

| When (in `TZ`) | Job |
|---|---|
| 01:15 daily | Progress snapshots for reports |
| 02:30 daily | Database backup (separate `backup` container, keeps 14) |
| 06:50 Mondays | Weekly status email to owners, co-leads and managers |
| 03:00 on the 1st | Reset every demo portal (public + each partner’s) |

### Affiliate program

- An operator adds a partner in `/ops/affiliates`. The partner gets an email to set a password, a referral link (`/?ref=code`) and their own demo portal (`/demo/code`).
- Visitors who click the link or use the partner’s demo are remembered for `AFFILIATE_COOKIE_DAYS`. A trial started in that window is attributed to the partner.
- When a referred customer’s Stripe invoice is paid, a commission of `AFFILIATE_COMMISSION_PERCENT` % of the net amount is recorded, for `AFFILIATE_COMMISSION_MONTHS` months.
- Partners connect a Stripe Express account from their portal. Operators pay out pending commission with one click (Stripe transfer).

---

## Backups and restore

Dumps are written nightly to the `backups` volume:

```bash
docker compose exec backup ls -lh /backups
```

To restore into a fresh database:

```bash
docker compose stop api web
docker compose exec -T db psql -U lockred -d postgres -c "DROP DATABASE lockred;" -c "CREATE DATABASE lockred;"
docker compose exec -T backup sh -c 'gunzip -c /backups/lockred-YYYYMMDD-HHMM.sql.gz' | docker compose exec -T db psql -U lockred -d lockred
docker compose up -d
```

Uploaded files live in the `uploads` volume. Back that up too, e.g. with `docker run --rm -v lockred_uploads:/d -v $PWD:/o alpine tar czf /o/uploads.tgz -C /d .`

---

## Local development

```bash
# Postgres
docker run -d --name lr-db -e POSTGRES_USER=lockred -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=lockred -p 5432:5432 postgres:17-alpine
docker exec lr-db psql -U lockred -c "CREATE ROLE lockred_app LOGIN PASSWORD 'apppw';"

# API
cd api && npm install
export DATABASE_URL=postgresql://lockred:pw@localhost:5432/lockred APP_DATABASE_URL=postgresql://lockred_app:apppw@localhost:5432/lockred
export APP_URL=http://localhost:47813 OPERATOR_EMAIL=you@example.com OPERATOR_PASSWORD=change-me-please OPERATOR_REQUIRE_MFA=false
npx prisma migrate deploy && npm run build && npm start

# Web (in another terminal)
cd web && npm install && API_INTERNAL_URL=http://localhost:47814 npm run dev
```

Open http://localhost:47813. Emails are printed to the API log when SMTP isn’t configured.

### Tests

GitHub Actions (`.github/workflows/ci.yml`) builds both apps and the Docker images, and runs end-to-end tests against a real PostgreSQL. The tests cover tenant isolation, deny-by-default project access, every role, progress roll-up, budget, owner change, task links, reports, support and the demo. Locally, with the API running: `cd api && npm run test:e2e`.
