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
