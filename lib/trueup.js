// The monthly Luminate true-up (the owner, 2026-11-04: "i rly want this to be accurate but i dont wanna do the
// reports its so tedious"). Server only.
//   Daily      STREAM DATA's estimate = Spotify x each song's own ratio (lib/stream-sheet.js, "estimate").
//   Monthly    one real Luminate file resets every roster song to its true all-platform total and refreshes
//              its ratio, so on true-up day the sheet's number IS Luminate's. A&R keeps the automated numbers
//              only: its rows in a file are left as they are.
// What Apply touches, and nothing else: one trueup_runs row and its trueup_points rows (migration 015). Undo
// deletes the newest run and its points. Nothing here writes the sheet: the STREAM DATA writer does that,
// behind STREAM_SHEET_WRITES (default off), and reads the newest ratio and total from trueup_points.
//
// Files: the one Luminate Trend Report the owner exports each month (round 10: Location Worldwide, Daily, with ATD;
// parseTrendReport, from two real exports), or the 4 portfolio exports the dashboard read before list B #3
// (portfolio-export-POR….csv; the parser is the old lib/luminate.js one). Several at once, so a second report works
// once the roster passes 500 songs. A Trend Report song is found by its Luminate ID (lum_history, then a placement
// carrying it), then by its title without version tags + an artist in common (matchTrendSongs, the base step's
// rules: Luminate counts a song's versions as one song, so the main one is matched and its versions are covered).
// Luminate leaves out a song with no plays in the period: it keeps its last number ("No plays this period, or not in
// the report yet"). Only a Worldwide file can be applied (a US-only one is shown, with the jump, but not saved).
//
// "Songs for the Luminate report" (reportSongs): every roster song, from the pub sheet songs (placements) and
// the roster catalogs the numbers pick up from Spotify (data_entities, new releases included), once per ISRC.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getState, setState } from "./app-state";
import { planStreamData, streamInputs } from "./stream-sheet";
import { spotifyId } from "./data/sources";

export const REPORT_CAP = 500, REPORT_WARN = 450;
export const NEAR_DAYS = 3;                 // a Spotify count this close to the export's moment makes the ratio
export const SCHEDULE_WEEKS = 12;           // Luminate's Report Scheduler runs a series for at most 12 weeks
export const REMIND_WEEKS = 11;             // the reminder shows a week before it ends
export const TREND_REPORT_NOTE = "In Luminate: the Trend Report with Location Worldwide, Daily and ATD. The 4 portfolio exports work too.";
export const NOT_IN_REPORT = "No plays this month, or not added"; // r10 fix: the owner's own words
const DAY = 864e5;

// what Luminate itself calls the 4 portfolios (the names staff know them by)
export const PORTFOLIO_NAMES = {
  POR2D7C3C99583C47AB97903870A7BF68B9: "Admin Catalog 1",
  PORD63A45A7E3214C9BA012EAE23C93E274: "Admin Catalog 2",
  POR069D735D69A24B35AEE8B7FF6D221BA4: "Artist Tracker",
  POR074E2117846F41B1A02150A26A5B0599: "Song Tracker",
};
const listOf = (por) => PORTFOLIO_NAMES[por] || `Portfolio …${String(por).slice(-4)}`;

// ---- the old parser (lib/luminate.js before list B #3), unchanged in what it accepts
// RFC 4180, the rules Luminate writes its CSVs with (quoted fields may hold commas, newlines and doubled quotes)
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const count = (v) => { const n = parseInt(String(v ?? "").replace(/[^0-9.-]/g, ""), 10); return Number.isNaN(n) ? 0 : n; };
// "portfolio-export-PORD63A…E274-1790177303899 (1).csv": the portfolio's id, then the moment Luminate made the file (ms)
export const portfolioIdOf = (s) => String(s || "").match(/(POR[0-9A-Fa-f]{6,})/)?.[1].toUpperCase() || null;
const exportedAtOf = (name) => { const ms = Number(String(name || "").match(/POR[0-9A-Fa-f]+-(\d{12,14})/)?.[1]); return ms ? new Date(ms).toISOString() : null; };
// by the Entity Type column, never by the id's prefix (artists are AR…, songs SG…, releases MRELG…)
export const entityType = (e) => (!e.type || /^song$/i.test(e.type) ? "song" : /^artist$/i.test(e.type) ? "artist" : /release/i.test(e.type) ? "release" : "other");

