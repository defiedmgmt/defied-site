-- A&R as lists (r10): who added what, the artist's other profiles, how sure each Spotify link is, and the
-- previous watchlist back on the Watchlist. Additive and idempotent: new columns with defaults, inserts with
-- fixed ids (ON CONFLICT DO NOTHING) and updates that only fill what's still empty. No foreign keys.
-- lum_history is only read (it stays read-only history).
--   ar_tracker.source      where an entry came from: paste | luminate | backfill | roster
--   ar_tracked.instagram / tiktok / youtube  the artist's other profiles, confirmed in the paste box (the
--                          engine tracks their followers too)
--   ar_tracked.match       how sure the Spotify link is: '' (pasted = sure) | isrc (ISRC equal) | name (a
--                          same-name match a person still has to confirm) | confirmed (a person tapped)
--   ar_tracked.match_candidates  the Spotify artists offered for a 'name' match: [{ id, name, image, listeners }]
ALTER TABLE ar_tracker ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS instagram text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS tiktok text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS youtube text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS match text NOT NULL DEFAULT '';
ALTER TABLE ar_tracked ADD COLUMN IF NOT EXISTS match_candidates jsonb NOT NULL DEFAULT '[]';

-- THE PREVIOUS WATCHLIST: every old Luminate Artist / Song Tracker row goes on the Watchlist, when it isn't a
-- roster client and isn't there already (by Luminate id or Spotify id). Songs keep their Spotify link (their
-- ISRC equals Luminate's, so they're tracked at once); an artist's same-name match waits for a person's tap.
-- "Added" is the first Luminate export that had it (noon UTC, so it reads as that day in New York).
INSERT INTO ar_tracked (id, kind, name, artist, spotify, isrc, photo, luminate_id, created_by, created_at, match)
SELECT 'lum-' || lower(h.lum_id),
       CASE WHEN h.kind = 'artist' THEN 'artist' ELSE 'song' END,
       h.name,
       CASE WHEN h.kind = 'artist' THEN '' ELSE COALESCE(NULLIF(h.artist, ''), NULLIF(split_part(h.spotify_name, ' · ', 2), ''), '') END,
       CASE WHEN h.kind <> 'artist' AND h.spotify_id <> '' THEN 'https://open.spotify.com/track/' || h.spotify_id ELSE '' END,
       CASE WHEN h.kind <> 'artist' THEN h.isrc ELSE '' END,
       CASE WHEN h.kind <> 'artist' AND h.spotify_id <> '' THEN h.spotify_image ELSE '' END,
       h.lum_id, 'Team (from Luminate)',
       (COALESCE(CASE WHEN jsonb_typeof(h.series->0->0) = 'string' THEN (h.series->0->>0)::date END, h.atd_on, current_date) + interval '12 hours') AT TIME ZONE 'UTC',
       CASE WHEN h.kind = 'artist' THEN (CASE WHEN h.spotify_id <> '' THEN 'name' ELSE '' END) ELSE (CASE WHEN h.spotify_id <> '' THEN 'isrc' ELSE '' END) END
FROM lum_history h
WHERE h.area = 'ar' AND h.client_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM ar_tracked t WHERE t.luminate_id = h.lum_id
                  OR (h.spotify_id <> '' AND t.spotify LIKE '%' || h.spotify_id || '%'))
ON CONFLICT (id) DO NOTHING;
-- the artist's name match is kept as the first candidate (never tracked before a tap)
UPDATE ar_tracked t SET match_candidates = jsonb_build_array(jsonb_build_object('id', h.spotify_id, 'name', h.spotify_name, 'image', h.spotify_image))
FROM lum_history h
WHERE t.id = 'lum-' || lower(h.lum_id) AND t.kind = 'artist' AND t.match = 'name' AND t.match_candidates = '[]'::jsonb AND h.spotify_id <> '';

-- each one gets one list entry. Nobody is named in the Luminate rows, so it's 'Team (from Luminate)', never a
-- made-up person, and there's no end date (nobody picked a length). A roster client (Liyakk!) goes on as a:<id>.
INSERT INTO ar_tracker (id, owner_id, owner_name, subject, kind, days, added_at, expires_at, source)
SELECT 'lum-' || lower(h.lum_id), 'team:luminate', 'Team (from Luminate)',
       CASE WHEN h.client_id IS NOT NULL THEN 'a:' || h.client_id ELSE 'w:' || t.id END,
       CASE WHEN h.kind = 'artist' THEN 'artist' ELSE 'song' END, NULL,
       (COALESCE(CASE WHEN jsonb_typeof(h.series->0->0) = 'string' THEN (h.series->0->>0)::date END, h.atd_on, current_date) + interval '12 hours') AT TIME ZONE 'UTC',
       NULL, 'luminate'
FROM lum_history h LEFT JOIN ar_tracked t ON t.luminate_id = h.lum_id AND t.removed_at IS NULL
WHERE h.area = 'ar' AND (h.client_id IS NOT NULL OR t.id IS NOT NULL)
ON CONFLICT (id) DO NOTHING;
UPDATE ar_tracker SET source = 'backfill' WHERE id LIKE 'bf-%' AND source = '';
