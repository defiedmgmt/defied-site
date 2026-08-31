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
