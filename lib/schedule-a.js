// Schedule A (2026-11-20, the owner: "sync all of the songs from every producer to this [Schedule A sheet]. ignore the artists and get rid of the
// ones that are on there, only the producers, and make sure there's no duplicates. it should auto update just like the other pub sync sheet, maybe
// make it a bit better too. a continuous long running schedule A."). ONE tab, "Schedule A", of its own Google spreadsheet (SCHEDULE_A_SHEET_ID),
// written whole from the site: one row per producer and song, the producer's own share of it, sorted by producer and title.
//   Columns   A Writer (the client's name) · B Song Title · C Recording Artist(s) · D Writer's Pub Share (%) (a number, shown as 12.50%; blank when the
//             site has none) · E Release Date · F ISRC · G Spotify Link · H Status (the site's: "Split % not yet specified", "Assumed split, confirm" for a
//             song the auto-add put on the site that nobody has said OK to; blank otherwise) · I Notes (the owner's own: kept across syncs) · J Site ID
//             (the placement's id, hidden: what a note is found by next time)
//   Who       the clients that are on the roster with a role that says Producer ("Producer", "Producer / Artist"). Artists, and anyone off the roster, are
//             not on it. A song under two producers is a row for each (each one's own share), never a duplicate; the same song twice under ONE producer
//             (its Spotify track id, else its title and artist, once punctuation, case and emoji are left out) is one row: the one with a share, then the
//             one with more filled in, keeps its place, and takes what the others had that it lacked.
//   Share     the client's own split on the song, found exactly as the pub sheet's push finds it (lib/sheet-push.js, lib/auto-add.js writeRow, the
//             dashboard's ownSplit in components/site/data.jsx): lib/names.js findByName(splits, client.name).percent. No share (none under the client's
//             name, or 0) is blank.
//   Notes     kept by Site ID. The first sync, from the owner's old 5-column sheet (no Site ID column yet), finds a note by writer and title instead: the
//             writer as the site names the client (case and punctuation aside; "Yellow" is prodyel1ow), the title once punctuation and case are aside, and
//             one letter off for a title of 8 letters or more ("Hellen Keller" is "Helen Keller"). A song the old sheet has twice is one row with both notes.
//   Not lost  a row of the sheet that no site song matches (a song the site doesn't have, a writer the site doesn't know) is not dropped: it is kept under a
//             separator row, "Only on this sheet (not on the site yet)", as it was (writer, title, artist, share, notes), Status "Not on the site". A row
//             someone types by hand later (no Site ID) is kept there the same way, and moves up into the table, its note with it, once the site has the
//             song. Text typed in a row with no writer and no title (a remark under the table) is kept there too, cell for cell. Rows of a writer who is an
//             Artist client are removed, and not kept: the sheet is for producers. Rows are removed too when the site no longer has the song (its Site ID is
//             gone) or when two of them are the same song; but a removed row's NOTE is kept by Site ID (app_state "scheduleA:notes", the newest 300) and
//             comes back with the row if it returns (a producer back on the roster, a song moved back).
//   Header    the columns are found by their HEADER NAME, never by their place: row 1 must be exactly the ten headers (any order: the table is written back in the
//             order above, the notes found by Site ID) or exactly the owner's old five (Writer, Song Title, Recording Artist(s) / Writer(s), Client Publishing
//             Share (%), Notes, with F1:J1 blank); anything else (a column deleted, one added inside A:J, a header renamed) writes nothing and says "the header row
//             changed". A tab that reads empty after the site has synced it before is refused too (a read gone wrong must not wipe the notes).
//   Footer    "TOTAL SONGS: N" (every song row, the table's and the kept ones) and "Updated by the site: <New York date and time>".
// Calls to Google: ONE read of the tab (A1:J, unformatted), then, only when something differs from what is there, ONE write: the whole table, padded with blank
// rows down to the longer of what was read and what is written, so there is no second call that could cut a newer table short; the first sync (and one that
// finds the header changed) also formats: the header dark and bold, the first row frozen, Site ID hidden, D as a percent, a filter on the table, column widths
// (one read of the tab list, one batchUpdate). A sync that changes nothing costs the one read and leaves the footer's time as it was.
// Runs: the daily cron's last step (after the auto-add, so a song it added is on the sheet), a staff save that changed songs or clients (marked
// app_state "scheduleA".dirtyAt, then run at most once every 2 minutes; a save inside the 2 minutes is caught by the Sync check or the nightly run),
// Site › Sync's "Sync Schedule A now" (pages/api/schedule-a.js), and the Sync check itself when a change is waiting or the last run failed. ONE run at a time,
// whoever asks: every run takes the claim "scheduleA:lock" (a 2-minute lease, given back when the run is over, a late run included) and one that loses it
// answers { busy } (the nightly run and the button then mark the change as waiting, for the Sync check to catch up).
// Off with no SCHEDULE_A_SHEET_ID (nothing is read or written, no error); SCHEDULE_A_WRITES=off stops every write (a dry run, GET /api/schedule-a, still
// reads the sheet). Nothing here throws out of a cron or a save: an answer is { ok, … }, { off }, { skipped }, { busy } or { error }. Server-only.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getSheetsClient, listTabs, withSheetsDeadline, sheetsDeadline } from "./sheets";
import { claimState, getState, setState } from "./app-state";
import { findByName, personKey, edits } from "./names";
import { spotifyTrack } from "./duplicates";
import { artistsOf } from "./splits";

export const TAB = "Schedule A";
export const KEY = "scheduleA";                 // app_state: { lastSyncAt, rows, producers, onlyOnSheet, lastError?, layoutDone, dirtyAt?, sheetId? }
export const RUN_KEY = "scheduleA:run";         // the gap: a run that comes by itself (a save, the Sync check) at most once in RUN_MIN minutes; the cron and the button only mark it
export const LOCK_KEY = "scheduleA:lock";       // one run at a time, whoever asks: every run takes it for LEASE_MIN minutes and gives it back when it is over
export const STASH_KEY = "scheduleA:notes";     // the notes of rows that left the table, by Site ID: { [id]: { note, writer, title, at } }, the newest STASH_MAX
export const RUN_MIN = 2, LEASE_MIN = 2, STASH_MAX = 300;
export const SAVE_BUDGET_MS = 6000;             // a run started by a save is held to this (its waits for Google's quota too); it goes on by itself after the save is answered
export const SAVE_WAIT_MS = 2000;               // a save waits for it no longer than this
const MIN_BUDGET_MS = 3000;                     // a run isn't started with less time than this left
export const HEADERS = ["Writer", "Song Title", "Recording Artist(s)", "Writer's Pub Share (%)", "Release Date", "ISRC", "Spotify Link", "Status", "Notes", "Site ID"];
// (2026-11-21, the owner: "make the clients pub share writers pub share") a header the sheet may still have under its earlier name reads as the new one;
// the next write puts the new name in row 1
export const HEADER_ALIASES = { "Client Publishing Share (%)": "Writer's Pub Share (%)" };
export const SEPARATOR = "Only on this sheet (not on the site yet)";
export const STATUS = { none: "Split % not yet specified", assumed: "Assumed split, confirm", manual: "Not on the site" };
// the old sheet's names for a writer that the site spells another way (by personKey of what the sheet says -> the client's name)
export const WRITER_ALIASES = { yellow: "prodyel1ow" };
const COLS = HEADERS.length;
const FOOTER_RE = /^(TOTAL SONGS\b|Updated by the site\b)/i;
const UPDATED = "Updated by the site: ";

