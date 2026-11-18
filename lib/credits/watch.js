// The artists whose new releases are checked for credits (2026-11-18): the people our clients already work with. No free source lists "songs by producer X", so
// the way to a placement is to read the new releases of a watchlist and look at each one's credits. The watchlist is Spotify artist ids:
//   - every performing artist on the Spotify tracks of the site's placements (the artists our producers have already worked with),
//   - the roster's artists (clients.spotify), and
//   - the A&R Watchlist's artists that have a Spotify artist id (ar_tracked).
// A roster or A&R artist's id is on its row (and in data_links); a placement's artists aren't anywhere on the site, so Spotify is asked for each track once (the
// batch lookup /tracks?ids=, 50 a call, when Spotify allows it; development mode refuses it, so one track at a time then) and the answer is kept in app_state
// "creditsWatch" ({ tracks: { [Spotify track id]: "artistId,artistId" } }, only the site's songs: it can't outgrow the placements). Each artist has a weight (a
// producer's placements with them count most) that decides who is checked first when the time runs out. Reads only; the one write is the cache, and the caller makes it.
import { sql as dbSql, rowsOrNoneIfNoTable } from "../db";
import { spotifyId } from "../data/sources";
import { spotifyTrack } from "../duplicates";
import { artistsOf } from "../splits";
import { personKey } from "../names";

export const MAX_WATCH = 1500;
export const RESOLVE_BATCH = 50;
export const RESOLVE_BATCH_PER_RUN = 300;   // 6 calls
export const RESOLVE_SINGLE_PER_RUN = 40;   // development mode: one call a track
export const WEIGHTS = { roster: 2, ar: 0.5, producerPlacement: 1, otherPlacement: 0.1 };
const ID = /^[A-Za-z0-9]{22}$/;

// the roster (clients on it), the A&R Watchlist's artists, every song's link, and the data_links of the tracked artists
export async function loadSources(sql = dbSql) {
  const [clients, tracked, placements, links] = await Promise.all([
    sql`SELECT id, name, role, spotify, on_roster FROM clients WHERE on_roster`,
    rowsOrNoneIfNoTable(sql`SELECT id, spotify FROM ar_tracked WHERE removed_at IS NULL AND kind = 'artist' AND spotify <> ''`),
    sql`SELECT id, client_id, song, artist, link FROM placements`,
    rowsOrNoneIfNoTable(sql`SELECT entity_id, ref FROM data_links WHERE platform = 'spotify' AND (entity_id LIKE 'a:%' OR entity_id LIKE 'w:%')`),
  ]);
  return { clients, tracked, placements, links };
}

const isProducer = (role) => /prod/i.test(role || "");

// -> { artists: Map(artist id -> { id, weight, why: ["roster" | "A&R" | "placement"] }), unresolved: [Spotify track id] (a placement's tracks the cache doesn't have,
// a producer's first), tracks: the cache cut to the tracks the site has today }. cache: { [track id]: "artistId,artistId" } ("" = Spotify has no artists for it)
export function buildWatchlist({ clients = [], tracked = [], placements = [], links = [], cache = {} } = {}) {
  const artists = new Map();
  const add = (id, weight, why) => {
    if (!ID.test(id || "")) return;
    const a = artists.get(id) || { id, weight: 0, why: [] };
    a.weight += weight;
    if (!a.why.includes(why)) a.why.push(why);
    artists.set(id, a);
  };
  const roster = new Map(clients.filter((c) => c.on_roster).map((c) => [c.id, c]));
  for (const c of roster.values()) add(spotifyId(c.spotify, "artist"), WEIGHTS.roster, "roster");
  const seen = new Set([...artists.keys()]);
  for (const t of tracked) { const id = spotifyId(t.spotify, "artist"); if (id) { seen.add(id); add(id, WEIGHTS.ar, "A&R"); } }
  // the tracked artists' data_links, where the engine has them: an id the rows above don't carry
  for (const l of links) if (ID.test(l.ref || "") && !seen.has(l.ref)) add(l.ref, String(l.entity_id).startsWith("a:") ? WEIGHTS.roster : WEIGHTS.ar, String(l.entity_id).startsWith("a:") ? "roster" : "A&R");
  const kept = {}, first = [], rest = [], done = new Set();
  for (const p of placements) {
    const sid = spotifyTrack(p.link);
    if (!sid || done.has(sid)) continue;
    const owner = roster.get(p.client_id), producer = !!owner && isProducer(owner.role);
    const have = cache[sid];
    if (have === undefined) {
      // a roster client's own song with only the client on its artist line: the artist is the roster's, known already
      const solo = owner && artistsOf(p.artist).every((n) => personKey(n) === personKey(owner.name));
      if (!solo) (producer ? first : rest).push(sid);
      done.add(sid);
      continue;
    }
    done.add(sid);
    kept[sid] = have;
    for (const id of String(have).split(",").filter(Boolean)) add(id, producer ? WEIGHTS.producerPlacement : WEIGHTS.otherPlacement, "placement");
  }
  // (a producer's placement counts again for each placement, so the artists a producer works with most come first when the time runs short)
  return { artists: new Map([...artists].sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0])).slice(0, MAX_WATCH)), unresolved: [...first, ...rest], tracks: kept };
}

