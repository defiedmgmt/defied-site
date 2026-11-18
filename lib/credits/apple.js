// A song's credits from Apple Music, the most accurate free source (the owner's research, 2026-11-17: the right producer on 8 of 10 real placements). Spotify's
// API lists only performing artists; Apple Music's public song page (music.apple.com/us/song/<id>, its JSON in <script id="serialized-server-data">) lists the
// distributor's credits with their roles. The way to the page:
//   1. Apple's free iTunes API finds the song. A small artist's song is rarely found by searching its title and name together ("Jackson 5" by Lil Twin brings back
//      Michael Jackson), so the way in is the ARTIST: iTunes Search finds the artist by name (exactly, entity=musicArtist), and iTunes Lookup lists that artist's
//      songs, newest first (the research's it3.py). The artist's Apple id is kept (creditsScan.appleArtists, 30 days; "Apple has no artist by that name" 2 days), so a known
//      artist costs one call, and one run's lookup serves every track of that artist. The routes, in order, stopping at the first that gives a pick: the artist's
//      songs, then the title and name searched together, then the title alone (and Deezer's title for the song, when it is another spelling). A song's first try goes as far
//      as 2 iTunes calls (its artist, or when Apple has no such artist the title and name together); the later daily tries go all the way: the new songs, which matter
//      most, are cheap, and the expensive routes use what time is left.
//   2. The pick is the song whose title, artist and length (within 2 seconds) are Spotify's; Deezer's record of the track's ISRC (api.deezer.com/track/isrc:<ISRC>) has to
//      agree with it, and its title is another way the song may be spelled ("Where Did You Go" is "WHERE DID U GO?" on Apple and Deezer).
//   3. The page is fetched once, and read.
// Polite and small: at most one Apple page a second and 60 a day (lib/credits/scan.js caps them), an iTunes call every 1.5 seconds, a generic browser User-Agent, and Apple is
// left alone for the rest of the day on a 403, a 429 or a page that isn't the shape it was (the reason is kept). The owner accepted Apple's site terms for the
// accuracy. Nothing is written anywhere from here. Server-only.
import { titleParts, artistNames, fit } from "../isrc";
import { personKey } from "../names";
import { clean } from "./http";
import { isCredit } from "./match";

export const APPLE_PAGES_PER_DAY = 60;
export const PAGE_GAP_MS = 1000;      // one Apple page a second
export const ITUNES_GAP_MS = 1500;    // the Search API's own guidance is about 20 calls a minute: this is 40
export const DEEZER_GAP_MS = 120;     // Deezer allows 50 calls per 5 seconds (lib/isrc.js)
export const LENGTH_SLOP_S = 2;       // two recordings are the same song when their lengths are within this many seconds
export const FIRST_TRY_FULL = false;  // true: a song's first try goes down every route too (measured in tests/credits-1118.mjs: a queue half of whose songs aren't on Apple reaches 3 pages a run, not 4)
// a generic browser's, the one the research's pages were read with
export const APPLE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

// "PT3M43S" -> 223
export const isoSeconds = (s) => {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(s || "").trim());
  return m ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : 0;
};

