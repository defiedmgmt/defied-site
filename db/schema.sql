-- Real backend schema for defied-site — see .claude/plans/wobbly-weaving-sunrise.md
-- for why this exists. IDs stay as text (not serial/uuid) to preserve the
-- existing site-generated ids (uid()) through migration without remapping
-- every foreign key across the whole export.

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT '',
  credit text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  photo text NOT NULL DEFAULT '',
  spotify text NOT NULL DEFAULT '',
  apple text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  tiktok text NOT NULL DEFAULT '',
  youtube text NOT NULL DEFAULT '',
  soundcloud text NOT NULL DEFAULT '',
  sheet_tab_name text NOT NULL DEFAULT '',
  total_streams bigint NOT NULL DEFAULT 0,
  on_roster boolean NOT NULL DEFAULT false,
  roster_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('staff', 'client')),
  name text NOT NULL DEFAULT '',
  client_id text REFERENCES clients(id) ON DELETE SET NULL
);

-- splits stay a JSONB array of {id,name,role,percent} rather than a join
-- table — matches the shape the frontend already reads/writes everywhere,
-- keeps the rewrite scoped. Revisit if per-collaborator queries are needed.
CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  song text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  release_date text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  notable boolean NOT NULL DEFAULT false,
  luminate_id text NOT NULL DEFAULT '',
  streams bigint NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  admin_fee numeric NOT NULL DEFAULT 0,
  splits jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS placements_client_id_idx ON placements(client_id);

-- the public "meet the team" roster — distinct from `users` login accounts
CREATE TABLE IF NOT EXISTS staff_bios (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  credit text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  photo text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  instagram text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS notable_releases (
  id text PRIMARY KEY,
  song text NOT NULL DEFAULT '',
  artist text NOT NULL DEFAULT '',
  client text NOT NULL DEFAULT '',
  cover text NOT NULL DEFAULT '',
  release_date text NOT NULL DEFAULT '',
  link text NOT NULL DEFAULT ''
);

-- singleton row (id always 1) for site-wide settings
CREATE TABLE IF NOT EXISTS site_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  about_text text NOT NULL DEFAULT '',
  last_synced_at timestamptz
);
INSERT INTO site_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- backs server-enforced login lockout — see /api/auth/login
CREATE TABLE IF NOT EXISTS login_attempts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL DEFAULT '',
  success boolean NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_time_idx ON login_attempts(email, attempted_at);
CREATE INDEX IF NOT EXISTS login_attempts_ip_time_idx ON login_attempts(ip, attempted_at);

-- backs contact-form rate limiting — see /api/submit-contact. Logs every
-- POST (including honeypot-tripped ones), not just accepted submissions,
-- so a scripted bot that fills the form out "correctly" still gets capped.
CREATE TABLE IF NOT EXISTS contact_attempts (
  id bigserial PRIMARY KEY,
  ip text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contact_attempts_ip_time_idx ON contact_attempts(ip, attempted_at);

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
