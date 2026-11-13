// Each song's growth and Home's "This week", from the automated numbers (Spotify streams, global; list B
// #3 replaced Luminate's weekly exports with them). Pure parts first; the loaders read data_snapshots.
//   songGrowthOf()  per song (placement): the newest count, this week vs last week, a small series
//   rosterTopOf()   Home's This week: one line per song (its copies on co-writers' pages are one song) and
//                   each client's songs added up, ranked by week-on-week % (lib/weekly.js rankTop)
//   lumTopOf()      the same from Luminate's newest real week (lib/data/lum.js lumWeek) until the Spotify numbers
//                   have a week on week (r10, H9; 2026-11-13: a % needs readings 14 days back, not 8 days of
//                   readings): labelled "Luminate · Oct 23–29 vs Oct 16–22", and per row when the rows' weeks differ
import { rowsOrNoneIfNoTable } from "../db";
import { dataSql as sql } from "./engine";
import { toSeries, stats, addDays } from "./math";
import { spotifyId } from "./sources";
import { sameWeek, sumWeeks, spanOf, rankTop } from "../weekly";
import { lumWeek, weekLabel } from "./lum";


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
      // the days this week really covers (2026-11-13: always "the last 7 days", when Nov 6's gap made it 8)
      weekOf: st.thisWeek == null ? null : { from: st.from, to: st.day }, label: "Spotify streams, global",
    };
  }
  return out;
}

// Pure. growth: songGrowthOf's answer; placements [{ id, client_id, song, artist }]; clients [{ id, name }]
// artistOwn: { [clientId]: week } an artist's own number for the week (Luminate's artist row), used instead of
// their songs added up
export function rosterTopOf({ placements, clients, growth, artistOwn = {} }) {
  const seen = new Map();
  for (const p of placements) {
    const g = growth[p.id];
    if (!g || g.thisWeek == null) continue;
    const key = `${title(p.song)}|${title(p.artist)}`;
    const w = { thisWeek: g.thisWeek, lastWeek: g.lastWeek, wowPct: g.wowPct, weekOf: g.weekOf, ...(g.src ? { src: g.src } : {}) };
    const cur = seen.get(key);
    if (!cur) { seen.set(key, { key, placementId: p.id, song: p.song, artist: p.artist, clientIds: [p.client_id], ...w }); continue; }
    if (!cur.clientIds.includes(p.client_id)) cur.clientIds.push(p.client_id);
    if (w.thisWeek > cur.thisWeek) Object.assign(cur, w, { placementId: p.id });
  }
  const songs = [...seen.values()];
  const artists = clients.map((c) => {
    const own = artistOwn[c.id];
    const theirs = sameWeek(songs.filter((x) => x.clientIds.includes(c.id) && (own || x.lastWeek != null))).sort((a, b) => b.thisWeek - a.thisWeek);
    if (own) return { clientId: c.id, name: c.name, songCount: theirs.length, topSong: theirs[0]?.song || null, ...own };
    const w = sumWeeks(theirs);
    return w && { clientId: c.id, name: c.name, songCount: theirs.length, topSong: theirs[0].song, ...w, ...(theirs[0].src ? { src: theirs[0].src } : {}) };
  }).filter(Boolean);
  const topSongs = rankTop(songs), topArtists = rankTop(artists);
  // allArtists: every client's week, falls included, for Clients › Overview's This week column (2026-11-13: it read
  // the top 5 risers, so 8 writers with a Luminate week showed "—")
  return { songs: topSongs, artists: topArtists, allArtists: artists, songsWeekOf: spanOf(topSongs), artistsWeekOf: spanOf(topArtists), label: "Spotify streams, global", source: "spotify" };
}

// "Oct 23–29 vs Oct 16–22" (just "Oct 23–29" when the week before is missing); "(US)" for a US-only week
const lumWeekText = (w) => {
  if (!w?.weekOf?.from) return null;
  const { from, to } = w.weekOf;
  return `${weekLabel(from, to)}${w.lastWeek != null ? ` vs ${weekLabel(addDays(from, -7), addDays(from, -1))}` : ""}${/US only/.test(w.src || "") ? " (US)" : ""}`;
};
// one label for a list whose rows are all the same week, else each row carries its own (weekText)
function labelRows(rows) {
  const texts = [...new Set(rows.map(lumWeekText).filter(Boolean))];
  if (texts.length <= 1) return { rows, label: texts.length ? `Luminate · ${texts[0]}` : null };
  return { rows: rows.map((r) => ({ ...r, weekText: lumWeekText(r) })), label: "Luminate · each row's newest week" };
}
// Pure. lw: lumWeek's answer { [entity key]: { v, last, pct, from, to, src } }; songs are t:<Spotify id>, artists a:<client id>
export function lumTopOf({ placements, clients, lw }) {
  const wk = (w) => ({ thisWeek: w.v, lastWeek: w.last, wowPct: w.pct, weekOf: { from: w.from, to: w.to }, src: w.src });
  const growth = {};
  for (const p of placements) {
    const id = spotifyId(p.link, "track"), w = id && lw[`t:${id}`];
    if (w && w.v != null) growth[p.id] = wk(w);
  }
  const artistOwn = {};
  for (const c of clients) { const w = lw[`a:${c.id}`]; if (w && w.v != null) artistOwn[c.id] = wk(w); }
  const top = rosterTopOf({ placements, clients, growth, artistOwn });
  const songs = labelRows(top.songs), artists = labelRows(top.artists), all = labelRows(top.allArtists);
  return { ...top, songs: songs.rows, artists: artists.rows, allArtists: all.rows, songsLabel: songs.label, artistsLabel: artists.label, allArtistsLabel: all.label, label: "Luminate, all platforms", source: "luminate" };
}

// Pure. The Spotify answer can rank once a song has a week on week: a running total needs a count 7 and 14 days back
// (2026-11-13: 8 days of counts gave a "this week" with no % and no artists, owner "this meter is broken")
export const spotifyRanks = (top) => top.songs.some((s) => s.lastWeek != null);

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
  const snaps = await streamSnaps(trackIds(placements));
  const spotify = rosterTopOf({ placements, clients, growth: songGrowthOf(placements, snaps) });
  // no week on week yet, so Luminate's newest real week stands in
  if (spotifyRanks(spotify)) return spotify;
  const keys = [...trackIds(placements), ...clients.map((c) => `a:${c.id}`)];
  const lw = await lumWeek(keys).catch((err) => { console.error("rosterTop: Luminate weeks", err); return {}; });
  const lum = lumTopOf({ placements, clients, lw });
  return lum.songs.length || lum.artists.length ? lum : spotify;
}
