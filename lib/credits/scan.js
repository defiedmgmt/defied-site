// Possible placements (2026-11-18, the owner: "the most accurate way that's always gonna find our guys' songs"). Spotify's API lists only performing artists, so
// a producer's placement on someone else's song is invisible there. No free source lists "songs by producer X" either, so this reads the NEW RELEASES of a
// watchlist of artists (lib/credits/watch.js) and the credits of each one (Apple Music first, lib/credits/apple.js; YouTube when Apple had nothing,
// lib/credits/youtube.js), and a credit that names one of our roster clients (lib/credits/match.js) becomes a possible placement in To do.
//
//   NOTHING IS EVER ADDED BY THIS. A match is only written to app_state "creditsFound", and To do lists it ("N possible placements"). A song goes on the site and the
//   pub sheet only when a Publishing staff member presses Add on it (lib/credits/add.js, through lib/auto-add.js addSong); Not ours dismisses it for good. This
//   module and everything it imports have no way to write a song: they don't import lib/auto-add.js, lib/sheet-push.js, lib/placement-rows.js or lib/sheets.js,
//   and tests/credits-1118.mjs checks that, and that a full run with matches makes no placement INSERT and no sheet write.
//
// One run (runCredits, the data-collect cron at 11:00 UTC; BUDGET_MS = 25 s, one at a time, resumable: everything it learned is saved, and the next run goes on):
//   1. the watchlist: ids of the artists on the site's placements' tracks, the roster and the A&R Watchlist; the ones not known yet are asked of Spotify
//   2. new releases: the artists not read for longest first (half of them a run: each at least every CYCLE_DAYS = 2 days, time permitting), their albums,
//      singles and appearances of the last WINDOW_DAYS = 14, each release's tracks once; a track not seen before is kept as
//      { firstSeen, tries, lastTry, done, source, matches, isrc ... } for KEEP_DAYS = 30
//   3. credits: the tracks not done, first-timers first, then by how much the site works with the artist, newest first; each is tried once a day for RETRY_DAYS = 14
//      after it was first seen (credits arrive late) until credits are found
// Budgets: 60 Apple pages a day at one a second (a 403, a 429 or an unexpected page leaves Apple alone for the day, with the reason), 30 YouTube searches a day.
// Switches: CREDITS_SCAN=off stops all of it, APPLE_CREDITS=off the Apple part only (default: on); no YOUTUBE_API_KEY, no YouTube.
// planCredits is the same run without a single database write: the network reads happen, and what it would suggest comes back (a probe calls it).
import { sql as dbSql, rowsOrNoneIfNoTable } from "../db";
import { claimState, dropState } from "../app-state";
import { nyDay } from "../todo-rank";
import { spotifyConfigured, youtubeConfigured } from "../data/direct";
import { spotifyId } from "../data/sources";
import { personKey } from "../names";
import { makeCtx, clean } from "./http";
import { KEYS, CAPS, readState, saveBlob, addFound, dropFound, dropNotOurs, overflow } from "./state";
import { loadSources, buildWatchlist, resolveTracks } from "./watch";
import { appleCredits, APPLE_PAGES_PER_DAY } from "./apple";
import { youtubeCredits, SEARCHES_PER_DAY, MAX_TRIES_PER_TRACK } from "./youtube";
import { buildAliases, matchCredits, suggestionKey, isMaker, stripProd, songOnSite, titleKey } from "./match";

export const BUDGET_MS = 25000;
export const WINDOW_DAYS = 14;   // releases of the last two weeks
export const RETRY_DAYS = 14;    // a track is tried again each day for this long after it was first seen
export const KEEP_DAYS = 30;     // and its state is kept this long
export const CYCLE_DAYS = 2;     // each artist's releases are read at least this often, time permitting
// ms from the start: the watchlist's lookups get up to 5 s, the release reads up to 14 s in all (8 s when tracks are already waiting for their credits: the
// backlog comes first, and the artists not read today are first in line tomorrow); the credits get the rest
const SLICE = { resolve: 5000, discover: 14000, discoverBusy: 8000 };
const BUSY = 3; // this many tracks waiting for credits is a backlog
const MIN_TRACK_MS = 4000;       // a track isn't started with less than this left (one takes up to about 3 s: a search, Deezer, a page, each after its pause)
const MAX_RELEASE_PAGES = 4;     // an artist's releases are read 10 at a time, newest first, up to 40
const MAX_ALBUM_TRACKS = 40;
const LOCK = "credits:run", LEASE_MIN = 5;
const ID = /^[A-Za-z0-9]{22}$/;

