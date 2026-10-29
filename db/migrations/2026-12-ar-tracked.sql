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