// One export file -> { portfolioId, list, fileName, exportedAt, entities: [{ id, name, type, atd }] }, or { error }
// in words staff can act on.
export function parseExport(fileName, text) {
  const portfolioId = portfolioIdOf(fileName);
  if (!portfolioId) return { fileName, error: `"${fileName}" isn't a Luminate Trend Report or portfolio export. ${TREND_REPORT_NOTE}` };
  const rows = parseCsv(text);
  const h = (rows[0] || []).map((x) => x.trim());
  const col = { type: h.indexOf("Entity Type"), id: h.indexOf("Entity ID"), name: h.indexOf("Entity Name"), period: h.indexOf("Period"), streams: h.indexOf("Streams (Current)") };
  if (col.id < 0 || col.period < 0 || col.streams < 0) return { fileName, error: `"${fileName}" is missing Luminate's Entity ID / Period / Streams columns. Download it again from the portfolio page.` };
  const byId = new Map();
  for (const r of rows.slice(1)) {
    const id = String(r[col.id] || "").trim();
    if (!id || r.length <= col.period) continue;
    const e = byId.get(id) || { id, name: col.name >= 0 ? r[col.name] || "" : "", type: col.type >= 0 ? r[col.type] || "" : "", atd: null };
    if (String(r[col.period]).trim().toLowerCase() === "activity to date") e.atd = count(r[col.streams]);
    byId.set(id, e);
  }
  const entities = [...byId.values()].filter((e) => e.atd !== null);
  if (!entities.length) return { fileName, error: `"${fileName}" has no "Activity to Date" rows. Check the export's settings and download it again.` };
  // the date comes only from Luminate's own file name: without it the numbers can't be dated
  const exportedAt = exportedAtOf(fileName);
  if (!exportedAt) return { fileName, error: `"${fileName}": this file was renamed, so its date is unknown. Download it again from Luminate.` };
  return { portfolioId, list: listOf(portfolioId), fileName, exportedAt, entities };
}

