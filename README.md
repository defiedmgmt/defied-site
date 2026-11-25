# Defied MGMT — website and dashboard

One Next.js 14 app (pages router) on Vercel:

- **The public site**: home, about, team, roster, contact (`pages/*.jsx`, `components/site/`; about, team, roster and
  contact are rendered on the server).
- **The staff dashboard** (`/dashboard`, one address per section: `/dashboard/todo`, `/dashboard/catalog` (Roster),
  `/dashboard/money`, `/dashboard/ar`, `/dashboard/site`…): Dashboard, To do, A&R, Money (with EMPIRE and Advance calculator pills for Founders),
  Roster (it was Clients) and Site.
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
- Rolling back past the people link (migration 022, `lib/people-link.js`, 2026-11-14): set `PEOPLE_AUTOLINK=off` first,
  or remove the rows it made (their ids start with `auto-`, in `users`, `clients` and `staff_bios`) before the older
  code is live. Older code can't save Site › Users while a login with no email exists (it answers 500), drops those
  logins at its next users save, and answers "Login failed." for an email whose login has no password yet.

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

## Instagram (Site › Instagram)

Drafts and posts to the company's Instagram (@defiedmgmt) in its exact caption format (2026-11-16). Paste a Spotify song
or album link, tick the tracks Defied worked on, pick the producers and the credit, check the handles, and the preview
shows the slides and the exact caption. Staff with Site use it; only a Founder connects or disconnects the account.

It uses Meta's **Instagram API with Unified Login** (2026-11-24: Facebook Login for Business, `graph.facebook.com`). The
company's Meta app is a new one, and Meta doesn't let a new app use "Instagram API with Instagram Login". No Facebook Page
is needed.

**Setting it up (once, the owner)**

1. In the Instagram app, make @defiedmgmt a **Professional** account (Creator or Business), if it isn't already, and
   have it in the company's Meta business portfolio (Defied Management) at business.facebook.com.
2. At developers.facebook.com, create a Meta app of the **Business** type with the use case **Manage messaging & content on
   Instagram**, owned by that business portfolio. (The **API setup with Unified login** tab only shows for an app a business
   portfolio owns.)
3. Make the **Facebook Login for Business** configuration (Facebook Login for Business › Configurations › Create
   configuration; choose it in Use cases › Manage messaging & content on Instagram › Customize › API setup with Unified
   login):
   - login variation **General**, access token **System-user access token**, token expiration **Never**;
   - assets: the **Instagram account** (@defiedmgmt);
   - permissions: `instagram_basic` and `instagram_content_publish` (also `instagram_manage_messages`, which Meta always
     includes).

   Copy the configuration's **ID**. It isn't a secret, and it isn't the Login URL: the site builds its own login link.
4. Add the redirect URL `https://www.defiedmgmt.com/api/instagram/callback` (the configuration's **Redirect URL**, and Facebook
   Login for Business › Settings › Valid OAuth redirect URIs if the app lists them there). A preview deploy only connects if
   its own `https://<preview address>/api/instagram/callback` is added too; otherwise connect on the live site.
5. In Vercel, add `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` (the **Meta app's** ID and secret, from App settings › Basic;
   not an Instagram app ID), `INSTAGRAM_CONFIG_ID` (the configuration's ID) and `INSTAGRAM_POSTS=on`, then redeploy.
6. In the dashboard, open **Site › Instagram** and press **Connect Instagram** (Founders only). Meta's login opens: log in with
   Instagram or Facebook, pick the business portfolio and @defiedmgmt, and approve. While the app is in Development mode, the
   Founder who presses it needs a role on the Meta app and full control of the business portfolio. Saving the configuration
   gives Standard Access, which covers people with a role on the app; App Review is only for connecting other businesses.

**How it works**

- The sign-in is a Business Integration System User token: it belongs to the business portfolio, not to the person who logged
  in. With the configuration's expiration on **Never** it doesn't expire and **is never renewed**. There is no refresh call,
  so nothing happens before a post or when the tab opens. If Meta ever stops accepting it (the app is removed under Business
  Settings › Integrations › Connected apps, or the account moves to another portfolio), the next post says "Instagram
  disconnected: a Founder presses Connect Instagram again" and the site doesn't retry.
- It's kept in `app_state` (`instagram:conn`) locked with AES-256-GCM under a key made from `SESSION_SECRET`: it never reaches
  a browser or a log, and goes out only as an `Authorization: Bearer` header. The app secret goes in one call only, the
  server-to-server code exchange when a Founder connects. Changing `SESSION_SECRET` means pressing Connect Instagram again.
  Disconnect only makes the site forget the token; Meta's side is cut in Business Settings › Integrations › Connected apps.
- Which account: the one in `/me/assigned_instagram_accounts` whose username is `defiedmgmt`; if only one account was shared,
  that one; otherwise the connect fails and names the usernames Meta sent.
- If `media_publish` says it dropped the caption or the tags (`config_issue`), the post is up and the page says what to fix
  in the Instagram app; it is never posted a second time.
- Images (a replaced cover, a tracklist) are made a square JPEG in the browser and stored through `/api/upload-image`;
  videos (MP4/MOV, up to 300 MB) go straight from the browser to Vercel Blob (`/api/instagram/upload`). Instagram
  fetches those public links. Both need `BLOB_READ_WRITE_TOKEN`; the Spotify cover works without it.
- A cover alone is one photo post; cover + video or image is a carousel; Video only is a Reel shown on the feed. Up to 3
  collaborators (Instagram's limit), and everyone is tagged on the cover photo (a Reel can't carry photo tags).
- A video Instagram is still processing after about 45 seconds is kept as "pending": **Check again** finishes the same post
  (it never posts twice), **Discard** drops it.
- The last 50 posts are kept in `app_state` (`instagram:posts`), and the handles used are remembered by name
  (`instagram:handles`) for the next post's prefill (after the roster's own Instagram field and the team page).

## Share card

- A client's portal has **Share my stats** on the line under their streams; staff see **Share card** in the same
  place on an artist's page. It opens the card: a PNG from `/api/share-card` (Story 1080 × 1920 or Post 1080 × 1350)
  with the Defied wordmark, the artist's total streams and their top 5 songs, and Save image (plus Share on a phone).
