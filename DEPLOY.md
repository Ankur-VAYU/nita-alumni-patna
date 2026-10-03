# Deploying the NITA Alumni Patna backend

This covers the first live part of the app: the **join form** and the **admin tools** to create and
verify member accounts. The member app screens (directory, events, board) come in the next phase
and will use the same deployment and database.

Chosen setup: **Cloudflare Workers** (free plan) runs the app, and **Neon** (free plan) holds
the PostgreSQL database. Cloudflare **Hyperdrive** connects the two.

```
Member's phone ──► Cloudflare Worker "nitaalumini" ──► Hyperdrive ──► Neon PostgreSQL
                   (join form, admin API)                             (all data)
Admin's computer ── command line (npm run cli) ─────────────────────► Neon PostgreSQL
```

## 1. Where is the data saved?

All data is saved in **one PostgreSQL database in your Neon project**. Cloudflare runs the
code but stores no member data.

| Data | Table | Notes |
| --- | --- | --- |
| Member profiles (all form fields) | `members` | One row per person; mobile number and roll number are unique |
| Profile photos | `members.photo` | Shrunk in the browser to 512 px (about 50–100 KB) |
| Proof documents | `members.proof` | At most 500 KB (certificate photos are shrunk automatically). **Deleted when an admin approves or rejects**; the file name is kept |
| Institute batch list | `batch_records` | Used only to check registrations |
| Who did what, and when | `audit_log` | Every registration, creation, import, approval, rejection and role change |

**Region:** when creating the Neon project, choose the region closest to members (check the list
Neon offers; Singapore was the nearest to India that I knew of). India's Digital Personal Data Protection Act, 2023 applies to this data. Have the privacy
notice and any data-location question checked by someone qualified.

**Row-level security is on.** Migration `0002_row_level_security.sql` turns on row-level
security for every table. That blocks any automatic data API a host may offer (Neon's optional
Data API, for example), while the app, which connects as the database owner, is unaffected. Don't
turn it off or add policies unless you mean to expose data.

## 2. Free-plan limits (check before relying on them)

These are from my knowledge of the plans and may have changed. Check the current terms on
cloudflare.com and neon.tech.

- **Cloudflare Workers Free:** about 100,000 requests a day, and a small amount of CPU time per
  request (10 ms). I measured a registration with photo at about 3 ms of CPU, and one with a
  500 KB proof at about 7 ms. That's why proofs are limited to 500 KB and certificate photos are
  shrunk. If registrations with proofs start failing, the paid Workers plan removes this limit.
- **Neon Free:** a small amount of storage (around 0.5 GB when I last knew). That is enough for a
  few thousand members because photos are small and proofs are deleted after review. Watch the
  storage figure in the Neon dashboard. When nobody uses the app, Neon puts the database to sleep;
  the next visit wakes it automatically and takes a second or two longer. No one has to restore it.
- **Backups:** Neon's free plan keeps only a short history for restoring. Take your own backups
  (section 6).

## 3. Set up and deploy, step by step

You need: a Neon account, a Cloudflare account, and a computer with Node.js 20 or newer and
Git. All commands run in the `backend` folder of this repository.

```bash
git clone https://github.com/Ankur-VAYU/nita-alumni-patna.git
cd nita-alumni-patna/backend
npm install
```

### Step 1: Create the database (Neon)
1. On neon.tech create a **new project**: name `nita-alumni-patna`, PostgreSQL version as offered,
   region closest to India.
2. Open **Connect** (Connection details) and copy the connection string with **connection pooling
   turned off**: the "direct" string, whose host does not contain `-pooler`. Hyperdrive does its
   own pooling. It looks like
   `postgresql://neondb_owner:<password>@ep-<name>.<region>.aws.neon.tech/neondb?sslmode=require`.

### Step 2: Create the tables (from your computer)
```bash
cp .env.example .env
# In .env set:
#   DATABASE_URL=<the direct connection string from step 1>
#   ADMIN_API_KEY=<a long random secret: openssl rand -hex 32>
npm run cli -- migrate
```
You should see `Applied 0001_init.sql`, `Applied 0002_row_level_security.sql`, `Database is up to date.`
I could not test against Neon from where this was built. If this step fails, send me the exact error.