// ---- the Trend Report (round 10): Luminate › Trend Report, Location Worldwide, Daily, with ATD. Columns: Location,
// Entity (Artist / Release Group / Song), Artist, Title, Luminate ID (AR… artists, MRELG… release groups, SG… songs),
// Activity, Release Type, Week, Year, Date (one row per day), Quantity (that day), ATD (all-time; only on each
// entity's newest row, through the last full week). The file repeats its byte-order mark mid-file.
const TREND_COLS = ["Location", "Entity", "Artist", "Title", "Luminate ID", "Activity", "Date", "Quantity", "ATD"];
const headOf = (text) => parseCsv(String(text || "").slice(0, 2000).replace(/\uFEFF/g, ""))[0]?.map((x) => x.trim()) || [];
export const isTrendReport = (text) => { const h = headOf(text); return h.includes("Luminate ID") && h.includes("Entity") && (h.includes("ATD") || h.includes("Date")); };
export function parseTrendReport(fileName, text) {
  const rows = parseCsv(String(text || "").replace(/\uFEFF/g, ""));
  const h = (rows[0] || []).map((x) => x.trim());
  const at = Object.fromEntries(TREND_COLS.map((c) => [c, h.indexOf(c)]));
  const need = ["Luminate ID", "Entity", "Date", "Quantity", "ATD"].filter((c) => at[c] < 0);
  if (need.length) return { fileName, error: `"${fileName}" is missing the Trend Report's ${need.join(" / ")} column${need.length > 1 ? "s" : ""}. In Luminate, turn on Daily and ATD and export it again.` };
  const cell = (r, c) => (at[c] >= 0 ? String(r[at[c]] ?? "").trim() : "");
  const byId = new Map(), places = new Set();
  let first = null, last = null;
  for (const r of rows.slice(1)) {
    const id = cell(r, "Luminate ID"), day = cell(r, "Date");
    if (!id || id === "Luminate ID" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (at.Activity >= 0 && cell(r, "Activity") && !/^streams?$/i.test(cell(r, "Activity"))) continue;
    if (cell(r, "Location")) places.add(cell(r, "Location"));
    const type = cell(r, "Entity");
    const e = byId.get(id) || { id, type, name: cell(r, "Title") || cell(r, "Artist"), artist: cell(r, "Artist"), atd: null, atdOn: null, week: 0, days: 0 };
    e.week += count(cell(r, "Quantity")); e.days++;
    if (cell(r, "ATD") !== "" && (!e.atdOn || day >= e.atdOn)) { e.atd = count(cell(r, "ATD")); e.atdOn = day; }
    byId.set(id, e);
    if (!first || day < first) first = day;
    if (!last || day > last) last = day;
  }
  if (places.size > 1) return { fileName, error: `"${fileName}" has more than one Location (${[...places].join(", ")}). Export it with one Location: Worldwide.` };
  const entities = [...byId.values()].filter((e) => e.atd !== null);
  if (!entities.length) return { fileName, error: `"${fileName}" has no ATD numbers. In Luminate, turn on ATD for the Trend Report and export it again.` };
  const location = [...places][0] || "Worldwide";
  // ATD is through the file's last day (the last full week's Thursday): that day is the numbers' date
  return { kind: "trend", fileName, list: location === "Worldwide" ? "Trend Report" : `Trend Report (${location})`, location,
    exportedAt: `${last}T23:59:00.000Z`, from: first, through: last, entities };
}
// One dropped file, by what's in it: the Trend Report's columns, or a portfolio export
export const parseFile = (fileName, text) => (isTrendReport(text) ? parseTrendReport(fileName, text) : parseExport(fileName, text));

// A Trend Report song with no Luminate ID here: its title without version tags (slowed, sped up, jersey club…, feat.,
// "- Single") + at least one artist in common, among the roster's tracked songs no other Luminate song holds. The
// main one (fewest tags) is matched; the song's other versions are covered by it (Luminate counts them as one).
const fold = (s) => String(s || "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
const VT = "(?:(?:super\\s+)?slowed(?:\\s+down)?|sped\\s*up|reverb(?:ed)?|jersey\\s*club|nightcore|extended|nola\\s*bounce)";
const stripTags = (s) => fold(s)
  .replace(new RegExp(`#\\s*${VT}`, "g"), " ")
  .replace(new RegExp(`[(\\[][^)\\]]*${VT}[^)\\]]*[)\\]]`, "g"), " ")
  .replace(new RegExp(`\\s[-–—:|]\\s*[^-–—:|]*${VT}[^-–—:|]*$`), " ")
  .replace(new RegExp(`\\s${VT}(?:\\s*(?:&|\\+|and|,|/)?\\s*${VT})*(?:\\s+(?:version|mix|edit))?\\s*$`), " ");
const plainKey = (s) => fold(s).replace(/[(\[]\s*(?:feat\.?|ft\.?|with)\s[^)\]]*[)\]]/g, " ").replace(/\s-\s*(?:single|ep)\s*$/, "").replace(/[^\p{L}\p{N}]+/gu, "");
export const tkey = (s) => plainKey(stripTags(s));
const tagsOf = (s) => new Set([...fold(s).matchAll(new RegExp(VT, "g"))].map((m) => m[0].replace(/\s+/g, "").replace(/^superslowed|^sloweddown/, "slowed").replace(/^reverbed/, "reverb")));
const hasTags = (x, need) => { const t = tagsOf(x); for (const k of need) if (!t.has(k)) return false; return true; };
const people = (s) => new Set(String(s || "").split(/\s*(?:,|&|\+|\/|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i).map((x) => fold(x).replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean));
export const overlap = (a, b) => { const A = people(a), B = people(b); let n = 0; for (const x of A) if (B.has(x)) n++; return { n, jac: n / (new Set([...A, ...B]).size || 1) }; };
export function matchTrendSong(e, tracks, claimed) {
  if (!tkey(e.name)) return null;
  const cands = tracks.filter((x) => !claimed.has(x.id) && tkey(x.name) === tkey(e.name) && hasTags(x.name, tagsOf(e.name)) && overlap(e.artist, x.artist).n > 0);
  if (!cands.length) return null;
  cands.sort((a, b) => tagsOf(a.name).size - tagsOf(b.name).size || Number(fold(b.name) === fold(e.name)) - Number(fold(a.name) === fold(e.name))
    || overlap(e.artist, b.artist).jac - overlap(e.artist, a.artist).jac || Number(!!b.isrc) - Number(!!a.isrc) || String(a.id).localeCompare(String(b.id)));
  return { main: cands[0], versions: cands.slice(1) };
}

export const nyDay = (at) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
export const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { return JSON.parse(v) || []; } catch { return []; } })() : []);
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const dayText = (v) => (v == null ? null : String(v instanceof Date ? v.toISOString() : v).slice(0, 10));
const isrcKey = (s) => String(s || "").trim().toUpperCase();
const titleKey = (s) => String(s || "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---- the roster songs, once each (pure)
// entities: data_entities tracks; links: spotify data_links; placements; tracking: song_tracking ISRCs;
// lum: lum_history; clients: { id, name }. Each song: { key, title, artist, client, isrc, spotify, entityIds,
// placementIds, lumIds, from: ["sheet" | "catalog"] }, by client then title.
export function reportSongs({ entities = [], links = [], placements = [], tracking = [], lum = [], clients = [] }) {
  const nameOf = new Map(clients.map((c) => [c.id, c.name || ""]));
  const urlOf = new Map(links.map((l) => [l.entity_id, l.url]));
  const isrcOfP = new Map(tracking.filter((t) => t.isrc).map((t) => [t.placement_id, isrcKey(t.isrc)]));
  const songs = [], byIsrc = new Map(), byEntity = new Map(), byTitle = new Map();
  const add = (s) => { songs.push(s); if (s.isrc) byIsrc.set(s.isrc, s); return s; };
  const roster = entities.filter((e) => e.active !== false && arr(e.clients).length && arr(e.origins).some((o) => o === "placement" || o === "catalog"));
  // the songs that came from the pub sheet first, so a song on the sheet keeps the sheet's title
  roster.sort((a, b) => Number(arr(b.origins).includes("placement")) - Number(arr(a.origins).includes("placement")) || String(a.id).localeCompare(String(b.id)));
  for (const e of roster) {
    const isrc = isrcKey(e.isrc), id = String(e.id);
    let s = isrc && byIsrc.get(isrc);
    if (!s) s = add({ key: isrc || id, title: e.name || "", artist: e.artist || "", clientIds: arr(e.clients), isrc, spotify: urlOf.get(id) || (id.startsWith("t:") ? `https://open.spotify.com/track/${id.slice(2)}` : ""), entityIds: [], placementIds: [], lumIds: [], from: [] });
    s.entityIds.push(id);
    for (const c of arr(e.clients)) if (!s.clientIds.includes(c)) s.clientIds.push(c);
    for (const o of arr(e.origins)) { const f = o === "placement" ? "sheet" : o === "catalog" ? "catalog" : null; if (f && !s.from.includes(f)) s.from.push(f); }
    byEntity.set(id, s);
  }
  for (const p of placements) {
    const sp = spotifyId(p.link, "track");
    let s = (sp && byEntity.get(`t:${sp}`)) || (isrcOfP.get(p.id) && byIsrc.get(isrcOfP.get(p.id)));
    if (!s) {
      // a sheet song with no Spotify song tracked here: the same title and artist on two clients' tabs is one song
      const tk = `${titleKey(p.song)}|${titleKey(p.artist)}`;
      s = byTitle.get(tk);
      if (!s) {
        const isrc = isrcOfP.get(p.id) || "";
        s = add({ key: isrc || `p:${p.id}`, title: p.song || "", artist: p.artist || "", clientIds: [], isrc, spotify: sp ? `https://open.spotify.com/track/${sp}` : "", entityIds: [], placementIds: [], lumIds: [], from: ["sheet"] });
        byTitle.set(tk, s);
      }
    }
    if (!s.placementIds.includes(p.id)) s.placementIds.push(p.id);
    if (p.client_id && !s.clientIds.includes(p.client_id)) s.clientIds.push(p.client_id);
    if (!s.isrc && isrcOfP.get(p.id)) { s.isrc = isrcOfP.get(p.id); byIsrc.set(s.isrc, s); }
    if (!s.from.includes("sheet")) s.from.push("sheet");
    if (p.luminate_id && !s.lumIds.includes(p.luminate_id)) s.lumIds.push(String(p.luminate_id));
  }
  const byPlacement = new Map();
  for (const s of songs) for (const id of s.placementIds) byPlacement.set(id, s);
  for (const r of lum) {
    if (r.kind === "artist") continue;
    const s = (r.entity_id && r.status === "matched" && byEntity.get(r.entity_id)) || arr(r.placement_ids).map((id) => byPlacement.get(id)).find(Boolean) || (r.isrc && byIsrc.get(isrcKey(r.isrc)));
    if (s && !s.lumIds.includes(r.lum_id)) s.lumIds.push(String(r.lum_id));
  }
  for (const s of songs) s.client = s.clientIds.map((c) => nameOf.get(c)).filter(Boolean).sort((a, b) => a.localeCompare(b))[0] || s.artist || "";
  return songs.sort((a, b) => a.client.localeCompare(b.client) || a.title.localeCompare(b.title));
}

// Over 500 the list splits into Report 1, Report 2… by artist (the roster client), each whole artist in one
// report while it fits; an artist with more than 500 songs on their own fills reports of their own.
export function splitReports(songs, cap = REPORT_CAP) {
  if (songs.length <= cap) return [{ name: "Report 1", songs }];
  const by = new Map();
  for (const s of songs) (by.get(s.client) || by.set(s.client, []).get(s.client)).push(s);
  const out = [];
  let cur = [];
  for (const group of by.values()) {
    if (cur.length && cur.length + group.length > cap) { out.push(cur); cur = []; }
    for (const s of group) { if (cur.length === cap) { out.push(cur); cur = []; } cur.push(s); }
  }
  if (cur.length) out.push(cur);
  return out.map((list, i) => ({ name: `Report ${i + 1}`, songs: list, from: list[0]?.client || "", to: list[list.length - 1]?.client || "" }));
}

// The roster songs that aren't in the newest file(s): by Luminate id, or (a song added to a portfolio after it
// was linked here) by its title when exactly one roster song has that title. inIds: Set of ids; inTitles:
// Map titleKey -> count of the file's songs not linked here.
// inEntities: the Spotify songs a Trend Report covered by title (and their versions), round 10.
export function notInReport(songs, inIds, inNames = [], inEntities = new Set()) {
  const left = songs.filter((s) => !s.lumIds.some((id) => inIds.has(id)) && !(inEntities.size && (s.entityIds || []).some((id) => inEntities.has(id))));
  const titles = new Map();
  for (const s of left) { const k = titleKey(s.title); titles.set(k, (titles.get(k) || 0) + 1); }
  const named = new Set(inNames.map(titleKey).filter((k) => titles.get(k) === 1));
  return left.filter((s) => !named.has(titleKey(s.title)));
}

export const copyText = (songs) => ["Title\tArtist\tISRC\tSpotify", ...songs.map((s) => [s.title, s.artist, s.isrc, s.spotify].map((v) => String(v || "").replace(/[\t\n\r]+/g, " ")).join("\t"))].join("\n");

// ---- the plan (pure)
// parsed: parseExport results without errors. lum: lum_history. placements. near: Map entity_id ->
// [{ value, taken_at }] Spotify counts around the files' days. before: Map lum_id -> { value, ratio } (the
// sheet's estimate now, and how it was made). last: Map lum_id -> { total, on } (the newest true-up point).
// entities: data_entities tracks (a Trend Report song with no Luminate ID here is matched among the roster's).
export function planTrueUp({ parsed = [], lum = [], placements = [], entities = [], near = new Map(), before = new Map(), last = new Map() }) {
  const lumBy = new Map(lum.map((r) => [String(r.lum_id), r]));
  const sheetLum = new Map();
  for (const p of placements) if (p.luminate_id && !sheetLum.has(p.luminate_id)) sheetLum.set(String(p.luminate_id), p);
  // newest file per id (two reports or two portfolios can both hold a song)
  const newest = new Map(), allIds = new Set(), names = [];
  for (const f of parsed) for (const e of f.entities) {
    if (entityType(e) === "artist") continue;
    allIds.add(e.id);
    const cur = newest.get(e.id);
    if (!cur || Date.parse(f.exportedAt) > Date.parse(cur.at)) newest.set(e.id, { ...e, at: f.exportedAt, on: nyDay(f.exportedAt), list: f.list, file: f.fileName, trend: f.kind === "trend" });
  }
  const link = linkTrendSongs({ newest, lumBy, sheetLum, placements, entities, lum });
  const rows = [], ar = [], unknown = [], older = [], artists = [];
  for (const f of parsed) for (const e of f.entities) if (entityType(e) === "artist") artists.push(e.id);
  for (const e of newest.values()) {
    const h = lumBy.get(e.id);
    if (h?.area === "ar") { ar.push({ lumId: e.id, name: e.name }); continue; }
    const m = link.get(e.id);
    if (!h && !sheetLum.has(e.id) && !m?.entityId) { unknown.push({ lumId: e.id, name: e.name, list: e.list, kind: entityType(e) }); names.push(e.name); continue; }
    const prev = last.get(e.id);
    if (prev?.on && prev.on > e.on) { older.push({ lumId: e.id, name: e.name, on: e.on, have: prev.on }); continue; }
    const entityId = m ? m.entityId : h?.status === "matched" && h.entity_id ? h.entity_id : null;
    const at = Date.parse(e.at);
    const close = entityId ? (near.get(entityId) || []).filter((s) => Number(s.value) > 0 && Math.abs(Date.parse(iso(s.taken_at)) - at) <= NEAR_DAYS * DAY)
      .sort((a, b) => Math.abs(Date.parse(iso(a.taken_at)) - at) - Math.abs(Date.parse(iso(b.taken_at)) - at))[0] : null;
    const b = before.get(e.id) || {};
    const total = Number(e.atd) || 0;
    const ratio = close && total > 0 ? total / Number(close.value) : null;
    // (a song with no number here before (a sheet row's id only) shows as new, not as 0)
    const was = b.how === "kept" && !Number(b.value) && !h && !prev ? null : b.value ?? (h?.atd != null ? Number(h.atd) : null);
    rows.push({ lumId: e.id, name: h?.name || m?.name || e.name, list: e.list, entityId, total, on: e.on, exportedAt: e.at,
      spotify: close ? Number(close.value) : null, spotifyAt: close ? iso(close.taken_at) : null, ratio,
      oldRatio: b.ratio ?? null, ratioKept: !ratio, why: !ratio ? (m?.why || (entityId ? `no Spotify count within ${NEAR_DAYS} days of ${e.on}` : "not matched to a Spotify song yet")) : null,
      before: was, same: prev?.on === e.on && Number(prev.total) === total,
      // round 10: how a Trend Report song was found, what the number before was, and the jump to Luminate's
      by: m?.by || null, versions: m?.versions?.length || 0, beforeFrom: was == null ? null : b.how ? BEFORE_FROM[b.how] || "sheet" : "portfolio",
      jump: was == null ? null : total - was, pct: was > 0 ? Math.round(((total - was) / was) * 1000) / 10 : null,
      // Luminate's own previous number: the last update's, or the portfolio exports' (lum_history)
      prev: prev?.total != null ? Number(prev.total) : h?.atd != null ? Number(h.atd) : null, prevFrom: prev?.total != null ? "update" : h?.atd != null ? "portfolio" : null,
      prevOn: prev?.on || dayText(h?.atd_on) || null });
  }
  rows.sort((a, b) => Math.abs((b.total || 0) - (b.before || 0)) - Math.abs((a.total || 0) - (a.before || 0)) || a.name.localeCompare(b.name));
  const fresh = rows.filter((r) => !r.same);
  // the jump from the numbers we had to Luminate's, over the songs that had one
  const had = fresh.filter((r) => r.before != null), was = had.reduce((a, r) => a + Number(r.before), 0), now = had.reduce((a, r) => a + r.total, 0);
  const pv = fresh.filter((r) => r.prev != null), pvWas = pv.reduce((a, r) => a + r.prev, 0), pvNow = pv.reduce((a, r) => a + r.total, 0);
  const pvOn = pv.map((r) => r.prevOn).filter(Boolean).sort().pop() || null;
  return {
    rows, fresh, ar, unknown, older,
    changed: fresh.filter((r) => r.before !== r.total),
    kept: fresh.filter((r) => r.ratioKept),
    lumIds: [...allIds], names,
    exportOn: parsed.map((f) => nyDay(f.exportedAt)).sort().pop() || null,
    artists: new Set(artists).size,
    jump: { songs: had.length, before: was, after: now, pct: was > 0 ? Math.round(((now - was) / was) * 1000) / 10 : null, noBefore: fresh.length - had.length },
    jumpPrev: { songs: pv.length, before: pvWas, after: pvNow, pct: pvWas > 0 ? Math.round(((pvNow - pvWas) / pvWas) * 1000) / 10 : null, on: pvOn,
      from: pv.some((r) => r.prevFrom === "update") ? (pv.every((r) => r.prevFrom === "update") ? "update" : "both") : "portfolio" },
    byTitle: rows.filter((r) => r.by === "title").length, versions: rows.reduce((a, r) => a + r.versions, 0),
    entityIds: [...new Set([...rows.map((r) => r.entityId), ...[...link.values()].flatMap((m) => m.versions || [])].filter(Boolean))],
  };
}
// where "before" came from: the sheet's estimate (Spotify x ratio), the last update, or the portfolio export
const BEFORE_FROM = { own: "estimate", median: "estimate", spotify: "estimate", trueup: "update", kept: "portfolio" };

// Round 10: each Trend Report song's Spotify song here. By its Luminate ID (lum_history's match, then a placement
// that carries the id and links a roster song), then by title (matchTrendSong). Two Luminate songs on one Spotify
// song: the one whose artists are that song's keeps it (Body Party.: the Stack!e / Pr0d.k4y one). Portfolio files
// keep their old rule (lum_history only). Map lum id -> { entityId, by, name, versions, why }.
function linkTrendSongs({ newest, lumBy, sheetLum, placements, entities, lum }) {
  const out = new Map();
  const trend = [...newest.values()].filter((e) => e.trend && entityType(e) === "song");
  if (!trend.length) return out;
  const tracks = entities.filter((x) => arr(x.clients).length && x.active !== false).map((x) => ({ ...x, id: String(x.id) }));
  const byId = new Map(tracks.map((x) => [x.id, x]));
  const claimed = new Set(lum.filter((r) => r.kind !== "release" && r.status === "matched" && r.entity_id).map((r) => String(r.entity_id)));
  for (const e of trend) {
    const h = lumBy.get(e.id);
    if (h?.status === "matched" && h.entity_id) { out.set(e.id, { entityId: String(h.entity_id), by: "id" }); continue; }
    const ids = [...new Set(placements.filter((p) => String(p.luminate_id || "") === e.id).map((p) => spotifyId(p.link, "track")).filter(Boolean).map((t) => `t:${t}`).filter((id) => byId.has(id)))];
    if (ids.length === 1) { out.set(e.id, { entityId: ids[0], by: "id" }); claimed.add(ids[0]); }
  }
  const on = new Map();
  for (const [id, m] of out) (on.get(m.entityId) || on.set(m.entityId, []).get(m.entityId)).push(id);
  for (const [ent, ids] of on) {
    const x = byId.get(ent);
    if (ids.length < 2 || !x) continue;
    const scored = ids.map((id) => ({ id, ...overlap(newest.get(id).artist, x.artist) })).sort((a, b) => b.jac - a.jac);
    if (scored[0].jac === scored[1].jac) continue; // can't tell them apart: both stay
    for (const s of scored.slice(1)) out.set(s.id, { entityId: null, by: "id", why: `its Spotify link is ${x.name} (${x.artist}), another Luminate song's` });
  }
  for (const e of trend.sort((a, b) => (b.days || 0) - (a.days || 0) || (b.atd || 0) - (a.atd || 0) || a.id.localeCompare(b.id))) {
    if (out.has(e.id) || lumBy.has(e.id) || sheetLum.has(e.id)) continue;
    const m = matchTrendSong(e, tracks, claimed);
    if (!m) continue;
    out.set(e.id, { entityId: m.main.id, by: "title", name: m.main.name, versions: m.versions.map((x) => x.id) });
    claimed.add(m.main.id); for (const x of m.versions) claimed.add(x.id);
  }
  return out;
}

// ---- the DB side
const newId = () => `tu${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
async function baseRows() {
  const [lum, placements, tracking, entities, links, clients] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT lum_id, list, area, kind, name, artist, placement_ids, entity_id, status, isrc, atd, atd_on::text AS atd_on FROM lum_history`),
    sql`SELECT id, client_id, song, artist, link, luminate_id FROM placements`,
    rowsOrNoneIfNoTable(sql`SELECT placement_id, isrc FROM song_tracking WHERE isrc <> ''`),
    rowsOrNoneIfNoTable(sql`SELECT id, name, artist, isrc, clients, origins, active FROM data_entities WHERE kind = 'track'`),
    rowsOrNoneIfNoTable(sql`SELECT entity_id, url FROM data_links WHERE platform = 'spotify'`),
    sql`SELECT id, name FROM clients`,
  ]);
  return { lum, placements, tracking, entities, links, clients };
}
export async function listRuns() {
  return (await rowsOrNoneIfNoTable(sql`SELECT id, files, export_on::text AS export_on, lum_ids, counts, applied_by, applied_at FROM trueup_runs ORDER BY applied_at DESC, id DESC`))
    .map((r) => ({ ...r, files: arr(r.files), lum_ids: arr(r.lum_ids), counts: typeof r.counts === "string" ? JSON.parse(r.counts) : r.counts || {}, applied_at: iso(r.applied_at) }));
}
// For the STREAM DATA writer: Map lum_id -> { total, on, ratio } (the newest point; the newest ratio any point had)
export async function trueUpInputs() {
  const [pts, ratios] = await Promise.all([
    rowsOrNoneIfNoTable(sql`SELECT DISTINCT ON (lum_id) lum_id, total, total_on::text AS total_on FROM trueup_points ORDER BY lum_id, total_on DESC, created_at DESC`),
    rowsOrNoneIfNoTable(sql`SELECT DISTINCT ON (lum_id) lum_id, ratio FROM trueup_points WHERE ratio IS NOT NULL ORDER BY lum_id, total_on DESC, created_at DESC`),
  ]);
  const r = new Map(ratios.map((x) => [x.lum_id, Number(x.ratio)]));
  return new Map(pts.map((x) => [x.lum_id, { total: Number(x.total), on: dayText(x.total_on), ratio: r.get(x.lum_id) ?? null }]));
}

