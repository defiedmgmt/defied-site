-- Real backend schema for defied-site — see .claude/plans/wobbly-weaving-sunrise.md
-- for why this exists. IDs stay as text (not serial/uuid) to preserve the
-- existing site-generated ids (uid()) through migration without remapping
-- every foreign key across the whole export.

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT '',
  credit text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  photo text NOT NULL DEFAULT '',
  spotify text NOT NULL DEFAULT '',
  apple text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  tiktok text NOT NULL DEFAULT '',
  youtube text NOT NULL DEFAULT '',
  soundcloud text NOT NULL DEFAULT '',
  sheet_tab_name text NOT NULL DEFAULT '',
  total_streams bigint NOT NULL DEFAULT 0,
  on_roster boolean NOT NULL DEFAULT false,
  roster_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('staff', 'client')),
  name text NOT NULL DEFAULT '',
  client_id text REFERENCES clients(id) ON DELETE SET NULL
);

-- splits stay a JSONB array of {id,name,role,percent} rather than a join
-- table — matches the shape the frontend already reads/writes everywhere,
-- keeps the rewrite scoped. Revisit if per-collaborator queries are needed.
CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  song text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  release_date text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  notable boolean NOT NULL DEFAULT false,
  luminate_id text NOT NULL DEFAULT '',
  streams bigint NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  admin_fee numeric NOT NULL DEFAULT 0,
  splits jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS placements_client_id_idx ON placements(client_id);

-- the public "meet the team" roster — distinct from `users` login accounts
CREATE TABLE IF NOT EXISTS staff_bios (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  credit text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  photo text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false
);
-- 020: music link and files on a message (Dropbox), and each attempt's file count
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS music_link text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS files_status text NOT NULL DEFAULT '';
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS clickup_message_id text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS notable_releases (
  id text PRIMARY KEY,
  song text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  client text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  release_date text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT ''
);

-- singleton row (id always 1) for site-wide settings
CREATE TABLE IF NOT EXISTS site_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  about_text text NOT NULL DEFAULT '',
  last_synced_at timestamptz
);
INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- backs server-enforced login lockout — see /api/auth/login
CREATE TABLE IF NOT EXISTS login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL DEFAULT '',
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_time_idx ON login_attempts(email, attempted_at);
CREATE INDEX IF NOT EXISTS login_attempts_ip_time_idx ON login_attempts(ip, attempted_at);

