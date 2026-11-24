// The nightly ISRC finder (pages/api/cron/daily.js runs it; pages/api/songs.js' "Find ISRCs" saves a hit the same way), moved out of the cron so what it
// saves is one piece of code. It did one thing until 2026-11-23: a song with no ISRC and not marked "Not on streaming", not looked at for 14 days, was
// looked up (lib/isrc.js) and a sure hit's ISRC saved. The owner: "why dont we have all the isrc and spotify links filled for scheule A. we shld try
// and pull everything." Now, in this order, each with its own count in the report (report.isrc):
//   1. the same lookup, and a sure hit that is on Spotify also gives its link (placements.link) to the songs of that group that have none
//   2. a song that has its ISRC and no link (not marked, not looked at for 14 days) is found on Spotify by the ISRC (search isrc:…): the same recording, so
//      the link is sure
//   3. a song marked "Not on streaming" (song_tracking.skip) is looked at again, at most once every 7 days (song_tracking.isrc_checked_at is the day it was
//      last looked at): when a search or its ISRC finds a sure track that Spotify has on offer, the mark is taken off and its ISRC and link are saved.
//      Nothing else changes: no candidates are offered for a marked song, and the mark itself is a person's, never set from here
// What a "sure" link is: the track has the same ISRC as the one the site already holds for the song, or (no ISRC held yet) its title is the song's (version tags AND
// decoration: "Song (Jersey Club)" is not Spotify's "Song", "Song - Jersey Club" is "Song (Jersey Club)"; a "(feat. X)" credit doesn't count) and at least one artist
// it names is one the song's artist line names: lib/isrc.js fit's "exact" and the same tags (titleTags), with the artist line required. And a link, or the mark
// coming off, also needs the track on offer on Spotify (lib/isrc.js spotifyAvailable): Spotify answers 200 for a track that was taken down, often with no markets,
// so a song's own Spotify link answering is never grounds for taking the mark off (the lookup for a marked song is not given it).
// Time (2026-11-23): steps 2 and 3 end by t0 + laterMs (30 s into the cron), whatever the loop has left, and each Spotify call in them has callMs (5 s) at most, so a
// slow Spotify can't take the time the cron's last step, the Schedule A sync, needs (about 3 s of the 60). Step 1 keeps the loop budget it always had.
// A change it saves is marked for the Schedule A sheet (lib/schedule-a.js markScheduleADirty; the nightly run's last step writes it), also when a later
// step or the database fails after something was saved. Server-only.
import { sql as dbSql } from "./db";
import { lookupIsrc, spotifyTracksByIsrc, titleParts, titleTags, fit, artistNames, cleanIsrc } from "./isrc";
import { markScheduleADirty } from "./schedule-a";

const trackUrl = (id) => `https://open.spotify.com/track/${id}`;
const plainTitle = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Whether a Spotify track is surely this song (the same recording, not whether Spotify has it on offer: that is track.available, asked where a link is written).
// track: { spotifyId, title, artist, isrc } (lib/isrc.js lookupIsrc's hit, spotifyTracksByIsrc's rows); siteIsrc: the ISRC the site held for the song BEFORE this
// lookup ("" when it held none: then the title, its tags and the artist line decide)
export function sureTrack({ song, artist, siteIsrc = "", track }) {
  if (!track?.spotifyId) return false;
  const mine = cleanIsrc(siteIsrc), theirs = cleanIsrc(track.isrc);
  if (mine) return !!theirs && mine === theirs; // (the ISRC the site holds is the recording: the title doesn't matter)
  const names = artistNames(artist), on = artistNames(track.artist);
  return names.length > 0 && on.some((n) => names.includes(n))
    && fit({ t: titleParts(song), names }, { title: track.title, names: on }) === "exact"
    && titleTags(song) === titleTags(track.title); // (fit leaves decoration out: Jersey Club, Drill, Clean are other recordings to a person)
}

