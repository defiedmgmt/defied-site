// List B #3: Luminate is gone from the dashboard; its portfolios are the automated numbers' starting list,
// and their old numbers stay as read-only history on each song and artist. Server only.
//   seedRowsOf()   pure: one row per entity in each portfolio's newest export (Admin Catalog 1 & 2 from
//                  luminate_exports, the Artist Tracker and Song Tracker from luminate_ar_held), matched to
//                  Spotify where we already know it (a linked song's Spotify link, a client's or an A&R
//                  artist's Spotify link), with its last Luminate numbers and every kept export's all-time
//   importSeeds()  writes them to lum_history. Safe to run again: a match or skip a person made stays.
//   matchSeeds()   the Spotify Web API (free) for the rest: a song by its ISRC (search isrc:…), an artist by
//                  name (only one exact hit, and a person confirms it: status "check")
//   decideSeed()   To do's answers: Yes (confirm), a pasted Spotify link, an artist's socials, Not on Spotify
// Matched rows are tracked like the roster by lib/data/engine.js syncEntities (origin "luminate").
// The Luminate tables (luminate_exports, luminate_ar_held, stream_snapshots) are only ever read here.
import { rowsOrNoneIfNoTable } from "../db";
import { dataSql as sql } from "./engine";
import { spotifyId, handleOf, youtubeRef } from "./sources";
import { personKey } from "../names";
import { baseTitle as tagFree, plainTitle } from "../duplicates";
import * as D from "./direct";
import { exportWeeks } from "./lum";

// what Luminate itself called the portfolios (the names staff knew them by)
export const LIST_NAMES = {
  POR2D7C3C99583C47AB97903870A7BF68B9: "Admin Catalog 1",
  PORD63A45A7E3214C9BA012EAE23C93E274: "Admin Catalog 2",
  POR069D735D69A24B35AEE8B7FF6D221BA4: "Artist Tracker",
  POR074E2117846F41B1A02150A26A5B0599: "Song Tracker",
};
const listName = (por, area, holds) => LIST_NAMES[por] || (area === "roster" ? `Portfolio …${String(por).slice(-4)}` : `${holds === "artists" ? "Artist" : "Song"} list …${String(por).slice(-4)}`);
const typeOf = (t) => (!t || /^song$/i.test(t) ? "song" : /^artist$/i.test(t) ? "artist" : /release/i.test(t) ? "release" : null);
// the New York day Luminate made an export (the dates staff read)
export const nyDay = (at) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const madeAt = (x) => new Date(x.exported_at || x.uploaded_at || 0).getTime();
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
// a title without its version tags or " - Single" (lib/duplicates.js's rule), for "the release group is that
// song's single" (TRUST WHO (SLOWED & REVERB) = TRUST WHO #jerseyclub) and for the title search
const noSingle = (s) => String(s || "").replace(/\s*-\s*(single|ep)\s*$/i, "");
export const baseTitle = (s) => tagFree(noSingle(s));
const searchTitle = (s) => plainTitle(noSingle(s)).replace(/[.]+$/, "");
const songKey = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const newestBy = (rows, key) => { const m = new Map(); for (const r of rows) if (!m.has(r[key]) || madeAt(r) > madeAt(m.get(r[key]))) m.set(r[key], r); return [...m.values()]; };
// a 1-week export's This and Last Period (an export made the old way, or one covering months, has none). This
// Period is Luminate's last FULL Fri-Thu week before the export day (Oct 29's file = Oct 16-22, Last = Oct 9-15),
// not the week ending on the export day (lib/data/lum.js exportWeeks)
const weekOf = (e, day) => (num(e.period) != null && num(e.last) != null && !e.longPeriod ? { thisWeek: num(e.period), lastWeek: num(e.last), ...exportWeeks(day) } : null);

