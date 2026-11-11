-- 2026-11-10 (the owner: "make the password stuff more intuitive"): a Founder makes a one-time link that lets one
-- person choose their own password (24 hours, once; only its SHA-256 is kept), and each login says when its password
-- was last set. Additive and idempotent: one new table, one nullable column (unknown for passwords set before this).
CREATE TABLE IF NOT EXISTS password_links (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token_hash text NOT NULL,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS password_links_hash_idx ON password_links(token_hash);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
