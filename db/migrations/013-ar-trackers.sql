-- List B #5, #6 and #8: A&R trackers (each staff account's own, rolled up into one team tracker), the
-- TikTok sound radar and the momentum score. New tables only, and one backfill that only inserts, so
-- running it again is harmless. No foreign keys (nothing into placements, clients or users: a missing
-- row reads as "deleted since").
--   ar_tracker       one row per person per thing they track: a watchlist artist or song (w:<ar_tracked id>),
--                    a roster artist (a:<client id>, never expires) or a TikTok sound (s:<clip id>), with
--                    how long (30/60/90 days). Expired: refreshing stops and Renew brings it back; 14 days
--                    later it's removed (removed_why 'expired'). The numbers stay in data_snapshots, so
--                    adding it again brings the history back.
--   radar_keywords   the radar's editable genre keywords (TikTok's sound search)
--   radar_sounds     every sound the radar has seen: from a keyword, a tracked artist's TikTok video, a
--                    pasted link, or one of ours. Its video counts are data_snapshots (s:<clip>, tiktok, videos)
--   momentum_scores  one score a day per tracked artist, kept for the trend (rising / falling)
CREATE TABLE IF NOT EXISTS ar_tracker (
  id text PRIMARY KEY,
  owner_id text NOT NULL DEFAULT '',          -- users.id ('' = a name that matched no login)
  owner_name text NOT NULL DEFAULT '',
  subject text NOT NULL,                      -- w:<ar_tracked id> | a:<client id> | s:<TikTok clip id>
  kind text NOT NULL CHECK (kind IN ('artist', 'song', 'sound')),
  days integer CHECK (days IS NULL OR days BETWEEN 1 AND 365),
  added_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,                     -- NULL: never (a roster artist, or tracked before durations)
  renewed_at timestamptz,
  removed_at timestamptz,
  removed_why text NOT NULL DEFAULT ''        -- 'expired' (not renewed in the grace period) | 'removed'
);
CREATE UNIQUE INDEX IF NOT EXISTS ar_tracker_live_uq ON ar_tracker(owner_id, subject) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS ar_tracker_subject_idx ON ar_tracker(subject);

-- everything already on the Watchlist goes on the tracker of whoever added it, with no end date (nobody
-- picked a length for those); deterministic ids, so a second run inserts nothing
INSERT INTO ar_tracker (id, owner_id, owner_name, subject, kind, added_at)
SELECT 'bf-' || t.id, COALESCE((SELECT u.id FROM users u WHERE u.role = 'staff' AND u.name = t.created_by ORDER BY u.id LIMIT 1), ''),
  t.created_by, 'w:' || t.id, t.kind, t.created_at
FROM ar_tracked t WHERE t.removed_at IS NULL
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS radar_keywords (
  id text PRIMARY KEY,
  keyword text NOT NULL,
  genre text NOT NULL DEFAULT '',             -- what the genre filter shows ('' = the keyword itself)
  active boolean NOT NULL DEFAULT true,
  last_scan_at timestamptz,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS radar_keywords_uq ON radar_keywords(lower(keyword));

CREATE TABLE IF NOT EXISTS radar_sounds (
  clip_id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  url text NOT NULL DEFAULT '',
  genres jsonb NOT NULL DEFAULT '[]',         -- the genres of the keywords that found it
  seeds jsonb NOT NULL DEFAULT '[]',          -- keyword | artist | manual | own
  from_entity text,                           -- the tracked artist (data_entities id) whose TikTok video used it
  own boolean NOT NULL DEFAULT false,         -- one of ours: asked about every day
  boost_until timestamptz,                    -- a top riser: asked about every day until then (renewed while it rises)
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz,                      -- the last count read for it
  last_checked timestamptz,                   -- the last time the radar asked about it by itself
  hidden_at timestamptz,                      -- taken off the radar by hand
  added_by text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS momentum_scores (
  entity_id text NOT NULL,                    -- a:<client id> | w:<ar_tracked id> | l:<Luminate id>
  day date NOT NULL,
  score numeric(5,1),                         -- 0-100; NULL = not enough numbers yet
  parts jsonb NOT NULL DEFAULT '{}',          -- { streams, followers, tiktok }: each one's points and growth
  why text NOT NULL DEFAULT '',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, day)
);