// Pure. exports/portfolios: the clients' Luminate files and records; held: the A&R lists' files;
// snaps: stream_snapshots [{ luminate_id, d, streams }]; the rest are today's rows.
export function seedRowsOf({ exports = [], portfolios = [], held = [], snaps = [], placements = [], clients = [], tracked = [], tracking = [] }) {
  const out = new Map();
  const isrcOf = new Map(tracking.filter((t) => t.isrc).map((t) => [t.placement_id, String(t.isrc).toUpperCase()]));
  const seriesOf = new Map();
  for (const s of snaps) (seriesOf.get(s.luminate_id) || seriesOf.set(s.luminate_id, []).get(s.luminate_id)).push([String(s.d).slice(0, 10), Number(s.streams)]);
  const roster = new Set(portfolios.filter((p) => (p.kind || "roster") === "roster").map((p) => p.luminate_id));
  const rosterFiles = exports.filter((x) => roster.has(x.portfolio_id) || LIST_NAMES[x.portfolio_id]?.startsWith("Admin"));
  // ---- Admin Catalog 1 & 2: the clients' songs (and release groups)
  for (const x of newestBy(rosterFiles, "portfolio_id").sort((a, b) => madeAt(a) - madeAt(b))) {
    const day = nyDay(x.exported_at || x.uploaded_at), list = listName(x.portfolio_id, "roster");
    const ents = x.entities || [];
    for (const e of ents) {
      const kind = typeOf(e.type);
      if (!kind || kind === "artist") continue;
      const linked = placements.filter((p) => p.luminate_id && p.luminate_id === e.id);
      const sp = linked.map((p) => spotifyId(p.link, "track")).find(Boolean) || "";
      const isrc = linked.map((p) => isrcOf.get(p.id)).find(Boolean) || "";
      const row = {
        lum_id: e.id, list, area: "roster", kind, name: e.name || "", artist: linked[0]?.artist || "", placement_ids: linked.map((p) => p.id),
        client_id: null, ar_id: null, isrc, spotify_id: sp, entity_id: sp ? `t:${sp}` : null, matched_by: sp ? "link" : "", status: sp ? "matched" : "todo",
        atd: num(e.atd), atd_on: day, week: weekOf(e, day), series: seriesOf.get(e.id) || (num(e.atd) != null ? [[day, num(e.atd)]] : []),
      };
      // a release group with the same title and all-time as a song in the same file is that song's single:
      // tracking the song covers it
      const twin = kind === "release" && !sp && ents.find((s) => typeOf(s.type) === "song" && num(s.atd) === num(e.atd) && baseTitle(s.name) === baseTitle(e.name));
      if (twin) {
        const t = out.get(twin.id) || null;
        Object.assign(row, { status: "matched", matched_by: "same-song", spotify_id: t?.spotify_id || "", entity_id: t?.entity_id || null, artist: row.artist || t?.artist || "", twin: twin.id });
      }
      out.set(e.id, row); // an id in both catalogs takes the newer file's numbers
    }
  }
  // ---- the Artist Tracker and the Song Tracker (the A&R lists)
  const liveTracked = tracked.filter((t) => !t.removed_at);
  const ourClient = (name) => clients.find((c) => [c.name, c.sheet_tab_name].some((n) => n && personKey(n) === personKey(name)));
  for (const h of newestBy(held, "portfolio_id")) {
    const day = nyDay(h.exported_at), list = listName(h.portfolio_id, "ar", h.holds);
    // every kept file of this list, oldest first: its all-time history
    const files = held.filter((x) => x.portfolio_id === h.portfolio_id).sort((a, b) => madeAt(a) - madeAt(b));
    for (const e of h.entities || []) {
      const kind = typeOf(e.type);
      if (!kind) continue;
      const series = [];
      for (const f of files) { const v = num((f.entities || []).find((y) => y.id === e.id)?.atd); if (v != null) { const d = nyDay(f.exported_at); if (series.length && series[series.length - 1][0] === d) series[series.length - 1][1] = v; else series.push([d, v]); } }
      const row = { lum_id: e.id, list, area: "ar", kind, name: e.name || "", artist: "", placement_ids: [], client_id: null, ar_id: null, isrc: "", spotify_id: "", entity_id: null,
        matched_by: "", status: "todo", atd: num(e.atd), atd_on: day, week: weekOf(e, day), series };
      if (kind === "artist") {
        const c = ourClient(e.name);
        const t = liveTracked.find((x) => x.kind === "artist" && ((x.luminate_id && x.luminate_id === e.id) || personKey(x.name) === personKey(e.name)));
        const cs = c && spotifyId(c.spotify, "artist"), ts = t && spotifyId(t.spotify, "artist");
        if (c) Object.assign(row, { client_id: c.id, entity_id: `a:${c.id}` });
        else if (t) Object.assign(row, { ar_id: t.id, entity_id: `w:${t.id}` });
        else row.entity_id = `l:${e.id}`;
        const sp = cs || ts || "";
        if (t && !c) row.ar_id = t.id;
        if (sp) Object.assign(row, { spotify_id: sp, matched_by: "link", status: "matched" });
      } else {
        const t = liveTracked.find((x) => x.kind === "song" && ((x.luminate_id && x.luminate_id === e.id) || songKey(x.name) === songKey(e.name)));
        const sp = t ? spotifyId(t.spotify, "track") : "";
        if (t) Object.assign(row, { ar_id: t.id, artist: t.artist || "", isrc: String(t.isrc || "").toUpperCase() });
        if (sp) Object.assign(row, { spotify_id: sp, entity_id: `t:${sp}`, matched_by: "link", status: "matched" });
      }
      if (!out.has(e.id)) out.set(e.id, row);
    }
  }
  return [...out.values()];
}