// ---------------------------------------------------------------- switches
const off = (v) => /^(off|false|0|no)$/i.test(String(v ?? "").trim());
// The owner's Schedule A Google Sheet (converted from the .xlsx "Defied Schedule A (Updated)" on 2026-11-20); SCHEDULE_A_SHEET_ID overrides it,
// and SCHEDULE_A_SHEET_ID=none turns the sync off
export const SCHEDULE_A_DEFAULT_ID = "1u7oRZlJMbPDUI9G7TMYBQYs6EJz9YuqugWa2OAUsXPc";
export const scheduleAId = () => { const v = String(process.env.SCHEDULE_A_SHEET_ID || "").trim(); return v === "none" ? "" : v || SCHEDULE_A_DEFAULT_ID; };
const oldNote = (t) => (/^split\s*%?\s*not yet specified\.?$/i.test(t.trim()) ? "" : t);
export const scheduleAOn = () => !!scheduleAId();
// writes default to on once the sheet is named; SCHEDULE_A_WRITES=off is the kill switch
export const scheduleAWritesOn = () => scheduleAOn() && !off(process.env.SCHEDULE_A_WRITES);
export const scheduleAUrl = () => (scheduleAOn() ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(scheduleAId())}/edit` : null);
const NOT_SET = "SCHEDULE_A_SHEET_ID isn't set";
const WRITES_OFF = "SCHEDULE_A_WRITES is off";

// ---------------------------------------------------------------- small pure helpers
const str = (v) => String(v ?? "").trim();
const plain = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
// a title as two songs are compared on: lowercase, accents, punctuation, emoji and spaces left out (letters and digits of any alphabet stay)
export const titleKey = (s) => plain(s).replace(/[^\p{L}\p{N}]+/gu, "");
// a song's artists as one key, whatever order they were typed in ("A, B" and "B & A" are the same line)
export const artistKey = (line) => artistsOf(line).map(personKey).filter(Boolean).sort().join("|");
const cleanIsrc = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const arr = (v) => (Array.isArray(v) ? v : typeof v === "string" ? (() => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } })() : []);
const isProducer = (c) => !!(c?.on_roster ?? c?.onRoster) && /producer/i.test(c?.role || "");
const isArtistOnly = (c) => /artist/i.test(c?.role || "") && !/producer/i.test(c?.role || "");
const order = (c) => Number(c?.roster_order ?? c?.rosterOrder) || 0;
const byProducer = (a, b) => order(a) - order(b) || String(a.name || "").toLowerCase().localeCompare(String(b.name || "").toLowerCase(), "en") || String(a.id).localeCompare(String(b.id));
const bySong = (a, b) => String(a.song || "").toLowerCase().localeCompare(String(b.song || "").toLowerCase(), "en") || String(a.siteId).localeCompare(String(b.siteId));
// the notes of one song as one cell: each different note once, in the order found
export const mergeNotes = (list) => {
  const seen = new Set(), out = [];
  for (const n of list || []) { const t = str(n), k = t.toLowerCase(); if (t && !seen.has(k)) { seen.add(k); out.push(t); } }
  return out.join(" | ");
};
// a release date as the sheet shows it: YYYY-MM-DD (a time after it is cut off); a year or a month alone (Spotify gives those for old releases) stays as it is; anything else is blank
const releaseText = (v) => {
  const t = str(v);
  return /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(t) ? t.slice(0, 10) : /^\d{4}(?:-\d{2})?$/.test(t) ? t : "";
};
// the link as the sheet shows it: a Spotify track as its plain link (no ?si= and no intl- part), any other web link as typed
const linkText = (v) => {
  const t = str(v), id = spotifyTrack(t);
  return id ? `https://open.spotify.com/track/${id}` : /^https?:\/\//i.test(t) ? t : "";
};
// the share as the cell holds it: a fraction with no floating-point tail (33.3 is 0.333, a third is 0.333333)
const fraction = (percent) => Math.round(percent * 10000) / 1000000;
const quote = (title) => `'${String(title).replace(/'/g, "''")}'`;
const nyStamp = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d).replace(/\u202f/g, " ");
const nyWhen = (d) => new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " ");
const s = (n, one, many) => (n === 1 ? one : many);

// The client's own share of a song, in percent: the split under the client's name, the way the pub sheet's push finds it
// (lib/sheet-push.js: findByName(saved.splits, owner.name); lib/auto-add.js writeRow: findByName(saved.splits, c.name).percent;
// components/site/data.jsx ownSplit). null when there's none, or it isn't above 0.
export function ownShare(p, client) {
  const own = client?.name ? findByName(arr(p?.splits), client.name) : null;
  const n = Number(own?.percent);
  return own && Number.isFinite(n) && n > 0 ? n : null;
}

// The ids of the songs the auto-add put on the site that nobody has said OK to: app_state "autoAdded" is { [Spotify track id]: { placementId, checked?,
// pending? } } (lib/auto-added.js); an array of those entries is as good. A pending one is still an assumed split.
const uncheckedIds = (autoAdded) => {
  const entries = Array.isArray(autoAdded) ? autoAdded : autoAdded && typeof autoAdded === "object" ? Object.values(autoAdded) : [];
  return new Set(entries.filter((e) => e && typeof e === "object" && e.placementId && e.checked !== true).map((e) => String(e.placementId)));
};

