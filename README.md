# Defied MGMT — website and dashboard

One Next.js 14 app (pages router) on Vercel:

- **The public site**: home, about, team, roster, contact (`pages/*.jsx`, `components/site/`; about, team, roster and
  contact are rendered on the server).
- **The staff dashboard** (`/dashboard`, one address per section: `/dashboard/todo`, `/dashboard/catalog` (Publishing),
  `/dashboard/money`, `/dashboard/ar`, `/dashboard/site`…): Home, To do, Publishing, Money, A&R and Site.
- **The client portal** (`/portal`): each client's own songs and splits.

Data lives in Neon Postgres (`lib/db.js`). The dashboard also reads and writes the pub master sheet and reads the
accounting sheet (Google Sheets, `lib/sheets.js`, `lib/accounting.js`), reads Stripe (`lib/stripe.js`) and uses
ClickUp (`lib/clickup*.js`). The UI is in `components/` (`app/` the shell, `site/` the public pages, `dash/` the
dashboard, `portal/` the client portal, `shared/` both sides), its CSS in `styles/app.css`. Server code is in `lib/`
and `pages/api/`.

Each dashboard section's code is its own download (`components/dash/sections.jsx`, `next/dynamic`): opening
`/dashboard/money` loads the sidebar and Money, nothing of A&R or Publishing, and the public pages load no dashboard
code at all. So the shell (`dash/StaffDashboard.jsx`) never imports a section module directly; the small parts
several sections share live in modules that import no section (`dash/chips.jsx`, `access.js`, `todo-data.js`,
`home-data.js`, `catalog-data.js`, `clients.jsx`, `ar-stages.jsx`, `portal/ask.jsx`, `trueup-data.js`). A re-export
in a section module is fine; one in a shared module pulls that section into every page.

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

## The automated numbers (the Numbers tab is gone: Site › Sync, Home's Spikes, Publishing pages)

- Two daily crons (Hobby runs each at most once a day): `/api/cron/data` at 09:00 UTC collects finished runs,
  reads YouTube and the Spotify catalogs, and starts the Apify runs that are due; `/api/cron/data-collect` at 11:00
  UTC collects what the webhook didn't. Apify runs aren't waited for: Apify calls `/api/data-hook` when one ends.
