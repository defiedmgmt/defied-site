-- What the pub sheet says about each song and client, kept by the sheet pull (sheets-pull and the
-- server sync) so the Dashboard can list songs that need updating and show the sheet's own net
-- streams. Two new tables only, so running it again is harmless. Nothing is written to the sheet,
-- and no foreign keys: a song or client removed later just leaves a row nobody reads.
CREATE TABLE IF NOT EXISTS sheet_song_facts (
  placement_id text NOT NULL,
  client_id text NOT NULL,
  sheet_row integer NOT NULL,                 -- the row on the client's writer tab
  sheet_share numeric,                        -- the Writer Share it holds, 0-100 (null: blank on the sheet)
  net_streams numeric NOT NULL DEFAULT 0,     -- gross × share, the row's Net Streams
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (placement_id, client_id)
);
CREATE INDEX IF NOT EXISTS sheet_song_facts_client_idx ON sheet_song_facts(client_id);
CREATE TABLE IF NOT EXISTS sheet_client_facts (
  client_id text PRIMARY KEY,
  tab text NOT NULL,                          -- the writer tab that was read
  net_streams bigint NOT NULL,                -- the tab's Net Streams total (MASTER's writer table)
  synced_at timestamptz NOT NULL DEFAULT now()
);
