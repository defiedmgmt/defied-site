-- Add artist from a link (round 7, C2): the photo it found (Spotify's, or Deezer's) on the tracked
-- artist. One new column with a default, so running it again is harmless and nothing else changes.
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS photo text NOT NULL DEFAULT '';