- Schedule: streams per song and YouTube daily; monthly listeners and Instagram/TikTok followers weekly. Campaign
  mode (on a roster artist's Publishing page, or a Watchlist row in A&R) makes everything about it daily for 30 days.
- Every number is a dated row in `data_snapshots`. A source that fails writes nothing, so the last good number
  stays and the page says "last updated <date>".
- Spending: each run has its own charge cap; each source has a monthly budget and all of them together one more
  (Site › Sync, "Where the numbers come from": Founders only, $15 by default). Set Apify's own usage limit (Billing) to the plan's $19 as the hard cap.
- A broken scraper: pick its backup in Site › Sync (Founders). Adding another is one entry in `lib/data/sources.js`.
- The starting list (list B #3, replacing Luminate): every song and artist in the old Luminate portfolios (Admin
  Catalog 1 & 2, Artist Tracker, Song Tracker) is in `lum_history` (migration 012, `lib/data/seeds.js`), matched to
  Spotify by its song's link, its ISRC (search `isrc:`) or by name, which a person confirms in To do. Matched rows
  are tracked like the roster. Each one keeps its last Luminate numbers as read-only history (a roster artist's or song's Publishing page, and the A&R drawer, show them).
  The data cron reads the old Luminate tables again each day (they're never written) and asks Spotify about a few
  more. Nothing reads or writes Luminate itself any more.
- The pub sheet's STREAM DATA tab is written only by `lib/stream-sheet.js`, behind `STREAM_SHEET_WRITES` (off unless
  `on`): columns D and E of the rows with a confirmed Spotify match, and the label in G1. The song rows' Luminate ID
  column (M) is never written. With the switch off the tab stays as it was on the last Luminate update.
- The monthly true-up (`lib/trueup.js`, To do › "Monthly Luminate update"): drop the month's Luminate Trend Report
  (Location Worldwide, Daily, with ATD; the 4 portfolio exports still work). A dry run shows what changes and the
  jump from the numbers we had; Apply saves one run (`trueup_runs`, `trueup_points`, migration 015) and Undo removes
  it. Songs are found by Luminate ID, then by title without version tags plus an artist in common. A song the file
  leaves out keeps its last number ("No plays this period, or not in the report yet"). A United States file is shown
  but can't be applied. Nothing here writes the sheet; the STREAM DATA writer reads the newest totals and ratios.

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
| `ACCOUNTING_SHEET_LINK_ID` | Only builds the "Open the sheet" links (Site › Sync, Money) to the accounting sheet (never read or written). A preview can read a stand-in sheet and still open the real one. Unset, the links use `ACCOUNTING_SHEET_ID`. |
| `AR_TRACKER_SHEET_ID` | The A&R sheet's spreadsheet id (r11): a new spreadsheet ("Defied A&R Tracker"), shared as Editor with `GOOGLE_SHEETS_CLIENT_EMAIL` (the same Google service account as the pub and accounting sheets). Written only with `AR_TRACKER_SHEET_WRITES=on`. |
| `AR_TRACKER_SHEET_LINK_ID` | Only builds the A&R sheet's "Open the sheet" link (never read or written). `none` hides the link; unset, it uses `AR_TRACKER_SHEET_ID`. |
| `GOOGLE_SHEET_LINK_ID` | Only builds the pub master sheet's "Open in sheet" links (never read or written). `none` hides them (a preview whose stand-in id would open nothing). Unset, the links use `GOOGLE_SHEET_ID`. |
| `DIGEST_CHANNEL_ID` | The ClickUp Chat channel the Monday team digest posts to. Unset, the team digest isn't sent (it says so in its log). |
| `DIGEST_PERSONAL_TO` | Who gets a personal Monday digest (a ClickUp direct message): `all`, or names or emails separated by commas. |
| `PAID_WAIT_MS` | How long the paste box waits for a paid lookup (an Apify run) before answering, in milliseconds. 25000 by default; a run still going is picked up by the next lookup. |

**Write switches (off unless set to `on`)**

| Name | What it lets the dashboard write |
|---|---|
| `ACCOUNTING_SHEET_WRITES` | "Log it": new rows on the accounting sheet's Income tab. |
| `CLICKUP_TASK_WRITES` | ClickUp tasks: create, update and mark done. |
| `AR_SHEET_WRITES` | Publishing › Advance calculator's saves to the pub sheet's OUTREACH / ADVANCE CALCULATOR tabs (r11: the A&R Outreach view is gone; the calculator keeps these saves). Off in production when unset. |
| `AR_TRACKER_SHEET_WRITES` | The A&R sheet (r11, `lib/ar/tracker-sheet.js`), a one-way copy of the A&R lists in its own spreadsheet: its **Watchlist** tab rewritten in full (A:V, values only) after every list change and after each data cron, and one **Log** row appended per action (Added / Removed / Renewed / Expired / Confirmed). It creates those two tabs if they're missing and never touches any other tab; nothing is ever read back. Off, nothing calls Google for it. |
| `PUB_SHARE_WRITES` | "Fill in 100%": a blank Writer Share cell on the pub sheet. |
| `STREAM_SHEET_WRITES` | The pub sheet's STREAM DATA tab from the new numbers, after each data cron tick (lib/stream-sheet.js): column D (streams) and E (source) of the rows with a confirmed Spotify match, and the label in G1. Nothing else on the sheet. |
| `STREAM_SHEET_MODE` | Not a switch: `estimate` (default, Spotify plays x each song's own Luminate/Spotify ratio, refreshed by each monthly true-up, so the sheet stays on Luminate's all-platform scale; on true-up day the number is Luminate's own) or `spotify` (Spotify plays as they are). |
| `DATA_REFRESH` | Not a write, but it spends money: the daily data crons start Apify runs and read YouTube/Spotify. Off, nothing is fetched (Site › Sync shows what's there). |
| `DIGEST_WRITES` | The Monday digests: the team post to `DIGEST_CHANNEL_ID` and the personal messages. Off, a Monday run still builds each digest and logs it (`digest_runs`, status "off"), so the preview shows what would have gone out. |
| `RADAR_SCANS` | Not a write, but it spends money: the TikTok radar's keyword scans and its risers' daily boost. Off, sounds added by link are still tracked one at a time. |

**Build and platform**

| Name | What it's for |
|---|---|
| `MIGRATE_ON_BUILD` | `off` skips the build's migrations. `on` runs them on a non-production or local build. |
| `DEFIED_PREVIEW` | Never set by hand: `next.config.js` makes it at build time from Vercel's own `VERCEL_ENV` (`""` on the live production build, `"1"` on every other build). On a preview a write whose gate is off says "Saves are off in this preview. They turn on when we go live." (lib/preview.js). |
| `VERCEL`, `VERCEL_ENV` | Set by Vercel. The build's migrations run only when `VERCEL_ENV` is `production`. |
| `VERCEL_PROJECT_PRODUCTION_URL` | Set by Vercel. With no `DATA_HOOK_URL`, Apify calls back to `https://<this>/api/data-hook`. |
| `NODE_ENV` | Set by Next. Secure cookies in production. |
| `STRIPE_API_BASE` | Staging tests only. Don't set it in Vercel. |
| `VERCEL_BLOB_API_URL`, `VERCEL_BLOB_RETRIES` | Tests only (the fake Blob store). Don't set them in Vercel. |

## Notes

- Roster and team photos load from `https://www.defiedmgmt.com/assets/…`. Spotify covers come from `i.scdn.co`.
  Uploaded photos come from `*.public.blob.vercel-storage.com`. All three hosts are listed in `next.config.js`.
- `next.config.js` holds the security headers, caching, redirects (`/staff` → `/team` and the pay.defiedmgmt.com links)
  and the image hosts.
