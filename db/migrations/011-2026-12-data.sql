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