// ---------------------------------------------------------------- the site's rows (pure)
// One producer's candidates -> one row per song. A group is a Spotify track, or (no link) a title and artist; a card with no link joins the one track that
// has its title and artist. Within a group the card with a share wins, then the one with more filled in (then the lower id), and takes what it lacks from the rest.
const dataScore = (r) => [r.artist, r.releaseDate, r.link, r.isrc].filter(Boolean).length;
const better = (a, b) => Number(b.share != null) - Number(a.share != null) || dataScore(b) - dataScore(a) || String(a.siteId).localeCompare(String(b.siteId));
function dedupe(rows) {
  const nameOf = (r) => `${titleKey(r.song)}|${artistKey(r.artist)}`;
  const linked = new Map(), loose = new Map(), groups = [];
  for (const r of rows) {
    if (!r.track) continue;
    let g = linked.get(r.track);
    if (!g) { g = { rows: [], names: new Set() }; linked.set(r.track, g); groups.push(g); }
    g.rows.push(r); g.names.add(nameOf(r));
  }
  for (const r of rows) {
    if (r.track) continue;
    const k = nameOf(r), hits = [...linked.values()].filter((g) => g.names.has(k));
    let g = hits.length === 1 ? hits[0] : loose.get(k);
    if (!g) { g = { rows: [], names: new Set([k]) }; loose.set(k, g); groups.push(g); }
    g.rows.push(r);
  }
  const kept = [], dropped = [];
  for (const g of groups) {
    const [win, ...rest] = [...g.rows].sort(better);
    for (const f of ["artist", "releaseDate", "link", "isrc"]) if (!win[f]) win[f] = rest.map((r) => r[f]).find(Boolean) || "";
    win.alsoIds = rest.map((r) => r.siteId);
    for (const r of rest) dropped.push({ kept: win.siteId, dropped: r.siteId, song: r.song });
    kept.push(win);
  }
  return { kept, dropped };
}

// { rows, producers: [{ id, name, songs }], dropped: [{ kept, dropped, song }] }. clients: every client (the DB's rows: id, name, role, on_roster, roster_order);
// placements: the DB's rows (id, client_id, song, artist, release_date, link, splits); isrcOf(placementId, placement) -> the ISRC or ""; autoAdded: app_state
// "autoAdded". A row: { siteId, clientId, writer, song, artist, share (percent or null), releaseDate, isrc, link, status, alsoIds }, sorted by producer
// (roster order, then name) and title, both ignoring case.
export function scheduleAPlan({ clients = [], placements = [], isrcOf = () => "", autoAdded = null } = {}) {
  const producers = clients.filter(isProducer).sort(byProducer);
  const rank = new Map(producers.map((c, i) => [c.id, i]));
  const unchecked = uncheckedIds(autoAdded);
  const by = new Map();
  for (const p of placements || []) {
    const c = producers[rank.get(p.client_id ?? p.clientId)];
    if (!c) continue;
    const share = ownShare(p, c);
    const row = {
      siteId: String(p.id), clientId: c.id, writer: str(c.name), song: str(p.song), artist: str(p.artist), share,
      releaseDate: releaseText(p.release_date ?? p.releaseDate), isrc: cleanIsrc(isrcOf(p.id, p)), link: linkText(p.link), track: spotifyTrack(p.link),
      status: share == null ? STATUS.none : unchecked.has(String(p.id)) ? STATUS.assumed : "", alsoIds: [],
    };
    by.set(c.id, [...(by.get(c.id) || []), row]);
  }
  const rows = [], dropped = [];
  for (const list of by.values()) {
    const d = dedupe(list);
    rows.push(...d.kept);
    dropped.push(...d.dropped);
  }
  rows.sort((a, b) => rank.get(a.clientId) - rank.get(b.clientId) || bySong(a, b));
  for (const r of rows) delete r.track;
  const counts = new Map();
  for (const r of rows) counts.set(r.clientId, (counts.get(r.clientId) || 0) + 1);
  return { rows, producers: producers.filter((c) => counts.has(c.id)).map((c) => ({ id: c.id, name: str(c.name), songs: counts.get(c.id) })), dropped };
}
export const scheduleARows = (args) => scheduleAPlan(args).rows;

// ---------------------------------------------------------------- the sheet as it is (pure)
// What row 1 says the tab is. The columns are found by their HEADER NAME, never by their place (a column the owner deleted or moved must not make a note be read from
// another one): "new" is exactly the ten headers (HEADERS), once each, in any order (idx: where each one is; canonical: they are in HEADERS' order); "old" is exactly the
// owner's five (OLD_HEADERS) with F1:J1 blank; "blank" is no header at all; anything else is "unknown". Case and spaces don't count.
const hk = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const KEYS = ["writer", "title", "artist", "share", "release", "isrc", "link", "status", "note", "siteId"]; // HEADERS' order
export const OLD_HEADERS = ["Writer", "Song Title", "Recording Artist(s) / Writer(s)", "Client Publishing Share (%)", "Notes"];
export function readHeader(cells) {
  const alias = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([a, b]) => [hk(a), hk(b)]));
  const raw = Array.from({ length: COLS }, (_, i) => hk(cells?.[i]));
  const names = raw.map((n) => alias[n] || n);
  const filled = names.filter(Boolean);
  if (!filled.length) return { layout: "blank" };
  const at = HEADERS.map((h) => names.indexOf(hk(h)));
  if (filled.length === COLS && at.every((i) => i >= 0)) return { layout: "new", idx: Object.fromEntries(KEYS.map((k, j) => [k, at[j]])), canonical: at.every((i, j) => i === j) };
  if (OLD_HEADERS.every((h, i) => raw[i] === hk(h)) && raw.slice(OLD_HEADERS.length).every((n) => !n)) return { layout: "old", idx: { writer: 0, title: 1, artist: 2, share: 3, note: 4 }, canonical: false };
  return { layout: "unknown" };
}
const headerChanged = (header) => `Nothing was written: the header row changed. Row 1 of the ${TAB} tab has to read ${HEADERS.join(", ")} (any order), or the old five columns (${OLD_HEADERS.join(", ")}). It reads: ${header.filter(Boolean).join(" | ") || "nothing"}.`;

