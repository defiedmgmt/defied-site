-- r11 fix: an old-list (Luminate) Watchlist artist whose Spotify match a person confirmed is tracked on its own
-- Luminate entity, l:<Luminate id> (lum_history.entity_id, where its readings already are), when the confirmed
-- Spotify artist is the one that entity was read for (lum_history.spotify_id). Confirms made before
-- this fix left that entity off (active = false, no "watchlist" origin), so the daily pull skipped it and the
-- Watchlist showed no numbers. This switches those entities on and gives each its Spotify link when missing.
-- Additive and idempotent: it only ever turns an entity on and adds a link (ON CONFLICT DO NOTHING); a second run
-- changes nothing. An artist that is taken off the list later is paused by the engine as before.
UPDATE data_entities e
   SET active = true,
       origins = CASE WHEN e.origins @> '["watchlist"]'::jsonb THEN e.origins ELSE e.origins || '["watchlist"]'::jsonb END,
       updated_at = now()
  FROM ar_tracked t
  JOIN lum_history h ON h.lum_id = t.luminate_id AND h.kind = 'artist'
 WHERE e.id = h.entity_id AND e.id LIKE 'l:%' AND e.kind = 'artist'
   AND t.kind = 'artist' AND t.match = 'confirmed' AND t.removed_at IS NULL
   AND h.spotify_id <> '' AND substring(t.spotify from 'artist/([A-Za-z0-9]{22})') = h.spotify_id
   AND NOT (e.active AND e.origins @> '["watchlist"]'::jsonb);
INSERT INTO data_links (entity_id, platform, ref, url)
SELECT h.entity_id, 'spotify', substring(t.spotify from 'artist/([A-Za-z0-9]{22})'),
       'https://open.spotify.com/artist/' || substring(t.spotify from 'artist/([A-Za-z0-9]{22})')
  FROM ar_tracked t
  JOIN lum_history h ON h.lum_id = t.luminate_id AND h.kind = 'artist'
  JOIN data_entities e ON e.id = h.entity_id
 WHERE h.entity_id LIKE 'l:%' AND t.kind = 'artist' AND t.match = 'confirmed' AND t.removed_at IS NULL
   AND h.spotify_id <> '' AND substring(t.spotify from 'artist/([A-Za-z0-9]{22})') = h.spotify_id
ON CONFLICT (entity_id, platform) DO NOTHING;
