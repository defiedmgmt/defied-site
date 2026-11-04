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
