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