// values: the tab's A1:J, unformatted. layout: "new", "old" (readHeader), "empty" (nothing there at all) or "unknown" (a header that isn't either: nothing is written over it; so is an old sheet
// with text in F:J under its blank headers, which the site's write would cover: `problem` says where). rows: every
// song row (the footer, the separator and the blank rows are left out): { row, writer, title, artist, share (as the cell had it), note, siteId, release, isrc, link }; a row with a Site ID
// and no writer or title is still a row (its note is found by the Site ID). extra: a row with text in it and no writer, no title and no Site ID (a remark typed under the table), cell
// for cell as it was ({ row, artist, share, release, isrc, link, status, note }; the site's own Status words aren't text of the owner's); so is the text next to a footer or the separator.
export function parseSheet(values) {
  const rows = Array.isArray(values) ? values : [];
  const at = (r, i) => (r && r[i] != null ? r[i] : "");
  const cells = Array.from({ length: COLS }, (_, i) => at(rows[0], i));
  const out = { layout: "empty", header: cells.map(str), idx: null, canonical: false, rows: [], extra: [], problem: "" };
  if (!rows.some((r) => (r || []).some((c) => str(c) !== ""))) return out;
  const h = readHeader(cells);
  if (h.layout === "blank" || h.layout === "unknown") return { ...out, layout: "unknown" };
  const { idx } = h, get = (r, k) => (idx[k] == null ? "" : at(r, idx[k]));
  const generated = (v) => Object.values(STATUS).some((w) => str(v).toLowerCase() === w.toLowerCase());
  rows.slice(1).forEach((r, i) => {
    const a = str(get(r, "writer")), b = str(get(r, "title")), siteId = str(get(r, "siteId"));
    // (the old sheet's stock note is not the owner's text; and the Site ID is what makes a row a song's, whatever its title says)
    const own = { artist: get(r, "artist"), share: get(r, "share"), release: get(r, "release"), isrc: get(r, "isrc"), link: get(r, "link"), status: generated(get(r, "status")) ? "" : get(r, "status"), note: h.layout === "old" ? oldNote(str(get(r, "note"))) : get(r, "note") };
    const text = Object.values(own).some((v) => str(v) !== "");
    // the total, the time and the separator are the site's own rows; what the owner typed beside them (in a sheet the site wrote: the old sheet's total row has its own cells) is theirs
    if (!siteId && (FOOTER_RE.test(a) || FOOTER_RE.test(b) || a === SEPARATOR)) { if (text && h.layout === "new") out.extra.push({ row: i + 2, ...own }); return; }
    if (!a && !b && !siteId) { if (text) out.extra.push({ row: i + 2, ...own }); return; }
    if (!a && !b && !text) return; // (a Site ID alone: nothing to carry)
    out.rows.push({ row: i + 2, writer: a, title: b, artist: str(own.artist), share: own.share, note: h.layout === "old" ? oldNote(str(own.note)) : str(own.note), siteId, release: str(own.release), isrc: str(own.isrc), link: str(own.link) });
  });
  // the old sheet has five columns: text under the blank headers of F:J would be written over by the first sync, so it stops there, saying where
  if (h.layout === "old") {
    const stray = [];
    rows.slice(1).forEach((r, i) => { for (let j = OLD_HEADERS.length; j < COLS; j++) if (str(at(r, j)) !== "") stray.push(`${"ABCDEFGHIJ"[j]}${i + 2}`); });
    if (stray.length) return { ...out, layout: "unknown", problem: `Nothing was written: the old sheet has text in ${stray.slice(0, 4).join(", ")}${stray.length > 4 ? ` and ${stray.length - 4} more cells` : ""} (columns F to J, under blank headers), which the site writes over. Move or clear it, then sync again.` };
  }
  return { ...out, layout: h.layout, idx, canonical: h.canonical };
}