// The link a sure hit gives a song that has none, or "". A hit read from the song's own Spotify link is that link (own: false when it must not count: the weekly
// look at a marked song); a hit found on Spotify by title and artist is a link when sureTrack says so; a hit from another service (Deezer, MusicBrainz) has an ISRC
// but no Spotify track, so when its title carries the song's tags Spotify is asked for it (one call; the same recording, by its ISRC). Whatever the route, the
// Spotify track has to be on offer. o: the finder's later steps' { deadline, timeout } for that call. Never throws: a Spotify that doesn't answer is no link tonight.
export async function hitLink({ hit, song, artist, byIsrc = spotifyTracksByIsrc, own = true, o = {} }) {
  if (!hit) return "";
  if (hit.spotifyId) {
    if (!hit.available) return "";
    if (hit.source === "spotify-link") return own ? trackUrl(hit.spotifyId) : "";
    return hit.source === "spotify" && sureTrack({ song, artist, track: hit }) ? trackUrl(hit.spotifyId) : "";
  }
  const isrc = cleanIsrc(hit.isrc);
  if (!isrc || titleTags(song) !== titleTags(hit.title)) return "";
  try {
    const t = ((await byIsrc(isrc, o)) || []).find((x) => x.available && sureTrack({ song, artist, siteIsrc: isrc, track: x }));
    return t ? trackUrl(t.spotifyId) : "";
  } catch { return ""; }
}

// The statements one saved hit is: the ISRC for each song of the group (one it already holds stays) with where it came from and the day it was looked at,
// and the link for the group's songs that have none (only while theirs is still empty). free: the "Not on streaming" mark comes off too.
// Used by the nightly run and by "Find ISRCs"
export const saveHit = (sql, ids, hit, at, { link = "", linkIds = [], free = false } = {}) => [
  ...ids.map((id) => (free ? sql`
    INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at, skip) VALUES (${id}, ${hit?.isrc || ""}, ${hit?.source || ""}, ${at}, false)
    ON CONFLICT (placement_id) DO UPDATE SET isrc = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc ELSE song_tracking.isrc END,
      isrc_source = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc_source ELSE song_tracking.isrc_source END,
      isrc_checked_at = EXCLUDED.isrc_checked_at, skip = false, updated_at = now()
  ` : sql`
    INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at) VALUES (${id}, ${hit?.isrc || ""}, ${hit?.source || ""}, ${at})
    ON CONFLICT (placement_id) DO UPDATE SET isrc = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc ELSE song_tracking.isrc END,
      isrc_source = CASE WHEN song_tracking.isrc = '' THEN EXCLUDED.isrc_source ELSE song_tracking.isrc_source END,
      isrc_checked_at = EXCLUDED.isrc_checked_at, updated_at = now()
  `)),
  ...(link && linkIds.length ? [sql`UPDATE placements SET link = ${link} WHERE id = ANY(${linkIds}) AND COALESCE(link, '') = ''`] : []),
];

const groupBy = (rows, keyOf) => { const m = new Map(); for (const r of rows) { const k = keyOf(r); m.set(k, [...(m.get(k) || []), r]); } return m; };