// ---- the page
// -> { ok: true, title, artists, releaseDate, durationSec, credits: [{ name, roles }] }, or { ok: false, why }: the page isn't the shape this reads, which is how
// a changed page or a block shows up. A song page that lists only its performers is fine (its credits haven't arrived): credits is then what is there.
export function parseApplePage(html) {
  const m = /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/.exec(String(html || ""));
  if (!m) return { ok: false, why: "no serialized-server-data on the page" };
  let data;
  try { data = JSON.parse(m[1]); } catch { return { ok: false, why: "the page's data isn't JSON" }; }
  const sections = data?.data?.[0]?.data?.sections;
  if (!Array.isArray(sections)) return { ok: false, why: "the page's data has no sections" };
  const head = sections.find((s) => s?.itemKind === "songDetailHeader" || s?.id === "songDetail")?.items?.[0];
  if (!head || typeof head.title !== "string" || !head.title.trim()) return { ok: false, why: "the page has no song header" };
  // every credit, wherever the page files it: an object with a name and its roles (the research read them the same way)
  const credits = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o.roleNames) && typeof o.name === "string" && o.name.trim()) {
      const roles = o.roleNames.filter((r) => typeof r === "string" && r.trim()).map((r) => r.trim());
      if (roles.length) credits.push({ name: o.name.trim(), roles });
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  sections.forEach(walk);
  const length = /property="music:song:duration"[^>]*content="([^"]+)"/i.exec(html)?.[1] || /"timeRequired":"(PT[^"]+)"/.exec(html)?.[1] || "";
  return { ok: true, title: head.title.trim(), artists: String(head.artists || ""), releaseDate: String(head.releaseDate || ""), durationSec: isoSeconds(length), credits };
}

// ---- finding the song
const ITUNES = "https://itunes.apple.com";
export const ARTIST_DAYS = 30;      // an Apple artist id found for a name is kept this long
export const ARTIST_MISS_DAYS = 2;  // "Apple has no artist by that name" is kept this long: a new artist reaches Apple within a day or two of a release
export const MAX_ARTIST_IDS = 2;    // two artists on Apple with one name: both are read
export const ITUNES_NEED_MS = 2500; // an iTunes call isn't started with less than this left of the run (its pause, its answer)
const PAGE_NEED_MS = 1200;          // nor a page
const DAYMS = 864e5;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const dayDiff = (a, b) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAYMS;
const isSong = (x) => !!x && !!x.trackId && (!x.kind || x.kind === "song") && (!x.wrapperType || x.wrapperType === "track");
const firstArtist = (t) => String(t.artist || "").split(",")[0].trim();
const enc = encodeURIComponent;

// What one run knows about Apple: artists: the saved memory (creditsScan.appleArtists: { [name key]: { ids: [Apple artist id], at } }), changed in place; lookups: the songs of
// each artist read this run; itunes.calls: how many iTunes calls were made (the report says)
export const newRun = (today = new Date().toISOString().slice(0, 10), artists = {}) => ({ today, artists, lookups: new Map(), itunes: { calls: 0 } });

// one iTunes call: { results } | { stop } (a 403 or 429: Apple is left alone today) | { error } | { held } (not enough of the run is left for it)
async function itunes(ctx, run, path, what) {
  if ((ctx.left?.() ?? Infinity) < ITUNES_NEED_MS) return { held: "the run is out of time" };
  run.itunes.calls++;
  const r = await ctx.get(`${ITUNES}${path}`, { host: "itunes.apple.com", gap: ITUNES_GAP_MS });
  if (r.status === 403 || r.status === 429) return { stop: `iTunes ${what} answered ${r.status}` };
  if (!r.ok) return { error: `iTunes ${what} answered ${r.status}` };
  return { results: Array.isArray(r.body?.results) ? r.body.results : [] };
}
// the songs of an iTunes answer, each once (by trackId), first seen first
export function mergeSongs(...lists) {
  const seen = new Set(), out = [];
  for (const list of lists) for (const x of list || []) if (isSong(x) && !seen.has(String(x.trackId))) { seen.add(String(x.trackId)); out.push(x); }
  return out;
}

// the track's title and first artist searched together (limit 25)
export async function searchApple(track, ctx, run = newRun()) {
  const term = `${titleParts(track.name).core} ${firstArtist(track)}`.trim();
  const r = await itunes(ctx, run, `/search?media=music&entity=song&country=us&limit=25&term=${enc(term)}`, "Search");
  return r.results ? { results: mergeSongs(r.results) } : r;
}
// a title alone (limit 50): for a song by an artist iTunes doesn't tie to its name
export async function searchTitle(core, ctx, run = newRun()) {
  const r = await itunes(ctx, run, `/search?media=music&entity=song&country=us&limit=50&term=${enc(core)}`, "Search");
  return r.results ? { results: mergeSongs(r.results) } : r;
}
// The Apple artist ids of a name: the artists iTunes Search finds with that exact name (by the app's name rule, lib/names.js personKey: never a near one), up to 2. Remembered in
// run.artists: a name found is kept 30 days, a name Apple has no artist for 2. -> { ids, cached } | { stop } | { error } | { held }
export async function appleArtist(name, ctx, run = newRun()) {
  const key = personKey(name);
  if (!key) return { ids: [], cached: false };
  const hit = run.artists[key];
  if (hit && isDay(hit.at) && Array.isArray(hit.ids) && dayDiff(hit.at, run.today) < (hit.ids.length ? ARTIST_DAYS : ARTIST_MISS_DAYS)) return { ids: hit.ids, cached: true };
  const r = await itunes(ctx, run, `/search?media=music&entity=musicArtist&country=us&limit=3&term=${enc(String(name).trim())}`, "Search");
  if (!r.results) return r;
  const ids = r.results.filter((x) => x && x.wrapperType === "artist" && x.artistId && personKey(x.artistName) === key).map((x) => String(x.artistId)).slice(0, MAX_ARTIST_IDS);
  run.artists[key] = { ids, at: run.today };
  return { ids, cached: false };
}
// The songs of those Apple artists, newest first (iTunes Lookup, up to 200 each): read once a run, whatever number of tracks the artist has in it. -> { songs } | { stop } | { error } | { held }
export async function artistSongs(ids, ctx, run = newRun()) {
  const lists = [];
  for (const id of ids) {
    let got = run.lookups.get(id);
    if (!got) {
      const r = await itunes(ctx, run, `/lookup?id=${enc(id)}&entity=song&limit=200&sort=recent&country=us`, "Lookup");
      if (!r.results) return r;
      got = mergeSongs(r.results);
      run.lookups.set(id, got);
    }
    lists.push(got);
  }
  return { songs: mergeSongs(...lists) };
}

// Deezer's record of an ISRC: { title, duration (seconds), id } | { none: true } (Deezer has no such recording) | { error }
export async function deezerByIsrc(isrc, ctx) {
  const r = await ctx.get(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`, { host: "api.deezer.com", gap: DEEZER_GAP_MS });
  if (r.status === 404) return { none: true };
  if (!r.ok) return { error: `Deezer answered ${r.status}` };
  const e = r.body?.error;
  if (e) return e.code === 800 || /DataException/i.test(e.type || "") ? { none: true } : { error: "Deezer is busy" }; // 800 is "no data"; a quota error is "try later"
  if (!r.body?.title) return { none: true };
  return { title: String(r.body.title), duration: Number(r.body.duration) || 0, id: r.body.id };
}

// does an Apple song fit what Deezer says the ISRC is: the same title (tags and "feat." aside, a version has to agree) and a length within the slop
const agrees = (dz, song) => {
  const sec = (Number(song.trackTimeMillis) || 0) / 1000;
  if (dz.duration && sec && Math.abs(dz.duration - sec) > LENGTH_SLOP_S) return false;
  const a = titleParts(dz.title), b = titleParts(song.trackName);
  return a.core === b.core && a.versions === b.versions;
};

// The song among the results, or null: { song, alias } where alias says the pick was made on Deezer's title (not Spotify's). Its title is the track's (versions, "feat." and
// tags as lib/isrc.js fit reads them: another version of the song, "Slowed" or "Instrumental", is another recording), one of its artists is the track's, and its length is within
// 2 seconds of the track's (track.ms). With no length on either side only a title that is exactly the track's will do. deezer: Deezer's record of the track's ISRC, when there is one:
// the pick has to agree with it, and its title is the same song under another spelling ("WHERE DID U GO?" for "Where Did You Go"), so an exact fit on it counts too.
// skip: Apple ids that were the wrong page before. The closest length wins, then the exact title, then the order Apple gave.
export function choose(track, results, { deezer = null, skip = [] } = {}) {
  const want = { t: titleParts(track.name), names: artistNames(track.artist) };
  const other = deezer?.title ? { t: titleParts(deezer.title), names: want.names } : null;
  const ms = Number(track.ms) || 0;
  const rows = [];
  (results || []).forEach((song, order) => {
    if (!song?.trackId || skip.includes(String(song.trackId))) return;
    const them = { title: song.trackName, names: artistNames(song.artistName) };
    let f = fit(want, them), alias = false;
    if (f !== "exact" && f !== "loose" && other && fit(other, them) === "exact") { f = "exact"; alias = true; }
    if (f !== "exact" && f !== "loose") return;
    const len = Number(song.trackTimeMillis) || 0;
    const delta = ms && len ? Math.abs(ms - len) / 1000 : null;
    if (delta != null && delta > LENGTH_SLOP_S) return;
    if (delta == null && f !== "exact") return;
    if (deezer && !agrees(deezer, song)) return;
    rows.push({ song, f, alias, delta: delta ?? 99, order });
  });
  rows.sort((a, b) => a.delta - b.delta || (a.f === "exact" ? 0 : 1) - (b.f === "exact" ? 0 : 1) || a.order - b.order);
  return rows[0] ? { song: rows[0].song, alias: rows[0].alias } : null;
}
export const pickApple = (track, results, o) => choose(track, results, o)?.song || null;

// Where the song is on Apple: its id, or why not. The routes in the order above, the first that gives a pick wins (the results of each add to a pool, each song once).
// full: every route (the song was tried before, or a probe); not full: the artist's songs, and when Apple has no such artist the title and name together.
// -> { id, confirmed, route, alt } | { status: "notfound" | "stopped" | "error" | "held", why }
async function locate(t, ctx, A, { run, isrc, full }) {
  const first = firstArtist(t);
  let pool = [], deezer; // deezer: undefined (not asked), null (no record of it), or its record
  const ask = async () => {
    if (deezer !== undefined) return deezer;
    deezer = null;
    const code = await isrc();
    if (code) { const d = await deezerByIsrc(code, ctx).catch(() => ({ error: "Deezer didn't answer" })); if (d.title) deezer = d; } // no record, or Deezer down: Spotify's own title, artist and length decide
    return deezer;
  };
  const tryPool = async (songs, route) => {
    pool = mergeSongs(pool, songs);
    if (!pool.length) return null;
    const dz = await ask(); // (the ISRC and Deezer are asked once the first songs are in: a track nothing was found for needs neither)
    const got = choose(t, pool, { deezer: dz, skip: t.bad || [] });
    return got ? { id: String(got.song.trackId), confirmed: !!dz, route, alt: got.alias ? dz.title : "" } : null;
  };
  const bad = (r) => (r.stop ? (A.stop = r.stop, { status: "stopped", why: A.stop }) : r.held ? { status: "held", why: r.held } : { status: "error", why: r.error });
  let known = null; // did Apple have an artist by that name
  if (first) {
    let a;
    try { a = await appleArtist(first, ctx, run); } catch (err) { return { status: "error", why: clean(err) }; }
    if (!a.ids) return bad(a);
    known = a.ids.length > 0;
    if (known) {
      let s;
      try { s = await artistSongs(a.ids, ctx, run); } catch (err) { return { status: "error", why: clean(err) }; }
      if (!s.songs) return bad(s);
      const hit = await tryPool(s.songs, a.cached ? "artist (known)" : "artist");
      if (hit) return hit;
    }
  }
  const routes = [];
  if (full || !known) routes.push(["search", () => searchApple(t, ctx, run)]);
  if (full) {
    routes.push(["title", () => searchTitle(titleParts(t.name).core, ctx, run)]);
    routes.push(["title (Deezer's)", async () => {
      const dz = await ask();
      const core = dz?.title ? titleParts(dz.title).core : "";
      return core && core !== titleParts(t.name).core ? searchTitle(core, ctx, run) : { results: [] };
    }]);
  }
  for (const [route, go] of routes) {
    let r;
    try { r = await go(); } catch (err) { return { status: "error", why: clean(err) }; }
    if (!r.results) return bad(r);
    const hit = await tryPool(r.results, route);
    if (hit) return hit;
  }
  return { status: "notfound", why: deezer ? "no Apple Music song agrees with Deezer's record of that ISRC" : pool.length ? "no Apple Music song with that title, artist and length" : "Apple Music has no song like it yet" };
}

// ---- one track's credits from Apple
// t: the track's state (lib/credits/scan.js: name, artist, ms, tries, apple (the page found before), alt (Deezer's title when that is how it was found), bad); day.apple: today's
// { pages, stop, errs }; isrc(): the Spotify ISRC when it can be had ("" when not); run: newRun() (what this run knows of Apple, kept by the caller across its tracks); full: every
// route, not only the first two (the default is the song's later tries: t.tries). -> { status, ... }:
//   found      { appleId, credits, confirmed, route, alt }   the page lists credits (someone besides the performers); confirmed: Deezer's record of the ISRC agreed; route: how it was found
//   nocredits  { appleId, route, alt }                       the song's page is there and lists only its performers so far (credits arrive late)
//   notfound   { why }                                       no song on Apple Music that is this one (a new release can take a day or two to get there)
//   mismatch   { appleId }                                   the page was another song's
//   stopped    { why, budget? }                              Apple is left alone: a 403, a 429, a page that isn't the shape it was, the day's pages used (budget); no try is counted
//   held       { why, appleId? }                             the run ran out of time on the way (the id found so far is kept); no try is counted
//   error      { why }                                       this one couldn't be read (a network error, a 5xx); no try is counted
export async function appleCredits(t, ctx, day, { isrc = async () => "", pageCap = APPLE_PAGES_PER_DAY, run = newRun((ctx.now?.() || new Date()).toISOString().slice(0, 10)), full = FIRST_TRY_FULL || (t.tries || 0) >= 1 } = {}) {
  const A = day.apple;
  if (A.stop) return { status: "stopped", why: A.stop };
  if (A.pages >= pageCap) return { status: "stopped", why: `today's ${pageCap} Apple pages are used`, budget: true };
  let id = t.apple || "", confirmed = false, route = id ? "page known" : "", alt = "";
  if (!id) {
    const f = await locate(t, ctx, A, { run, isrc, full });
    if (f.status) return f;
    ({ id, confirmed, route, alt } = f);
  }
  if ((ctx.left?.() ?? Infinity) < PAGE_NEED_MS) return { status: "held", why: "the run is out of time", appleId: id, alt };
  A.pages++;
  let page;
  try {
    page = await ctx.get(`https://music.apple.com/us/song/${id}`, { host: "music.apple.com", gap: PAGE_GAP_MS, as: "text", timeout: 20000,
      headers: { "User-Agent": APPLE_UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" } });
  } catch (err) {
    A.errs = (A.errs || 0) + 1;
    if (A.errs >= 3) { A.stop = `3 Apple pages in a row didn't load (${clean(err)})`; return { status: "stopped", why: A.stop }; }
    return { status: "error", why: clean(err) };
  }
  if (page.status === 403 || page.status === 429) { A.stop = `Apple Music answered ${page.status}`; return { status: "stopped", why: A.stop }; }
  if (page.status === 404) return { status: "notfound", why: "that Apple Music page doesn't exist", gone: id };
  if (!page.ok) {
    A.errs = (A.errs || 0) + 1;
    if (A.errs >= 3) { A.stop = `3 Apple pages in a row didn't load (the last answered ${page.status})`; return { status: "stopped", why: A.stop }; }
    return { status: "error", why: `Apple Music answered ${page.status}` };
  }
  A.errs = 0;
  const p = parseApplePage(page.text);
  if (!p.ok) { A.stop = `unexpected page shape: ${p.why}`; return { status: "stopped", why: A.stop }; }
  // the page is the track's: the same title (as loosely as the pick was: lib/isrc.js fit; or Deezer's title for it, when that is how it was found), and the same length when both are known
  const a = titleParts(p.title);
  const sameAs = (title) => { const b = titleParts(title); return a.versions === b.versions && (a.core === b.core || a.bare === b.bare || a.core === b.bare || a.bare === b.core); };
  const lenOk = !p.durationSec || !t.ms || Math.abs(p.durationSec - t.ms / 1000) <= LENGTH_SLOP_S;
  if (!(sameAs(t.name) || (t.alt && sameAs(t.alt)) || (alt && sameAs(alt))) || !lenOk) return { status: "mismatch", appleId: id };
  return p.credits.some((c) => isCredit(c.roles)) ? { status: "found", appleId: id, credits: p.credits, confirmed, route, alt } : { status: "nocredits", appleId: id, route, alt };
}