// the client a writer cell names: a producer first, then any client; by name, then the sheet tab name, then the credit; then the known aliases
export function writerClient(clients, name) {
  const w = str(name);
  if (!w) return null;
  const pools = [clients.filter(isProducer), clients];
  for (const pool of pools) for (const nameOf of [(c) => c.name, (c) => c.sheet_tab_name, (c) => c.credit]) { const hit = findByName(pool, w, nameOf); if (hit) return hit; }
  const alias = WRITER_ALIASES[personKey(w)];
  if (alias) for (const pool of pools) { const hit = findByName(pool, alias); if (hit) return hit; }
  // (2026-11-20, the real sheet's dry run) the old sheet writes "Stacke" for Stack!e: personKey reads "!" between letters as an i ("stackie"), so
  // last, every letter and digit only, with the "!" simply dropped, and only when it names exactly one client
  const loose = (s) => String(s ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const lw = loose(w);
  if (lw) for (const pool of pools) {
    const hits = pool.filter((c) => [c.name, c.sheet_tab_name, c.credit].some((n) => n && loose(n) === lw));
    if (hits.length === 1) return hits[0];
  }
  return null;
}
// the site row (of one client's) an old or hand-typed row is: the same title (when two share it, the one with the same artists, else none: a blank artist is
// the same as a blank artist), else the one title a letter off, for titles of 8 letters or more
function matchRow(old, candidates) {
  const tk = titleKey(old.title);
  if (!tk) return null;
  let hits = candidates.filter((r) => titleKey(r.song) === tk);
  if (hits.length > 1) {
    const ak = artistKey(old.artist), same = hits.filter((r) => artistKey(r.artist) === ak);
    hits = same.length === 1 ? same : [];
  } else if (!hits.length && tk.length >= 8) {
    hits = candidates.filter((r) => { const k = titleKey(r.song); return k.length >= 8 && edits(k, tk) === 1; });
  }
  return hits.length === 1 ? hits[0] : null;
}
// a share cell read as a fraction: a number as it is (above 1: a percent typed as a number), "25.00%" or "25" as text; anything else stays as it was
function shareCell(v) {
  if (v === "" || v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? (v > 1 ? fraction(v) : v) : "";
  const t = str(v), n = Number(t.replace(/%$/, "").trim());
  if (!t) return "";
  if (!Number.isFinite(n)) return t;
  return /%$/.test(t) || n > 1 ? fraction(n) : n;
}
const hasShare = (v) => typeof v === "number" ? v > 0 : str(v) !== "";

// The notes kept for rows that left the table, as app_state STASH_KEY holds them: { [Site ID]: { note, writer, title, at } }; anything else in it is dropped, the newest STASH_MAX stay
// and a note is cut at 2,000 characters
const NOTE_MAX = 2000;
export function cleanStash(v) {
  const entries = v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v) : [];
  return Object.fromEntries(entries.filter(([id, e]) => id && e && typeof e === "object" && typeof e.note === "string" && e.note.trim())
    .sort((a, b) => String(b[1].at || "").localeCompare(String(a[1].at || "")) || a[0].localeCompare(b[0])).slice(0, STASH_MAX)
    .map(([id, e]) => [id, { note: e.note.slice(0, NOTE_MAX), writer: str(e.writer), title: str(e.title), at: String(e.at || "") }]));
}

// What the tab should say now: the site's rows with the notes the sheet had (and the ones kept for rows that came back), the rows only the sheet has, the text typed outside the
// table, and the footer. plan: scheduleAPlan's; read: parseSheet's; clients: every client; now: a Date; stash: cleanStash's (what is kept from earlier).
// -> { grid, rows, manual, other, summary, stash: { add: { [Site ID]: entry } (notes of rows that left the table this time), restore: [Site ID] (kept notes that came back) } }
export function buildSheet({ plan, read, clients = [], now = new Date(), stash = {} }) {
  const site = plan.rows.map((r) => ({ ...r }));
  const byId = new Map(site.map((r) => [r.siteId, r]));
  const winnerOf = new Map(site.flatMap((r) => r.alsoIds.map((id) => [id, r.siteId])));
  const byClient = new Map();
  for (const r of site) byClient.set(r.clientId, [...(byClient.get(r.clientId) || []), r]);
  const notes = new Map(), onSheet = new Set(), claims = new Map(), left = new Map();
  const note = (id, text) => notes.set(id, [...(notes.get(id) || []), text]);
  const summary = { rows: site.length, producers: plan.producers.length, added: 0, removed: 0, removedArtistRows: 0, duplicatesOnSite: plan.dropped.length, duplicatesOnSheet: 0, onlyOnSheet: 0, notesCarried: 0, notesStashed: 0, notesRestored: 0, otherText: 0, migrated: read.layout === "old" };
  const loose = [];
  for (const r of read.rows) {
    if (r.siteId) {
      const id = byId.has(r.siteId) ? r.siteId : winnerOf.get(r.siteId);
      if (id) { note(id, r.note); onSheet.add(id); } else {
        // the site no longer has this song (a producer off the roster, a role changed, a song moved): the row goes, its note is kept by Site ID for the day the row is back
        summary.removed++;
        if (r.note) left.set(r.siteId, { notes: [...(left.get(r.siteId)?.notes || []), r.note], writer: r.writer, title: r.title });
      }
      continue;
    }
    const c = writerClient(clients, r.writer);
    if (c && isArtistOnly(c)) { summary.removedArtistRows++; continue; }
    const hit = c && isProducer(c) ? matchRow(r, byClient.get(c.id) || []) : null;
    if (hit) {
      note(hit.siteId, r.note); onSheet.add(hit.siteId);
      claims.set(hit.siteId, (claims.get(hit.siteId) || 0) + 1);
    } else loose.push(r);
  }
  for (const n of claims.values()) if (n > 1) summary.duplicatesOnSheet += n - 1;
  // the rows only the sheet has: one per writer and title, the one with a share (then more filled in) keeping its place, the notes together
  const manual = [], seen = new Map();
  for (const r of loose) {
    const k = `${personKey(r.writer)}|${titleKey(r.title)}`;
    const m = { writer: r.writer, title: r.title, artist: r.artist, share: shareCell(r.share), release: r.release, isrc: r.isrc, link: r.link, notes: [r.note] };
    const prior = seen.get(k);
    if (!prior || !titleKey(r.title)) { seen.set(k, m); manual.push(m); continue; }
    summary.duplicatesOnSheet++;
    prior.notes.push(r.note);
    const filled = (x) => [x.artist, x.release, x.isrc, x.link].filter(Boolean).length + (hasShare(x.share) ? 10 : 0);
    if (filled(m) > filled(prior)) Object.assign(prior, { artist: m.artist, share: m.share, release: m.release, isrc: m.isrc, link: m.link });
  }
  summary.onlyOnSheet = manual.length;
  const restore = [];
  for (const r of site) {
    // a note kept from when this row left the table comes back with it (after the one the sheet has, if it has one)
    const kept = stash[r.siteId];
    if (kept?.note) { note(r.siteId, kept.note); restore.push(r.siteId); summary.notesRestored++; }
    r.notes = mergeNotes(notes.get(r.siteId));
    if (r.notes) summary.notesCarried++;
    if (!onSheet.has(r.siteId)) summary.added++;
  }
  const add = Object.fromEntries([...left].map(([id, v]) => [id, { note: mergeNotes(v.notes).slice(0, NOTE_MAX), writer: v.writer, title: v.title, at: new Date(now).toISOString() }]));
  summary.notesStashed = Object.keys(add).length;
  // text typed outside the table (no writer, no title): kept cell for cell, under the separator, after the songs; it is not a song, so it isn't counted as one
  const other = read.extra.map((x) => ({ ...x }));
  summary.otherText = other.length;
  const blank = () => Array(COLS).fill("");
  const grid = [HEADERS.slice()];
  for (const r of site) grid.push([r.writer, r.song, r.artist, r.share == null ? "" : fraction(r.share), r.releaseDate, r.isrc, r.link, r.status, r.notes, r.siteId]);
  if (manual.length || other.length) {
    grid.push(blank(), Object.assign(blank(), { 0: SEPARATOR }));
    for (const m of manual) grid.push([m.writer, m.title, m.artist, m.share, m.release, m.isrc, m.link, STATUS.manual, mergeNotes(m.notes), ""]);
    for (const x of other) grid.push(["", "", x.artist, x.share, x.release, x.isrc, x.link, x.status, x.note, ""]);
  }
  grid.push(blank(), Object.assign(blank(), { 0: `TOTAL SONGS: ${site.length + manual.length}` }), Object.assign(blank(), { 0: `${UPDATED}${nyStamp(now)}` }));
  return { grid, rows: site, manual: manual.map((m) => ({ ...m, notes: mergeNotes(m.notes) })), other, summary, stash: { add, restore } };
}

// whether the tab already says this (the footer's time aside): every cell of every row, numbers to nine places, text trimmed
const norm = (v) => (typeof v === "number" ? Math.round(v * 1e9) / 1e9 : str(v));
export function sameSheet(values, grid) {
  const read = Array.isArray(values) ? values : [];
  if (read.length !== grid.length) return false;
  for (let i = 0; i < grid.length; i++) {
    const a = Array.from({ length: COLS }, (_, j) => norm(read[i]?.[j] ?? "")), b = Array.from({ length: COLS }, (_, j) => norm(grid[i][j] ?? ""));
    if (str(grid[i][0]).startsWith(UPDATED)) { if (!str(a[0]).startsWith(UPDATED)) return false; continue; }
    if (a.some((x, j) => x !== b[j])) return false;
  }
  return true;
}

// ---------------------------------------------------------------- the sheet's looks (once)
// sheetId: the tab's. Header row dark and bold, the first row frozen, Site ID hidden, D a percent with two decimals, a filter over the table (no end row: it
// grows with the sheet), and column widths. Applied once (app_state layoutDone), and again when the columns found on the sheet aren't in the order written
// (the owner moved some: unhide, so no column stays hidden where another one is now).
export function formatRequests(sheetId, { unhide = false } = {}) {
  const range = (o) => ({ sheetId, ...o });
  const width = [170, 260, 240, 160, 110, 130, 300, 190, 300];
  return [
    { repeatCell: { range: range({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: COLS }),
      cell: { userEnteredFormat: { backgroundColor: { red: 0.1, green: 0.11, blue: 0.13 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" } },
      fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)" } },
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: range({ startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }), cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.00%" } } }, fields: "userEnteredFormat.numberFormat" } },
    ...width.map((pixelSize, i) => ({ updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }), properties: { pixelSize }, fields: "pixelSize" } })),
    ...(unhide ? [{ updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: 0, endIndex: 9 }), properties: { hiddenByUser: false }, fields: "hiddenByUser" } }] : []),
    { updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: 9, endIndex: 10 }), properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
    { setBasicFilter: { filter: { range: range({ startRowIndex: 0, startColumnIndex: 0, endColumnIndex: COLS }) } } },
  ];
}