// A row someone decided (matched by hand, confirmed, skipped) keeps that; otherwise the fresh row wins,
// except a match the Spotify search found (isrc / name) stays until a fresh link replaces it. Pure.
export function mergeSeed(fresh, old) {
  if (!old) return fresh;
  const hist = { atd: fresh.atd, atd_on: fresh.atd_on, week: fresh.week, series: fresh.series, list: fresh.list, name: fresh.name };
  if (old.decided_by) return { ...old, ...hist, placement_ids: fresh.placement_ids, artist: old.artist || fresh.artist };
  if (fresh.status === "matched" && fresh.matched_by !== "same-song") return { ...old, ...fresh, socials: old.socials };
  if (["isrc", "name", "search"].includes(old.matched_by) || (old.status === "check")) return { ...old, ...hist, placement_ids: fresh.placement_ids, isrc: fresh.isrc || old.isrc, artist: old.artist || fresh.artist };
  return { ...old, ...fresh, socials: old.socials };
}

const COLS = ["lum_id", "list", "area", "kind", "name", "artist", "placement_ids", "client_id", "ar_id", "isrc", "spotify_id", "spotify_name", "spotify_image", "entity_id", "matched_by", "status", "socials", "atd", "atd_on", "week", "series", "decided_by"];
const jsonCols = new Set(["placement_ids", "socials", "week", "series"]);
export async function saveSeeds(rows) {
  if (!rows.length) return 0;
  const clean = rows.map((r) => Object.fromEntries(COLS.map((k) => [k, r[k] ?? (jsonCols.has(k) ? (k === "placement_ids" || k === "series" ? [] : k === "socials" ? {} : null) : ["client_id", "ar_id", "entity_id", "atd", "atd_on"].includes(k) ? null : "")])));
  await sql`
    INSERT INTO lum_history (lum_id, list, area, kind, name, artist, placement_ids, client_id, ar_id, isrc, spotify_id, spotify_name, spotify_image, entity_id, matched_by, status, socials, atd, atd_on, week, series, decided_by)
    SELECT x.lum_id, x.list, x.area, x.kind, x.name, x.artist, x.placement_ids, x.client_id, x.ar_id, x.isrc, x.spotify_id, x.spotify_name, x.spotify_image, x.entity_id, x.matched_by, x.status, x.socials, x.atd, x.atd_on, x.week, x.series, x.decided_by
    FROM jsonb_to_recordset(${JSON.stringify(clean)}::jsonb) AS x(lum_id text, list text, area text, kind text, name text, artist text, placement_ids jsonb, client_id text, ar_id text, isrc text,
      spotify_id text, spotify_name text, spotify_image text, entity_id text, matched_by text, status text, socials jsonb, atd bigint, atd_on date, week jsonb, series jsonb, decided_by text)
    ON CONFLICT (lum_id) DO UPDATE SET list = EXCLUDED.list, area = EXCLUDED.area, kind = EXCLUDED.kind, name = EXCLUDED.name, artist = EXCLUDED.artist, placement_ids = EXCLUDED.placement_ids,
      client_id = EXCLUDED.client_id, ar_id = EXCLUDED.ar_id, isrc = EXCLUDED.isrc, spotify_id = EXCLUDED.spotify_id, spotify_name = EXCLUDED.spotify_name, spotify_image = EXCLUDED.spotify_image,
      entity_id = EXCLUDED.entity_id, matched_by = EXCLUDED.matched_by, status = EXCLUDED.status, socials = EXCLUDED.socials, atd = EXCLUDED.atd, atd_on = EXCLUDED.atd_on, week = EXCLUDED.week,
      series = EXCLUDED.series, decided_by = EXCLUDED.decided_by, updated_at = now()`;
  return clean.length;
}
const rowOut = (r) => ({ ...r, placement_ids: arr(r.placement_ids), series: arr(r.series), socials: obj(r.socials), week: r.week && typeof r.week === "string" ? JSON.parse(r.week) : r.week || null,
  atd: r.atd == null ? null : Number(r.atd), atd_on: r.atd_on ? String(r.atd_on instanceof Date ? r.atd_on.toISOString() : r.atd_on).slice(0, 10) : null });
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v) || {}; } catch { return {}; } })() : {});
export async function loadSeeds() {
  return (await rowsOrNoneIfNoTable(sql`SELECT * FROM lum_history ORDER BY area, list, atd DESC NULLS LAST, lum_id`)).map(rowOut);
}

