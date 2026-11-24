// Roster › Catalog (2026-11-23, the owner: a "Catalog" and a release calendar under the roster; 2026-11-24: "maybe we dont need releases if we have catalog", so the release dates are the
// "New releases" strip on top of Catalog now): every song of the roster in one list, and the songs coming up or just out. Pure: the dashboard's own data (db.clients, db.placements:
// already only the account's own artists for a Co-manager limited to them) and each song's tracking facts (its ISRC and "Not on streaming": song_tracking, GET /api/songs, or GET
// /api/roster-catalog for the accounts that route refuses) go in, rows come out.
// Nothing is read, written or made up here: a cover is the link the song really holds (placements.cover), a source is a link the song really has, a chip is one of the app's own gaps
// (lib/sheet-facts.js SONG_GAPS: "No link", "No release date", "Split to confirm"; the ISRC finder's "No ISRC"; song_tracking.skip's "Not on streaming"), and the streams are the pub
// sheet's, as the client's page shows them.
import { spotifyTrack } from "./duplicates";
import { titleKey } from "./sheet-facts";

// ---- where a song is, from the links it really holds (placements.link is the only place a song keeps one) ----------------------------------------------
export const SOURCE_LABEL = { spotify: "Spotify", apple: "Apple", youtube: "YouTube", soundcloud: "SoundCloud" };
const SOURCE_HOSTS = [
  ["spotify", /(^|\.)spotify\.(com|link)$/],
  ["apple", /^(geo\.)?(music|itunes)\.apple\.com$/],
  ["youtube", /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/],
  ["soundcloud", /(^|\.)(soundcloud\.com|snd\.sc)$/],
];
// "spotify" | "apple" | "youtube" | "soundcloud" for a link on one of those sites, null for anything else (or nothing)
export function sourceOf(link) {
  const raw = String(link ?? "").trim();
  if (!raw) return null;
  if (/^spotify:(track|album|artist):/i.test(raw)) return "spotify";
  let host;
  try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return null; }
  return SOURCE_HOSTS.find(([, re]) => re.test(host))?.[0] || null;
}

// ---- days ------------------------------------------------------------------------------------------------------------------------------------------
// "YYYY-MM-DD" for a real calendar day at the start of the text (a Spotify date can be just a year or a month: that isn't a day), else ""
export function ymdOf(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(String(s ?? "").trim());
  if (!m) return "";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : "";
}
// the day it is in New York (where the business is, as lib/streams-on.js nyYmd), as "YYYY-MM-DD"
export const todayNY = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- one row per song ------------------------------------------------------------------------------------------------------------------------------
// "One song, even when two clients' pages have it": the same Spotify track, or the same title and artist (the rule To do's ISRC finder uses: components/dash/isrc-data.js
// songsWithoutIsrc, so "N songs with no ISRC" there and the "No ISRC" songs here are the same songs). A title with no letters or digits in it (an emoji, another script)
// is compared as typed, and an empty one never joins another: two different songs are never made one.
export function songKey(p) {
  const sp = spotifyTrack(p.link);
  if (sp) return `t:${sp}`;
  const t = titleKey(p.song) || String(p.song ?? "").trim().toLowerCase();
  return t ? `n:${t}|${titleKey(p.artist) || String(p.artist ?? "").trim().toLowerCase()}` : `id:${p.id}`;
}

