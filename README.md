# Defied MGMT — website and dashboard

One Next.js 14 app (pages router) on Vercel:

- **The public site**: home, about, team, roster, contact (`pages/*.jsx`, rendered by `components/App.jsx`).
- **The staff dashboard** (`/dashboard`): Home, To do, Publishing, Numbers, Money, A&R and Site.
- **The client portal** (`/portal`): each client's own songs and splits.

Data lives in Neon Postgres (`lib/db.js`). The dashboard also reads and writes the pub master sheet and reads the
accounting sheet (Google Sheets, `lib/sheets.js`, `lib/accounting.js`), reads Stripe (`lib/stripe.js`) and uses
ClickUp (`lib/clickup*.js`). The whole UI and its CSS are in `components/App.jsx`. Server code is in `lib/` and
`pages/api/`.

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

## Photos and covers

- A photo or cover uploaded in the dashboard goes to Vercel Blob (the public store `defied-images`) through
  `/api/upload-image`, and the row keeps only its link. The file's name is a hash of its content, so the same image
  uploaded twice is one file.
- Only JPG, PNG, WebP and GIF files under 2 MB are taken. The crop tool sends a 520 × 520 JPEG.
- Without `BLOB_READ_WRITE_TOKEN`, the upload falls back to the old way: the image is stored inside the row as a
  `data:` URI.
- The dashboard and the public site show both kinds, links and `data:` URIs.
- The dashboard loads everything in one reply, and Vercel won't send one over 4.5 MB, so a save that would take
  it past 4.2 MB is refused. With photos as links, the reply is a few hundred KB.
- **Moving the old ones** (a launch step, run once by hand after the deploy):
  - `DATABASE_URL=… node scripts/migrate-images-to-blob.mjs` lists what it would move and changes nothing.
  - Add `BLOB_READ_WRITE_TOKEN=…` and `--apply` to upload them and swap in the links. It writes a JSON backup of
    every old value first (`--backup <file>` to choose where). Running it again does nothing.
  - `--restore <file>` puts the old values from a backup back.

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
- The server enforces all of it. Every dashboard API route starts with the same check, `requireAccess` in
  `lib/access.js`, and the dashboard just hides what an account can't use.
- The sign-in and the session are unchanged: `users.role` is still `staff` or `client`. The role is
  `users.staff_role` and the per-person changes are `users.access` (migration 010).
- The Founders are Devin, Burny and Hank. Every other staff login is a Co-manager.
- There's always at least one Founder. Only a Founder can change roles, or another Founder's login.

There are no demo logins. Accounts are created in Site › Users.

## Numbers (automated data)

- Two daily crons (Hobby runs each at most once a day): `/api/cron/data` at 09:00 UTC collects finished runs,
  reads YouTube and the Spotify catalogs, and starts the Apify runs that are due; `/api/cron/data-collect` at 11:00
  UTC collects what the webhook didn't. Apify runs aren't waited for: Apify calls `/api/data-hook` when one ends.
- Schedule: streams per song and YouTube daily; monthly listeners and Instagram/TikTok followers weekly. Campaign
  mode (on an artist or a sound, in Numbers) makes everything about it daily for 30 days.
- Every number is a dated row in `data_snapshots`. A source that fails writes nothing, so the last good number
  stays and the page says "last updated <date>".
- Spending: each run has its own charge cap; each source has a monthly budget and all of them together one more
  (Numbers › Sources & cost, $15 by default). Set Apify's own usage limit (Billing) to the plan's $19 as the hard cap.
- A broken scraper: pick its backup in Numbers › Sources & cost. Adding another is one entry in `lib/data/sources.js`.
- The starting list (list B #3, replacing Luminate): every song and artist in the old Luminate portfolios (Admin
  Catalog 1 & 2, Artist Tracker, Song Tracker) is in `lum_history` (migration 012, `lib/data/seeds.js`), matched to
  Spotify by its song's link, its ISRC (search `isrc:`) or by name, which a person confirms in To do. Matched rows
  are tracked like the roster. Each one keeps its last Luminate numbers as read-only history (Numbers shows them).
  The data cron reads the old Luminate tables again each day (they're never written) and asks Spotify about a few
  more. Nothing reads or writes Luminate itself any more.
- The pub sheet's STREAM DATA tab is left as it was on the last Luminate update: nothing writes it, and the song
  rows' Luminate ID column (M) is never written either. Publishing's streams and money are the sheet's, so they
  stay at those numbers until the owner decides what feeds the sheet next.

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
| `SONGLINK_API_KEY` | song.link key for the ISRC finder. Optional. |
| `CRON_SECRET` | Vercel sends it to `/api/cron/daily`, `/api/cron/data` and `/api/cron/data-collect`. Without it, those jobs refuse to run. |
| `APIFY_TOKEN` | Apify, for the automated numbers: Spotify streams per song and monthly listeners, Instagram/TikTok followers, TikTok sounds. |
| `YOUTUBE_API_KEY` | YouTube Data API (free): subscribers and views. |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify Web API (free, client credentials): each roster artist's releases, so new songs are tracked by themselves. |
| `DATA_HOOK_SECRET` | The secret Apify sends back to `/api/data-hook` when a run ends, so its numbers land at once. Unset, the second daily cron collects them instead. |
| `DATA_HOOK_URL` | Where Apify calls back. Unset, it's the production site's `/api/data-hook`. |
| `BLOB_READ_WRITE_TOKEN` | The Vercel Blob store for photos and covers. Vercel adds it when the store is connected. Unset, photos are kept inside the database as before. |

**Write switches (off unless set to `on`)**

| Name | What it lets the dashboard write |
|---|---|
| `ACCOUNTING_SHEET_WRITES` | "Log it": new rows on the accounting sheet's Income tab. |
| `CLICKUP_TASK_WRITES` | ClickUp tasks: create, update and mark done. |
| `AR_SHEET_WRITES` | The A&R tab's saves to OUTREACH / ADVANCE CALCULATOR. Off in production when unset. |
| `PUB_SHARE_WRITES` | "Fill in 100%": a blank Writer Share cell on the pub sheet. |
| `DATA_REFRESH` | Not a write, but it spends money: the daily data crons start Apify runs and read YouTube/Spotify. Off, nothing is fetched (the Numbers page shows what's there). |

**Build and platform**

| Name | What it's for |
|---|---|
| `MIGRATE_ON_BUILD` | `off` skips the build's migrations. `on` runs them on a non-production or local build. |
| `VERCEL`, `VERCEL_ENV` | Set by Vercel. The build's migrations run only when `VERCEL_ENV` is `production`. |
| `NODE_ENV` | Set by Next. Secure cookies in production. |
| `STRIPE_API_BASE` | Staging tests only. Don't set it in Vercel. |
| `VERCEL_BLOB_API_URL`, `VERCEL_BLOB_RETRIES` | Tests only (the fake Blob store). Don't set them in Vercel. |

**On the Mac helper only (not Vercel):** `HELPER_CONFIG` and `BOT_CONFIG` are the paths of the helper's and the
export bot's config files (`helper/README.txt`).

## Notes

- Roster and team photos load from `https://www.defiedmgmt.com/assets/…`. Spotify covers come from `i.scdn.co`.
  Uploaded photos come from `*.public.blob.vercel-storage.com`. All three hosts are listed in `next.config.js`.
- `next.config.js` holds the security headers, caching, redirects (`/staff` → `/team` and the pay.defiedmgmt.com links)
  and the image hosts.
