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