const off = (v) => /^(off|false|0|no)$/i.test(String(v ?? "").trim());
export const creditsOn = () => !off(process.env.CREDITS_SCAN);
export const appleOn = () => !off(process.env.APPLE_CREDITS);
const autoAddOn = () => !off(process.env.AUTO_ADD_SONGS); // lib/auto-add.js's own switch, read here so this never imports it

const DAY = 864e5;
const dnum = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;
const daysBetween = (a, b) => dnum(b) - dnum(a);
const daysBack = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const cleanIsrc = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// today's budgets and the memory of what was read, from what was saved (the budgets start over each New York day)
function scanOf(saved, today) {
  const s = obj(saved), fresh = s.day === today;
  const apple = fresh ? obj(s.apple) : {}, youtube = fresh ? obj(s.youtube) : {}, batch = obj(s.batch);
  return {
    day: today,
    apple: { pages: Number(apple.pages) || 0, stop: String(apple.stop || ""), errs: Number(apple.errs) || 0 },
    youtube: { searches: Number(youtube.searches) || 0, stop: String(youtube.stop || "") },
    batch: { ok: batch.ok === true ? true : batch.ok === false ? false : null, day: String(batch.day || "") },
    spotifyUntil: String(s.spotifyUntil || ""),
    artists: { ...obj(s.artists) }, albums: { ...obj(s.albums) },
  };
}

