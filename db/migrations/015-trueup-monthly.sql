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