// ---------------------------------------------------------------- state
const patchState = (patch) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(patch)}, now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
// a change was saved since the last sync started (lastSyncAt is the moment that run began, so a save during a run is still waiting)
export const dirtyOf = (st) => !!st?.dirtyAt && (!st.lastSyncAt || Date.parse(st.dirtyAt) > Date.parse(st.lastSyncAt));
export const needsSync = (st) => dirtyOf(st) || !!st?.lastError;
export async function scheduleAState() { return (await getState(KEY).catch(() => null)) || {}; }

// ---------------------------------------------------------------- the sync
const denied = (err) => [err?.status, err?.code, err?.response?.status].some((x) => Number(x) === 403);
const quota = (err) => [err?.status, err?.code, err?.response?.status].some((x) => Number(x) === 429) || /quota exceeded|resource has been exhausted/i.test(String(err?.message || ""));
// a thrown error as a sentence anyone may read
function words(err) {
  if (err?.plain) return String(err.message).slice(0, 500); // (its own words; a header row read back into one is cut)
  const who = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "").trim();
  if (denied(err)) return `The dashboard's Google account${who ? ` (${who})` : ""} can't edit the Schedule A sheet. Share it with that account as Editor.`;
  if (quota(err)) return "Google Sheets was busy: too many requests in one minute. It tries again.";
  if ([err?.status, err?.code].some((x) => Number(x) === 404)) return "The Schedule A sheet wasn't found. Check SCHEDULE_A_SHEET_ID.";
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 300);
}
const plainError = (message) => Object.assign(new Error(message), { plain: true });

// every client, the songs of the producers, each song's ISRC (the song's own record, else the Spotify catalog's for its track) and the auto-added songs
async function loadSite() {
  const [clients, all, tracking, autoAdded] = await Promise.all([
    sql`SELECT id, name, credit, role, sheet_tab_name, on_roster, roster_order FROM clients`,
    sql`SELECT id, client_id, song, artist, release_date, link, splits FROM placements`,
    rowsOrNoneIfNoTable(sql`SELECT placement_id, isrc FROM song_tracking WHERE isrc <> ''`),
    getState("autoAdded"),
  ]);
  const mine = new Set(clients.filter(isProducer).map((c) => c.id));
  const placements = all.filter((p) => mine.has(p.client_id));
  const ids = [...new Set(placements.map((p) => spotifyTrack(p.link)).filter(Boolean))].map((t) => `t:${t}`);
  const entities = ids.length ? await rowsOrNoneIfNoTable(sql`SELECT id, isrc FROM data_entities WHERE kind = 'track' AND isrc <> '' AND id = ANY(${ids})`) : [];
  const own = new Map(tracking.map((t) => [t.placement_id, cleanIsrc(t.isrc)]));
  const cat = new Map(entities.map((e) => [String(e.id).slice(2), cleanIsrc(e.isrc)]));
  return { clients, placements, autoAdded, isrcOf: (id, p) => own.get(id) || cat.get(spotifyTrack(p?.link)) || "" };
}

// the tab's values: A1:J as the cells hold them. A tab that isn't called "Schedule A" is looked for by name (another case), else said
async function readTab(sheets, spreadsheetId) {
  const get = (title) => sheets.spreadsheets.values.get({ spreadsheetId, range: `${quote(title)}!A1:J`, valueRenderOption: "UNFORMATTED_VALUE" });
  try { return { title: TAB, values: (await get(TAB)).data.values || [] }; } catch (err) {
    if (!/unable to parse range/i.test(String(err?.message || ""))) throw err;
    const tabs = await listTabs(sheets, spreadsheetId);
    const hit = tabs.find((t) => t.title.trim().toLowerCase() === TAB.toLowerCase());
    if (!hit) throw plainError(`The sheet has no tab called "${TAB}"${tabs.length ? ` (it has ${tabs.map((t) => `"${t.title}"`).join(", ")})` : ""}, so nothing was written.`);
    return { title: hit.title, values: (await get(hit.title)).data.values || [], sheetId: hit.sheetId };
  }
}
// a tab too small for the table (a sheet has 1,000 rows to begin with): rows and columns added, once, by what the table needs
async function growTab(sheets, spreadsheetId, title, rows) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const p = (res.data.sheets || []).map((x) => x.properties).find((x) => x.title === title);
  if (!p) throw plainError(`The sheet has no tab called "${title}".`);
  const requests = [];
  const rowCount = p.gridProperties?.rowCount || 0, columnCount = p.gridProperties?.columnCount || 0;
  if (rowCount < rows) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: "ROWS", length: rows - rowCount + 200 } });
  if (columnCount < COLS) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: "COLUMNS", length: COLS - columnCount } });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// The notes kept for rows that left the table (app_state STASH_KEY): saved whole, pruned to the newest STASH_MAX
const saveStash = (stash) => setState(STASH_KEY, cleanStash(stash));