### Step 3: Connect Cloudflare to the database (Hyperdrive)
```bash
npx wrangler login                       # opens the browser to sign in to Cloudflare
npx wrangler hyperdrive create nita-alumni-db --connection-string="<the direct connection string>"
```
Copy the `id` it prints into `backend/wrangler.jsonc`, replacing `REPLACE_WITH_HYPERDRIVE_ID`, then
commit and push that change. The id is not a secret. The database password is stored inside
Hyperdrive, not in the code.

### Step 4: Store the admin key in Cloudflare
```bash
npx wrangler secret put ADMIN_API_KEY      # paste the same value as in your .env
```

### Step 5: Deploy
```bash
npm run deploy
```
The first time, Cloudflare asks you to choose a **workers.dev subdomain** for your account (for
example `nita-patna`). The app is then at `https://nitaalumini.<your-subdomain>.workers.dev`.
Open `/health` (should show `{"ok":true}`), then `/join`.

For a shorter address such as `join.yourchapter.org`, you need your own domain added to
Cloudflare. Then add it under the Worker's *Settings → Domains & Routes*.

**Automatic deploys (optional):** in the Cloudflare dashboard open the Worker and use
*Settings → Build → Connect* to link the GitHub repository. Set the root directory to `backend`
and the deploy command to `npx wrangler deploy`. Every push to `main` then redeploys.
Database changes are still applied by running `npm run cli -- migrate` from your computer, before
deploying code that needs them.

### Step 6: Remove the Vercel project
The repository no longer contains Vercel settings. Delete the `nitaalumini` project on Vercel so it
stops building on every push. If you created a Neon database through Vercel, you can reuse it
instead of making a new one in step 1, or delete it.

## 4. Creating accounts from the backend

Admin commands run **from an admin's own computer** and connect straight to Neon using
`DATABASE_URL` in `backend/.env`. That file holds the key to all member data: keep it only on
admins' own computers and never commit it.

All methods apply the same rules as the join form: a valid Indian mobile number, a home district
in Bihar, a known degree and branch, and no duplicate mobile or roll number. Every action is
recorded in the activity log.

### a) One person at a time
```bash
npm run cli -- member:create \
  --name "Full Name" --phone 9XXXXXXXXX --email name@example.com --roll 08UCE021 \
  --degree B.Tech --branch "Civil Engineering" --batch 2012 --home-district Patna \
  --position "Executive Engineer" --organisation "Example Org" \
  --work-district Patna --work-state Bihar --by "Your Name"

# Make someone an admin (they must exist first), with the title members will see:
npm run cli -- admin:make 9XXXXXXXXX --title President --by "Your Name"
```
Accounts created this way are **verified** straight away. Add `--status pending` to send them
through review instead.

### b) Many people from a spreadsheet
1. Start from `backend/templates/members-import-template.csv`, or export Google Form responses as
   CSV. Column names like "Mobile number" or "Batch (passing year)" are understood, and extra
   columns such as "Timestamp" are ignored. Details: `backend/templates/README.md`.
2. **Try without saving:** `npm run cli -- members:import members.csv --dry-run`. It lists every
   row that needs fixing and why.
3. Import for real: `npm run cli -- members:import members.csv --by "Your Name"`. Rows already
   registered are skipped, so a corrected file can be imported again.

### c) Through the admin API
Every request needs the header `x-admin-key: <ADMIN_API_KEY>`; optionally add
`x-admin-name: Your Name` for the activity log.