// Reads the files and works out what Apply would do (nothing is written)
export async function previewTrueUp(files) {
  const parsed = (Array.isArray(files) ? files : []).slice(0, 12).map((f) => parseFile(String(f?.name || ""), String(f?.text || "")));
  const ok = parsed.filter((p) => !p.error), errors = parsed.filter((p) => p.error).map((p) => ({ fileName: p.fileName, error: p.error }));
  if (!ok.length) return { errors, plan: null, files: [] };
  const base = await baseRows();
  const [inputs, last] = await Promise.all([streamInputs(), trueUpInputs()]);
  // the sheet's estimate now, for each roster row in the files (the writer's own rule, so "from" is what it shows)
  const ids = new Set(ok.flatMap((f) => f.entities.map((e) => e.id)));
  const lumBy = new Map(base.lum.map((r) => [r.lum_id, r]));
  // (a Trend Report song new here has no number before: it isn't asked for, so it shows as new, not as 0)
  const sheetIds = new Set(base.placements.map((p) => String(p.luminate_id || "")).filter(Boolean));
  const had = [...ids].filter((id) => lumBy.has(id) || last.has(id) || sheetIds.has(id));
  const now = planStreamData({ rows: had.map((id) => [id, lumBy.get(id)?.name || "", "", last.get(id)?.total ?? lumBy.get(id)?.atd ?? 0, ""]), ...inputs, trueups: last, mode: "estimate" });
  const before = new Map(now.rows.map((r) => [r.id, { value: r.value, ratio: r.ratio, how: r.how }]));
  // the Spotify counts around the files' moments, for the songs matched to Spotify (a Trend Report song found by
  // its placement's link or its title too: a first pass of the plan says which)
  const first = planTrueUp({ parsed: ok, lum: base.lum, placements: base.placements, entities: base.entities, before, last });
  const ents = [...new Set([...[...ids].map((id) => lumBy.get(id)).filter((h) => h?.status === "matched" && h.entity_id).map((h) => h.entity_id), ...first.rows.map((r) => r.entityId).filter(Boolean)])];
  const times = ok.map((f) => Date.parse(f.exportedAt));
  const from = new Date(Math.min(...times) - (NEAR_DAYS + 1) * DAY).toISOString(), to = new Date(Math.max(...times) + (NEAR_DAYS + 1) * DAY).toISOString();
  const snaps = ents.length ? await sql`SELECT entity_id, value, taken_at FROM data_snapshots WHERE platform = 'spotify' AND metric = 'streams' AND value > 0
    AND entity_id = ANY(${ents}) AND taken_at BETWEEN ${from} AND ${to}` : [];
  const near = new Map();
  for (const s of snaps) (near.get(s.entity_id) || near.set(s.entity_id, []).get(s.entity_id)).push({ value: Number(s.value), taken_at: iso(s.taken_at) });
  const plan = planTrueUp({ parsed: ok, lum: base.lum, placements: base.placements, entities: base.entities, near, before, last });
  // the roster songs the files don't have: they keep their last number (Luminate leaves out a song with no plays)
  const songs = reportSongs(base);
  const left = notInReport(songs, new Set(plan.lumIds), plan.names, new Set(plan.entityIds));
  plan.notIn = { n: left.length, songs: left.slice(0, 40).map(slim) };
  // only a Worldwide Trend Report is applied: a US-only one would set every song to its US number
  const local = ok.find((f) => f.kind === "trend" && f.location !== "Worldwide");
  const blocked = local ? `"${local.fileName}" is ${local.location} only. The monthly update uses Worldwide numbers: in Luminate, set the Trend Report's Location to Worldwide and export it again.` : null;
  return { errors, plan, blocked, files: ok.map((f) => ({ name: f.fileName, portfolioId: f.portfolioId || null, kind: f.kind || "portfolio", location: f.location || null, from: f.from || null, through: f.through || null, list: f.list, exportedAt: f.exportedAt, rows: f.entities.length })) };
}