// Spotify's performing artists for tracks, until the deadline. batch: null (not tried), true (it works) or false (refused: one at a time). The batch lookup
// (/tracks?ids=, 50 a call, up to RESOLVE_BATCH_PER_RUN) is tried first unless it is known to be refused; a 400 or 403 on it means development mode, and the
// rest is read one track at a time (up to RESOLVE_SINGLE_PER_RUN). -> { got: { trackId: "artistId,artistId" | "" }, batch, calls, rateLimited (seconds, 0 for none), error? }
// A track Spotify no longer has is "" (not asked again); one that failed (a 5xx, a timeout) is left out, so it is asked again next time.
export async function resolveTracks(ids, ctx, { batch = null, deadline = Infinity, batchPerRun = RESOLVE_BATCH_PER_RUN, singlePerRun = RESOLVE_SINGLE_PER_RUN } = {}) {
  const out = { got: {}, batch, calls: 0, rateLimited: 0 };
  const todo = ids.filter((id) => ID.test(id));
  const artistsOfTrack = (t) => (t && Array.isArray(t.artists) ? t.artists.map((a) => a?.id).filter((x) => ID.test(x || "")).join(",") : "");
  const limited = (r) => { out.rateLimited = Math.max(1, Number(r.retryAfter) || 60); return out; };
  if (out.batch !== false) {
    let taken = 0;
    while (todo.length && taken < batchPerRun && ctx.clock() < deadline) {
      const chunk = todo.slice(0, RESOLVE_BATCH);
      const r = await ctx.spotify(`/tracks?ids=${chunk.join(",")}`);
      out.calls++;
      if (r.status === 200 && Array.isArray(r.body?.tracks)) {
        out.batch = true;
        chunk.forEach((id, i) => { out.got[id] = artistsOfTrack(r.body.tracks[i]); });
        todo.splice(0, chunk.length);
        taken += chunk.length;
        continue;
      }
      if (r.status === 429) return limited(r);
      if (r.status === 400 || r.status === 401 || r.status === 403) { out.batch = false; break; }
      out.error = `Spotify answered ${r.status}`;
      return out;
    }
  }
  if (out.batch === false) {
    let n = 0;
    for (const id of todo) {
      if (n >= singlePerRun || ctx.clock() >= deadline) break;
      const r = await ctx.spotify(`/tracks/${id}`);
      out.calls++; n++;
      if (r.status === 200 && r.body) { out.got[id] = artistsOfTrack(r.body); continue; }
      if (r.status === 404) { out.got[id] = ""; continue; }
      if (r.status === 429) return limited(r);
      out.error = `Spotify answered ${r.status}`; // this one waits for the next run
    }
  }
  return out;
}