// Reads the Luminate tables once more and (re)writes lum_history; returns the counts
export async function importSeeds() {
  const [exports, portfolios, held, snaps, placements, clients, tracked, tracking, old] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT portfolio_id, exported_at, uploaded_at, entities FROM luminate_exports`),
    rowsOrNoneIfNoTable(sql`SELECT luminate_id, name, kind FROM luminate_portfolios`),
    rowsOrNoneIfNoTable(sql`SELECT portfolio_id, holds, exported_at, entities FROM luminate_ar_held`),
    rowsOrNoneIfNoTable(sql`SELECT luminate_id, taken_on::text AS d, streams FROM stream_snapshots ORDER BY taken_on`),
    sql`SELECT id, client_id, song, artist, link, luminate_id FROM placements`,
    sql`SELECT id, name, sheet_tab_name, spotify, on_roster FROM clients`,
    rowsOrNoneIfNoTable(sql`SELECT id, kind, name, artist, spotify, isrc, luminate_id, removed_at FROM ar_tracked`),
    rowsOrNoneIfNoTable(sql`SELECT placement_id, isrc FROM song_tracking`),
    loadSeeds(),
  ]);
  const prev = new Map(old.map((r) => [r.lum_id, r]));
  const rows = seedRowsOf({ exports, portfolios, held, snaps, placements, clients, tracked, tracking }).map((r) => mergeSeed(r, prev.get(r.lum_id)));
  await saveSeeds(rows);
  return countsOf(rows);
}
export const countsOf = (rows) => ({ total: rows.length, matched: rows.filter((r) => r.status === "matched").length, check: rows.filter((r) => r.status === "check").length,
  todo: rows.filter((r) => r.status === "todo").length, skipped: rows.filter((r) => r.status === "skipped").length });

// ---- Spotify for what's left (free API). limit = rows asked about in one call (each is one or two requests).
const plainName = (s) => personKey(s).replace(/[^\p{L}\p{N}$]+/gu, "");
export async function matchSeeds({ limit = 60, skip = new Set() } = {}) {
  if (!D.spotifyConfigured()) return { asked: 0, skipped: "no Spotify keys" };
  const rows = await loadSeeds();
  const done = { asked: 0, isrc: 0, check: 0, details: 0, none: 0, errors: 0 };
  const save = [];
  // what isn't matched yet first (a new match matters more than a matched row's name and picture)
  for (const r of [...rows.filter((x) => x.status === "todo"), ...rows.filter((x) => x.status !== "todo")]) {
    if (done.asked >= limit) break;
    if (r.decided_by || r.status === "skipped" || skip.has(r.lum_id)) continue;
    try {
      if (r.status === "matched" && r.spotify_id && !r.spotify_name && r.matched_by !== "same-song") {
        // a match from a link: what Spotify calls it, its picture and (a song's) ISRC, for the page and the dedupe by ISRC
        done.asked++;
        const d = r.kind === "artist" ? await D.spotifyArtist(r.spotify_id) : await D.spotifyTrack(r.spotify_id);
        if (d) { save.push({ ...r, spotify_name: d.name, spotify_image: d.image, isrc: r.isrc || d.isrc || "" }); done.details++; }
        continue;
      }
      if (r.status !== "todo") continue;
      skip.add(r.lum_id); // asked once per call (the caller can pass the set on to the next one)
      if (r.kind !== "artist" && r.isrc) {
        done.asked++;
        const hits = await D.spotifyIsrc(r.isrc);
        if (hits.length) { const t = hits[0]; save.push({ ...r, spotify_id: t.id, spotify_name: t.name, spotify_image: t.image, entity_id: `t:${t.id}`, matched_by: "isrc", status: "matched" }); done.isrc++; continue; }
      }
      if (r.kind === "artist") {
        // Spotify's first artist with exactly this name (it often has two or three profiles by one name):
        // offered with its picture, and a person says Yes (or pastes the right one) before it's tracked
        done.asked++;
        const hits = (await D.spotifyArtistSearch(r.name)).filter((a) => plainName(a.name) === plainName(r.name));
        if (hits.length) { save.push({ ...r, spotify_id: hits[0].id, spotify_name: hits[0].name, spotify_image: hits[0].image, matched_by: "name", status: "check" }); done.check++; continue; }
      } else {
        // a song: its first exact title hit (with one of its artists, when we know them), offered the same way
        done.asked++;
        const lead = r.artist ? r.artist.split(/,|&| x | feat\.? /i)[0].trim() : "";
        const hits = (await D.spotifyTrackSearch(searchTitle(r.name), lead))
          .filter((t) => baseTitle(t.name) === baseTitle(r.name) && (!r.artist || t.artists.some((a) => r.artist.toLowerCase().includes(a.name.toLowerCase()))));
        if (hits.length) { const t = hits[0]; save.push({ ...r, spotify_id: t.id, spotify_name: `${t.name} · ${t.artists.map((a) => a.name).join(", ")}`, spotify_image: t.image, isrc: r.isrc || t.isrc, matched_by: "search", status: "check" }); done.check++; continue; }
      }
      done.none++;
    } catch (err) {
      done.errors++;
      if (err instanceof D.RateLimited) break;
    }
  }
  // a release group that is a song's single follows that song's match
  const byId = new Map([...rows.map((r) => [r.lum_id, r]), ...save.map((r) => [r.lum_id, r])]);
  for (const r of rows) if (r.matched_by === "same-song" && !r.decided_by) {
    const twin = [...byId.values()].find((x) => x.kind === "song" && x.list === r.list && x.atd === r.atd && baseTitle(x.name) === baseTitle(r.name));
    if (twin && twin.status === "matched" && twin.spotify_id !== r.spotify_id) save.push({ ...r, spotify_id: twin.spotify_id, entity_id: twin.entity_id, artist: r.artist || twin.artist });
  }
  await saveSeeds(save);
  return done;
}

// ---- To do's answers. op: confirm | link | isrc | skip | socials. Returns the row, or { error }.
// isrc: an ISRC staff picked or typed for a song: kept on the row (and on its songs here, song_tracking),
// then looked up on Spotify (search isrc:…); a hit tracks it at once, none leaves it to find by link.
export async function decideSeed(lumId, { op, url = "", socials = {}, ...extra } = {}, by = "") {
  const [r] = (await sql`SELECT * FROM lum_history WHERE lum_id = ${String(lumId || "")}`).map(rowOut);
  if (!r) return { error: "That one isn't on the list any more." };
  const who = String(by || "staff").slice(0, 80);
  let next = null;
  if (op === "confirm") {
    if (r.status !== "check" || !r.spotify_id) return { error: "There's nothing to confirm on that one." };
    next = { ...r, status: "matched", entity_id: r.kind === "artist" ? r.entity_id || `l:${r.lum_id}` : `t:${r.spotify_id}`, decided_by: who };
  } else if (op === "link") {
    const want = r.kind === "artist" ? "artist" : "track";
    const id = spotifyId(url, want);
    if (!id) return { error: r.kind === "artist" ? "Paste the artist's Spotify link (open.spotify.com/artist/…)." : "Paste the song's Spotify link (open.spotify.com/track/…)." };
    let d = null;
    if (D.spotifyConfigured()) { try { d = want === "artist" ? await D.spotifyArtist(id) : await D.spotifyTrack(id); } catch { d = null; } }
    next = { ...r, spotify_id: id, spotify_name: d?.name || "", spotify_image: d?.image || "", isrc: r.isrc || d?.isrc || "", matched_by: "typed", status: "matched",
      entity_id: r.kind === "artist" ? r.entity_id || `l:${r.lum_id}` : `t:${id}`, decided_by: who };
  } else if (op === "isrc") {
    if (r.kind === "artist") return { error: "Only a song has an ISRC." };
    const isrc = String(extra.isrc || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) return { error: "An ISRC is 12 letters and numbers, like USUM72506269." };
    if (r.placement_ids.length) await sql`
      INSERT INTO song_tracking (placement_id, isrc, isrc_source, isrc_checked_at, updated_at)
      SELECT id, ${isrc}, ${extra.source || "manual"}, now(), now() FROM jsonb_array_elements_text(${JSON.stringify(r.placement_ids)}::jsonb) AS id
      ON CONFLICT (placement_id) DO UPDATE SET isrc = EXCLUDED.isrc, isrc_source = EXCLUDED.isrc_source, isrc_checked_at = now(), updated_at = now()`;
    let hit = null;
    if (D.spotifyConfigured()) { try { hit = (await D.spotifyIsrc(isrc))[0] || null; } catch { hit = null; } }
    next = hit
      ? { ...r, isrc, spotify_id: hit.id, spotify_name: hit.name, spotify_image: hit.image, entity_id: `t:${hit.id}`, matched_by: "isrc", status: "matched", decided_by: who }
      : { ...r, isrc };
  } else if (op === "skip") {
    next = { ...r, status: "skipped", decided_by: who };
  } else if (op === "socials") {
    if (r.kind !== "artist") return { error: "Only an artist has socials here." };
    const s = { ...r.socials };
    const ig = handleOf(socials.instagram, "instagram.com"), tt = handleOf(socials.tiktok, "tiktok.com"), yt = youtubeRef(socials.youtube);
    if (socials.instagram !== undefined) s.instagram = ig ? `https://www.instagram.com/${ig}` : "";
    if (socials.tiktok !== undefined) s.tiktok = tt ? `https://www.tiktok.com/@${tt}` : "";
    if (socials.youtube !== undefined) s.youtube = yt ? (yt.startsWith("@") ? `https://www.youtube.com/${yt}` : `https://www.youtube.com/channel/${yt}`) : "";
    if ([["instagram", ig], ["tiktok", tt], ["youtube", yt]].some(([k, v]) => String(socials[k] || "").trim() && !v)) return { error: "One of those links isn't a profile link. Paste the profile's address." };
    next = { ...r, socials: s, decided_by: r.decided_by || "" };
  } else return { error: "Unknown answer." };
  await saveSeeds([next]);
  return { row: next };
}