- Each top song shows its own cover art: a thumbnail in its row, and the biggest song's cover, blurred and darkened,
  behind the whole card (its tones are held in a dark band, so the white text reads on any cover). The cover is the
  one stored for the song (`placements.cover`, a Spotify `i.scdn.co` link). A song whose stored cover can't be had
  but that links a Spotify track gets Spotify's picture of that track (the Web API, the data engine's client-credentials
  sign-in, `lib/data/direct.js`). A song with neither gets the D mark on a dark tile: never another song's art, never
  a made-up one. Covers are fetched on the server by the same fetcher as the photo (`loadPhoto` in `lib/share-card.js`),
  all at once, about 3 s each and 2 MB at most, only from `i.scdn.co`, the public site and the Blob store; one that
  doesn't arrive just leaves its tile. A picture next/og can't decode is left out, not the whole card.
- The numbers are the ones the portal shows as Gross Streams and per song, worked out by the same code
  (`lib/portal-streams.js`). Nothing about net streams, splits or money is on it.
- A client gets only their own card. Staff need Roster access, and a Co-manager limited to their own artists gets
  only theirs. An artist with no streams yet gets "No streams to share yet." instead of a card.
- A long song title gets smaller, then goes onto two lines; only past that does it end in "…". All the titles on a card
  are one size, the biggest at which each of them fits (the smallest any one needs): one line where it fits, two where
  it must.
- The card's fonts cover Latin letters (accents included). A name in other letters (Japanese, Korean, Cyrillic, Greek…)
  gets "Your name uses letters the card can't draw yet." instead of a card with no name. A top song whose title is in
  such letters is left off the list (the total still counts it), and the window says how many were.
- The card's fonts and logo are read from `public/` when it's drawn. `next.config.js` traces those files (and
  next/og's own) into that one function on Vercel.
- `node scripts/render-share-card.mjs stats.json story out.png` draws a card from a stats file, for checking the
  layout. It reads no database and fetches nothing; a song's `cover` (and the `photo`) can be a PNG or JPEG file
  beside the stats file.

## Roles and permissions

Every staff login has a role. Founders set roles in **Site › Users** (`lib/roles.js`).

| Role | Can use |
|---|---|
| Founder | Everything, including Money and Users (user management). |
| Co-manager | Everything except Money and Users. Can optionally be limited to their own artists. |
| Intern | A&R and Site (website content, messages). |
| Client | Their own portal. Unchanged. |

Net streams are for the spreadsheet (2026-11-13): an artist's page (the Net Streams card and a song's Net streams row)
and the Overview (the Net streams column) show them to no one, Founders included. The Advance calculator (since 2026-11-21 on Money ›
Advance calculator, below) is the one place that still uses them, as the input of its estimate, so it and the data behind it (`/api/ar-data`'s signed clients, and the
net columns of `/api/sheets-master`) are for an account with **Money** access, which is a Founder unless a Founder turns
Money on for someone else (`lib/roles.js` `seesNetStreams`). The calculator starts from today's pace, the streams a year the
person earns now (`lib/advance-model.js` does the math): `/api/ar-data` sends each signed client's `pace` with those same
clients and to the same accounts, worked out from real daily Spotify readings, with the sheet's run-rate (ASSUMPTIONS!B9)
for songs that have none (`lib/advance-pace.js`).

