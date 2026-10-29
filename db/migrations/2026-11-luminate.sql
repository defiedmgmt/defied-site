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
