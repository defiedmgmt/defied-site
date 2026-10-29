-- Luminate batch-1 fixes. Adds one table only: nothing that already exists is
-- changed, so running it again is harmless. No foreign keys, like the rest.

-- A&R portfolio exports (prospects' artists and songs) dropped on the
-- Luminate page before the A&R tab can use them. Kept here, apart from
-- luminate_exports, so they never reach STREAM DATA, the clients' numbers,
-- linking or the "add to Luminate" list. The A&R tab takes them over.
CREATE TABLE IF NOT EXISTS luminate_ar_held (
  id text PRIMARY KEY,
  portfolio_id text NOT NULL,                 -- Luminate's POR… id
  holds text NOT NULL CHECK (holds IN ('artists', 'songs')),
  file_name text NOT NULL DEFAULT '',
  exported_at timestamptz NOT NULL,           -- from the file name (a renamed file is refused)
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text NOT NULL DEFAULT '',
  entity_count integer NOT NULL DEFAULT 0,    -- everything: what counts toward its slots
  artist_count integer NOT NULL DEFAULT 0,
  song_count integer NOT NULL DEFAULT 0,
  weekly boolean NOT NULL DEFAULT false,      -- had "Last Period" rows (Luminate's weekly numbers)
  entities jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS luminate_ar_held_portfolio_idx ON luminate_ar_held(portfolio_id, exported_at DESC);
