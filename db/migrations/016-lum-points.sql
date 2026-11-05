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