| Action | Request |
| --- | --- |
| List registrations | `GET /api/v1/admin/members?status=pending` |
| See one member | `GET /api/v1/admin/members/:id` (photo: `/photo`, proof: `/proof`) |
| Create one account | `POST /api/v1/admin/members` with JSON (same fields as the form; optional `status`, `role`, `title`) |
| Import a spreadsheet | `POST /api/v1/admin/members/import?dryRun=true` with the CSV as the body and `Content-Type: text/csv` |
| Approve / reject | `POST /api/v1/admin/members/:id/approve`; `POST /api/v1/admin/members/:id/reject` with `{"reason": "..."}` |
| Roles | `POST /api/v1/admin/members/:id/role` with `{"role": "admin", "title": "Treasurer"}` |
| Suspend / reinstate | `POST /api/v1/admin/members/:id/suspend`, `/reinstate` |
| Upload batch list | `POST /api/v1/admin/batch-list` with the CSV body |
| Download members | `GET /api/v1/admin/members.csv?status=verified` |
| Activity log | `GET /api/v1/admin/audit` |

Large spreadsheet imports are better done with the command line (4b), which has no time or CPU
limit.

## 5. Collecting data and reviewing registrations

Share `https://nitaalumini.<your-subdomain>.workers.dev/join` on WhatsApp groups. Registrations
arrive as **pending**. Until the admin screens are built, review them from the command line:
```bash
npm run cli -- batch:import batch-list.csv --by "Your Name"     # once, and whenever the list changes
npm run cli -- members:list --status pending
npm run cli -- member:approve 9XXXXXXXXX --by "Your Name"
npm run cli -- member:reject 9XXXXXXXXX --reason "Roll number not found in batch records" --by "Your Name"
```
To see a proof document before deciding:
`curl -H "x-admin-key: $ADMIN_API_KEY" -o proof.pdf https://nitaalumini.<your-subdomain>.workers.dev/api/v1/admin/members/<id>/proof`

## 6. Backups

Weekly, from an admin's computer (needs PostgreSQL client tools with `pg_dump` at the same or a
newer major version than the Neon database):
```bash
scripts/backup-remote.sh            # reads DATABASE_URL from .env, writes backups/…sql.gz
```
Keep copies away from that computer, for example in a private cloud folder. Test a restore once into
a new empty database: `gunzip -c backups/<file>.sql.gz | psql "<new database URL>"`.

## 7. Security checklist before going live

- `ADMIN_API_KEY` is long and random, known only to admins, and changed when someone leaves the committee (`npx wrangler secret put ADMIN_API_KEY` and each admin's `.env`).
- `.env` and `.dev.vars` files are never committed (both are in `.gitignore`).
- Row-level security is on for every table (the migration does this; `npm run cli -- migrate` shows it applied).
- Backups are taken and stored away from the admin's computer; a restore has been tested once.
- The privacy notice on the form has been reviewed.
- Optional, with your own domain on Cloudflare: add a WAF rate-limiting rule for `/api/v1/join`. The app's own limit counts per Cloudflare instance, so it is weaker.

## 8. Known limits of this first version

- Admins share one key instead of having their own sign-in. Personal admin sign-in with OTP comes with the member app.
- No WhatsApp or email messages yet; applicants are not told automatically when they are approved.
- Proof documents are limited to 500 KB to stay within the free plan's CPU limit.

## Appendix A: trying it on your computer

```bash
docker compose -f docker-compose.dev.yml up -d   # local PostgreSQL
# .env: DATABASE_URL=postgres://postgres:postgres@localhost:5432/nita_alumni
npm run cli -- migrate
npm run dev            # Node version at http://localhost:3000/join
# or, the Cloudflare version (uses localConnectionString in wrangler.jsonc and ADMIN_API_KEY from .dev.vars):
npm run dev:worker     # http://localhost:8787/join
```

## Appendix B: hosting on your own server instead

`backend/docker-compose.yml`, `Caddyfile` and `scripts/backup.sh` run the same app with its own
PostgreSQL and automatic HTTPS on one Linux server. In short: point a domain at the server,
`cp .env.example .env`, and set `ADMIN_API_KEY`, `POSTGRES_PASSWORD` and `DOMAIN`. Then run
`docker compose up -d --build`. The command line then runs as
`docker compose exec api node dist/cli.js <command>`.