// The sync. { now, dryRun }: dryRun plans and reads (one read of the tab) and writes nothing, here or in the database.
// -> { ok: true, at, rows, producers, onlyOnSheet, summary, changed, wrote: { values, formatted, blanked } } (blanked: the blank rows that wipe what is left of a longer
// sheet, in the same write), { ok: true, dryRun: true, …, planned }, { off }, or { error }. It never throws. It doesn't take the run lock: runScheduleA does.
export async function syncScheduleA({ now = new Date(), dryRun = false } = {}) {
  const at = Number.isFinite(new Date(now).getTime()) ? new Date(now) : new Date();
  let spreadsheetId = "";
  try {
    if (!scheduleAOn()) return { off: NOT_SET };
    if (!dryRun && !scheduleAWritesOn()) return { off: WRITES_OFF };
    spreadsheetId = scheduleAId();
    const [site, prior, stashed] = await Promise.all([loadSite(), scheduleAState(), getState(STASH_KEY)]);
    const plan = scheduleAPlan(site);
    const sheets = getSheetsClient();
    const tab = await readTab(sheets, spreadsheetId);
    const read = parseSheet(tab.values);
    // a header that isn't the ten (any order) or the owner's old five: a column deleted or one added inside A:J, a header renamed. Nothing is written over it, and no note is read from a place
    // it isn't in
    if (read.layout === "unknown") throw plainError(read.problem || headerChanged(read.header));
    // a tab that reads empty after the site has synced it is more likely a read that went wrong than a wish: writing it would make a table with none of the notes
    if (read.layout === "empty" && (prior.lastSyncAt || Number(prior.rows) > 0)) {
      throw plainError(`The ${TAB} tab reads empty, but the site has synced it before, so nothing was written (a read that went wrong would wipe the notes). If you emptied it on purpose, type the ten headers back into row 1 (${HEADERS.join(", ")}) and sync again.`);
    }
    // an empty site is not a reason to empty the sheet: it is more likely a read that went wrong
    if (!plan.rows.length && read.rows.length) throw plainError("The site has no producer songs just now, so Schedule A was left as it is.");
    const kept = cleanStash(stashed);
    const built = buildSheet({ plan, read, clients: site.clients, now: at, stash: kept });
    const same = sameSheet(tab.values, built.grid);
    const styled = !!prior.layoutDone && read.layout === "new" && read.canonical;
    const result = {
      ok: true, at: at.toISOString(), rows: built.rows.length, producers: plan.producers.length, onlyOnSheet: built.manual.length, summary: built.summary,
      changed: !same, wrote: { values: false, formatted: false, blanked: 0 },
    };
    if (dryRun) return { ...result, dryRun: true, wouldFormat: !styled, planned: [...built.rows, ...built.manual.map((m) => ({ ...m, status: STATUS.manual }))] };
    if (!same) {
      // the notes of the rows this write takes off are kept FIRST: a note is never only in a write that may have gone wrong
      const stash = { ...kept, ...built.stash.add };
      if (Object.keys(built.stash.add).length) await saveStash(stash);
      // ONE write: the table, then blank rows down to what was read, so what is left of a longer sheet is wiped by the very same call (a second call, a clear, could cut short a table
      // a later run had written)
      const blanked = Math.max(0, tab.values.length - built.grid.length);
      const out = blanked ? [...built.grid, ...Array.from({ length: blanked }, () => Array(COLS).fill(""))] : built.grid;
      const write = () => sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `${quote(tab.title)}!A1`, values: out }] } });
      try { await write(); } catch (err) {
        if (!/exceeds grid limits/i.test(String(err?.message || ""))) throw err;
        await growTab(sheets, spreadsheetId, tab.title, out.length);
        await write();
      }
      result.wrote.values = true; result.wrote.blanked = blanked;
      // the notes that came back with their rows are on the sheet now: they leave the keeping
      if (built.stash.restore.length) await saveStash(Object.fromEntries(Object.entries(stash).filter(([id]) => !built.stash.restore.includes(id))));
    }
    let layout = { layoutDone: styled };
    if (!styled) {
      const sheetId = tab.sheetId ?? (await listTabs(sheets, spreadsheetId)).find((t) => t.title === tab.title)?.sheetId;
      if (sheetId == null) throw plainError(`The sheet has no tab called "${tab.title}".`);
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: formatRequests(sheetId, { unhide: read.layout === "new" }) } });
      result.wrote.formatted = true;
      layout = { layoutDone: true, sheetId };
    }
    await patchState({ lastSyncAt: at.toISOString(), rows: result.rows, producers: result.producers, onlyOnSheet: result.onlyOnSheet, lastError: null, lastErrorAt: null, ...layout,
      summary: { added: built.summary.added, removed: built.summary.removed, removedArtistRows: built.summary.removedArtistRows, duplicatesDropped: built.summary.duplicatesOnSite + built.summary.duplicatesOnSheet }, ...(result.changed ? { changedAt: at.toISOString() } : {}) });
    return result;
  } catch (err) {
    console.error("schedule a:", err?.message || err); // (the message only: a Google error object carries the request)
    const error = words(err);
    if (!dryRun && spreadsheetId) await patchState({ lastError: error, lastErrorAt: at.toISOString() }).catch((e) => console.error("schedule a: the error wasn't saved:", e?.message || e));
    return { error };
  }
}

// ---------------------------------------------------------------- when it runs
// the work's answer, or `late` if it takes longer than ms (the work goes on by itself after that)
function within(ms, work, late) {
  let timer;
  return Promise.race([work, new Promise((resolve) => { timer = setTimeout(() => resolve(late), ms); })]).finally(() => clearTimeout(timer));
}
// the lock given back: only when it is still this run's (the token it was claimed with)
const releaseLock = (token) => sql`DELETE FROM app_state WHERE key = ${LOCK_KEY} AND value ->> 'token' = ${token}`;
// The promise's answer, or null once ms are up (it goes on by itself); it never rejects. What a save waits with (SAVE_WAIT_MS).
export function settleWithin(promise, ms) {
  let timer;
  return Promise.race([Promise.resolve(promise).catch(() => null), new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })]).finally(() => clearTimeout(timer));
}
// A run with a time limit and two claims (a dry run, which only reads, takes none):
//  - the gap, for the runs that come by themselves: minutes RUN_MIN (a save, the Sync check) runs only when no run began in the last RUN_MIN minutes; minutes 0 (the nightly run, the
//    button) always goes on and only marks the time, so a save just after it isn't run again within RUN_MIN;
//  - the lock, for every run: one at a time (a LEASE_MIN lease, given back when the run is over: a late run, one that went on after its answer, holds it to its end; each run
//    gives back only its own claim, so one that outlived its lease can't take away the lock of the run that came after it). A run that loses it answers { busy }; the nightly
//    run and the button then mark the change as waiting (dirtyAt), for the Sync check to catch up.
// Waits for Google's quota are held to the limit too (withSheetsDeadline), and to the deadline of whoever called, when there is one (the daily cron's 45 seconds). Never throws.
export async function runScheduleA({ source = "", budgetMs = 15000, minutes = 0, now = new Date(), dryRun = false } = {}) {
  try {
    if (!scheduleAOn()) return { off: NOT_SET };
    if (!dryRun && !scheduleAWritesOn()) return { off: WRITES_OFF };
    if (budgetMs < MIN_BUDGET_MS) return { skipped: "not enough time left for it" };
    const claim = { at: new Date().toISOString(), by: source || "a run" }, token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (!dryRun) {
      if (!(await claimState(RUN_KEY, minutes, claim))) return { skipped: `it ran in the last ${RUN_MIN} minutes` };
      if (!(await claimState(LOCK_KEY, LEASE_MIN, { ...claim, token }))) {
        if (!minutes) await patchState({ dirtyAt: new Date().toISOString() }).catch((err) => console.error("schedule a: the waiting change wasn't marked:", err?.message || err));
        return { busy: true };
      }
      // a run that comes by itself marked its change before it began (a save, the Sync check); the nightly run and the button mark theirs now, with the time the run is for: a run
      // that finishes saves that same time as lastSyncAt, so nothing is waiting; one that is cut short (the function ended, a late run killed) leaves it waiting for the Sync check
      if (!minutes) await patchState({ dirtyAt: new Date(now).toISOString() }).catch((err) => console.error("schedule a: the run wasn't marked:", err?.message || err));
    }
    const until = Math.min(Date.now() + budgetMs, sheetsDeadline() ?? Infinity);
    const work = withSheetsDeadline(until, () => syncScheduleA({ now, dryRun })).finally(() => (dryRun ? null : releaseLock(token).catch((err) => console.error("schedule a: the lock wasn't given back:", err?.message || err))));
    return await within(budgetMs, work, { late: true, skipped: "still running; it carries on by itself" });
  } catch (err) {
    console.error("schedule a run:", err?.message || err);
    return { error: String(err?.message || err).slice(0, 300) };
  }
}