// What To do lists: everything not matched yet, plus a found match to confirm. areas: the ones this
// account may see ("roster" = Publishing, "ar" = A&R). Each row says what Luminate last had for it.
export function seedTodo(rows, areas = ["roster", "ar"]) {
  return rows.filter((r) => areas.includes(r.area) && (r.status === "todo" || r.status === "check"))
    .map((r) => ({ lumId: r.lum_id, list: r.list, area: r.area, kind: r.kind, name: r.name, artist: r.artist, status: r.status, isrc: r.isrc, placementIds: r.placement_ids,
      spotify: r.spotify_id ? { id: r.spotify_id, name: r.spotify_name, image: r.spotify_image, url: `https://open.spotify.com/${r.kind === "artist" ? "artist" : "track"}/${r.spotify_id}` } : null,
      atd: r.atd, atdOn: r.atd_on, socials: r.socials }))
    .sort((a, b) => (b.atd ?? -1) - (a.atd ?? -1));
}
// The read-only Luminate history per tracked entity: { [entityId]: { atd, on, week, series, list } }
// (the newest list's numbers when two Luminate rows point at one entity, e.g. a song and its single)
export function historyByEntity(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.entity_id || r.status !== "matched" || r.atd == null || r.matched_by === "same-song") continue;
    const cur = out[r.entity_id];
    if (!cur || (r.atd ?? 0) > (cur.atd ?? 0)) out[r.entity_id] = { atd: r.atd, on: r.atd_on, week: r.week, series: r.series, list: r.list };
  }
  return out;
}