-- backs contact-form rate limiting — see /api/submit-contact. Logs every
-- POST (including honeypot-tripped ones), not just accepted submissions,
-- so a scripted bot that fills the form out "correctly" still gets capped.
CREATE TABLE IF NOT EXISTS contact_attempts (
  id bigserial PRIMARY KEY,
  ip text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_attempts_ip_time_idx ON contact_attempts(ip, attempted_at);
ALTER TABLE contact_attempts ADD COLUMN IF NOT EXISTS files integer NOT NULL DEFAULT 0; -- 020

-- Luminate helper (dashboard v2, batch 1). Adds tables only: nothing that
-- already exists is changed, so running it again is harmless. None of these
-- has a foreign key into placements, on purpose: a staff save replaces the
-- placements table wholesale (DELETE + reinsert, see /api/dashboard-data),
-- which would cascade through any FK and wipe these rows on every save.

-- Luminate portfolios, as staff set them up in the Luminate account.
-- luminate_id is Luminate's own POR… id (from an export's file name or the
-- portfolio's link) and can be blank until the first export shows it.
CREATE TABLE IF NOT EXISTS luminate_portfolios (
  id text PRIMARY KEY,
  luminate_id text UNIQUE,
  name text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'roster' CHECK (kind IN ('roster', 'watchlist')),
  capacity integer NOT NULL DEFAULT 100,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- per song: its ISRC, and which portfolio it was added to in Luminate.
-- Keyed by placement id; a row whose song is gone is just ignored.
CREATE TABLE IF NOT EXISTS song_tracking (
  placement_id text PRIMARY KEY,
  isrc text NOT NULL DEFAULT '',
  isrc_source text NOT NULL DEFAULT '',
  isrc_checked_at timestamptz,
  portfolio_id text,
  added_at timestamptz,
  skip boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- every portfolio export taken in: the newest per portfolio rebuilds STREAM DATA
CREATE TABLE IF NOT EXISTS luminate_exports (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  exported_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text NOT NULL DEFAULT '',
  song_count integer NOT NULL DEFAULT 0,
  total_streams bigint NOT NULL DEFAULT 0,
  entities jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS luminate_exports_portfolio_idx ON luminate_exports(portfolio_id, exported_at DESC);

-- all-time streams per Luminate song per day: the growth history
CREATE TABLE IF NOT EXISTS stream_snapshots (
  luminate_id text NOT NULL,
  taken_on date NOT NULL,
  streams bigint NOT NULL,
  ytd bigint,
  PRIMARY KEY (luminate_id, taken_on)
);

-- Luminate rows staff marked "not one of ours" (never offered for linking again)
CREATE TABLE IF NOT EXISTS luminate_ignored (
  luminate_id text PRIMARY KEY,
  ignored_at timestamptz NOT NULL DEFAULT now()
);

-- small key/value store for background jobs (when an alert was last sent, …)
CREATE TABLE IF NOT EXISTS app_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Luminate batch-1 fixes. Adds one table only: nothing that already exists is
-- changed, so running it again is harmless. No foreign keys, like the rest.

-- A&R portfolio exports (prospects' artists and songs) dropped on the
-- Luminate page before the A&R tab can use them. Kept here, apart from
-- luminate_exports, so they never reach STREAM DATA, the clients' numbers,
-- linking or the "add to Luminate" list. The A&R tab takes them over.
CREATE TABLE IF NOT EXISTS luminate_ar_held (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL,                 -- Luminate's POR… id
  holds text NOT NULL CHECK (holds IN ('artists', 'songs')),
  file_name text NOT NULL DEFAULT '',
  exported_at timestamptz NOT NULL,           -- from the file name (a renamed file is refused)
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text NOT NULL DEFAULT '',
  entity_count integer NOT NULL DEFAULT 0,    -- everything: what counts toward its slots
  artist_count integer NOT NULL DEFAULT 0,
  song_count integer NOT NULL DEFAULT 0,
  weekly boolean NOT NULL DEFAULT false,      -- had "Last Period" rows (Luminate's weekly numbers)
  entities jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS luminate_ar_held_portfolio_idx ON luminate_ar_held(portfolio_id, exported_at DESC);

-- A&R (dashboard v2, batch 2). New tables only: nothing that already exists is changed, so running
-- it again is harmless. No foreign keys into clients, placements or luminate_*: a staff save upserts
-- and deletes clients and rewrites placements wholesale (see /api/dashboard-data), and neither may
-- cascade into these rows. A missing client/placement reads as "deleted since".

-- A&R portfolios in Luminate (one or more for artists, one or more for songs). Kept apart from
-- luminate_portfolios so nothing in the clients' pipeline (STREAM DATA, auto-link, "which song is
-- this?", the to-add list, lastUpload) can ever read them.
CREATE TABLE IF NOT EXISTS ar_portfolios (
  id text PRIMARY KEY,
  luminate_id text UNIQUE,                    -- POR… id, from its link or its first export
  name text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  holds text NOT NULL CHECK (holds IN ('artists', 'songs')),
  capacity integer NOT NULL DEFAULT 100 CHECK (capacity BETWEEN 1 AND 1000),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- every A&R export taken in (luminate_exports' shape, with counts per entity type)
CREATE TABLE IF NOT EXISTS ar_exports (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL,                 -- the Luminate POR… id
  file_name text NOT NULL DEFAULT '',
  exported_at timestamptz NOT NULL,           -- from the file name; a renamed file is refused
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text NOT NULL DEFAULT '',
  entity_count integer NOT NULL DEFAULT 0,    -- everything: what counts toward the 100 slots
  artist_count integer NOT NULL DEFAULT 0,
  song_count integer NOT NULL DEFAULT 0,
  weekly boolean NOT NULL DEFAULT false,      -- had "Last Period" rows (Luminate's weekly numbers)
  entities jsonb NOT NULL DEFAULT '[]'        -- parseExport entities: {id,name,type,atd,ytd,period,last,change,owners}
);
CREATE INDEX IF NOT EXISTS ar_exports_portfolio_idx ON ar_exports(portfolio_id, exported_at DESC);

-- One row per prospect: the permanent id an OUTREACH row is matched to, plus what the sheet has no
-- column for. The sheet stays the source of truth for name/contact/status/last contact/notes/slots;
-- sheet_seen is only a read-only copy for when Sheets is down and for rename detection.
CREATE TABLE IF NOT EXISTS ar_prospects (
  id text PRIMARY KEY,                        -- also the client id after "Turn into client"
  name text NOT NULL,                         -- OUTREACH!A as last seen
  name_key text NOT NULL,                     -- personKey(name), or lower(trim(name)) when that is ''
  outreach_row integer CHECK (outreach_row IS NULL OR outreach_row >= 5),
  sheet_seen jsonb NOT NULL DEFAULT '{}',     -- last unformatted A..AA of its row + {calc:{C,D,E,G,H,N}}
  sheet_seen_at timestamptz,
  advance_given text NOT NULL DEFAULT '',     -- last known ADVANCE "Advance Given?" ('Yes'|'No'|'')
  follow_up_on date,
  follow_up_note text NOT NULL DEFAULT '',
  follow_up_pinged_on date,                   -- last day ClickUp accepted a reminder for it
  instagram text NOT NULL DEFAULT '',         -- bare handle (clients.instagram format)
  tiktok text NOT NULL DEFAULT '',            -- bare handle
  youtube text NOT NULL DEFAULT '',           -- full channel URL (clients.youtube format)
  spotify text NOT NULL DEFAULT '',           -- artist URL; its 22-char id is what Luminate's ID search takes
  client_id text,                             -- set when "Turn into client" finished
  converted_at timestamptz,
  removed_at timestamptz,                     -- off the board (row cleared by us or gone from the sheet)
  removed_by text NOT NULL DEFAULT '',        -- staff name, or 'sheet'
  merged_into text,                           -- "same person as…": its data moved to that id
  source text NOT NULL DEFAULT 'sheet' CHECK (source IN ('sheet', 'dashboard', 'luminate')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- two prospects can never hold one OUTREACH row: also the guard that stops two adds landing together
CREATE UNIQUE INDEX IF NOT EXISTS ar_prospects_row_uq ON ar_prospects(outreach_row) WHERE outreach_row IS NOT NULL;
CREATE INDEX IF NOT EXISTS ar_prospects_key_idx ON ar_prospects(name_key);
CREATE INDEX IF NOT EXISTS ar_prospects_follow_idx ON ar_prospects(follow_up_on) WHERE follow_up_on IS NOT NULL;

-- What we follow per prospect in Luminate: their artist page(s) and their songs. A song can sit in one
-- of OUTREACH's Song 1-5 slots; its writer % then lives in the sheet. share is only for songs with no
-- slot (used by "Turn into client"). luminate_id is unique per prospect only: co-writers can share a song.
CREATE TABLE IF NOT EXISTS ar_tracking (
  id text PRIMARY KEY,                        -- also the placement id if the prospect becomes a client
  prospect_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('artist', 'song')),
  name text NOT NULL DEFAULT '',              -- song title or artist name ('' = an untitled slot from the sheet)
  artist text NOT NULL DEFAULT '',            -- a song's recording artist
  link text NOT NULL DEFAULT '',              -- Spotify track/artist link
  cover text NOT NULL DEFAULT '',
  spotify_id text NOT NULL DEFAULT '',        -- 22-char Spotify id (artist: paste into Luminate's ID search)
  isrc text NOT NULL DEFAULT '',
  isrc_source text NOT NULL DEFAULT '',       -- 'deezer' | 'manual' | 'client' | ''
  isrc_checked_at timestamptz,
  luminate_id text NOT NULL DEFAULT '',
  via text NOT NULL DEFAULT '' CHECK (via IN ('', 'ar', 'clients')),  -- where its numbers come from
  portfolio_id text,                          -- ar_portfolios.id it was marked as added to
  added_at timestamptz,
  slot smallint CHECK (slot IS NULL OR slot BETWEEN 1 AND 5),
  share numeric CHECK (share IS NULL OR (share > 0 AND share <= 1)),   -- only when slot IS NULL
  last_filled bigint,                         -- streams the site last wrote into its slot
  skip boolean NOT NULL DEFAULT false,        -- "not on Luminate / don't track"
  left_portfolio_at timestamptz,              -- staff removed it from the A&R portfolio in Luminate
  placement_id text,                          -- the client song it became
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'song' OR slot IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ar_tracking_slot_uq ON ar_tracking(prospect_id, slot) WHERE slot IS NOT NULL AND removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ar_tracking_lum_uq ON ar_tracking(prospect_id, luminate_id) WHERE luminate_id <> '' AND removed_at IS NULL;
CREATE INDEX IF NOT EXISTS ar_tracking_prospect_idx ON ar_tracking(prospect_id);
CREATE INDEX IF NOT EXISTS ar_tracking_lum_idx ON ar_tracking(luminate_id) WHERE luminate_id <> '';

-- A&R Luminate rows staff marked "not a prospect" (apart from luminate_ignored, so ignoring one can
-- never hide a client song from linking)
CREATE TABLE IF NOT EXISTS ar_ignored (
  luminate_id text PRIMARY KEY,
  ignored_at timestamptz NOT NULL DEFAULT now(),
  ignored_by text NOT NULL DEFAULT ''
);

-- A prospect's history, and every pub-sheet cell the A&R code wrote with what was there before
-- (History, Undo, "Put back", and recovery when a request dies between write and confirmation)
CREATE TABLE IF NOT EXISTS ar_events (
  id text PRIMARY KEY,
  prospect_id text,                           -- NULL = not about one prospect (a fill, a sheet check)
  at timestamptz NOT NULL DEFAULT now(),
  by text NOT NULL DEFAULT '',
  kind text NOT NULL,                         -- imported|created|edit|status|contact|follow_up|song|luminate|
                                              -- fill|given|remove|restore|undo|merge|convert|sheet_edit|moved|gone
  text text NOT NULL DEFAULT '',              -- the plain sentence History shows
  cells jsonb NOT NULL DEFAULT '[]',          -- [{tab, cell, before, after}] (unformatted values)
  status text NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'done', 'failed', 'undone'))
);
CREATE INDEX IF NOT EXISTS ar_events_prospect_idx ON ar_events(prospect_id, at DESC);
CREATE INDEX IF NOT EXISTS ar_events_pending_idx ON ar_events(at) WHERE status = 'pending';

-- A&R Watchlist (dashboard v2, the A&R rebuild). One new table only, so running it again is
-- harmless. Artists and songs staff track that aren't pub-deal prospects: they live here alone and
-- never go into the pub sheet. No foreign keys (person_id may name an ar_prospects or ar_tracked id;
-- a missing one reads as "deleted since"), and nothing into placements.
CREATE TABLE IF NOT EXISTS ar_tracked (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('artist', 'song')),
  name text NOT NULL,                         -- the artist's name, or the song's title
  artist text NOT NULL DEFAULT '',            -- a song's artist
  handle text NOT NULL DEFAULT '',            -- Instagram / TikTok
  spotify text NOT NULL DEFAULT '',
  isrc text NOT NULL DEFAULT '',
  genre text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  luminate_id text NOT NULL DEFAULT '',       -- its row in an A&R Luminate list ('' = not there yet)
  person_id text,                             -- a song tied to a tracked person (prospect or artist)
  stage text CHECK (stage IS NULL OR stage IN ('reach', 'reached', 'talking', 'offer', 'signed', 'passed')), -- NULL = not on the board
  last_contact date,
  follow_up date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT '',
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ar_tracked_lum_idx ON ar_tracked(luminate_id) WHERE luminate_id <> '';

-- One-click logging of Stripe payments into the accounting sheet (dashboard, lib/accounting-log.js).
-- One new table only, so running it again is harmless. One row per Stripe payment id: the claim that
-- stops a double click or a second tab from logging it twice, then the Income row it went to. No
-- foreign keys, and nothing into placements.
CREATE TABLE IF NOT EXISTS accounting_log (
  payment_id text PRIMARY KEY,                -- Stripe's id: an application fee (fee_…) or a charge (ch_…)
  claim text NOT NULL,                        -- the request holding it; a takeover must name the old one
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  day text NOT NULL,                          -- the payment's New York day, YYYY-MM-DD
  amount_cents integer NOT NULL,              -- the Gross Commission written (the full amount paid)
  client text NOT NULL DEFAULT '',            -- as written in Artist / Client
  sheet_row integer,                          -- the Income row it was written to
  row_values jsonb,                           -- A:J as sent (null = a formula cell left alone)
  by_name text NOT NULL DEFAULT '',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  logged_at timestamptz
);

-- "This isn't ours" (dashboard song window and Luminate page): songs staff removed because they
-- aren't Defied's. One new table only, so running it again is harmless. The sheet sync never
-- imports a row of that client with that title again, and the Dashboard reminds staff to take its
-- Luminate id out of the portfolio. No foreign keys, and nothing into placements: the song is gone.
CREATE TABLE IF NOT EXISTS not_ours (
  id text PRIMARY KEY,
  client_id text,                             -- whose page it was on (null: a Luminate-only song)
  song text NOT NULL,
  song_key text NOT NULL,                     -- normalizeTitle(song), what the sync compares
  artist text,
  luminate_id text,
  placement_id text,                          -- the deleted song's id, for the record only
  removed_at timestamptz NOT NULL DEFAULT now(),
  out_of_luminate_at timestamptz              -- staff said "I've taken it out" of Luminate
);
CREATE INDEX IF NOT EXISTS not_ours_key_idx ON not_ours(client_id, song_key);

-- What the pub sheet says about each song and client, kept by the sheet pull (sheets-pull and the
-- server sync) so the Dashboard can list songs that need updating and show the sheet's own net
-- streams. Two new tables only, so running it again is harmless. Nothing is written to the sheet,
-- and no foreign keys: a song or client removed later just leaves a row nobody reads.
CREATE TABLE IF NOT EXISTS sheet_song_facts (
  placement_id text NOT NULL,
  client_id text NOT NULL,
  sheet_row integer NOT NULL,                 -- the row on the client's writer tab
  sheet_share numeric,                        -- the Writer Share it holds, 0-100 (null: blank on the sheet)
  net_streams numeric NOT NULL DEFAULT 0,     -- gross × share, the row's Net Streams
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (placement_id, client_id)
);
CREATE INDEX IF NOT EXISTS sheet_song_facts_client_idx ON sheet_song_facts(client_id);
CREATE TABLE IF NOT EXISTS sheet_client_facts (
  client_id text PRIMARY KEY,
  tab text NOT NULL,                          -- the writer tab that was read
  net_streams bigint NOT NULL,                -- the tab's Net Streams total (MASTER's writer table)
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- Hands-free Luminate (round 7, C1): the Mac helper's uploads, the ISRC finder's candidates and the
-- A&R artists' Deezer numbers. New tables only, so running it again is harmless. No foreign keys, and
-- nothing into placements: a song or person removed later just leaves a row nobody reads.

-- Every export the Mac helper sent (POST /api/luminate-helper). A file held back for a person (it
-- covers more than a week, its all-time went down, or its portfolio is new) keeps its CSV here until
-- staff apply or discard it; every other row is a log line for the Luminate page's status.
CREATE TABLE IF NOT EXISTS luminate_helper_files (
  id text PRIMARY KEY,
  device text NOT NULL DEFAULT '',            -- which helper sent it (the token's name)
  file_name text NOT NULL,
  portfolio_id text,                          -- the POR… id from the file name
  exported_at timestamptz,                    -- from the file name
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('applied', 'kept', 'older', 'held', 'error', 'discarded')),
  reason text NOT NULL DEFAULT '',            -- why it was held, or what was wrong with it
  csv text,                                   -- only while held
  decided_by text NOT NULL DEFAULT '',        -- staff who applied or discarded a held one
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS luminate_helper_files_status_idx ON luminate_helper_files(status, received_at DESC);

-- What the ISRC finder offered when it wasn't sure: up to 3 { isrc, source, title, artist, cover },
-- for one-tap picking. item = a placement id, or "ar:<ar_tracked id>". Cleared once an ISRC is set.
CREATE TABLE IF NOT EXISTS isrc_candidates (
  item text PRIMARY KEY,
  song text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  candidates jsonb NOT NULL DEFAULT '[]',
  checked_at timestamptz NOT NULL DEFAULT now()
);

-- An A&R person's Deezer page: fans (Deezer's nb_fan) and their tracks, so an artist Luminate has no
-- artist page for yet is still followed, through their songs. person = "t:<ar_tracked id>" or
-- "p:<ar_prospects id>".
CREATE TABLE IF NOT EXISTS ar_deezer (
  person text PRIMARY KEY,
  deezer_id text NOT NULL DEFAULT '',         -- '' = looked, no page found
  name text NOT NULL DEFAULT '',
  fans integer,
  picture text NOT NULL DEFAULT '',
  tracks jsonb NOT NULL DEFAULT '[]',         -- [{ title, isrc, deezerId }]
  checked_at timestamptz NOT NULL DEFAULT now()
);

-- Add artist from a link (round 7, C2): the photo it found (Spotify's, or Deezer's) on the tracked
-- artist. One new column with a default, so running it again is harmless and nothing else changes.
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS photo text NOT NULL DEFAULT '';

-- Roles and permissions (list B #1). Additive only, and safe to run again: every column is
-- ADD COLUMN IF NOT EXISTS, and the two UPDATEs only fill a role that isn't set yet.
--
-- users.role stays "staff" / "client" (the sign-in and the session don't change). A staff account
-- also gets one of three presets (lib/access.js):
--   founder    everything
--   comanager  everything except Money and Users (user management); optionally only their own artists
--   intern     Site only
-- NULL means "not set yet": a Co-manager once any Founder exists, else a Founder (so a database where
-- nobody is a Founder yet, the harness's for one, keeps working exactly as before).
ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_role text;
-- Per-user changes on top of the preset, set by a Founder in Site > Users:
--   { "sections": { "money": true, "ar": false, ... }, "ownOnly": true }
ALTER TABLE users ADD COLUMN IF NOT EXISTS access jsonb NOT NULL DEFAULT '{}'::jsonb;
-- Each client's manager, from the accounting sheet's INFO tab ("Assigned Manager"): what a
-- Co-manager limited to their own artists is matched on (their account's name). '' = none.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS manager text NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS manager_at timestamptz;

-- The owner's decision (2026-11-04): the Founders are Devin, Burny and Hank; every other staff account
-- is a Co-manager. Matched by the live accounts' ids and emails, and only where no role is set yet,
-- so a role a Founder changes later is never put back.
UPDATE users SET staff_role = 'founder'
  WHERE role = 'staff' AND staff_role IS NULL
    AND (id IN ('jcypmfil', 'wo3ufb3w', '1l4mirtq')
      OR lower(email) IN ('devin@defiedmgmt.com', 'hank@defiedmgmt.com', 'burnymadeit@gmail.com'));
UPDATE users SET staff_role = 'comanager'
  WHERE role = 'staff' AND staff_role IS NULL
    AND EXISTS (SELECT 1 FROM users f WHERE f.staff_role = 'founder');

-- List B #4: the automated numbers (Spotify streams and monthly listeners, Instagram/TikTok followers,
-- TikTok sound videos, YouTube). New tables only, no foreign keys (nothing into placements), so running
-- it again is harmless.
--   data_entities   what is tracked: an artist (a roster client or a watchlist artist), a song, a sound
--   data_links      its id or handle on each platform (one per platform)
--   data_albums     the Spotify releases already read into the catalog (new ones are picked up daily)
--   data_snapshots  every number, dated: entity, platform, metric, value, taken_at, source
--   data_checks     when each source last asked about each entity (a failed or empty answer counts, so
--                   a song with no number isn't asked again every hour)
--   data_refresh    per artist or sound: 'campaign' (everything daily while we push it) or 'off'
--   data_settings   the sources' schedule, scraper and monthly budget; the Apify account's usage
--   data_runs       every run, with its cost (estimated, then what Apify charged)
CREATE TABLE IF NOT EXISTS data_entities (
  id text PRIMARY KEY,                       -- a:<client id> | w:<A&R id> | t:<Spotify track id> | s:<TikTok clip id>
  kind text NOT NULL CHECK (kind IN ('artist', 'track', 'sound')),
  name text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',           -- a song's or a sound's artist, as shown
  image text NOT NULL DEFAULT '',
  release_date text NOT NULL DEFAULT '',
  isrc text NOT NULL DEFAULT '',             -- one song can have several Spotify ids: counted once, by ISRC
  parent_id text,                            -- a catalog song's artist entity
  clients jsonb NOT NULL DEFAULT '[]',       -- the roster clients it belongs to
  origins jsonb NOT NULL DEFAULT '[]',       -- roster | placement | catalog | watchlist | manual
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS data_entities_isrc_idx ON data_entities(isrc) WHERE isrc <> '';
CREATE TABLE IF NOT EXISTS data_links (
  entity_id text NOT NULL,
  platform text NOT NULL,                    -- spotify | instagram | tiktok | youtube | tiktok_sound
  ref text NOT NULL,                         -- Spotify id, handle, YouTube channel id or @handle, clip id
  url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, platform)
);
CREATE TABLE IF NOT EXISTS data_albums (
  album_id text PRIMARY KEY,
  artist_entity text NOT NULL,
  name text NOT NULL DEFAULT '',
  release_date text NOT NULL DEFAULT '',
  tracks integer NOT NULL DEFAULT 0,
  read_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS data_snapshots (
  id bigserial PRIMARY KEY,
  entity_id text NOT NULL,
  platform text NOT NULL,
  metric text NOT NULL,                      -- streams | monthly_listeners | followers | videos | subscribers | views
  value bigint NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT '',           -- the scraper or API it came from
  approx boolean NOT NULL DEFAULT false,     -- a rounded count ("about 29K")
  run_id text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS data_snapshots_entity_idx ON data_snapshots(entity_id, platform, metric, taken_at);
CREATE UNIQUE INDEX IF NOT EXISTS data_snapshots_run_idx ON data_snapshots(run_id, entity_id, platform, metric) WHERE run_id <> '';
CREATE TABLE IF NOT EXISTS data_checks (
  entity_id text NOT NULL,
  source text NOT NULL,
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (entity_id, source)
);
CREATE TABLE IF NOT EXISTS data_refresh (
  entity_id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('campaign', 'off')),
  until timestamptz,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS data_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS data_runs (
  id text PRIMARY KEY,
  source text NOT NULL,
  adapter text NOT NULL,
  actor text NOT NULL DEFAULT '',
  apify_run_id text,
  dataset_id text,
  status text NOT NULL,                      -- started | collecting | done | failed | skipped
  targets jsonb NOT NULL DEFAULT '[]',       -- [{entityId, ref}]
  items integer,
  snapshots integer,
  est_usd numeric(10,4) NOT NULL DEFAULT 0,
  usd numeric(10,4),
  error text NOT NULL DEFAULT '',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS data_runs_source_idx ON data_runs(source, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS data_runs_apify_idx ON data_runs(apify_run_id) WHERE apify_run_id IS NOT NULL;

-- List B #3 (Luminate replaced by the automated numbers): the Luminate portfolios are the new tracking's
-- starting list. One row per entity in the last exports of Admin Catalog 1 & 2, the Artist Tracker and the
-- Song Tracker: what it was matched to on Spotify (and an artist's socials), and its old Luminate numbers,
-- kept read-only as history. Adds one table only, so running it again is harmless. No foreign keys.
CREATE TABLE IF NOT EXISTS lum_history (
  lum_id text PRIMARY KEY,                    -- Luminate's own id (SG… song, AR… artist, MRELG… release)
  list text NOT NULL DEFAULT '',              -- Admin Catalog 1 | Admin Catalog 2 | Artist Tracker | Song Tracker
  area text NOT NULL DEFAULT 'roster' CHECK (area IN ('roster', 'ar')),
  kind text NOT NULL CHECK (kind IN ('song', 'artist', 'release')),
  name text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',            -- a song's artist, from its song here (Luminate's files have none)
  placement_ids jsonb NOT NULL DEFAULT '[]',  -- the songs here it was linked to
  client_id text,                             -- an artist who is one of ours
  ar_id text,                                 -- the A&R Watchlist's artist or song (ar_tracked)
  isrc text NOT NULL DEFAULT '',
  spotify_id text NOT NULL DEFAULT '',        -- the Spotify track or artist it is matched to
  spotify_name text NOT NULL DEFAULT '',      -- what Spotify calls it (a match to check shows it)
  spotify_image text NOT NULL DEFAULT '',
  entity_id text,                             -- the data_entities row that tracks it now
  matched_by text NOT NULL DEFAULT '',        -- link | isrc | name | same-song | typed
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('matched', 'check', 'todo', 'skipped')),
  socials jsonb NOT NULL DEFAULT '{}',        -- { instagram, tiktok, youtube }: the links staff gave an artist
  atd bigint,                                 -- Luminate's last all-time streams (all platforms)
  atd_on date,                                -- the day Luminate made that export
  week jsonb,                                 -- { thisWeek, lastWeek, from, to } when that export was a 1-week one
  series jsonb NOT NULL DEFAULT '[]',         -- [[day, all-time streams]] from every export kept
  decided_by text NOT NULL DEFAULT '',        -- staff who matched, confirmed or skipped it by hand
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lum_history_entity_idx ON lum_history(entity_id) WHERE entity_id IS NOT NULL;

-- List B #5, #6 and #8: A&R trackers (each staff account's own, rolled up into one team tracker), the
-- TikTok sound radar and the momentum score. New tables only, and one backfill that only inserts, so
-- running it again is harmless. No foreign keys (nothing into placements, clients or users: a missing
-- row reads as "deleted since").
--   ar_tracker       one row per person per thing they track: a watchlist artist or song (w:<ar_tracked id>),
--                    a roster artist (a:<client id>, never expires) or a TikTok sound (s:<clip id>), with
--                    how long (30/60/90 days). Expired: refreshing stops and Renew brings it back; 14 days
--                    later it's removed (removed_why 'expired'). The numbers stay in data_snapshots, so
--                    adding it again brings the history back.
--   radar_keywords   the radar's editable genre keywords (TikTok's sound search)
--   radar_sounds     every sound the radar has seen: from a keyword, a tracked artist's TikTok video, a
--                    pasted link, or one of ours. Its video counts are data_snapshots (s:<clip>, tiktok, videos)
--   momentum_scores  one score a day per tracked artist, kept for the trend (rising / falling)
CREATE TABLE IF NOT EXISTS ar_tracker (
  id text PRIMARY KEY,
  owner_id text NOT NULL DEFAULT '',          -- users.id ('' = a name that matched no login)
  owner_name text NOT NULL DEFAULT '',
  subject text NOT NULL,                      -- w:<ar_tracked id> | a:<client id> | s:<TikTok clip id>
  kind text NOT NULL CHECK (kind IN ('artist', 'song', 'sound')),
  days integer CHECK (days IS NULL OR days BETWEEN 1 AND 365),
  added_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                     -- NULL: never (a roster artist, or tracked before durations)
  renewed_at timestamptz,
  removed_at timestamptz,
  removed_why text NOT NULL DEFAULT ''        -- 'expired' (not renewed in the grace period) | 'removed'
);
CREATE UNIQUE INDEX IF NOT EXISTS ar_tracker_live_uq ON ar_tracker(owner_id, subject) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS ar_tracker_subject_idx ON ar_tracker(subject);

-- everything already on the Watchlist goes on the tracker of whoever added it, with no end date (nobody
-- picked a length for those); deterministic ids, so a second run inserts nothing
INSERT INTO ar_tracker (id, owner_id, owner_name, subject, kind, added_at)
SELECT 'bf-' || t.id, COALESCE((SELECT u.id FROM users u WHERE u.role = 'staff' AND u.name = t.created_by ORDER BY u.id LIMIT 1), ''),
  t.created_by, 'w:' || t.id, t.kind, t.created_at
FROM ar_tracked t WHERE t.removed_at IS NULL
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS radar_keywords (
  id text PRIMARY KEY,
  keyword text NOT NULL,
  genre text NOT NULL DEFAULT '',             -- what the genre filter shows ('' = the keyword itself)
  active boolean NOT NULL DEFAULT true,
  last_scan_at timestamptz,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radar_keywords_uq ON radar_keywords(lower(keyword));

CREATE TABLE IF NOT EXISTS radar_sounds (
  clip_id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  genres jsonb NOT NULL DEFAULT '[]',         -- the genres of the keywords that found it
  seeds jsonb NOT NULL DEFAULT '[]',          -- keyword | artist | manual | own
  from_entity text,                           -- the tracked artist (data_entities id) whose TikTok video used it
  own boolean NOT NULL DEFAULT false,         -- one of ours: asked about every day
  boost_until timestamptz,                    -- a top riser: asked about every day until then (renewed while it rises)
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz,                      -- the last count read for it
  last_checked timestamptz,                   -- the last time the radar asked about it by itself
  hidden_at timestamptz,                      -- taken off the radar by hand
  added_by text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS momentum_scores (
  entity_id text NOT NULL,                    -- a:<client id> | w:<ar_tracked id> | l:<Luminate id>
  day date NOT NULL,
  score numeric(5,1),                         -- 0-100; NULL = not enough numbers yet
  parts jsonb NOT NULL DEFAULT '{}',          -- { streams, followers, tiktok }: each one's points and growth
  why text NOT NULL DEFAULT '',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, day)
);

-- List B #7 (one "paste a link" box) and #9 (Monday digests). Additive and idempotent: two new tables and
-- one new column, no foreign keys, so running it again is harmless.
--   link_cache   what a pasted link resolved to. The Apify lookups (TikTok, Instagram) cost credit, so
--                their answers are kept 7 days and a slow run is picked up again, not started twice.
--   digest_runs  every Monday digest built or sent: one row per week, kind and person, so the two Monday
--                crons (one for EDT, one for EST) send it once
--   users.clickup_user_id  who a personal digest goes to in ClickUp (blank: matched by email)
CREATE TABLE IF NOT EXISTS link_cache (
  key text PRIMARY KEY,                       -- platform:kind:id, e.g. tiktok:profile:1stackie
  platform text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',           -- the resolved card (no keys, no signed photo links)
  cost_usd numeric NOT NULL DEFAULT 0,        -- what the lookup charged (Apify), 0 for the free APIs
  run_id text NOT NULL DEFAULT '',            -- an Apify run still going (picked up on the next paste)
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'running', 'failed')),
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS digest_runs (
  id text PRIMARY KEY,                        -- <week>|team or <week>|user:<id>
  week date NOT NULL,                         -- the Monday (New York) it's for
  kind text NOT NULL CHECK (kind IN ('team', 'personal')),
  user_id text,
  status text NOT NULL CHECK (status IN ('sent', 'off', 'failed', 'skipped')),
  channel text NOT NULL DEFAULT '',           -- the ClickUp channel or direct message it went to
  error text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS clickup_user_id text NOT NULL DEFAULT '';

-- The monthly Luminate true-up (the owner, 2026-11-04: "i rly want this to be accurate but i dont wanna do the
-- reports"). Every day STREAM DATA's estimate is Spotify x each song's own ratio; once a month one real Luminate
-- file resets every roster song to its true all-platform number and refreshes that ratio. Additive and
-- idempotent: two new tables, no foreign keys, so running it again is harmless.
--   trueup_runs    one row per Apply: the files it read and who applied it. Undo deletes the newest run and
--                  its points, so nothing is left behind.
--   trueup_points  one row per roster song per run: Luminate's all-time total (all platforms) on the export's
--                  day, the Spotify count nearest it (within 3 days) and the ratio from them. ratio is null when
--                  no Spotify count was that close: the song keeps its old ratio.
CREATE TABLE IF NOT EXISTS trueup_runs (
  id text PRIMARY KEY,
  files jsonb NOT NULL DEFAULT '[]',          -- [{ name, portfolioId, list, exportedAt, rows }]
  export_on date,                             -- the newest file's New York day
  lum_ids jsonb NOT NULL DEFAULT '[]',        -- every song id in the files ("not in the report yet" compares to it)
  counts jsonb NOT NULL DEFAULT '{}',
  applied_by text NOT NULL DEFAULT '',
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trueup_points (
  run_id text NOT NULL,
  lum_id text NOT NULL,                       -- the STREAM DATA row (Luminate's song id)
  entity_id text,                             -- the Spotify song tracked here (data_entities)
  name text NOT NULL DEFAULT '',
  list text NOT NULL DEFAULT '',
  total bigint NOT NULL,                      -- Luminate's all-time streams, all platforms
  total_on date NOT NULL,                     -- the export's New York day
  exported_at timestamptz,
  spotify bigint,                             -- the Spotify count the ratio came from
  spotify_at timestamptz,
  ratio double precision,                     -- total / spotify; null = kept the old ratio
  old_ratio double precision,
  before bigint,                              -- the sheet's estimate just before
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, lum_id)
);
CREATE INDEX IF NOT EXISTS trueup_points_lum_idx ON trueup_points(lum_id, total_on DESC);

-- The old Luminate numbers as dated, read-only history (r10): every week, day and all-time total Luminate's own
-- files give for a song, release or artist, labelled "Luminate, all platforms" (or "..., US only") and kept apart
-- from the Spotify numbers (data_snapshots). Built from the dated portfolio exports and the Trend Report exports
-- (r10/real/build-history.mjs -> luminate-history.json -> load-history.mjs). Additive and idempotent: one new
-- table, no foreign keys; the loader's rows have a key they can't be inserted twice under.
--   grain  week (a full Fri-Thu tracking week) | week_partial (part of one) | day | atd (all time) | ytd
--   period_from / period_to  the days it covers; for atd/ytd both are the day it runs to. to_known = false: the
--          file didn't say its last day (a week to date, or an export's all-time), so period_to is the export day
--   entity_id  the dashboard entity when it was built; join on lum_id through lum_history for the current one
CREATE TABLE IF NOT EXISTS lum_points (
  lum_id text NOT NULL,                       -- Luminate's id (SG… song, AR… artist, MRELG… release group)
  grain text NOT NULL CHECK (grain IN ('week', 'week_partial', 'day', 'atd', 'ytd')),
  location text NOT NULL DEFAULT 'Worldwide', -- Worldwide | United States
  period_from date NOT NULL,
  period_to date NOT NULL,
  value bigint NOT NULL,                      -- streams, all platforms
  kind text NOT NULL DEFAULT '',              -- song | release | artist
  name text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  entity_id text,
  label text NOT NULL,                        -- Luminate, all platforms | Luminate, all platforms, US only
  source text NOT NULL DEFAULT '',            -- the file it came from
  basis text NOT NULL DEFAULT '',             -- how its dates are known
  to_known boolean NOT NULL DEFAULT true,
  luminate_pct double precision,              -- Luminate's own % change for that week, when the file had one
  exported_at timestamptz,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lum_id, grain, location, period_from, period_to)
);
CREATE INDEX IF NOT EXISTS lum_points_entity_idx ON lum_points(entity_id) WHERE entity_id IS NOT NULL;

-- A&R as lists (r10): who added what, the artist's other profiles, how sure each Spotify link is, and the
-- previous watchlist back on the Watchlist. Additive and idempotent: new columns with defaults, inserts with
-- fixed ids (ON CONFLICT DO NOTHING) and updates that only fill what's still empty. No foreign keys.
-- lum_history is only read (it stays read-only history).
--   ar_tracker.source      where an entry came from: paste | luminate | backfill | roster
--   ar_tracked.instagram / tiktok / youtube  the artist's other profiles, confirmed in the paste box (the
--                          engine tracks their followers too)
--   ar_tracked.match       how sure the Spotify link is: '' (pasted = sure) | isrc (ISRC equal) | name (a
--                          same-name match a person still has to confirm) | confirmed (a person tapped)
--   ar_tracked.match_candidates  the Spotify artists offered for a 'name' match: [{ id, name, image, listeners }]
ALTER TABLE ar_tracker ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS instagram text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS tiktok text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS youtube text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS match text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS match_candidates jsonb NOT NULL DEFAULT '[]';

-- THE PREVIOUS WATCHLIST: every old Luminate Artist / Song Tracker row goes on the Watchlist, when it isn't a
-- roster client and isn't there already (by Luminate id or Spotify id). Songs keep their Spotify link (their
-- ISRC equals Luminate's, so they're tracked at once); an artist's same-name match waits for a person's tap.
-- "Added" is the first Luminate export that had it (noon UTC, so it reads as that day in New York).
INSERT INTO ar_tracked (id, kind, name, artist, spotify, isrc, photo, luminate_id, created_by, created_at, match)
SELECT 'lum-' || lower(h.lum_id),
       CASE WHEN h.kind = 'artist' THEN 'artist' ELSE 'song' END,
       h.name,
       CASE WHEN h.kind = 'artist' THEN '' ELSE COALESCE(NULLIF(h.artist, ''), NULLIF(split_part(h.spotify_name, ' · ', 2), ''), '') END,
       CASE WHEN h.kind <> 'artist' AND h.spotify_id <> '' THEN 'https://open.spotify.com/track/' || h.spotify_id ELSE '' END,
       CASE WHEN h.kind <> 'artist' THEN h.isrc ELSE '' END,
       CASE WHEN h.kind <> 'artist' AND h.spotify_id <> '' THEN h.spotify_image ELSE '' END,
       h.lum_id, 'Team (from Luminate)',
       (COALESCE(CASE WHEN jsonb_typeof(h.series->0->0) = 'string' THEN (h.series->0->>0)::date END, h.atd_on, current_date) + interval '12 hours') AT TIME ZONE 'UTC',
       CASE WHEN h.kind = 'artist' THEN (CASE WHEN h.spotify_id <> '' THEN 'name' ELSE '' END) ELSE (CASE WHEN h.spotify_id <> '' THEN 'isrc' ELSE '' END) END
FROM lum_history h
WHERE h.area = 'ar' AND h.client_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ar_tracked t WHERE t.luminate_id = h.lum_id
                  OR (h.spotify_id <> '' AND t.spotify LIKE '%' || h.spotify_id || '%'))
ON CONFLICT (id) DO NOTHING;
-- the artist's name match is kept as the first candidate (never tracked before a tap)
UPDATE ar_tracked t SET match_candidates = jsonb_build_array(jsonb_build_object('id', h.spotify_id, 'name', h.spotify_name, 'image', h.spotify_image))
FROM lum_history h
WHERE t.id = 'lum-' || lower(h.lum_id) AND t.kind = 'artist' AND t.match = 'name' AND t.match_candidates = '[]'::jsonb AND h.spotify_id <> '';

-- each one gets one list entry. Nobody is named in the Luminate rows, so it's 'Team (from Luminate)', never a
-- made-up person, and there's no end date (nobody picked a length). A roster client (Liyakk!) goes on as a:<id>.
INSERT INTO ar_tracker (id, owner_id, owner_name, subject, kind, days, added_at, expires_at, source)
SELECT 'lum-' || lower(h.lum_id), 'team:luminate', 'Team (from Luminate)',
       CASE WHEN h.client_id IS NOT NULL THEN 'a:' || h.client_id ELSE 'w:' || t.id END,
       CASE WHEN h.kind = 'artist' THEN 'artist' ELSE 'song' END, NULL,
       (COALESCE(CASE WHEN jsonb_typeof(h.series->0->0) = 'string' THEN (h.series->0->>0)::date END, h.atd_on, current_date) + interval '12 hours') AT TIME ZONE 'UTC',
       NULL, 'luminate'
FROM lum_history h LEFT JOIN ar_tracked t ON t.luminate_id = h.lum_id AND t.removed_at IS NULL
WHERE h.area = 'ar' AND (h.client_id IS NOT NULL OR t.id IS NOT NULL)
ON CONFLICT (id) DO NOTHING;
UPDATE ar_tracker SET source = 'backfill' WHERE id LIKE 'bf-%' AND source = '';
-- sounds added by link in Numbers before the lists (a manual data_entities sound with no list entry): an entry for
-- whoever radar_sounds.added_by names (a staff login with that name), else 'Team'; no end date
INSERT INTO ar_tracker (id, owner_id, owner_name, subject, kind, days, added_at, expires_at, source)
SELECT 'snd-' || substr(e.id, 3),
       COALESCE((SELECT u.id FROM users u WHERE u.role = 'staff' AND u.name <> '' AND u.name = s.added_by ORDER BY u.id LIMIT 1), ''),
       COALESCE(NULLIF(s.added_by, ''), 'Team'), e.id, 'sound', NULL, e.created_at, NULL, 'backfill'
FROM data_entities e LEFT JOIN radar_sounds s ON s.clip_id = substr(e.id, 3)
WHERE e.kind = 'sound' AND e.active AND e.origins @> '["manual"]'::jsonb
  AND NOT EXISTS (SELECT 1 FROM ar_tracker t WHERE t.subject = e.id)
ON CONFLICT (id) DO NOTHING;

-- r11 (A&R UI, A2): a Watchlist artist's type for its colour chip. NULL = nobody has said yet (the row shows
-- "Artist": it is a Spotify artist profile), 'artist' or 'producer' once someone taps the drawer's switch or picks it
-- in the paste box. A roster row takes clients.role instead. Additive and idempotent: one nullable column, no
-- default, no backfill (the old A&R rows carry no producer flag: checked on the real preview data, 2026-11-05).
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS role text;

-- 019-ar-confirmed-entities.sql (r11 fix): an old-list artist's confirmed match is tracked on its l:<Luminate id> entity
UPDATE data_entities e
   SET active = true,
       origins = CASE WHEN e.origins @> '["watchlist"]'::jsonb THEN e.origins ELSE e.origins || '["watchlist"]'::jsonb END,
       updated_at = now()
  FROM ar_tracked t
  JOIN lum_history h ON h.lum_id = t.luminate_id AND h.kind = 'artist'
 WHERE e.id = h.entity_id AND e.id LIKE 'l:%' AND e.kind = 'artist'
   AND t.kind = 'artist' AND t.match = 'confirmed' AND t.removed_at IS NULL
   AND h.spotify_id <> '' AND substring(t.spotify from 'artist/([A-Za-z0-9]{22})') = h.spotify_id
   AND NOT (e.active AND e.origins @> '["watchlist"]'::jsonb);
INSERT INTO data_links (entity_id, platform, ref, url)
SELECT h.entity_id, 'spotify', substring(t.spotify from 'artist/([A-Za-z0-9]{22})'),
       'https://open.spotify.com/artist/' || substring(t.spotify from 'artist/([A-Za-z0-9]{22})')
  FROM ar_tracked t
  JOIN lum_history h ON h.lum_id = t.luminate_id AND h.kind = 'artist'
  JOIN data_entities e ON e.id = h.entity_id
 WHERE h.entity_id LIKE 'l:%' AND t.kind = 'artist' AND t.match = 'confirmed' AND t.removed_at IS NULL
   AND h.spotify_id <> '' AND substring(t.spotify from 'artist/([A-Za-z0-9]{22})') = h.spotify_id
ON CONFLICT (entity_id, platform) DO NOTHING;