// After a staff or client save that changed songs or clients: the change is marked, and the sync runs unless one began in the last 2 minutes (the Sync check
// or the nightly run picks up the change then). The run is held to SAVE_BUDGET_MS; the save itself waits for it SAVE_WAIT_MS at the most (settleWithin, in
// pages/api/dashboard-data.js) and a run that is slower goes on by itself, the change being marked. Never throws: the save is already stored.
export async function scheduleAAfterSave({ now = new Date(), budgetMs = SAVE_BUDGET_MS } = {}) {
  try {
    if (!scheduleAWritesOn()) return { off: scheduleAOn() ? WRITES_OFF : NOT_SET };
    await patchState({ dirtyAt: new Date(now).toISOString() });
    return await runScheduleA({ source: "a save", budgetMs, minutes: RUN_MIN, now });
  } catch (err) {
    console.error("schedule a after a save:", err?.message || err);
    return { error: String(err?.message || err).slice(0, 300) };
  }
}

// whether a staff save's clients changed anything the sheet shows: one added, a name, the roster, or the order (the save's list is in roster order, so a
// client's index is its roster_order; an account limited to its own artists sends only theirs and can't reorder: ordered false). A client taken out takes
// its songs with it, and that save changes songs. prior: the stored clients (id, name, on_roster, roster_order); sent: the clients the save carried
export function clientsTouchSchedule(prior, sent, { ordered = true } = {}) {
  if (!Array.isArray(prior) || !Array.isArray(sent)) return false;
  const was = new Map(prior.map((c) => [c.id, c]));
  return sent.some((c, i) => {
    const w = was.get(c.id);
    return !w || str(w.name) !== str(c.name) || !!w.on_roster !== !!c.onRoster || (ordered && Number(w.roster_order) !== i);
  });
}

// ---------------------------------------------------------------- Site › Sync
// The check's line, from the state (no Google call). ok: true synced, null not set up / off / not run yet / the nightly run is late, false the last sync failed
export function scheduleALine(st = {}, { now = Date.now() } = {}) {
  const url = scheduleAUrl();
  const sheet = url ? { also: { kind: "url", label: "Open the sheet ↗", url }, url } : {};
  if (!scheduleAOn()) return { id: "scheduleA", ok: null, text: `Schedule A isn't set up yet (${NOT_SET}).` };
  if (!scheduleAWritesOn()) return { id: "scheduleA", ok: null, text: `Schedule A: writing to the sheet is switched off (SCHEDULE_A_WRITES).`, ...sheet };
  const fix = { kind: "scheduleA", label: "Sync Schedule A now" };
  const when = st.lastSyncAt ? nyWhen(st.lastSyncAt) : "";
  if (st.lastError) {
    return { id: "scheduleA", ok: false, text: `Schedule A: the last sync failed: ${String(st.lastError).replace(/[.\s]+$/, "")}.${when ? ` It last synced ${when}.` : ""}`, fix, ...sheet };
  }
  if (!st.lastSyncAt) return { id: "scheduleA", ok: null, text: "Schedule A hasn't been synced yet. Press Sync Schedule A now, or it runs with tonight's update.", fix, ...sheet };
  const rows = Number(st.rows) || 0, producers = Number(st.producers) || 0, only = Number(st.onlyOnSheet) || 0;
  const detail = only ? `${only} ${s(only, "song is", "songs are")} only on the sheet (not on the site yet): add ${s(only, "it", "them")} on the site and ${s(only, "it joins", "they join")} the table.` : undefined;
  if (now - Date.parse(st.lastSyncAt) > 36 * 3600000) {
    return { id: "scheduleA", ok: null, text: `Schedule A: last synced ${when}. The nightly update hasn't synced it since.`, ...(detail ? { detail } : {}), fix, ...sheet };
  }
  const line = `Schedule A: synced ${when} · ${rows} ${s(rows, "song", "songs")} from ${producers} ${s(producers, "producer", "producers")}${only ? ` · ${only} only on this sheet` : ""}.`;
  return { id: "scheduleA", ok: true, text: dirtyOf(st) ? `${line} A change since then is on its way.` : line, ...(detail ? { detail } : {}), fix, ...sheet };
}
// The Sync check: the line, after a catch-up run when a change is waiting or the last run failed (at most every 2 minutes, with the others' claims). A first sync that
// nobody has run isn't started here (the button, a save or the nightly run does that). Never throws.
export async function scheduleACheck({ now = Date.now() } = {}) {
  if (!scheduleAOn()) return scheduleALine({}, { now });
  try {
    let st = await scheduleAState();
    if (scheduleAWritesOn() && needsSync(st)) {
      const r = await runScheduleA({ source: "the sync check", budgetMs: 20000, minutes: RUN_MIN, now: new Date(now) });
      if (!r.skipped && !r.off && !r.busy) st = await scheduleAState();
    }
    return scheduleALine(st, { now });
  } catch (err) {
    console.error("sync: schedule a", err?.message || err);
    return { id: "scheduleA", ok: null, text: "Couldn't check Schedule A just now." };
  }
}
// the route's GET: where it stands, and what a sync would do (a dry run: one read of the sheet)
export async function scheduleAStatus() {
  const on = scheduleAOn();
  const out = { on, writes: scheduleAWritesOn(), url: scheduleAUrl(), last: on ? await scheduleAState() : null };
  if (on) {
    const r = await runScheduleA({ dryRun: true, budgetMs: 40000 });
    out.preview = r.ok ? { rows: r.rows, producers: r.producers, onlyOnSheet: r.onlyOnSheet, changed: r.changed, wouldFormat: r.wouldFormat, summary: r.summary } : { error: r.error || r.skipped || r.off };
  }
  return out;
}
