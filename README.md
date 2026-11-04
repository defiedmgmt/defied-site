# Defied MGMT — website and dashboard

One Next.js 14 app (pages router) on Vercel:

- **The public site**: home, about, team, roster, contact (`pages/*.jsx`, rendered by `components/App.jsx`).
- **The staff dashboard** (`/dashboard`): Home, To do, Publishing, Money, A&R, Luminate and Site.
- **The client portal** (`/portal`): each client's own songs and splits.

Data lives in Neon Postgres (`lib/db.js`). The dashboard also reads and writes the pub master sheet and reads the
accounting sheet (Google Sheets, `lib/sheets.js`, `lib/accounting.js`), reads Stripe (`lib/stripe.js`) and uses
ClickUp (`lib/clickup*.js`). The whole UI and its CSS are in `components/App.jsx`. Server code is in `lib/` and
`pages/api/`. The Mac helper for Luminate exports is in `helper/` (see `helper/README.txt`).

## Run locally

    npm install
    # the env vars below, in .env.local (never commit it)
    npm run dev          # http://localhost:3000

`npm run build` runs the migrations first (see below), but only on a Vercel production build, so a local build
never touches a database.

## Deploy

Pushing `main` to GitHub deploys production on Vercel. The production build runs `node scripts/migrate.mjs --build`
before `next build`. If a migration fails, the build stops and the live site stays on the last good deploy.

## Database migrations

- The schema changes are in `db/migrations/NNN-name.sql`. They run in file-name order, and each file runs once. Each
  file runs in its own transaction, together with its row in the `schema_migrations` table, so a file that fails
  changes nothing and is tried again on the next deploy.
- Migrations only add things. Every statement is safe to run again (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`). The runner refuses any file containing `DROP`, `TRUNCATE` or `DELETE`, and then
  nothing runs at all.
- To add one, create `db/migrations/011-what-it-does.sql` (the next number) and append the same SQL to
  `db/schema.sql`. `db/schema.sql` builds a fresh database in one go.
- To run them by hand:
  - `DATABASE_URL=… node scripts/migrate.mjs` applies what's new.
  - `--dry-run` lists what would run.
  - The script reads no `.env` file.
- `db/migrate.mjs` is something else: a one-time import of an old JSON export. It empties the main tables first.

## Roles and permissions

Every staff login has a role. Founders set roles in **Site › Users** (`lib/roles.js`).

| Role | Can use |
|---|---|
| Founder | Everything, including Money and Users (user management). |
| Co-manager | Everything except Money and Users. Can optionally be limited to their own artists. |
| Intern | Site only (website content, messages). |
| Client | Their own portal. Unchanged. |

- A Founder can turn any section on or off for one person, on top of their role.
- "Only their own artists" limits a Co-manager to the clients whose **Assigned Manager** on the accounting sheet's
  INFO tab is that person's name. The daily cron reads INFO, and so does "Update from the sheet" in Site › Users.
  Luminate works on every artist at once, so it's off for a limited Co-manager.
- The server enforces all of it. Every dashboard API route starts with the same check, `requireAccess` in
  `lib/access.js`, and the dashboard just hides what an account can't use.
- The sign-in and the session are unchanged: `users.role` is still `staff` or `client`. The role is
  `users.staff_role` and the per-person changes are `users.access` (migration 010).
- The Founders are Devin, Burny and Hank. Every other staff login is a Co-manager.
- There's always at least one Founder. Only a Founder can change roles, or another Founder's login.

There are no demo logins. Accounts are created in Site › Users.

## Environment variables

Set them in Vercel (Project › Settings › Environment Variables) and in `.env.local` for local work. Names only here,
never values.

**Needed to run**

| Name | What it's for |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. The app and the build's migrations use it. |
| `SESSION_SECRET` | At least 32 characters. Seals the sign-in cookie. Changing it signs everyone out. |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | The Google service account's email. |
| `GOOGLE_SHEETS_PRIVATE_KEY` | That service account's private key (`\n` for line breaks). |
| `GOOGLE_SHEET_ID` | The pub master sheet. |

**Features (each one is off, or says "not connected", until it's set)**

| Name | What it's for |
|---|---|
| `ACCOUNTING_SHEET_ID` | The accounting sheet. Used by Money, Home's money tiles and INFO's managers. The service account needs Viewer (Editor for logging). |
| `STRIPE_READ_KEY` | A restricted, read-only Stripe key. Used by Money and Home. |
| `CLICKUP_API_TOKEN` | ClickUp: To do's tasks, the dashboard's own tasks, alerts. |
| `CLICKUP_ALERTS_CHANNEL_ID` | The ClickUp Chat channel for dashboard alerts. Defaults to "Dashboard Alerts". |
| `CLICKUP_SYNC_WEEKDAY` | Day of the weekly sync task. 1 = Monday, the default. |
| `LUMINATE_WEEKDAY` | Day of the weekly Luminate update. Defaults to `CLICKUP_SYNC_WEEKDAY`. |
| `LUMINATE_HELPER_TOKEN` | The Mac helper's token, as comma-separated `name:token` pairs (24+ characters each). Unset, the helper can't connect. |
| `STREAM_SYNC_URL` | The pub sheet's "Luminate Portfolio Sync" Apps Script web app. |
| `SONGLINK_API_KEY` | song.link key for the ISRC finder. Optional. |
| `CRON_SECRET` | Vercel sends it to `/api/cron/daily`. Without it, the daily job refuses to run. |

**Write switches (off unless set to `on`)**

| Name | What it lets the dashboard write |
|---|---|
| `ACCOUNTING_SHEET_WRITES` | "Log it": new rows on the accounting sheet's Income tab. |
| `CLICKUP_TASK_WRITES` | ClickUp tasks: create, update and mark done. |
| `AR_SHEET_WRITES` | The A&R tab's saves to OUTREACH / ADVANCE CALCULATOR. Off in production when unset. |
| `PUB_SHARE_WRITES` | "Fill in 100%": a blank Writer Share cell on the pub sheet. |

**Build and platform**

| Name | What it's for |
|---|---|
| `MIGRATE_ON_BUILD` | `off` skips the build's migrations. `on` runs them on a non-production or local build. |
| `VERCEL`, `VERCEL_ENV` | Set by Vercel. The build's migrations run only when `VERCEL_ENV` is `production`. |
| `NODE_ENV` | Set by Next. Secure cookies in production. |
| `STRIPE_API_BASE` | Staging tests only. Don't set it in Vercel. |

**On the Mac helper only (not Vercel):** `HELPER_CONFIG` and `BOT_CONFIG` are the paths of the helper's and the
export bot's config files (`helper/README.txt`).

## Notes

- Roster and team photos load from `https://www.defiedmgmt.com/assets/…`. Spotify covers come from `i.scdn.co`.
  Both hosts are listed in `next.config.js`.
- `next.config.js` holds the security headers, caching, redirects (`/staff` → `/team` and the pay.defiedmgmt.com links)
  and the image hosts.
