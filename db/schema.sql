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