// Apply: the same plan, saved as one run. Returns { run, counts } or { error }.
export async function applyTrueUp(files, { by = "" } = {}) {
  const { errors, plan, files: used, blocked } = await previewTrueUp(files);
  if (!plan) return { error: errors[0]?.error || "Drop the Luminate files first.", errors };
  if (blocked) return { error: blocked, errors };
  if (!plan.fresh.length) return { error: plan.rows.length ? "These files are already applied: nothing new in them." : "Nothing in these files is a roster song here.", errors };
  const id = newId();
  const counts = { songs: plan.fresh.length, changed: plan.changed.length, ratios: plan.fresh.filter((r) => r.ratio).length, kept: plan.kept.length, same: plan.rows.length - plan.fresh.length, ar: plan.ar.length, unknown: plan.unknown.length, older: plan.older.length, unknownNames: plan.names.slice(0, 1000),
    // the Spotify songs the files covered (a Trend Report song found by title, its versions): "not in the report" uses them
    entities: plan.entityIds.slice(0, 3000), byTitle: plan.byTitle };
  await sql.transaction([
    sql`INSERT INTO trueup_runs (id, files, export_on, lum_ids, counts, applied_by) VALUES (${id}, ${JSON.stringify(used)}, ${plan.exportOn}, ${JSON.stringify(plan.lumIds)}, ${JSON.stringify(counts)}, ${String(by).slice(0, 120)})`,
    ...plan.fresh.map((r) => sql`INSERT INTO trueup_points (run_id, lum_id, entity_id, name, list, total, total_on, exported_at, spotify, spotify_at, ratio, old_ratio, before)
      VALUES (${id}, ${r.lumId}, ${r.entityId}, ${r.name}, ${r.list}, ${r.total}, ${r.on}, ${r.exportedAt}, ${r.spotify}, ${r.spotifyAt}, ${r.ratio}, ${r.oldRatio}, ${r.before})`),
  ]);
  return { run: { id, export_on: plan.exportOn, counts, applied_by: by }, counts, errors };
}

