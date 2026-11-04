-- List B #7 (one "paste a link" box) and #9 (Monday digests). Additive and idempotent: two new tables and
-- one new column, no foreign keys, so running it again is harmless.
--   link_cache   what a pasted link resolved to. The Apify lookups (TikTok, Instagram) cost credit, so
--                their answers are kept 7 days and a slow run is picked up again, not started twice.
--   digest_runs  every Monday digest built or sent: one row per week, kind and person, so the two Monday
--                crons (one for EDT, one for EST) send it once
--   users.clickup_user_id  who a personal digest goes to in ClickUp (blank: matched by email)
CREATE TABLE IF NOT EXISTS link_cache (
  key text PRIMARY KEY,                       -- platform:kind:id, e.g. tiktok:profile:1stackie
  platform text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',           -- the resolved card (no keys, no signed photo links)
  cost_usd numeric NOT NULL DEFAULT 0,        -- what the lookup charged (Apify), 0 for the free APIs
  run_id text NOT NULL DEFAULT '',            -- an Apify run still going (picked up on the next paste)
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'running', 'failed')),
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS digest_runs (
  id text PRIMARY KEY,                        -- <week>|team or <week>|user:<id>
  week date NOT NULL,                         -- the Monday (New York) it's for
  kind text NOT NULL CHECK (kind IN ('team', 'personal')),
  user_id text,
  status text NOT NULL CHECK (status IN ('sent', 'off', 'failed', 'skipped')),
  channel text NOT NULL DEFAULT '',           -- the ClickUp channel or direct message it went to
  error text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS clickup_user_id text NOT NULL DEFAULT '';