// One night's finder. report: the cron's report (report.isrc is set once the first read has worked, as before); lookup, byIsrc: lib/isrc.js lookupIsrc and
// spotifyTracksByIsrc (the cron passes its own; tests pass fakes); normalizeTitle: lib/sheets.js; t0: when the cron began. The loop stops 25 s after it
// began and the whole run by 45 s (the cron has 60): what doesn't fit waits for tomorrow, and a service that is down ends it at once. Steps 2 and 3 also end
// by t0 + laterMs (30 s), nothing in them is started after that, and each Spotify call in them is cut at callMs (5 s) or that time, whichever is first (lib/isrc.js
// o.deadline, o.timeout). Throws only when the database does (the cron says so in report.isrcError); what was saved before it did is marked for Schedule A all the same
export async function findNightly({ report, lookup = lookupIsrc, byIsrc = spotifyTracksByIsrc, normalizeTitle = plainTitle, t0 = Date.now(), sql = dbSql, markDirty = markScheduleADirty,
  loopMs = 25000, runMs = 45000, laterMs = 30000, callMs = 5000, groupMax = 60, linkMax = 40, recheckMax = 20 }) {
  const key = (r) => `${normalizeTitle(r.song)}|${normalizeTitle(r.artist)}`;
  const rows = await sql`
      SELECT p.id, p.song, p.artist, p.link FROM placements p LEFT JOIN song_tracking t ON t.placement_id = p.id
      WHERE COALESCE(t.isrc, '') = '' AND NOT COALESCE(t.skip, false)
        AND (t.isrc_checked_at IS NULL OR t.isrc_checked_at < now() - interval '14 days')
      LIMIT 240
    `;
  const counts = report.isrc = { looked: 0, found: 0, offered: 0, linked: 0, rechecked: 0, freed: 0 };
  const start = Date.now();
  const late = () => Date.now() - start > loopMs || Date.now() - t0 > runMs;
  const deadline = t0 + laterMs;
  const over = () => late() || Date.now() >= deadline; // steps 2 and 3: the loop's budget and the hard deadline
  const limits = () => ({ deadline, timeout: Math.max(1, Math.min(callMs, deadline - Date.now())) }); // for one Spotify call, asked for right before it
  const clearCandidates = (ids) => sql`DELETE FROM isrc_candidates WHERE item = ANY(${ids})`.catch((err) => { if (err?.code !== "42P01") throw err; });
  // own: false looks the song up without its own link (a marked song's link answering, taken down or not, is not a reason to take the mark off)
  const askLink = (g, { own = true, o = {} } = {}) => lookup({ song: g[0].song, artist: g[0].artist, link: own ? g[0].link || g.find((x) => x.link)?.link || "" : "" }, o).catch(() => ({ failed: true }));
  let changed = false, down = false;

  try {
    // 1. no ISRC yet: up to 60 songs (a song on more than one client's page is one lookup). A sure hit is saved with its source, else the finder's candidates
    // wait for one tap on the song; a hit on Spotify is also the link of the songs of the group that have none
    for (const g of [...groupBy(rows, key).values()].slice(0, groupMax)) {
      if (late()) break; // the rest tomorrow
      const r = await askLink(g);
      if (r.failed || r.retry) { down = true; break; } // the services are down (or Spotify didn't answer): tomorrow
      counts.looked++;
      if (r.hit) counts.found++; else if (r.candidates.length) counts.offered++;
      const at = new Date().toISOString(), ids = g.map((x) => x.id), linkIds = g.filter((x) => !x.link).map((x) => x.id);
      const link = r.hit && linkIds.length ? await hitLink({ hit: r.hit, song: g[0].song, artist: g[0].artist, byIsrc }) : "";
      await sql.transaction(saveHit(sql, ids, r.hit, at, { link, linkIds }));
      if (link) counts.linked += linkIds.length;
      if (r.hit) changed = true;
      if (r.hit || !r.candidates.length) await clearCandidates(ids);
      else {
        await sql.transaction(ids.map((id) => sql`INSERT INTO isrc_candidates (item, song, artist, candidates) VALUES (${id}, ${g[0].song}, ${g[0].artist}, ${JSON.stringify(r.candidates)})
            ON CONFLICT (item) DO UPDATE SET candidates = EXCLUDED.candidates, checked_at = now()`)).catch((err) => { if (err?.code !== "42P01") throw err; });
      }
    }

    // 2. an ISRC and no link (not marked): Spotify by the ISRC, one call for each ISRC (the same recording on a second client's page is the same call). The link is
    // the track that has that ISRC and is on offer on Spotify
    if (!down && !over()) {
      const have = await sql`
        SELECT p.id, t.isrc FROM placements p JOIN song_tracking t ON t.placement_id = p.id
        WHERE COALESCE(t.isrc, '') <> '' AND COALESCE(p.link, '') = '' AND NOT t.skip
          AND (t.isrc_checked_at IS NULL OR t.isrc_checked_at < now() - interval '14 days')
        LIMIT 200
      `;
      for (const [code, g] of [...groupBy(have, (r) => cleanIsrc(r.isrc))].slice(0, linkMax)) {
        if (over()) break;
        let tracks;
        try { tracks = await byIsrc(code, limits()); } catch { down = true; break; } // Spotify has trouble (or the time is up): tomorrow
        if (tracks === null) break; // Spotify isn't set up: nothing was asked, so nothing is marked as looked at
        const ids = g.map((x) => x.id), t = tracks.find((x) => x.available && sureTrack({ siteIsrc: code, track: x }));
        await sql.transaction([sql`UPDATE song_tracking SET isrc_checked_at = ${new Date().toISOString()}, updated_at = now() WHERE placement_id = ANY(${ids})`,
          ...(t ? [sql`UPDATE placements SET link = ${trackUrl(t.spotifyId)} WHERE id = ANY(${ids}) AND COALESCE(link, '') = ''`] : [])]);
        if (t) { counts.linked += ids.length; changed = true; }
      }
    }

    // 3. marked "Not on streaming": looked at again once a week. A sure track on offer on Spotify takes the mark off and saves what was found; anything less
    // leaves the mark (a person's) as it is and only notes the day it was looked at
    if (!down && !over()) {
      const marked = await sql`
        SELECT p.id, p.song, p.artist, p.link, t.isrc, t.isrc_source FROM placements p JOIN song_tracking t ON t.placement_id = p.id
        WHERE t.skip AND (COALESCE(t.isrc, '') = '' OR COALESCE(p.link, '') = '')
          AND (t.isrc_checked_at IS NULL OR t.isrc_checked_at < now() - interval '7 days')
        LIMIT 60
      `;
      for (const g of [...groupBy(marked, key).values()].slice(0, recheckMax)) {
        if (over()) break;
        const ids = g.map((x) => x.id), linkIds = g.filter((x) => !x.link).map((x) => x.id), held = cleanIsrc(g.find((x) => x.isrc)?.isrc);
        let hit = null, url = "";
        const kept = { isrc: held, source: g.find((x) => x.isrc)?.isrc_source || "spotify" }; // what the group already holds, for the songs of it that don't
        try {
          if (held) {
            // the ISRC is known: Spotify either has that recording on offer or doesn't
            const tracks = await byIsrc(held, limits());
            if (tracks === null) break; // Spotify isn't set up
            const t = tracks.find((x) => x.available && sureTrack({ siteIsrc: held, track: x }));
            url = t ? trackUrl(t.spotifyId) : "";
          } else {
            // a search, never the song's own link (it answers for a track that was taken down): a sure match on Spotify that is on offer, or its ISRC asked of Spotify
            const r = await askLink(g, { own: false, o: limits() });
            if (r.failed || r.retry) { down = true; break; }
            hit = r.hit;
            url = hit ? await hitLink({ hit, song: g[0].song, artist: g[0].artist, byIsrc, own: false, o: limits() }) : "";
          }
        } catch { down = true; break; }
        counts.rechecked++;
        const at = new Date().toISOString();
        if (url) {
          // on Spotify: the mark comes off, the ISRC (a hit's, when the song had none) and the link are saved
          await sql.transaction(saveHit(sql, ids, hit || kept, at, { link: url, linkIds, free: true }));
          await clearCandidates(ids);
          counts.freed++; counts.linked += linkIds.length; changed = true;
        } else if (hit) {
          // a sure ISRC from another service (or a match that isn't sure enough for a link) is saved all the same; the mark stays until Spotify has the song
          await sql.transaction(saveHit(sql, ids, hit, at));
          changed = true;
        } else await sql`UPDATE song_tracking SET isrc_checked_at = ${at}, updated_at = now() WHERE placement_id = ANY(${ids})`;
      }
    }
  } finally {
    // what was saved is saved even when a later step or the database failed: the Schedule A sheet is marked all the same (markDirty never throws; a stand-in that does must not hide the error)
    if (changed) await Promise.resolve(markDirty()).catch((err) => console.error("isrc finder: the Schedule A sheet wasn't marked:", err?.message || err));
  }
  return counts;
}