// The one Undo: the newest run only, and everything it wrote
export async function undoTrueUp(runId) {
  const [top] = await listRuns();
  if (!top) return { error: "There's no update to undo." };
  if (runId && top.id !== runId) return { error: "Only the newest update can be undone." };
  await sql.transaction([sql`DELETE FROM trueup_points WHERE run_id = ${top.id}`, sql`DELETE FROM trueup_runs WHERE id = ${top.id}`]);
  return { ok: true, undone: top.id };
}

// "Monthly Luminate update" is due from the 1st of each month until a file made that month is applied
export const dueOf = (latest, today) => !latest || !latest.export_on || latest.export_on < `${today.slice(0, 7)}-01`;

// Luminate's schedule: a series runs 12 weeks from the first true-up; a Founder can move the end day
// (e.g. after copying the report). The reminder shows from 11 weeks on.
export function scheduleOf(runs, saved, today) {
  const first = runs.length ? runs[runs.length - 1] : null;
  const start = saved?.from || (first ? nyDay(first.applied_at) : null);
  const ends = saved?.ends || (start ? addDays(start, SCHEDULE_WEEKS * 7) : null);
  if (!ends) return { ends: null, remind: false };
  const remindOn = addDays(ends, -(SCHEDULE_WEEKS - REMIND_WEEKS) * 7);
  return { ends, start, remindOn, remind: today >= remindOn, by: saved?.by || "", set: !!saved?.ends };
}
export async function setSchedule({ ends, copied = false, by = "", today = nyDay(Date.now()) }) {
  const day = copied ? addDays(today, SCHEDULE_WEEKS * 7) : String(ends || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return { error: "Pick the day Luminate's schedule ends." };
  const value = { ends: day, from: copied ? today : null, by: String(by).slice(0, 120), at: new Date().toISOString() };
  await setState("trueupSchedule", value);
  return { ok: true, ends: day };
}

// Everything the To do rows and the panel need (GET /api/trueup)
export async function trueUpState({ now = new Date() } = {}) {
  const base = await baseRows();
  const [runs, saved] = await Promise.all([listRuns(), getState("trueupSchedule").catch(() => null)]);
  const songs = reportSongs(base);
  const today = nyDay(now), month1 = `${today.slice(0, 7)}-01`;
  const latest = runs[0] || null;
  // the newest true-up's files, or before the first one, the Oct 29 portfolio exports (lum_history's rows)
  const inIds = new Set(latest ? latest.lum_ids : base.lum.filter((r) => r.kind !== "artist").map((r) => r.lum_id));
  const linked = new Set(songs.flatMap((s) => s.lumIds));
  // the file rows not linked to a roster song here, by title (a song added to a portfolio after it was linked)
  const inNames = latest ? arr(latest.counts?.unknownNames) : base.lum.filter((r) => r.kind !== "artist" && !linked.has(r.lum_id)).map((r) => r.name);
  const missing = notInReport(songs, inIds, inNames, new Set(latest ? arr(latest.counts?.entities) : [])).map(slim);
  const reports = splitReports(songs).map((r) => ({ ...r, songs: r.songs.map(slim) }));
  return {
    cap: REPORT_CAP, warn: REPORT_WARN, total: songs.length, reports,
    noIsrc: songs.filter((s) => !s.isrc).map(slim),
    notInReport: missing, baseline: latest ? { kind: "trueup", on: latest.export_on } : { kind: "portfolios", on: base.lum.map((r) => dayText(r.atd_on)).filter(Boolean).sort().pop() || null },
    due: dueOf(latest, today),
    month1, today,
    runs: runs.slice(0, 6).map((r) => ({ id: r.id, export_on: r.export_on, counts: { ...r.counts, unknownNames: undefined, entities: undefined }, applied_by: r.applied_by, applied_at: r.applied_at, files: r.files })),
    schedule: scheduleOf(runs, saved, today),
    linked: linked.size, note: TREND_REPORT_NOTE, notInWords: NOT_IN_REPORT,
  };
}
const slim = (s) => ({ key: s.key, title: s.title, artist: s.artist, client: s.client, isrc: s.isrc, spotify: s.spotify, placementIds: s.placementIds, from: s.from });