export const CHIP_LABEL = { isrc: "No ISRC", link: "No link", date: "No release date", confirm: "Split to confirm", off: "Not on streaming" };
const CHIP_ORDER = ["isrc", "link", "date", "confirm", "off"];
export const FILTERS = [["all", "All"], ["missing", "Missing info"], ["off", "Not on streaming"]];
const collate = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), "en");
// two rows that tie on what they're sorted by: the title, then the first client, then the key (so the order never depends on how the rows came)
const tie = (a, b) => collate(a.title, b.title) || collate(a.clients[0]?.name, b.clients[0]?.name) || collate(a.key, b.key);
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// clients: db.clients; placements: db.placements; tracking: { [placementId]: { isrc?, skip? } } (GET /api/songs' `tracking`, or /api/roster-catalog's), or null when it isn't known
// (then no song is said to lack an ISRC or to be off streaming); confirmIds: the songs whose split is to confirm (components/dash/catalog-data.js splitsToConfirm)
// A row: { key, title, artist, clients: [{ id, name }], placementIds, open (the placement a click opens: the one with the most streams), releaseDate ("" = none),
//          cover (the link of the song's cover art: the first copy that has one, the one a click opens first; "" = none), streams (the pub sheet's lifetime streams; the same song's
//          copies on two clients' tabs carry the same number, so the biggest, never the sum), sources: ["spotify", ...],
//          skip (every copy is marked Not on streaming), gaps: { isrc, link, date, confirm }, chips: [{ k, label }], missing, search }
export function catalogRows({ clients = [], placements = [], tracking = null, confirmIds = new Set() } = {}) {
  const name = new Map((clients || []).map((c) => [c.id, c.name]));
  const known = tracking != null;
  const groups = new Map();
  for (const p of placements || []) {
    const k = songKey(p);
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  const rows = [];
  for (const [key, copies] of groups) {
    const cn = (p) => name.get(p.clientId) || "";
    // the copy a click opens comes first: the most streams, then the client's name, then the id (so the order never depends on how the rows came)
    const ps = [...copies].sort((a, b) => (Number(b.streams) || 0) - (Number(a.streams) || 0) || collate(cn(a), cn(b)) || collate(a.id, b.id));
    const seen = new Set(), cs = [];
    for (const p of ps) {
      const id = p.clientId ?? "";
      if (seen.has(id)) continue;
      seen.add(id);
      cs.push({ id, name: cn(p) || "A deleted client" });
    }
    cs.sort((a, b) => collate(a.name, b.name) || collate(a.id, b.id));
    const first = (f) => { for (const p of ps) { const v = f(p); if (v) return v; } return ""; };
    const releaseDate = first((p) => ymdOf(p.releaseDate)), cover = first((p) => String(p.cover ?? "").trim());
    const sources = Object.keys(SOURCE_LABEL).filter((s) => ps.some((p) => sourceOf(p.link) === s));
    const skip = known && ps.every((p) => !!tracking[p.id]?.skip);
    const gaps = {
      // a copy marked Not on streaming has no ISRC to find, so its own doesn't count (the finder skips it the same way: isrc-data.js)
      isrc: known && !skip && !ps.some((p) => !tracking[p.id]?.skip && !!tracking[p.id]?.isrc),
      link: !skip && !ps.some((p) => String(p.link ?? "").trim()),
      date: !skip && !releaseDate,
      confirm: ps.some((p) => confirmIds.has(p.id)),
    };
    const chips = CHIP_ORDER.filter((k) => (k === "off" ? skip : gaps[k])).map((k) => ({ k, label: CHIP_LABEL[k] }));
    const title = first((p) => String(p.song ?? "").trim()) || "Untitled", artist = first((p) => String(p.artist ?? "").trim());
    rows.push({
      key, title, artist, clients: cs, placementIds: ps.map((p) => p.id), open: ps[0].id, openClient: cn(ps[0]) || "A deleted client", releaseDate, cover,
      streams: Math.max(0, ...ps.map((p) => Number(p.streams) || 0)), sources, skip, gaps, chips,
      missing: gaps.isrc || gaps.link || gaps.date || gaps.confirm,
      search: norm(`${title} ${artist} ${cs.map((c) => c.name).join(" ")}`),
    });
  }
  return rows;
}

// the big number: the songs listed, their streams added up, and how many have no streams on the sheet yet
export function summary(rows) {
  return { songs: rows.length, streams: rows.reduce((a, r) => a + r.streams, 0), noStreams: rows.filter((r) => !(r.streams > 0)).length };
}

// instant search over title, artist and client: every word typed has to be in the song's text (punctuation and accents don't matter: "stacke" finds Stack!e)
export function searchRows(rows, q) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => { const flat = r.search.replace(/ /g, ""); return words.every((w) => r.search.includes(w) || flat.includes(w)); });
}
export function filterRows(rows, f) {
  return f === "missing" ? rows.filter((r) => r.missing) : f === "off" ? rows.filter((r) => r.skip) : rows;
}
export const filterCounts = (rows) => ({ all: rows.length, missing: rows.filter((r) => r.missing).length, off: rows.filter((r) => r.skip).length });
// "streams": the most first (the default); "date": the newest release first, songs with no date last. A tie: title, then the first client
export function sortRows(rows, by = "streams") {
  const cmp = by === "date"
    ? (a, b) => (a.releaseDate && !b.releaseDate ? -1 : !a.releaseDate && b.releaseDate ? 1 : collate(b.releaseDate, a.releaseDate)) || tie(a, b)
    : (a, b) => b.streams - a.streams || tie(a, b);
  return [...rows].sort(cmp);
}

// ---- Release dates ---------------------------------------------------------------------------------------------------------------------------------
// "Coming up" (after today, the soonest first), "Out in the last 30 days" (the newest first; today counts as out), "No release date yet" (the biggest first). A song marked
// Not on streaming has no date to find (its editor says so), so it isn't asked for one: `off` counts them. Older releases are only in Catalog's table.
// The page draws the first two as one strip (newReleases below); the last is the table's "No release date" chip.
export const RECENT_DAYS = 30;
export function releaseGroups(rows, today) {
  const from = addDays(today, -RECENT_DAYS);
  const coming = [], recent = [], none = [];
  let off = 0;
  for (const r of rows) {
    if (!r.releaseDate) { if (r.skip) off++; else none.push(r); continue; }
    if (r.releaseDate > today) coming.push(r);
    else if (r.releaseDate >= from) recent.push(r);
  }
  coming.sort((a, b) => collate(a.releaseDate, b.releaseDate) || tie(a, b));
  recent.sort((a, b) => collate(b.releaseDate, a.releaseDate) || tie(a, b));
  none.sort((a, b) => b.streams - a.streams || tie(a, b));
  return { coming, recent, none, off, from };
}

// Catalog's "New releases" strip (2026-11-24): the songs coming up (a release date after today) and the ones out in the last 30 days (today counts as out) in one list, the newest release first
// (so the furthest date leads), each with `coming`: true for a song that isn't out yet. A song with no day isn't in it (a year alone isn't one). The rows are the catalogRows' own, with `coming` added.
export function newReleases(rows, today) {
  const { coming, recent } = releaseGroups(rows, today);
  return [...coming, ...recent].sort((a, b) => collate(b.releaseDate, a.releaseDate) || tie(a, b)).map((r) => ({ ...r, coming: r.releaseDate > today }));
}