// The whole run. write: false is the dry run (planCredits): everything is read, nothing is written. trackIds: read only these Spotify tracks' credits (a probe).
// -> the report. Options besides: now, budgetMs, sql, maxApplePages, maxSearches, cycleDays (days one pass over the watchlist takes: 1 reads every artist now), youtubeKey,
// and the fakes lib/credits/http.js takes (fetch, wait, clock, spotify).
export async function scanCore({ write = false, now = new Date(), budgetMs = BUDGET_MS, sql = dbSql, trackIds = null, maxApplePages = write ? APPLE_PAGES_PER_DAY : Math.min(10, APPLE_PAGES_PER_DAY),
  maxSearches = write ? SEARCHES_PER_DAY : 3, cycleDays = CYCLE_DAYS, youtubeKey = youtubeConfigured() ? process.env.YOUTUBE_API_KEY : "", ...io } = {}) {
  const t0 = (io.clock || Date.now)(), deadline = t0 + budgetMs;
  const ctx = makeCtx({ ...io, deadline });
  const today = nyDay(now), from = daysBack(today, WINDOW_DAYS);
  const report = { at: new Date(now).toISOString(), day: today, ...(write ? {} : { dry: true }) };
  const [state, src, tracking] = await Promise.all([readState(sql), loadSources(sql), rowsOrNoneIfNoTable(sql`SELECT placement_id, isrc FROM song_tracking WHERE isrc <> ''`)]);
  const scan = scanOf(state.scan, today);
  const aliases = buildAliases({ clients: src.clients, staff: state.aliases });
  report.aliases = { clients: aliases.clients, names: aliases.size };
  if (!aliases.size) return { ...report, note: "No client on the roster has a name to match, so nothing was read." };

  // ---- 1. the watchlist
  const spotifyLimited = () => !!scan.spotifyUntil && Date.parse(scan.spotifyUntil) > ctx.clock();
  // every Spotify read of the run: a 429 holds Spotify for as long as it said (the rest of this run, and the next ones until then)
  const sp = async (path) => {
    if (spotifyLimited()) return { status: 429, body: null, retryAfter: null };
    const r = await ctx.spotify(path);
    report.spotifyCalls = (report.spotifyCalls || 0) + 1;
    if (r.status === 429) { scan.spotifyUntil = new Date(ctx.clock() + Math.max(1, Number(r.retryAfter) || 60) * 1000).toISOString(); report.rateLimited = scan.spotifyUntil; }
    return r;
  };
  let cache = obj(state.watch.tracks), wl = buildWatchlist({ ...src, cache });
  // a batch lookup that development mode refused is tried again once a week
  const batchKnown = scan.batch.ok === false && scan.batch.day && daysBetween(scan.batch.day, today) < 7 ? false : null;
  report.watch = { artists: wl.artists.size, unresolved: wl.unresolved.length };
  if (wl.unresolved.length && !spotifyLimited() && !trackIds) {
    const r = await resolveTracks(wl.unresolved, { ...ctx, spotify: sp }, { batch: batchKnown, deadline: Math.min(deadline, t0 + SLICE.resolve) });
    cache = { ...cache, ...r.got };
    if (r.batch !== null && r.batch !== batchKnown) scan.batch = { ok: r.batch, day: today };
    wl = buildWatchlist({ ...src, cache });
    Object.assign(report.watch, { resolved: Object.keys(r.got).length, calls: r.calls, batch: scan.batch.ok, artists: wl.artists.size, unresolved: wl.unresolved.length, ...(r.error ? { error: r.error } : {}) });
  }
  const watched = wl.artists;

  // ---- the tracks (state) and what a run changes in them
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const tracks = Object.fromEntries(Object.entries(state.tracks).filter(([id, t]) => ID.test(id) && t && typeof t === "object" && isDay(t.firstSeen)));
  for (const memo of [scan.albums, scan.artists]) for (const [id, d] of Object.entries(memo)) if (!isDay(d)) delete memo[id];
  const fresh = {};                       // the possible placements this run found: { key: entry }
  const pending = { ...state.found };     // what is waiting in To do already (and `fresh`, as it comes)
  const isrcBy = new Map(tracking.map((x) => [x.placement_id, cleanIsrc(x.isrc)]));
  const isrcOf = (placementId) => isrcBy.get(placementId) || "";
  const ownArtist = new Map(src.clients.map((c) => [c.id, spotifyId(c.spotify, "artist")]).filter(([, a]) => a));
  const stats = { artists: 0, releases: 0, albums: 0, tracks: 0, errors: 0 };

  // ---- 2. new releases
  async function readReleases(id) {
    const items = [];
    let sorted = true, prev = "9999-99-99";
    for (let page = 0; page < MAX_RELEASE_PAGES; page++) {
      const r = await sp(`/artists/${id}/albums?include_groups=album,single,appears_on&limit=10&offset=${page * 10}`);
      if (r.status !== 200 || !Array.isArray(r.body?.items)) return { error: r.status, items };
      let last = "";
      for (const a of r.body.items) {
        const d = String(a?.release_date || ""), day = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
        if (day && day > prev) sorted = false;
        if (day) prev = day;
        last = day;
        if (a?.id) items.push({ id: a.id, day });
      }
      if (!r.body.next || !r.body.items.length) break;
      // newest first: once a release older than the window is on the page, the rest are older still (an artist whose list isn't in order is read to the end)
      if (sorted && last && last < from) break;
    }
    return { items };
  }
  async function readTracks(albumId) {
    const items = [];
    for (let offset = 0; offset < MAX_ALBUM_TRACKS; offset += 10) {
      const r = await sp(`/albums/${albumId}/tracks?limit=10&offset=${offset}`);
      if (r.status !== 200 || !Array.isArray(r.body?.items)) return { error: r.status, items };
      items.push(...r.body.items);
      if (!r.body.next) break;
    }
    return { items };
  }
  // a track of a release, kept when one of its artists is on the watchlist and it wasn't seen before
  const keep = (x, day) => {
    const ids = (x?.artists || []).map((a) => a?.id).filter((i) => ID.test(i || ""));
    if (!ID.test(x?.id || "") || tracks[x.id] || !ids.some((i) => watched.has(i))) return;
    tracks[x.id] = { name: String(x.name || "").slice(0, 120), artist: (x.artists || []).map((a) => a?.name).filter(Boolean).join(", ").slice(0, 160), ms: Number(x.duration_ms) || 0, rel: day,
      aid: ids.slice(0, 8), w: Math.max(...ids.map((i) => watched.get(i)?.weight ?? 0)), firstSeen: today, tries: 0, lastTry: "", done: false, source: "" };
    stats.tracks++;
  };
  async function discover(until) {
    // the artists read longest ago first, the ones the site works with most first among them; half the list a run (each at least every CYCLE_DAYS days)
    const order = [...watched.values()].map((a) => ({ ...a, seen: scan.artists[a.id] || "" }))
      .sort((a, b) => (a.seen < b.seen ? -1 : a.seen > b.seen ? 1 : 0) || b.weight - a.weight || a.id.localeCompare(b.id));
    const quota = Math.max(1, Math.ceil(order.length / cycleDays));
    let readToday = order.filter((a) => a.seen === today).length; // (a second run the same day goes on from there: the quota is the day's)
    for (const a of order) {
      if (a.seen === today) continue;
      if (readToday >= quota) break;
      if (ctx.clock() > until || spotifyLimited()) { stats.cut = true; break; }
      const rel = await readReleases(a.id);
      if (rel.error) { stats.errors++; continue; }
      let whole = true;
      for (const album of rel.items.filter((x) => x.day && x.day >= from && x.day <= today && !scan.albums[x.id])) {
        stats.releases++;
        const got = await readTracks(album.id);
        if (got.error) { stats.errors++; whole = false; continue; }
        for (const x of got.items) keep(x, album.day);
        scan.albums[album.id] = today;
        stats.albums++;
      }
      if (whole) { scan.artists[a.id] = today; stats.artists++; readToday++; }
    }
  }
  // a probe names the tracks to read: each is taken as if it had just been seen
  async function seeTracks(ids) {
    for (const id of ids.filter((x) => ID.test(x) && !tracks[x])) {
      const r = await sp(`/tracks/${id}`);
      if (r.status !== 200 || !r.body) { stats.errors++; continue; }
      const t = r.body, aid = (t.artists || []).map((a) => a?.id).filter((i) => ID.test(i || ""));
      tracks[id] = { name: String(t.name || "").slice(0, 120), artist: (t.artists || []).map((a) => a?.name).filter(Boolean).join(", ").slice(0, 160), ms: Number(t.duration_ms) || 0, rel: String(t.album?.release_date || "").slice(0, 10),
        aid: aid.slice(0, 8), w: 1, firstSeen: today, tries: 0, lastTry: "", done: false, source: "", isrc: cleanIsrc(t.external_ids?.isrc) };
      stats.tracks++;
    }
  }
  const waiting = Object.values(tracks).filter((t) => !t.done && t.lastTry !== today && daysBetween(t.firstSeen, today) <= RETRY_DAYS).length;
  if (trackIds) await seeTracks(trackIds);
  else if (watched.size && !spotifyLimited()) await discover(Math.min(deadline, t0 + (waiting >= BUSY ? SLICE.discoverBusy : SLICE.discover)));

  // ---- 3. credits
  const cr = { queued: 0, tried: 0, found: 0, notfound: 0, held: 0, errors: 0 };
  const skipped = [], day = { apple: scan.apple, youtube: scan.youtube };
  // the track's ISRC from Spotify, once ("" when it has none)
  const isrcFor = async (id, t) => {
    if (t.isrc !== undefined) return t.isrc;
    const r = await sp(`/tracks/${id}`);
    if (r.status === 200 && r.body) return (t.isrc = cleanIsrc(r.body.external_ids?.isrc));
    if (r.status === 404) return (t.isrc = "");
    return ""; // not now (a limit, an error): asked again next time
  };
  // a roster artist's own release is the nightly auto-add's (lib/auto-add.js): its credits name the artist, and that isn't news
  const ownRelease = (clientId, t) => autoAddOn() && !!ownArtist.get(clientId) && (t.aid || []).includes(ownArtist.get(clientId));
  async function suggest(id, t, credits, source) {
    const matches = matchCredits(credits, aliases, source);
    if (!matches.length) return;
    const code = await isrcFor(id, t);
    t.matches = matches.slice(0, 4).map((m) => ({ clientId: m.clientId, roles: m.roles, credit: m.credit }));
    for (const m of matches) {
      const key = suggestionKey(id, m.clientId);
      const skip = (why) => { if (skipped.length < 40) skipped.push({ key, client: m.client, song: t.name, why }); };
      if (state.notOurs[key]) { skip("marked Not ours"); continue; }
      if (pending[key]) { skip("already waiting in To do"); continue; }
      if (ownRelease(m.clientId, t)) { skip("their own release: the nightly auto-add puts those on the site"); continue; }
      const why = songOnSite({ clientId: m.clientId, spotifyId: id, isrc: code, title: t.name }, src.placements, isrcOf);
      if (why) { skip(why); continue; }
      // a single and its album copy are one song: the same title for this client is already waiting
      const twin = Object.values(pending).find((p) => p?.clientId === m.clientId && titleKey(p.song) === titleKey(t.name));
      if (twin) { skip(`same title as "${twin.song}", already waiting in To do`); continue; }
      // the other credited producers, named beside the client in the assumed split (another roster client by its site name); never the client's own credits
      const mine = new Set(credits.filter((c) => matchCredits([c], aliases, source).some((x) => x.clientId === m.clientId)).map((c) => c.name));
      const others = [];
      for (const c of credits) {
        if (!c.roles.some(isMaker) || mine.has(c.name)) continue;
        const nm = (matchCredits([c], aliases, source)[0]?.client || stripProd(c.name) || c.name).trim();
        if (nm && !others.some((o) => personKey(o) === personKey(nm))) others.push(nm);
      }
      const entry = { spotifyId: id, clientId: m.clientId, client: m.client, song: t.name, artist: t.artist, releaseDate: t.rel, isrc: code, source, roles: m.roles, credit: m.credit, alias: m.alias, via: m.via, others: others.slice(0, 8), found: today };
      fresh[key] = entry; pending[key] = entry;
    }
  }
  const problem = (line) => { if ((cr.problems ||= []).length < 3 && !cr.problems.includes(line)) cr.problems.push(line); };
  // one track: Apple, then YouTube when Apple had nothing; a try is counted when a source answered about it (a stop, a budget or an error is not a try)
  async function check(id, t) {
    let tried = false, credits = null, source = "";
    if (appleOn() && !day.apple.stop && day.apple.pages < maxApplePages) {
      const a = await appleCredits(t, ctx, day, { isrc: () => isrcFor(id, t), pageCap: maxApplePages });
      if (a.appleId) t.apple = a.appleId;
      if (a.gone) delete t.apple;
      if (a.status === "mismatch") { t.bad = [...(t.bad || []), a.appleId].slice(-3); delete t.apple; }
      if (a.status === "found") { credits = a.credits; source = "apple"; }
      if (["found", "nocredits", "notfound", "mismatch"].includes(a.status)) tried = true;
      if (a.status === "error") problem(`Apple: ${a.why}`);
    }
    if (!credits && youtubeKey && (t.yt || 0) < MAX_TRIES_PER_TRACK && !day.youtube.stop && day.youtube.searches < maxSearches) {
      const y = await youtubeCredits(t, ctx, day, { key: youtubeKey, cap: maxSearches });
      if (y.status === "found") { credits = y.credits; source = "youtube"; }
      if (["found", "nocredits", "notfound"].includes(y.status)) { tried = true; t.yt = (t.yt || 0) + 1; }
      if (y.status === "error") problem(`YouTube: ${y.why}`);
    }
    if (!tried) { cr.held++; return; }
    t.tries = (t.tries || 0) + 1; t.lastTry = today; cr.tried++;
    if (!credits) { cr.notfound++; return; }
    t.done = true; t.source = source; cr.found++;
    await suggest(id, t, credits, source);
  }
  const eligible = Object.entries(tracks).filter(([id, t]) => (trackIds ? trackIds.includes(id) : true) && !t.done && (trackIds || t.lastTry !== today) && daysBetween(t.firstSeen, today) <= RETRY_DAYS)
    .sort(([ia, a], [ib, b]) => (a.tries ? 1 : 0) - (b.tries ? 1 : 0) || (a.tries ? String(a.lastTry).localeCompare(String(b.lastTry)) : 0) || (b.w || 0) - (a.w || 0) || String(b.rel).localeCompare(String(a.rel)) || ia.localeCompare(ib));
  cr.queued = eligible.length;
  for (const [id, t] of eligible) {
    if (deadline - ctx.clock() < MIN_TRACK_MS) { cr.cut = true; break; }
    try { await check(id, t); } catch (err) { cr.errors++; problem(`${t.name}: ${clean(err)}`); }
  }
  cr.apple = { pages: day.apple.pages, ...(day.apple.stop ? { stop: day.apple.stop } : {}) };
  cr.youtube = { searches: day.youtube.searches, ...(day.youtube.stop ? { stop: day.youtube.stop } : {}) };

  // ---- what is kept: a waiting suggestion whose song is on the site now (added by hand, say), or whose client left the roster, goes; each blob stays within its cap
  const gone = [];
  for (const [key, p] of Object.entries(pending)) {
    const c = p && typeof p === "object" ? src.clients.find((x) => x.id === p.clientId) : null;
    if (!c || songOnSite({ clientId: p.clientId, spotifyId: p.spotifyId, isrc: p.isrc, title: p.song }, src.placements, isrcOf)) { gone.push(key); delete pending[key]; delete fresh[key]; }
  }
  for (const key of overflow(pending, CAPS.found)) { gone.push(key); delete pending[key]; delete fresh[key]; }
  for (const [id, t] of Object.entries(tracks)) if (daysBetween(t.firstSeen, today) > KEEP_DAYS) delete tracks[id];
  for (const id of overflow(tracks, CAPS.tracks, (t) => `${t.done ? "0" : "1"}${t.firstSeen || ""}`)) delete tracks[id];
  for (const [id, d] of Object.entries(scan.albums)) if (daysBetween(d, today) > KEEP_DAYS) delete scan.albums[id];
  for (const id of overflow(scan.albums, CAPS.albums, (d) => String(d))) delete scan.albums[id];
  for (const id of Object.keys(scan.artists)) if (!watched.has(id)) delete scan.artists[id];
  // "Not ours" is kept for good; past CAPS.notOurs (5,000: years of them) the oldest are let go, key by key, so the blob stays bounded
  const notOursOver = overflow(state.notOurs, CAPS.notOurs, (v) => String(v));
  const out = { ...report, watch: { ...report.watch, artists: watched.size }, discover: stats, credits: cr,
    suggestedCount: Object.keys(fresh).length,
    suggested: Object.values(fresh).slice(0, 25).map((e) => ({ client: e.client, song: e.song, artist: e.artist, releaseDate: e.releaseDate, source: e.source, roles: e.roles, credit: e.credit, alias: e.alias, spotifyId: e.spotifyId })),
    skipped: skipped.slice(0, 20), tracks: { kept: Object.keys(tracks).length, waiting: Object.keys(pending).length }, ms: ctx.clock() - t0 };
  if (!write) return out;
  // the suggestions are a person's keys as well (Add and Not ours take them out): added and removed key by key, never replaced
  if (Object.keys(fresh).length) await addFound(fresh, sql);
  if (gone.length) await dropFound(gone, sql);
  if (notOursOver.length) await dropNotOurs(notOursOver, sql);
  scan.last = { at: out.at, suggested: out.suggestedCount, found: cr.found, tried: cr.tried, apple: cr.apple, youtube: cr.youtube, ...(out.rateLimited ? { rateLimited: out.rateLimited } : {}) };
  await saveBlob(KEYS.watch, { at: out.at, tracks: wl.tracks });
  await saveBlob(KEYS.tracks, tracks);
  await saveBlob(KEYS.scan, scan);
  return out;
}

// the cron's step: one run at a time, switches honoured. -> the report, or { off }, { skipped }, { busy }
export async function runCredits(opts = {}) {
  if (!creditsOn()) return { off: "CREDITS_SCAN=off" };
  if (!spotifyConfigured()) return { skipped: "Spotify isn't set up here (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET), so no release was read." };
  if (!(await claimState(LOCK, LEASE_MIN, { at: new Date().toISOString(), by: "credits scan" }))) return { busy: true };
  try { return await scanCore({ ...opts, write: true }); } finally { await dropState(LOCK).catch(() => {}); }
}

// The dry run: the same run as runCredits, with the network reads and NOT ONE database write (no state saved, no lock, no suggestion kept). Returns what it would
// suggest: { suggested: [{ client, song, artist, releaseDate, source, roles, credit, alias, spotifyId }], skipped, watch, discover, credits, ... }. Options: now,
// budgetMs, trackIds (read only those Spotify tracks), maxApplePages (default 10), maxSearches (default 3), cycleDays, youtubeKey
export async function planCredits(opts = {}) {
  if (!creditsOn()) return { off: "CREDITS_SCAN=off" };
  return scanCore({ ...opts, write: false });
}
