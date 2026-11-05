-- r11 (A&R UI, A2): a Watchlist artist's type for its colour chip. NULL = nobody has said yet (the row shows
-- "Artist": it is a Spotify artist profile), 'artist' or 'producer' once someone taps the drawer's switch or picks it
-- in the paste box. A roster row takes clients.role instead. Additive and idempotent: one nullable column, no
-- default, no backfill (the old A&R rows carry no producer flag: checked on the real preview data, 2026-11-05).
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS role text;