- A Founder can turn any section on or off for one person, on top of their role. In that list To do reads "Team to-do" (everyone's) and
  Money "All money" (Defied's books); a login's own **My to-do** (their ClickUp MGMT list) and **My payments** (their pay link) come with
  their first name, not with a tick (`lib/own-pages.js`, shown under "Their own").
- "Only their own artists" limits a Co-manager to the clients whose **Assigned Manager** on the accounting sheet's
  INFO tab is that person's name. The daily cron reads INFO, and so does "Update from the sheet" in Site › Users.
- Each person is managed in ONE place, their own form in Site › Users (2026-11-15). A Co-manager's or Founder's form has "Their
  artists": their artists as chips (INFO's Assigned Manager is exactly their name, never a near match: Caden is not Cayden),
  "Their cut" (INFO's Manager Gets %: one of two splits for all of their artists, 66.7 / 33.3 or 50 / 50, Manager / Defied; picking
  one rewrites every artist of theirs that isn't on it, and artists are only ever added at the picked split. A Founder has no picker:
  Defied keeps the whole commission, so a Founder's new artists go in at 0; the picked split is a filled button), and "+ Add artists" for the rest of INFO's
  artists, each with who has them now. A client's own form (Site › Roster, "Accounting sheet") has the same two buttons for its Manager's cut, and for a
  Founder's artist the same Founders' line instead (F is written as 0 when it isn't 0 already); a client moved to a co-manager whose F is no split (a
  Founder's artist at 0, a blank F) has to have a split picked before Save, and one that stays with its manager and holds some other cut ("Now 67% on the
  sheet") is left alone unless a split is picked. (The Founders are known from the logins the form can read, so a viewer without Users gets the picker.) The form's ONE Save writes the account first, then (only if there is something to send) the accounting sheet: the name
  onto INFO's manager list if it isn't on it (a Co-manager always, a Founder only to give them artists, and only through this Save: the
  automatic link never puts a Founder on the list; never for a name near one that is on it: the same person by first name, or a near miss by
  the people link's own rule, `nearMiss` in `lib/names.js`, swaps included ("Jaime" next to "Jamie"); Caden and Cayden are two people,
  `TWO_PEOPLE`; the server's `manager` action refuses those names too, with the form's words), then Assigned Manager and Manager Gets % of each row changed in one write (`manager` and `manager-artists` in
  `/api/people-sync`, `saveManagerArtists` in `lib/people-sync.js`); an artist taken off clears both cells (Defied keeps 100%), and
  Defied's share (G) is the sheet's own formula, never written. If the sheet part is refused (a row changed on INFO since, someone else
  saving) the account is still saved and the form says "Saved. Their artists weren't saved: <reason>. Try again." with its chips as
  they were. Money access, never an account limited to its own artists. The managers on INFO's list with no account here are rows
  of the Users list under "No login yet" (their Edit opens the new-user form filled in, so one Save makes the account); there is no
  separate managers section. A manager counts as having an account by the people link's own pairing (`GET /api/people-sync` gives each
  INFO manager its `account`: the stored link first, so a renamed login or a "Same person" answer counts, then `sameManager`), and a
  save of a NEW login with the exact name of a staff login (one the link made meanwhile included) is refused ("<name> already has an
  account."), and so is a NEW Co-manager or Founder whose first name is a staff login's, because the site matches managers by first name
  ("<name> would be matched to <existing>'s artists: …"); an Intern or a Client is refused only for the exact name, and editing an existing
  login is never checked The list has a "Sort by" control (Role by default: Founder, Co-manager, Intern, Client, then name; Name;
  Last sign-in) and sortable heads, remembered in the browser.
- Adding someone puts them everywhere at once, hidden. After a save that ADDS a person (Site › Users › Add, Website › Roster › Add,
  the Roster tab's Add client, Website › Team › Add) the dashboard runs the people link at once (`POST /api/people-sync { action:
  "link", after: true }`: an automatic run, so until a person has pressed Site › Sync's Sync people now once (the first run, which sends
  no `after`) it answers `{ waiting: true }` and does nothing, and the line says so; never for an account limited to its own artists):
  the account (no login), INFO (the manager on L, or the client's
  row with its commission at 20%: `DEFAULT_COMMISSION` in `lib/people-sync.js`, the way INFO's D holds every row, 0.2) and the
  hidden team or roster entry, and says in one line what exists (`components/dash/added-line.js`). A client added by a person is kept
  in `app_state` `peopleSync:added` as real (an atomic append, written in the save's own transaction), so a run that was busy or
  couldn't write the sheet is finished by the sync check or the nightly run. It never grows Annual Summary (a person does that, from the client's form); if INFO's client list can't take the
  row, the line says the client isn't on the sheet yet and the flag says why.
- Site › Website › Team has an **Account** select (2026-11-15) so adding a team entry doesn't make everyone a manager: **Manager** (a
  Co-manager account, put on INFO's manager list), **Intern** (an Intern account, not on INFO) or **No account**. A new entry starts at
  what its Role text says (`teamAccountOf` in `lib/roles.js`: an intern or assistant is an Intern first; otherwise manager, Founder, A&R or
  management is a Manager; anything else an Intern); an entry that has an account already shows its role, read only; an old entry with no
  account asks ("Pick one"). The answer is saved in the SAME transaction as the team row (`app_state` `peopleSync:accounts`, `{ teamId:
  "comanager" | "intern" | "none" }`, an atomic jsonb merge in `pages/api/dashboard-data.js`), so no run can read the entry without it and
  nothing waits for the link's lock; answers for entries that are gone are pruned when a run saves. People-link rule h makes the account
  chosen; "No account" is never made or asked about later. An entry nobody answered for gets NO account and a flag ("<name> on the team
  page has no account: pick Manager, Intern or No account"): never a default Co-manager.
- The server enforces all of it. Every dashboard API route starts with the same check, `requireAccess` in
  `lib/access.js`, and the dashboard just hides what an account can't use.
- The sign-in and the session are unchanged: `users.role` is still `staff` or `client`. The role is
  `users.staff_role` and the per-person changes are `users.access` (migration 010).
- The Founders are Devin, Burny and Hank. Every other staff login is a Co-manager.
- There's always at least one Founder. Only a Founder can change roles, or another Founder's login.
- The sidebar's foot says who is signed in: their name (`users.name`, the session's: `pages/dashboard/[[...section]].jsx` hands it to `StaffDashboard`) beside their role, on one line
  ("Devin · Founder"; a name too long for the line is cut with "…", never the role; no name, the role alone). A Founder's label has a soft light that sweeps across it every few seconds
  (`.dash-role` in `styles/app.css`); it stays still for anyone whose device asks for reduced motion. The phone's top bar has no label.

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

## Schedule A (the producers' songs sheet, 2026-11-20)

One tab, **Schedule A**, of its own Google spreadsheet (`SCHEDULE_A_SHEET_ID`), written from the site by `lib/schedule-a.js`: one row per producer and song, with
the producer's own share of it. The owner's old file ("Defied Schedule A (Updated)") is converted to a Google Sheet once; the site takes it over from there.

- **Who is on it:** the clients on the roster whose role says Producer (`Producer`, `Producer / Artist`). Artist clients and anyone off the roster are not. A song
  under two producers is a row for each (each one's own share); the same song twice under ONE producer (the same Spotify track, else the same title and artists once
  case, punctuation and emoji are left out) is one row: the card with a share, then the one with more filled in, keeps its place.
- **Columns:** A Writer · B Song Title · C Recording Artist(s) · D Writer's Pub Share (%) (the writer's own split on the song, found the way the pub sheet's push
  finds it, `findByName(splits, client.name)`; blank when there is none) · E Release Date · F ISRC · G Spotify Link · H Status (`Split % not yet specified`,
  `Assumed split, confirm` for a song the auto-add put on the site that nobody has OK'd, `Not on the site` for the kept rows below) · I Notes (the owner's own, kept) ·
  J Site ID (the song's id on the site, hidden: what a note is found by). Sorted by producer (roster order, then name) and title. The footer says `TOTAL SONGS: N` and
  `Updated by the site: <New York time>`.
- **Edit the site, not columns A to H and J:** the next sync writes them again. **Notes (I) are yours**, kept by Site ID whatever you sort or filter. A song that is
  not on the site yet can be typed by hand (no Site ID); it is kept under a separator row, `Only on this sheet (not on the site yet)`, and moves up into the table,
  its note with it, once the site has the song. Text typed in a row with no writer and no title (a remark under the table, next to the total) is kept there too,
  cell for cell; it isn't counted as a song. Rows of an Artist client are removed, and so are rows whose song the site no longer has, but a removed row's **note**
  is kept by Site ID (`app_state` `scheduleA:notes`, the newest 300, each cut at 2,000 characters) and comes back with the row if it returns: a producer back on the roster, a
  song moved back.
- **The header row:** the columns are found by their header name, never by their place. Row 1 must be the ten headers (any order: the site writes the table back in
  the order above and finds each note by Site ID) or the old five, exactly (with F1:J1 blank); case and spaces don't count. Anything else (a column deleted or added
  inside A:J, a header renamed) writes nothing, and the Sync check and the summary say "the header row changed" and what row 1 reads. A tab that reads empty after the
  site has synced it is refused too (a read that went wrong would wipe the notes); to start from nothing, type the ten headers back into row 1. Columns after J are the
  owner's and are never touched.
- **The first sync** reads the old 5-column sheet (Writer, Song Title, Recording Artist(s) / Writer(s), Client Publishing Share (%), Notes) and carries each old note to
  its song by writer and title (the writer as the site names the client, case and punctuation aside, `Yellow` being prodyel1ow; the title with one letter off allowed for
  titles of 8 letters or more, so `Hellen Keller` is `Helen Keller`). A song the old sheet has twice becomes one row with both notes. Rows no site song matches are
  kept under the separator (never dropped); the artists' rows are removed. An empty site never empties the sheet.
- **When it runs:** the daily cron's last step (after the auto-add, so a song it just added is on the sheet); right after a staff or client save that wrote or
  removed a song or changed a client's name, roster place or order (marked in `app_state` `scheduleA`.`dirtyAt`, run at most once every 2 minutes through the claim
  `scheduleA:run`; it starts beside the save's answer, the save waits 2 seconds for it at the most and never fails; a slower run goes on by itself); Site › Sync's
  **Sync Schedule A now** (and `POST /api/schedule-a`); and the Sync check itself, when a change is waiting (a save inside the 2-minute gap, or a run that was busy) or
  the last run failed. One run at a time, whoever asks: every run takes the claim `scheduleA:lock` (a 2-minute lease, given back when the run is over) and one that finds
  it taken answers `busy` (the button says so, the nightly run marks the change as waiting). The nightly run has 12 seconds at most and never past the 42nd second of its
  run (the report's save and the alert's 8 seconds still follow). `GET /api/schedule-a` is a dry run: where it stands and what a sync would do, one read of the sheet,
  nothing written. Publishing access, every artist at once.
- **Calls to Google:** one read of the tab; then, only when something differs, ONE write: the whole table, padded with blank rows down to the longer of what was read
  and what is written (there is no separate clear: a second call could cut short a table another run had written). A sync that changes nothing is the one read and
  leaves the footer's time alone. The first sync (and one that finds the header changed) also formats the tab: header dark and bold,
  first row frozen, Site ID hidden, D as a percent, a filter, column widths (a read of the tab list and one batchUpdate). A tab with too few rows or columns is grown once.
- **Setting it up:** convert the file to a Google Sheet, name its tab `Schedule A`, share it with `GOOGLE_SHEETS_CLIENT_EMAIL` as Editor, and set `SCHEDULE_A_SHEET_ID` in
  Vercel's **Production** environment only (writes are on as soon as the id is set; a preview that shares the database and the id would write the sheet too).
  To look first: set `SCHEDULE_A_WRITES=off`, open `/api/schedule-a` (or Site › Sync) while signed in, then take the switch off. The first sync is the owner's old sheet's migration.

## Roster › Catalog (2026-11-23, 2026-11-24)

The Clients tab is **Roster** now (same section, same address `/dashboard/catalog`, same access: Publishing in `lib/roles.js`, shown as Roster). Its pill row is **Roster** (the page the
Clients pill always was, the default) and **Catalog** (`/dashboard/catalog/songs`). Catalog is read only: a click on a song opens it in its client's own page and editor (the same
`openFix` To do's Update uses), and nothing here saves anything. The rules are pure and tested (`lib/roster-catalog.js`, `components/dash/roster-views.jsx`).
There was a **Releases** pill too until 2026-11-24 (the owner: "maybe we dont need releases if we have catalog"): its address, `/dashboard/catalog/releases` (and `release-desk` or
`releasedesk` under `/dashboard/catalog/` or on their own), opens Catalog now (`placeOf` in `StaffDashboard.jsx`; Catalog also takes `releases` as its own sub), and its dates are the strip below.

- **Catalog** (top to bottom): the **New releases** strip, the headline, the search and filters, the table.
  - The strip is the songs coming up (a release date after today in New York, tagged "Coming up") and the ones out in the last 30 days (today included), in one row of cover cards: the
    songs coming up first, the soonest first, then the ones already out, the newest first (`newReleases` in `lib/roster-catalog.js`); each card has the cover, the title, the artist and the
    date. It scrolls sideways inside itself (the page never does, a phone included). A card opens the song as a table row does. With none to show it says so in a line; with no songs at all it isn't drawn. It is not filtered by the search or the filters below it.
  - The cover is `placements.cover` (the link stored on the song: a Spotify image today, `i.scdn.co`; the site's own photo links and uploads work too), the first copy that has one when a
    song is on two clients' pages. It goes through the same resizer the client photos use (`thumb()`); a song with no cover shows the first letter of its title in the app's own placeholder
    (`.avatar-ph`). Nothing is looked up: no Spotify call is made for a cover.
  - The big number is the streams of the songs listed (the pub sheet's lifetime streams, the figure a client's page shows for a song; never net streams) with "N songs" beside it and the day
    they are from (`db.streamsOn`, as the portal says "Streams as of"). A song on two clients' tabs carries the same streams on both, so it is counted once, and a line says so. A song the
    sheet has no streams for yet shows "-" and is said to be "not on Luminate yet".
  - The table: every song of the roster, one row each, with its cover beside the title. A song on more than one client's page is one row naming all of them (the ISRC finder's rule: the same
    Spotify track, or the same title and artist, so "N songs with no ISRC" in To do and the No ISRC songs here are the same songs). It follows the search, the filter and the account: a
    Co-manager limited to their own artists sees only theirs (`db` already has only those).
    Columns: song, artist, client(s), released, streams and status (no Sources column, and no per-link source rule in `lib/roster-catalog.js` any more: today every link is Spotify).
    Status chips are the app's own gaps: No ISRC (the finder's), No link and No release date (`lib/sheet-facts.js` SONG_GAPS), Split to confirm (`splitsToConfirm`, the list To do and the
    client chips use), and a gray Not on streaming (`song_tracking.skip`). A song marked Not on streaming is not asked for a date, link or ISRC. Search is instant over title, artist and
    client; the chips are All, Missing info (any chip but the gray one) and Not on streaming; the sort is Most streams (default) or Newest release. A phone shows 25 cards, then "Show more".
- **Roster** (the clients' page): the Overview (the streams total, "Streams (all time)", and the table: client, songs, this week, streams, the same for every account: no "More columns" button)
  and a client's page (their name and role, the Campaign numbers, Gross Streams, the songs with their covers, splits and "+N this week"). The old pub sheet's estimates are not on these pages
  or in a song's window: no Pub earnings or Potential admin fee tile, row or column (not behind "More columns" either, which is gone), no "Estimates: streams × the writer's share × $0.00092"
  line, no "Sheet tab: <name>" under a client's name (a tab the sheet doesn't have is still said, as a warning), and a song's card says nothing about its split unless it is missing or doesn't
  add up to 100% (a client's own portal still says "Pub split · N people · 100%"). A song's window keeps its streams, its splits and everything else, and every write it had.
- **Each song's ISRC and "Not on streaming"** are the two facts the dashboard's own data doesn't carry for every account. `GET /api/songs` has them, but it is for every artist at
  once (an account limited to its own artists is refused), so for that account the pages read `GET /api/roster-catalog`: `{ tracking: { [placementId]: { isrc?, skip? } } }`, its own
  artists' songs only (`requireAccess(..., "publishing")`, `limited`/`ownSet`), read only, `Cache-Control: no-store`, no migration. Every other account uses the copy it has.

## Money › EMPIRE and Advance calculator (2026-11-21, 2026-11-23, 2026-11-24)

The publishing-administration deal with EMPIRE, as Money's last two pills, for a Founder: **EMPIRE** (`/dashboard/money/empire`) and **Advance calculator** (`/dashboard/money/advance`).
They were Money's last two pills until 2026-11-23, then a **Deals** section of its own for a day; the owner (2026-11-24: "maybe that whole deals tab can go in with money to make things less
cluttered") put them back in Money, so there is no Deals tab. Deals' addresses (`/dashboard/deals`, `/dashboard/deals/empire`: the EMPIRE pill; `/dashboard/deals/advance`: the calculator) and the
calculator's first ones (`/dashboard/catalog/advance`, `advance:<id>`) open the pills (`placeOf` in `StaffDashboard.jsx`). Each page is its own chunk with its own read of `GET /api/empire`
(`next/dynamic` in `money.jsx`, loaded the first time its pill opens). Money's other pills are Overview, All payments and My payments, and it opens on the Overview.
Founders only: Money access, an account that sees every artist (one limited to its own is refused) and the Founder role itself, since a Founder can switch
Money on for an intern or co-manager in Site › Users and that must not open these pages (403 "Only Founders can see the EMPIRE deal.", the two pills and Roster's
pointer hidden; one decision, `seeDeals` in `StaffDashboard.jsx`, gates both pills). Any other account that opens those addresses gets Money's Overview, or its first tab without Money.
`GET`/`POST /api/empire` is the only way the pages see any of it. The contract is confidential, so its terms
live in server code only (`lib/empire-terms.js`); the pages' own code (`components/dash/empire*.jsx`, `empire-data.js`, `lib/empire-math.js`) holds none
and takes every rate, amount and date from the answer, so none of them is in what a browser downloads.

**Shown simple** (2026-11-24, the owner: "this is still a bit complicated like idk what all that means ... i wanna know like just the key information"): only layout and words changed;
every save sends what it always sent and asks what it always asked.

**The EMPIRE pill shows real money only** (the owner: "start us at zero since we havent made nothing yet ... this shld be based on real"). EMPIRE's money never
passes through Stripe (while unrecouped it pays Defied nothing), so "real" here is what the founders type in from EMPIRE's quarterly statements, and what they
mark: money spent, a deal given, the advance received. Nothing estimated counts as money. The page, in order:

- **Three tiles and one line**: Paid back to EMPIRE (what the statements credited, of the total, with its bar), Left to give out (of the advance EMPIRE gave Defied; "Over by $X" when
  more than that is marked spent) and Next EMPIRE statement (the day it is due and the quarter it is for); under them one line with the last day to be paid back (for EMPIRE's extra advance),
  the day Defied can buy out (both from the terms, nothing projected) and "Defied gets paid once EMPIRE is paid back". The timeline, the status line and the sentence about the bar are gone.

- **The first tile's bar**: how much of EMPIRE's advance is paid back = the sum of what the statements typed in credited ($0 until one is typed in; nothing estimated is drawn in it).
  It is "paid back" only when the statements alone reach the total (they come a quarter after the quarter ends). In the API: `recoupment.credited / remaining / pct / recouped` are statements only.
- **Forecast (an estimate from streams, not money)**, a fold (closed) under the line of dates (in the API, everything under `recoupment.forecast`): what today's pace would put on
  the next statement and a year of it; when it is paid back at today's pace, or that the current songs top out short of the total; whether that is in time for EMPIRE's extra
  advance (yes or missed only from statements; on track, close (within 6 months of its last day) or not on this pace from the estimate; every mention says it is recouped
  too); and what a buyout would cost on the day it opens. Inside it, "How the estimate counts Net Income": the streams each Schedule A song earned (Luminate's all-time total
  near the start and the latest count where both exist, a song's lifetime count if it came out since, else today's pace x the days), x the pub sheet's rate a stream
  (ASSUMPTIONS!B7) x the share of it EMPIRE receives as Net Income (a standard guess a Founder can change there) x what EMPIRE pays Defied. It is before EMPIRE's collection fees
  (the contract caps them); a statement replaces it. (2026-11-25) The words follow the share saved: at 60% or under they say Net Income is the mechanical royalties only (EMPIRE isn't
  registered to collect PRO money, so both halves of performance go to the writers through their PRO) with about 3% collection fees already taken out; above 60%, the mechanicals and
  the publisher's half of performance, before the fees (`components/dash/empire-data.js` netIncomeText / netIncomeHow, on the EMPIRE page and in the calculator's Show the math).
- **The advance EMPIRE gave Defied**, a second bar. It starts at $0 and fills only with money marked spent: the deals marked
  given plus the entries a founder types in under "Mark money spent" (a button; its form, amount, what for and the day, appears when it is pressed; saved as `spend:<id>`, Delete asks in the page).
  A planned deal is one muted line under the bar, not part of it. Going over is allowed and says "Over by $X". Whether it has been received (and the day) is a small chip with its button.
- **Producer deals**: a producer's advance for a song or a whole catalog, paid back from that producer's royalties (Net Income x EMPIRE's payout, less Defied's cut, 20% unless
  the deal says another). Saved as planned from the Advance calculator (the card's one line, empty or not, links there), marked given with a day, edited, deleted (asked in the page).
  A given deal's "paid back so far" is real: the producer's share of what each statement credited (what is left after Defied's cut), split by each song's streams (the deal's
  songs' share of that quarter's Net Income, estimated from the streams), counted from the day it was given, $0 until a statement covers it. Its estimated payback day is a small
  muted "forecast:" note. A planned deal repays nothing and shows no repayment. One producer's deals never share a song, or its royalties would repay two advances: a whole catalog
  overlaps everything of that producer's, two deals on songs overlap when they share one, a prospect's deal overlaps nothing, and a save that would overlap is refused with a sentence
  that says to edit or delete the other deal. An edit writes only the fields it sent, so one made from an old copy of a deal can't undo a status or advance someone else changed
  meanwhile, and an edit that leaves the producer and songs alone still goes through for a producer who has since left Schedule A.
- **Statements from EMPIRE**: type in each quarter's Net Income and what EMPIRE credited Defied (the "Add EMPIRE statement" button opens the form); the first tile counts it.
- **Advance calculator** (its own pill: its old addresses, /dashboard/catalog/advance and Roster's line, open it; founders only like the EMPIRE pill). A planning tool, so its
  numbers are estimates and say so. Same model as before (`lib/advance-model.js`), run on the producer's royalties (`lib/empire-math.js`). In: the producer (one of ours, or someone new
  whose streams are typed; the A&R prospects are not in the picker any more), their whole catalog or some songs (each with its own pace), how long to pay it back (chips: 6, 12, 18, 24, 36 months; it
  starts on the model's default) and Defied's cut (a small field, "usually 20%" from the defaults). Out: one headline, "Up to $X", with "paid back in N months" and the verdict, and three tiles (their
  royalties and Defied's cut over the next 12 months, and what is left of the advance EMPIRE gave Defied after this), then Check an amount and Save as a planned deal. For a producer who already has a
  deal on those songs it says so and takes what is still to pay back on that deal (an estimate) off the advance it recommends, never below 0, and it plans against what is neither spent nor planned.
  Saving it files a planned deal (listed under Producer deals on the EMPIRE pill; the confirmation says "It's in Producer deals on the EMPIRE page."). Everything else is one closed fold, "Show the math": what counts toward EMPIRE's total, today's pace and where it
  comes from, the rate, where each dollar of Net Income goes, the payback ladder, the 3-year ledgers and every step. The pub sheet's own forecast that used to sit under it is gone.
  (2026-11-24, accuracy) Today's pace is song by song: a song with daily readings at its measured pace, one without by the sheet's rule (lifetime x B9), summed (no switch to the
  rule for everything below half measured); "from daily counts" only when all of it is measured, else "partly from daily counts (N%)". A song whose daily counts are from its first
  90 days plans on the lower of its 28-day pace and its latest 7 days of readings (the launch spike drops out), never above its measured pace, with a "New song, so this estimate is rough" note (`lib/advance-pace.js`
  songPace `forward`; the estimate of what was already earned still fills at today's measured rate). Check an amount is stacked on what the producer's deals still owe, like the headline.
  Someone new is typed as lifetime streams (all platforms). The calculator's estimates are shown to the nearest $10; Show the math keeps the cents.
- **Saved state**: the one `app_state` row "empireDeal", an entry per key (`received`, `levers`, `statement:<quarter>`, `deal:<id>`, `spend:<id>`), each write one SQL
  statement on its own key so two founders saving at once never overwrite each other. No migration. `lib/empire-store.js` checks everything typed.

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
| `SONGLINK_API_KEY` | song.link key for the ISRC finder. Optional. |
| `CRON_SECRET` | Vercel sends it to `/api/cron/daily`, `/api/cron/data` and `/api/cron/data-collect`. Without it, those jobs refuse to run. |
| `APIFY_TOKEN` | Apify, for the automated numbers: Spotify streams per song and monthly listeners, Instagram/TikTok followers, TikTok sounds. |
| `YOUTUBE_API_KEY` | YouTube Data API (free): subscribers and views; and (2026-11-18) the credits scan's fallback when Apple Music had nothing: a search is 100 of the day's 10,000 units, 30 a day at most. Unset, the scan skips YouTube. |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify Web API (free, client credentials): each roster artist's releases, so new songs are tracked by themselves. |
| `DATA_HOOK_SECRET` | The secret Apify sends back to `/api/data-hook` when a run ends, so its numbers land at once. Unset, the second daily cron collects them instead. |
| `DATA_HOOK_URL` | Where Apify calls back. Unset, it's the production site's `/api/data-hook`. |
| `BLOB_READ_WRITE_TOKEN` | The Vercel Blob store for photos and covers. Vercel adds it when the store is connected. Unset, photos are kept inside the database as before. |
| `ACCOUNTING_SHEET_LINK_ID` | Only builds the "Open the sheet" links (Site › Sync, Money) to the accounting sheet (never read or written). A preview can read a stand-in sheet and still open the real one. Unset, the links use `ACCOUNTING_SHEET_ID`. |
| `AR_TRACKER_SHEET_ID` | The A&R sheet's spreadsheet id (r11): a new spreadsheet ("Defied A&R Tracker"), shared as Editor with `GOOGLE_SHEETS_CLIENT_EMAIL` (the same Google service account as the pub and accounting sheets). Written only with `AR_TRACKER_SHEET_WRITES=on`. |
| `AR_TRACKER_SHEET_LINK_ID` | Only builds the A&R sheet's "Open the sheet" link (never read or written). `none` hides the link; unset, it uses `AR_TRACKER_SHEET_ID`. |
| `GOOGLE_SHEET_LINK_ID` | Only builds the pub master sheet's "Open in sheet" links (never read or written). `none` hides them (a preview whose stand-in id would open nothing). Unset, the links use `GOOGLE_SHEET_ID`. |
| `DIGEST_CHANNEL_ID` | The ClickUp Chat channel the Monday team digest (one message a week since 2026-11-16: Our artists, Our songs, On the radar, Radar songs) posts to. Unset, the team digest isn't sent (it says so in its log). |
| `ALERT_CHANNEL_ID` | The ClickUp Chat channel a failed nightly or weekly job's alert posts to (2026-11-17, `lib/alerts.js`; see `ALERTS` below). Unset, it's the Dashboard Alerts channel (`CLICKUP_ALERTS_CHANNEL_ID`, else the one built into `lib/clickup.js`); `DIGEST_CHANNEL_ID` is only a last resort. An alert never goes to the Weekly Digest channel while there is another. |
| `DIGEST_PERSONAL` | Personal Monday digests (a ClickUp direct message each) are off unless this is `on`, `true`, `1` or `yes` (2026-11-18, the owner doesn't want them): off, a Monday run builds no personal digest, writes no `digest_runs` row for one, sends none and posts no alert for one, whoever `DIGEST_PERSONAL_TO` names. The team digest is not affected. |
| `DIGEST_PERSONAL_TO` | Who gets a personal Monday digest when `DIGEST_PERSONAL` is on: `all`, or names or emails separated by commas. Unset, nobody does (opt-in since 2026-11-16; it used to start with Devin). |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_CONFIG_ID` | Site › Instagram (2026-11-16, Unified Login since 2026-11-24): the **Meta app's** ID and secret (App settings › Basic; not an Instagram app ID) and the Facebook Login for Business configuration's ID (public, not a secret), for Connect Instagram. Any unset, the tab says what's missing and can only draft. See **Instagram** above. |
| `SCHEDULE_A_SHEET_ID` | The Schedule A spreadsheet's id (2026-11-20, `lib/schedule-a.js`; see **Schedule A** above): its tab `Schedule A` is written from the site, the service account needs Editor. Unset, the feature is off: nothing is read or written and Site › Sync says it isn't set up. Set it in Production only. |
| `PAID_WAIT_MS` | How long the paste box waits for a paid lookup (an Apify run) before answering, in milliseconds. 25000 by default; a run still going is picked up by the next lookup. |

**Write switches (off unless set to `on`)**

| Name | What it lets the dashboard write |
|---|---|
| `ACCOUNTING_SHEET_WRITES` | "Log it": new rows on the accounting sheet's Income tab. |
| `CLICKUP_TASK_WRITES` | ClickUp tasks: create, update and mark done. |
| `CLICKUP_REACTIONS` | Not off by default, unlike the rest: on unless set to `off` (2026-11-16). A website message marked read in Site › Messages gets a ✅ reaction on its post in ClickUp's Website Messages channel, and marking it unread takes it off again (`lib/clickup.js` `reactToMessage`, after the save). Best effort: a ClickUp failure or a slow answer (4 seconds at most) never changes the save. |
| `AR_SHEET_WRITES` | Publishing › Advance calculator's saves to the pub sheet's OUTREACH / ADVANCE CALCULATOR tabs (r11: the A&R Outreach view is gone; the calculator keeps these saves). Off in production when unset. |
| `AR_TRACKER_SHEET_WRITES` | The A&R sheet (r11, `lib/ar/tracker-sheet.js`), a one-way copy of the A&R lists in its own spreadsheet: its **Watchlist** tab rewritten in full (A:V, values only) after every list change and after each data cron, and one **Log** row appended per action (Added / Removed / Renewed / Expired / Confirmed). It creates those two tabs if they're missing and never touches any other tab; nothing is ever read back. Off, nothing calls Google for it. |
| `PUB_SHARE_WRITES` | "Fill in 100%": a blank Writer Share cell on the pub sheet. Also the nightly sync's Site Sync ID stamp (column N) on a row it imports from a client tab, the same stamp a staff member's pull makes (r11). |
| `STREAM_SHEET_WRITES` | The pub sheet's STREAM DATA tab from the new numbers, after each data cron tick (lib/stream-sheet.js): column D (streams) and E (source) of the rows with a confirmed Spotify match, and the label in G1. Nothing else on the sheet. |
| `STREAM_SHEET_MODE` | Not a switch: `estimate` (default, Spotify plays x each song's own Luminate/Spotify ratio, refreshed by each monthly true-up, so the sheet stays on Luminate's all-platform scale; on true-up day the number is Luminate's own) or `spotify` (Spotify plays as they are). |
| `DATA_REFRESH` | Not a write, but it spends money: the daily data crons start Apify runs and read YouTube/Spotify. Off, nothing is fetched (Site › Sync shows what's there). |
| `DIGEST_WRITES` | The Monday digests: the team post to `DIGEST_CHANNEL_ID` and (only with `DIGEST_PERSONAL` on) the personal messages. Off, a Monday run still builds each digest and logs it (`digest_runs`, status "off"), so the preview shows what would have gone out. |
| `ALERTS` | On unless set to `off` (2026-11-17, `lib/alerts.js`): a nightly or weekly job that fails tells the founders with ONE short ClickUp message ("⚠️ Site check · Daily update: the pub sheet sync failed (…). Everything else ran. It tries again tomorrow."), instead of failing silently: a step of the daily update that went wrong, a data cron that threw, a Monday digest that ended "failed" (the team's, or a person's by name), the data refresh not having run for 26 hours, the Monday digest not having posted by Tuesday. At most one message per job and step per New York day (`app_state` `alertsSent`; Site › Sync lists the last 7 days, for an account with Money). With `CLICKUP_ALERTS=on` the older path (the nightly sync's failure and the pub sheet's rows, posted to the Dashboard Alerts channel) already says those two, so they are not posted twice; every other step still is. The data cron also says when the daily update's report hasn't been saved for 26 hours. It posts only with `DIGEST_WRITES=on` (the same "may write to ClickUp" switch as the digests), a `CLICKUP_API_TOKEN` and a channel (`ALERT_CHANNEL_ID`, else Dashboard Alerts, else `DIGEST_CHANNEL_ID`); otherwise the message is only in the logs. It never fails or slows a job (5 seconds at the most). |
| `SCHEDULE_A_WRITES` | Not off by default, unlike the rest: Schedule A's writes are on as soon as `SCHEDULE_A_SHEET_ID` is set, and `off` (or `false`, `0`, `no`) is the kill switch for every one of them (the daily step, the save's, the button, the Sync check's catch-up). Reading for a dry run (`GET /api/schedule-a`) still works. |
| `RADAR_SCANS` | Not a write, but it spends money: the TikTok radar's keyword scans and its risers' daily boost. Off, sounds added by link are still tracked one at a time. |
| `INSTAGRAM_POSTS` | Site › Instagram's **Post to Instagram** (2026-11-16, `lib/instagram.js`): a post to the connected Instagram account. Off, the composer still looks songs up, drafts and previews; a post is refused (503) before anything reaches Instagram. Connecting the account doesn't need it. |
| `CREDITS_SCAN` | On unless set to `off` (2026-11-18, `lib/credits/scan.js`): **Possible placements**. The data-collect cron (11:00 UTC, 25 seconds, one run at a time) reads the new releases of the artists our clients work with (the placements' artists, the roster, the A&R Watchlist) and each one's credits, Apple Music first, then YouTube, and a credit that names a roster client (exact name, or a staff alias in app_state `producerAliases`) is listed in To do as "N possible placements". **It never adds a song:** a Publishing staff member presses Add (the same add as the nightly auto-add, with the assumed split) or Not ours. `off` stops all of it. |
| `APPLE_CREDITS` | On unless set to `off` (2026-11-18): the Apple Music part of the credits scan only. It finds each new song with Apple's free iTunes API (its artist first, then the title and name, an iTunes call every 1.5 seconds) and asks Apple's public song page for it, at most one page a second and 60 a day with a generic browser User-Agent, and leaves Apple alone for the rest of the day on a 403, a 429 or a page that isn't the shape it was (the reason is in the cron's report, `credits.apple.stop`). The release reads and the YouTube fallback go on. |
| `PEOPLE_AUTOLINK` | On unless set to `off` (2026-11-14, `lib/people-link.js`): one person, same info everywhere. Someone new in the logins, the roster, the team page or INFO is added to the others, hidden and with no login: after a dashboard save that changes the people, from the Sync check at most every 2 minutes, nightly, and from Site › Sync's "Sync people now". Nothing is ever deleted or renamed by it. Its INFO writes (a client's name, a manager's name) also need `ACCOUNTING_SHEET_WRITES`, and it never grows Annual Summary. The first run is a person's: until Site › Sync's "Sync people now" (a preview, then "Add them") has run once, the automatic runs only log that they're waiting. |

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

- A save of the songs or the notable releases (`POST /api/dashboard-data`, 2026-11-18, `lib/known-ids.js`) never deletes or overwrites a
  row its page didn't know about. The page sends the ids its copy had (`knownIds.placements`, `knownIds.notableReleases`: from the copy
  its save was built on, never from the list it edited); the server upserts only the rows that are new or changed and deletes only the
  ids the page knew and left out, inside one transaction, so a song the nightly auto-add, the sheet sync or another person added in the
  meantime stays. A page from before (no `knownIds`) has its rows written and nothing deleted, and the answer says `stale: true`. The
  answer carries the lists as the database holds them now (`fresh`) and how many rows it left alone (`kept`); the page takes them in and
  says so quietly (a success: never the red error banner), in the toast spot in the success strip's look, for a few seconds or until its
  next save: "Saved. 2 songs added since you opened this page are now in your list." (`addedNote` in `components/app/saves.js`). An
  account limited to its own artists, and a client, can only change (and delete) their own artists' songs. Anything else that writes
  songs should do it by id (`lib/placement-rows.js`), never "delete them all and insert them again".
- Google's per-minute Sheets quota (2026-11-18, `lib/sheets.js`, `lib/auto-add.js`): the service account may read 60 times a minute, shared by the dashboard,
  the crons and every sheet. A request Google turns away for it (HTTP 429, "Quota exceeded …") is sent again after 4, 8 and 16 seconds (or what Retry-After
  says, if longer; 28 seconds at most for one request, and never past the 45th second of the daily cron), a write too, since a refused request did nothing; any
  other error (400, 403, 5xx) is raised at once, as before. The daily cron runs the auto-add LAST, so the sheet pull and the managers read have the quota first.
  A run of the auto-add spends at most 40 estimated reads (a song is 7 reads through `pushSongRows`: five songs a night, the rest wait for the next night), and
  a song is remembered in `app_state` `autoAdded` as `pending: true` between its card and its pub sheet row, so a row that couldn't be written (the quota, a refused
  write) is written first by the next run, before any new song; To do's "added automatically" list shows a song only once its row is on the sheet. An alert for
  a quota error says "Google Sheets was busy: too many requests in one minute" instead of Google's sentence.
- Roster and team photos load from `https://www.defiedmgmt.com/assets/…`. Spotify covers come from `i.scdn.co`.
  Uploaded photos come from `*.public.blob.vercel-storage.com`. All three hosts are listed in `next.config.js`.
- `next.config.js` holds the security headers, caching, redirects (`/staff` → `/team` and the pay.defiedmgmt.com links)
  and the image hosts.
