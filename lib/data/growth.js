// Each song's growth and Home's "This week", from the automated numbers (Spotify streams, global; list B
// #3 replaced Luminate's weekly exports with them). Pure parts first; the loaders read data_snapshots.
//   songGrowthOf()  per song (placement): the newest count, this week vs last week, a small series
//   rosterTopOf()   Home's This week: one line per song (its copies on co-writers' pages are one song) and
//                   each client's songs added up, ranked by week-on-week % (lib/weekly.js rankTop)
import { rowsOrNoneIfNoTable } from "../db";
import { dataSql as sql } from "./engine";
import { toSeries, stats, addDays } from "./math";
import { spotifyId } from "./sources";
import { sameWeek, sumWeeks, spanOf, rankTop } from "../weekly";

const SERIES_DAYS = 60;
const title = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// placements: [{ id, link }]; snaps: [{ entity_id, value, taken_at }] (Spotify streams). Pure.
export function songGrowthOf(placements, snaps) {
  const by = new Map();
  for (const s of snaps) (by.get(s.entity_id) || by.set(s.entity_id, []).get(s.entity_id)).push(s);
  const out = {};
  for (const p of placements) {
    const id = spotifyId(p.link, "track");
    const list = id && by.get(`t:${id}`);
    if (!list?.length) continue;
    const series = toSeries(list), st = stats(series);
    out[p.id] = {
      latest: st.latest, latestOn: st.day, series: series.slice(-SERIES_DAYS), daily: st.daily,
      thisWeek: st.thisWeek, lastWeek: st.lastWeek, wowPct: st.pct == null ? null : st.pct * 100,
      weekOf: st.thisWeek == null ? null : { from: addDays(st.day, -6), to: st.day }, label: "Spotify streams, global",
    };
  }
  return out;
}

// Pure. growth: songGrowthOf's answer; placements [{ id, client_id, song, artist }]; clients [{ id, name }]
export function rosterTopOf({ placements, clients, growth }) {
  const seen = new Map();
  for (const p of placements) {
    const g = growth[p.id];
    if (!g || g.thisWeek == null) continue;
    const key = `${title(p.song)}|${title(p.artist)}`;
    const w = { thisWeek: g.thisWeek, lastWeek: g.lastWeek, wowPct: g.wowPct, weekOf: g.weekOf };
    const cur = seen.get(key);
    if (!cur) { seen.set(key, { key, placementId: p.id, song: p.song, artist: p.artist, clientIds: [p.client_id], ...w }); continue; }
    if (!cur.clientIds.includes(p.client_id)) cur.clientIds.push(p.client_id);
    if (w.thisWeek > cur.thisWeek) Object.assign(cur, w, { placementId: p.id });
  }
  const songs = [...seen.values()];
  const artists = clients.map((c) => {
    const theirs = sameWeek(songs.filter((x) => x.clientIds.includes(c.id) && x.lastWeek != null)).sort((a, b) => b.thisWeek - a.thisWeek);
    const w = sumWeeks(theirs);
    return w && { clientId: c.id, name: c.name, songCount: theirs.length, topSong: theirs[0].song, ...w };
  }).filter(Boolean);
  const topSongs = rankTop(songs), topArtists = rankTop(artists);
  return { songs: topSongs, artists: topArtists, songsWeekOf: spanOf(topSongs), artistsWeekOf: spanOf(topArtists), label: "Spotify streams, global" };
}

const streamSnaps = (ids) => (ids.length ? rowsOrNoneIfNoTable(sql`
  SELECT entity_id, value, taken_at FROM data_snapshots
  WHERE platform = 'spotify' AND metric = 'streams' AND entity_id = ANY(${ids}) AND taken_at > now() - interval '75 days' ORDER BY taken_at`) : Promise.resolve([]));
const trackIds = (rows) => [...new Set(rows.map((p) => spotifyId(p.link, "track")).filter(Boolean).map((id) => `t:${id}`))];

// clientIds: only those clients' songs (a client's own page, or an account limited to its own artists)
export async function songGrowth({ clientIds = null } = {}) {
  const rows = clientIds ? await sql`SELECT id, link FROM placements WHERE client_id = ANY(${clientIds}) AND link <> ''` : await sql`SELECT id, link FROM placements WHERE link <> ''`;
  return songGrowthOf(rows, await streamSnaps(trackIds(rows)));
}
export async function rosterTop({ clientIds = null } = {}) {
  const [placements, clients] = await Promise.all([
    clientIds ? sql`SELECT id, client_id, song, artist, link FROM placements WHERE client_id = ANY(${clientIds})` : sql`SELECT id, client_id, song, artist, link FROM placements`,
    clientIds ? sql`SELECT id, name FROM clients WHERE id = ANY(${clientIds})` : sql`SELECT id, name FROM clients`,
  ]);
  const growth = songGrowthOf(placements, await streamSnaps(trackIds(placements)));
  return rosterTopOf({ placements, clients, growth });
}
