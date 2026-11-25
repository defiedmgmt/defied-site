// Schedule A (2026-11-20, the owner: "sync all of the songs from every producer to this [Schedule A sheet]. ignore the artists and get rid of the
// ones that are on there, only the producers, and make sure there's no duplicates. it should auto update just like the other pub sync sheet, maybe
// make it a bit better too. a continuous long running schedule A."). ONE tab, "Schedule A", of its own Google spreadsheet (SCHEDULE_A_SHEET_ID),
// written whole from the site: one row per producer and song, the producer's own share of it, sorted by producer and title.
//   Columns   A Writer (the client's name) · B Song Title · C Recording Artist(s) · D Writer's Pub Share (%) (a number, shown as 12.50%; blank when the
//             site has none) · E Release Date · F ISRC · G Spotify Link · H Notes (2026-11-24, the owner: Status and Notes as one column: the site's status
//             words first, then the owner's own note, joined by " · ": "Assumed split, confirm · ask Len"; the words alone, the note alone, or blank) · I Site
//             ID (the placement's id, hidden: what a note is found by next time). J is left blank (see Header).
//   Status    the words in H are the site's own, made again from the site on every sync (STATUS): "Split % not yet specified" (no share), "Assumed split,
//             confirm" (a song the auto-add put on the site that nobody has said OK to), "Not on the site" (a row under the separator). Read back, the owner's
//             note is the cell less those words at its very start (the whole phrase, any case, any spaces) and the " · " after them (ownerNote); words that
//             aren't followed by " · " or the end of the cell ("Assumed split, confirmed by Len"), a phrase in the middle of the cell, and a cell of the
//             owner's alone are kept whole. Deleting the words by hand is harmless: the next sync writes them again.
//   Before    (until 2026-11-24) ten columns: H Status (the site's words) and I Notes (the owner's) apart, J Site ID. A sync that reads those ten headers (any
//             order) takes them as they are and writes the nine: the owner's note is the Notes cell, then any Status text that isn't the site's own words
//             (the code always kept that as the owner's), merged by mergeNotes; notes are found by Site ID as always. (A sheet of the nine with "Status"
//             typed back into J1 is the ten again, and is written as the nine again the same way: whatever is in J is the site's words, dropped, or the
//             owner's, kept in Notes; a leading phrase of the site's in a Notes cell is never taken as the owner's, so the words aren't doubled.) The same single write blanks column J
//             (the old Site IDs) down to the last row read, and the looks are done again (LAYOUT): Site ID (I) hidden, J shown at the default width with
//             its header cell plain again, the filter on A:I. The separator, the rows only on the sheet and the footer are written in the nine columns too.
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
//             separator row, "Only on this sheet (not on the site yet)", as it was (writer, title, artist, share, notes), its Notes saying "Not on the site". A row
//             someone types by hand later (no Site ID) is kept there the same way, and moves up into the table, its note with it, once the site has the
//             song. Text typed in a row with no writer and no title (a remark under the table) is kept there too, cell for cell. Rows of a writer who is an
//             Artist client are removed, and not kept: the sheet is for producers. Rows are removed too when the site no longer has the song (its Site ID is
//             gone) or when two of them are the same song; but a removed row's NOTE is kept by Site ID (app_state "scheduleA:notes", the newest 300) and
//             comes back with the row if it returns (a producer back on the roster, a song moved back).
//   Header    the columns are found by their HEADER NAME, never by their place: row 1 must be exactly the nine headers in A1:I1 with J1 blank (any order: the
//             table is written back in the order above, the notes found by Site ID), or exactly the ten of before in A1:J1 (any order; read once, then the nine
//             are written), or exactly the owner's old five (Writer, Song Title, Recording Artist(s) / Writer(s), Client Publishing Share (%), Notes, with F1:J1
//             blank); anything else (a column deleted, one added inside A:I, a header renamed, a header typed in J1) writes nothing and says "the header row
//             changed". A tab that reads empty after the site has synced it before is refused too (a read gone wrong must not wipe the notes). Column K and on
//             are the owner's, never read or written; so is text under a blank J1 (the nine columns' write never reaches J).
//   Footer    "TOTAL SONGS: N" (every song row, the table's and the kept ones) and "Updated by the site: <New York date and time>".
// Calls to Google: ONE read of the tab (A1:J, unformatted), then, only when something differs from what is there, ONE write: the whole table, padded with blank
// rows down to the longer of what was read and what is written, so there is no second call that could cut a newer table short (a read of the ten columns of
// before is always written, ten cells wide, J blank); the first sync (and one that finds the header changed, or a layout older than LAYOUT) also formats:
// the header dark and bold, the first row frozen, Site ID hidden, D as a percent, a filter on the table, column widths (one read of the tab list, one
// batchUpdate). A sync that changes nothing costs the one read and leaves the footer's time as it was.
//   Merges    (2026-11-25) Google keeps only the top-left cell of merged cells, so a value written under the rest of a merge is dropped (the live tab's A149:C149
//             hid a song's title and artist, and the read could never match the table, so every sync wrote it all again). A write that fills a cell that reads
//             empty (the only kind a merge can hide: Google reads the cells under a merge's top-left one as empty) first reads the tab's merges (one
//             spreadsheets.get, which also gives the tab's id for the looks) and unmerges, whole, in one batchUpdate just before the values go in, every merge
//             that would hide something the write puts in (hidingMerges). A merge that hides nothing the site writes (over blank cells, in K and on, below the
//             table) is left as it is. Neither step can stop the write: if either fails, the values are written as before.
// EMPIRE copy (2026-11-24): a second, separate spreadsheet, "Defied Schedule A — EMPIRE" (SCHEDULE_A_EMPIRE_SHEET_ID, else SCHEDULE_A_EMPIRE_DEFAULT_ID;
// "none" turns it off), written right after the main sheet by every sync that isn't a dry run, whole: its tab's values are cleared and written again in ONE
// batchUpdate (it carries no notes, nothing on it is anyone's to keep), with its looks in the same call. Calls: the tab list, one read of the tab, the batchUpdate.
//   Rows      the main table's rows of the songs with MORE THAN 1,000,000 streams (exactly 1,000,000 is not; a song with no streams is not), in the same order,
//             one per writer; no "Only on this sheet" row (the site has no streams for those). Columns A to G as the main sheet's, H Streams (a whole number,
//             shown 1,234,567). No Notes and no Site ID: the owner's notes are not for the label.
//   Left out  (2026-11-25, the owner: "for the EMPIRE one need to get rid of any with uncleared samples") a song with an uncleared sample is not in the copy at all,
//             whatever its streams: a song is out when ANY of its Schedule A rows (one per writer, the "Only on this sheet" ones too) has an owner's note in the
//             owner's wording for it (unclearedSample: "Uncleared sample: …", "un-cleared sample", "sample not cleared", "sample (not cleared)", "samples uncleared";
//             not "sample cleared", "cleared sample", "sample clearance done", "no uncleared samples"). The note is the one this same sync carries (the owner's, the
//             site's status words taken off: buildSheet's rows), so a note typed on the sheet counts from the next sync, and one deleted puts the song back. The
//             same song: rows that share a Catalog song (the same Spotify track, or title and artist), an ISRC, or a title and artists (unclearedRows). The copy
//             itself never says why a song isn't on it, and its TOTAL counts only the songs on it; Site › Sync's EMPIRE line (Founders only) says how many were
//             left out ("· 9 left out (uncleared sample)").
//   Streams   exactly the number Roster › Catalog shows for the song (lib/roster-catalog.js catalogRows over every client's songs: the biggest placements.streams
//             among the song's copies, the same Spotify track or the same title and artist, never a sum; placements.streams is the song's lifetime count from
//             Luminate, as the pub sheet pull and the monthly true-up bring it in). A row the dedupe made of several cards takes the biggest of their songs'.
//   Footer    "TOTAL SONGS: N" (N different songs, "(R rows: one per writer)" after it when a song has two Defied producers), "Streams: as shown on the Defied
//             site (Luminate), as of <day>" (lib/streams-on.js streamsOn: the day the site's streams are from, the day Catalog's "Streams as of" says; when the
//             site has none: "synced <the sync's New York day>"), and "Updated by the site: <time>".
//   Tab       the tab called "Schedule A" (any case), else the spreadsheet's first tab, renamed "Schedule A" in the same call. It is written only when it reads
//             empty or its row 1 starts Writer, Song Title (a wrong id must not wipe someone else's sheet), never when the id is the main sheet's own, and not with
//             no songs at all when it had some (a read gone wrong).
//   Failing   the main sheet goes first and counts as synced whatever the copy does: a copy that couldn't be written (not shared with the site's Google account,
//             not found, Google busy) is said in plain words in the answer (empire.error) and the state ("scheduleA".empire, with the last good write kept), and
//             is tried again by the next sync. A main sync that fails doesn't write the copy. A dry run writes neither and says how many rows and songs the copy
//             would have. The nightly run's alert tells a copy that couldn't be written (lib/alerts.js dailyFailures, in neutral words: "the 1M+ streams copy").
//   Who sees  only a Founder with Money and every artist, the EMPIRE deal pages' own gate (seesEmpire; the deal is confidential): Site › Sync's EMPIRE line, the
//             route's state, preview and answer. Anyone else sees nothing of the copy on the site.
// Runs: the daily cron's last step (after the auto-add, so a song it added is on the sheet), "OK" on To do's auto-added songs (2026-11-24: the status words go; pages/api/songs.js
// autoChecked), a staff save that changed songs or clients (marked
// app_state "scheduleA".dirtyAt, then run at most once every 2 minutes; a save inside the 2 minutes is caught by the Sync check or the nightly run),
// Site › Sync's "Sync Schedule A now" (pages/api/schedule-a.js), and the Sync check itself when a change is waiting or the last run failed. ONE run at a time,
// whoever asks: every run takes the claim "scheduleA:lock" (a 2-minute lease, given back when the run is over, a late run included) and one that loses it
// answers { busy } (the nightly run and the button then mark the change as waiting, for the Sync check to catch up).
// Off with no SCHEDULE_A_SHEET_ID (nothing is read or written, no error); SCHEDULE_A_WRITES=off stops every write, the EMPIRE copy's too (a dry run, GET
// /api/schedule-a, still reads the main sheet). Nothing here throws out of a cron or a save: an answer is { ok, … }, { off }, { skipped }, { busy } or { error }.
// The sync's state (app_state) can be kept elsewhere for one run (syncScheduleA's `store`): a run against a test copy of the sheet writes nothing to the
// database that way. Server-only.
import { sql, rowsOrNoneIfNoTable } from "./db";
import { getSheetsClient, listTabs, withSheetsDeadline, sheetsDeadline } from "./sheets";
import { claimState, getState, setState } from "./app-state";
import { findByName, personKey, edits } from "./names";
import { spotifyTrack } from "./duplicates";
import { artistsOf } from "./splits";
import { catalogRows } from "./roster-catalog";
import { streamsOn } from "./streams-on";
// Site › Sync's times: New York's clock wherever this runs (lib/ny-time.js)
import { nyWhen } from "./ny-time";

export const TAB = "Schedule A";
export const KEY = "scheduleA";                 // app_state: { lastSyncAt, rows, producers, onlyOnSheet, lastError?, layoutDone, dirtyAt?, sheetId?, empire? }
export const RUN_KEY = "scheduleA:run";         // the gap: a run that comes by itself (a save, the Sync check) at most once in RUN_MIN minutes; the cron and the button only mark it
export const LOCK_KEY = "scheduleA:lock";       // one run at a time, whoever asks: every run takes it for LEASE_MIN minutes and gives it back when it is over
export const STASH_KEY = "scheduleA:notes";     // the notes of rows that left the table, by Site ID: { [id]: { note, writer, title, at } }, the newest STASH_MAX
export const RUN_MIN = 2, LEASE_MIN = 2, STASH_MAX = 300;
export const SAVE_BUDGET_MS = 6000;             // a run started by a save is held to this (its waits for Google's quota too); it goes on by itself after the save is answered
export const SAVE_WAIT_MS = 2000;               // a save waits for it no longer than this
const MIN_BUDGET_MS = 3000;                     // a run isn't started with less time than this left
export const HEADERS = ["Writer", "Song Title", "Recording Artist(s)", "Writer's Pub Share (%)", "Release Date", "ISRC", "Spotify Link", "Notes", "Site ID"];
// the ten columns of before 2026-11-24 (Status and Notes apart, Site ID in J): read once, the next write is in HEADERS
export const TEN_HEADERS = ["Writer", "Song Title", "Recording Artist(s)", "Writer's Pub Share (%)", "Release Date", "ISRC", "Spotify Link", "Status", "Notes", "Site ID"];
// (2026-11-21, the owner: "make the clients pub share writers pub share") a header the sheet may still have under its earlier name reads as the new one;
// the next write puts the new name in row 1
export const HEADER_ALIASES = { "Client Publishing Share (%)": "Writer's Pub Share (%)" };
export const SEPARATOR = "Only on this sheet (not on the site yet)";
export const STATUS = { none: "Split % not yet specified", assumed: "Assumed split, confirm", manual: "Not on the site" };
export const NOTE_JOIN = " · ";                 // between the site's status words and the owner's note, in the one Notes cell
// the old sheet's names for a writer that the site spells another way (by personKey of what the sheet says -> the client's name)
export const WRITER_ALIASES = { yellow: "prodyel1ow" };
const COLS = HEADERS.length;                    // 9: A:I, what is written
const READ_COLS = TEN_HEADERS.length;           // 10: A:J, what is read (the ten of before, and a header typed in J1, are seen)
// the looks of the layout (app_state "scheduleA".layoutDone): a sheet formatted for an earlier one (true: the ten columns) is formatted again, once
export const LAYOUT = 2;
// The EMPIRE copy: only the songs over EMPIRE_MIN streams (strictly more), these columns, no notes and no Site ID
export const EMPIRE_HEADERS = ["Writer", "Song Title", "Recording Artist(s)", "Writer's Pub Share (%)", "Release Date", "ISRC", "Spotify Link", "Streams"];
export const EMPIRE_MIN = 1000000;
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
// The EMPIRE copy, "Defied Schedule A — EMPIRE" (2026-11-24): SCHEDULE_A_EMPIRE_SHEET_ID overrides it, SCHEDULE_A_EMPIRE_SHEET_ID=none turns it off. It is
// written only by a sync of the main sheet (so never with Schedule A off), and SCHEDULE_A_WRITES=off stops it too
export const SCHEDULE_A_EMPIRE_DEFAULT_ID = "1-kuN3-CMqKBJzdUxN7Q7HKDuRt-4LyK4dngNHlTBDJk";
export const empireId = () => { const v = String(process.env.SCHEDULE_A_EMPIRE_SHEET_ID || "").trim(); return v === "none" ? "" : v || SCHEDULE_A_EMPIRE_DEFAULT_ID; };
export const empireOn = () => scheduleAOn() && !!empireId();
export const empireUrl = () => (empireOn() ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(empireId())}/edit` : null);

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
// (2026-11-24) the one Notes cell: the site's status words first, then the owner's note, " · " between; either alone; or blank
export const notesCell = (status, note) => [str(status), str(note)].filter(Boolean).join(NOTE_JOIN);
// ...and the owner's note read back from it: the cell less a status phrase of the site's at its very start (the whole phrase, any case, any spaces in it)
// and the " · " after it. Words not followed by " · " or the end of the cell, a phrase anywhere else, and a cell that doesn't start with one are kept whole.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LEADING_STATUS = Object.values(STATUS).map((w) => new RegExp(`^\\s*${escapeRe(w).replace(/\s+/g, "\\s+")}\\s*(?:·\\s*|$)`, "i"));
export function ownerNote(cell) {
  const t = str(cell);
  for (const re of LEADING_STATUS) { const m = re.exec(t); if (m) return t.slice(m[0].length).trim(); }
  return t;
}
// whether a cell is exactly one of the site's status phrases (case and spaces aside): the old Status column's own words, not the owner's
const isStatusWords = (v) => { const t = str(v).replace(/\s+/g, " ").toLowerCase(); return !!t && Object.values(STATUS).some((w) => w.toLowerCase() === t); };
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
// another one): "new" is exactly the nine headers (HEADERS), once each, in any order, in A1:I1, with J1 blank (idx: where each one is; canonical: they are in HEADERS'
// order); "ten" is exactly the ten of before (TEN_HEADERS), once each, in any order, in A1:J1; "old" is exactly the owner's five (OLD_HEADERS) with F1:J1 blank;
// "blank" is no header at all; anything else (a header in J1 beside the nine, a blank one among them, one twice, one renamed) is "unknown". Case and spaces don't count.
const hk = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const LAYOUTS = [
  { layout: "new", headers: HEADERS, keys: ["writer", "title", "artist", "share", "release", "isrc", "link", "note", "siteId"] },
  { layout: "ten", headers: TEN_HEADERS, keys: ["writer", "title", "artist", "share", "release", "isrc", "link", "status", "note", "siteId"] },
];
export const OLD_HEADERS = ["Writer", "Song Title", "Recording Artist(s) / Writer(s)", "Client Publishing Share (%)", "Notes"];
export function readHeader(cells) {
  const alias = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([a, b]) => [hk(a), hk(b)]));
  const raw = Array.from({ length: READ_COLS }, (_, i) => hk(cells?.[i]));
  const names = raw.map((n) => alias[n] || n);
  if (!names.some(Boolean)) return { layout: "blank" };
  for (const L of LAYOUTS) {
    const n = L.headers.length, head = names.slice(0, n), at = L.headers.map((h) => head.indexOf(hk(h)));
    if (head.every(Boolean) && names.slice(n).every((x) => !x) && at.every((i) => i >= 0)) return { layout: L.layout, idx: Object.fromEntries(L.keys.map((k, j) => [k, at[j]])), canonical: at.every((i, j) => i === j) };
  }
  if (OLD_HEADERS.every((h, i) => raw[i] === hk(h)) && raw.slice(OLD_HEADERS.length).every((n) => !n)) return { layout: "old", idx: { writer: 0, title: 1, artist: 2, share: 3, note: 4 }, canonical: false };
  return { layout: "unknown" };
}
const headerChanged = (header) => `Nothing was written: the header row changed. Row 1 of the ${TAB} tab has to read ${HEADERS.join(", ")} (any order, in A to I, with J1 blank), or the old five columns (${OLD_HEADERS.join(", ")}). It reads: ${header.filter(Boolean).join(" | ") || "nothing"}.`;

// values: the tab's A1:J, unformatted. layout: "new", "ten", "old" (readHeader), "empty" (nothing there at all) or "unknown" (a header that isn't one of them: nothing is written over it;
// so is an old sheet with text in F:J under its blank headers, which the site's write would cover: `problem` says where). rows: every song row (the footer, the separator and the
// blank rows are left out): { row, writer, title, artist, share (as the cell had it), note, siteId, release, isrc, link }; note is the OWNER's text only: "new", the Notes cell less
// the site's status words at its start (ownerNote); "ten", the Notes cell (less such words too: a sheet of the nine with "Status" typed back into J1 reads as the ten, and its
// Notes cells carry the words) and then the Status cell when that isn't the site's own words (mergeNotes); "old", the note less the old sheet's stock words. A row with a Site ID and no writer or title is still a row (its note is found by the Site ID). extra: a row with text in it and no writer, no title and no
// Site ID (a remark typed under the table), cell for cell as it was ({ row, artist, share, release, isrc, link, note }, note as for the rows: the site's own words alone aren't the
// owner's text); so is the text next to a footer or the separator.
export function parseSheet(values) {
  const rows = Array.isArray(values) ? values : [];
  const at = (r, i) => (r && r[i] != null ? r[i] : "");
  const cells = Array.from({ length: READ_COLS }, (_, i) => at(rows[0], i));
  const out = { layout: "empty", header: cells.map(str), idx: null, canonical: false, rows: [], extra: [], problem: "" };
  if (!rows.some((r) => (r || []).some((c) => str(c) !== ""))) return out;
  const h = readHeader(cells);
  if (h.layout === "blank" || h.layout === "unknown") return { ...out, layout: "unknown" };
  const { idx } = h, get = (r, k) => (idx[k] == null ? "" : at(r, idx[k]));
  const noteOf = (r) => (h.layout === "new" ? ownerNote(get(r, "note"))
    : h.layout === "ten" ? mergeNotes([ownerNote(get(r, "note")), isStatusWords(get(r, "status")) ? "" : get(r, "status")])
    : oldNote(str(get(r, "note"))));
  rows.slice(1).forEach((r, i) => {
    const a = str(get(r, "writer")), b = str(get(r, "title")), siteId = str(get(r, "siteId"));
    // (the site's own status words and the old sheet's stock note are not the owner's text; and the Site ID is what makes a row a song's, whatever its title says)
    const own = { artist: get(r, "artist"), share: get(r, "share"), release: get(r, "release"), isrc: get(r, "isrc"), link: get(r, "link"), note: noteOf(r) };
    const text = Object.values(own).some((v) => str(v) !== "");
    // the total, the time and the separator are the site's own rows; what the owner typed beside them (in a sheet the site wrote: the old sheet's total row has its own cells) is theirs
    if (!siteId && (FOOTER_RE.test(a) || FOOTER_RE.test(b) || a === SEPARATOR)) { if (text && h.layout !== "old") out.extra.push({ row: i + 2, ...own }); return; }
    if (!a && !b && !siteId) { if (text) out.extra.push({ row: i + 2, ...own }); return; }
    if (!a && !b && !text) return; // (a Site ID alone: nothing to carry)
    out.rows.push({ row: i + 2, writer: a, title: b, artist: str(own.artist), share: own.share, note: str(own.note), siteId, release: str(own.release), isrc: str(own.isrc), link: str(own.link) });
  });
  // the old sheet has five columns: text under the blank headers of F:J would be written over by the first sync, so it stops there, saying where
  if (h.layout === "old") {
    const stray = [];
    rows.slice(1).forEach((r, i) => { for (let j = OLD_HEADERS.length; j < READ_COLS; j++) if (str(at(r, j)) !== "") stray.push(`${"ABCDEFGHIJ"[j]}${i + 2}`); });
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
// -> { grid (rows of the nine columns; a row's Notes cell is notesCell(its status, its owner's notes)), rows, manual, other, summary, stash: { add: { [Site ID]: entry } (notes
// of rows that left the table this time), restore: [Site ID] (kept notes that came back) } }. A row's notes (rows[].notes, manual[].notes, the stash) are the owner's only.
export function buildSheet({ plan, read, clients = [], now = new Date(), stash = {} }) {
  const site = plan.rows.map((r) => ({ ...r }));
  const byId = new Map(site.map((r) => [r.siteId, r]));
  const winnerOf = new Map(site.flatMap((r) => r.alsoIds.map((id) => [id, r.siteId])));
  const byClient = new Map();
  for (const r of site) byClient.set(r.clientId, [...(byClient.get(r.clientId) || []), r]);
  const notes = new Map(), onSheet = new Set(), claims = new Map(), left = new Map();
  const note = (id, text) => notes.set(id, [...(notes.get(id) || []), text]);
  const summary = { rows: site.length, producers: plan.producers.length, added: 0, removed: 0, removedArtistRows: 0, duplicatesOnSite: plan.dropped.length, duplicatesOnSheet: 0, onlyOnSheet: 0, notesCarried: 0, notesStashed: 0, notesRestored: 0, otherText: 0, migrated: read.layout === "old", statusMerged: read.layout === "ten" };
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
  for (const r of site) grid.push([r.writer, r.song, r.artist, r.share == null ? "" : fraction(r.share), r.releaseDate, r.isrc, r.link, notesCell(r.status, r.notes), r.siteId]);
  if (manual.length || other.length) {
    grid.push(blank(), Object.assign(blank(), { 0: SEPARATOR }));
    for (const m of manual) grid.push([m.writer, m.title, m.artist, m.share, m.release, m.isrc, m.link, notesCell(STATUS.manual, mergeNotes(m.notes)), ""]);
    for (const x of other) grid.push(["", "", x.artist, x.share, x.release, x.isrc, x.link, str(x.note), ""]);
  }
  grid.push(blank(), Object.assign(blank(), { 0: `TOTAL SONGS: ${site.length + manual.length}` }), Object.assign(blank(), { 0: `${UPDATED}${nyStamp(now)}` }));
  return { grid, rows: site, manual: manual.map((m) => ({ ...m, notes: mergeNotes(m.notes) })), other, summary, stash: { add, restore } };
}

// whether the tab already says this (the footer's time aside): every cell of every row (of the first `width` columns), numbers to nine places, text trimmed
const norm = (v) => (typeof v === "number" ? Math.round(v * 1e9) / 1e9 : str(v));
export function sameSheet(values, grid, width = COLS) {
  const read = Array.isArray(values) ? values : [];
  if (read.length !== grid.length) return false;
  for (let i = 0; i < grid.length; i++) {
    const a = Array.from({ length: width }, (_, j) => norm(read[i]?.[j] ?? "")), b = Array.from({ length: width }, (_, j) => norm(grid[i][j] ?? ""));
    if (str(grid[i][0]).startsWith(UPDATED)) { if (!str(a[0]).startsWith(UPDATED)) return false; continue; }
    if (a.some((x, j) => x !== b[j])) return false;
  }
  return true;
}

// fillsEmpty: whether `out` (the rows written from A1) puts something in a cell that `read` (the values read) has empty; only then can a merge hide part of it (the cells
// under a merge's top-left one read empty), so only then are the merges read.
export const fillsEmpty = (read, out) => out.some((row, r) => row.some((v, c) => str(v) !== "" && str(read?.[r]?.[c]) === ""));
// The merges (from spreadsheets.get, GridRanges) that would hide a value of `out`: a cell of the merge other than its top-left one, inside what is written, with
// something in it. Only those are unmerged before a write; one over blank cells, or wholly outside the rows and columns written, is left alone.
export function hidingMerges(merges, out) {
  return (merges || []).filter((m) => {
    const r0 = m.startRowIndex ?? 0, c0 = m.startColumnIndex ?? 0, r1 = Math.min(m.endRowIndex ?? out.length, out.length);
    for (let r = r0; r < r1; r++) {
      const row = out[r] || [], c1 = Math.min(m.endColumnIndex ?? row.length, row.length);
      for (let c = c0; c < c1; c++) if ((r !== r0 || c !== c0) && str(row[c]) !== "") return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------- the sheet's looks (once)
// sheetId: the tab's. Header row dark and bold, the first row frozen, Site ID (I) hidden, D a percent with two decimals, a filter over the table (no end row: it
// grows with the sheet), and column widths (the one Notes column wide: it holds the status words and the note). Applied once per LAYOUT (app_state layoutDone),
// and again when the columns found on the sheet aren't in the order written (the owner moved some: unhide, so no column stays hidden where another one is now).
// clearJ: the sheet was in the ten columns of before (or formatted for them): J, their hidden Site ID, is shown again at Google's default width and its
// dark header cell made plain; nothing else of J is touched.
const HEAD_LOOK = { backgroundColor: { red: 0.1, green: 0.11, blue: 0.13 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: "MIDDLE", wrapStrategy: "WRAP" };
const headRow = (range, n) => ({ repeatCell: { range: range({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }), cell: { userEnteredFormat: HEAD_LOOK }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)" } });
const frozenRow = (sheetId) => ({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
const percentD = (range) => ({ repeatCell: { range: range({ startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4 }), cell: { userEnteredFormat: { numberFormat: { type: "PERCENT", pattern: "0.00%" } } }, fields: "userEnteredFormat.numberFormat" } });
const widths = (range, list) => list.map((pixelSize, i) => ({ updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }), properties: { pixelSize }, fields: "pixelSize" } }));
export function formatRequests(sheetId, { unhide = false, clearJ = false } = {}) {
  const range = (o) => ({ sheetId, ...o });
  const SITE = COLS - 1, J = COLS; // I (index 8) and J (index 9)
  return [
    headRow(range, COLS),
    ...(clearJ ? [{ repeatCell: { range: range({ startRowIndex: 0, endRowIndex: 1, startColumnIndex: J, endColumnIndex: J + 1 }), cell: {}, fields: "userEnteredFormat" } }] : []),
    frozenRow(sheetId),
    percentD(range),
    ...widths(range, [170, 260, 240, 160, 110, 130, 300, 380]),
    ...(unhide ? [{ updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: 0, endIndex: SITE }), properties: { hiddenByUser: false }, fields: "hiddenByUser" } }] : []),
    { updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: SITE, endIndex: SITE + 1 }), properties: { hiddenByUser: true }, fields: "hiddenByUser" } },
    ...(clearJ ? [{ updateDimensionProperties: { range: range({ dimension: "COLUMNS", startIndex: J, endIndex: J + 1 }), properties: { pixelSize: 100, hiddenByUser: false }, fields: "pixelSize,hiddenByUser" } }] : []),
    { setBasicFilter: { filter: { range: range({ startRowIndex: 0, startColumnIndex: 0, endColumnIndex: COLS }) } } },
  ];
}
// The EMPIRE copy's looks, sent with every write of it (the same call): the main sheet's header, frozen row, percent D and widths, H a whole number with
// thousands separators. No filter (the label may filter its own view: a filter set again every sync would undo theirs).
export function empireFormatRequests(sheetId) {
  const range = (o) => ({ sheetId, ...o });
  return [
    headRow(range, EMPIRE_HEADERS.length),
    frozenRow(sheetId),
    percentD(range),
    { repeatCell: { range: range({ startRowIndex: 1, startColumnIndex: 7, endColumnIndex: 8 }), cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
    ...widths(range, [170, 260, 240, 160, 110, 130, 300, 130]),
  ];
}

// ---------------------------------------------------------------- state
const patchState = (patch) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(patch)}, now())
  ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
// where a sync keeps what it knows: app_state (get a key, set one whole, merge into "scheduleA"). A run against a test copy of the sheet passes its own (syncScheduleA's
// `store`, the same three), so nothing is written to the database
const DB_STORE = { get: (key) => getState(key), set: (key, value) => setState(key, value), merge: (patch) => patchState(patch) };
// a change was saved since the last sync started (lastSyncAt is the moment that run began, so a save during a run is still waiting)
export const dirtyOf = (st) => !!st?.dirtyAt && (!st.lastSyncAt || Date.parse(st.dirtyAt) > Date.parse(st.lastSyncAt));
export const needsSync = (st) => dirtyOf(st) || !!st?.lastError;
export async function scheduleAState() { return (await getState(KEY).catch(() => null)) || {}; }

// ---------------------------------------------------------------- the sync
const denied = (err) => [err?.status, err?.code, err?.response?.status].some((x) => Number(x) === 403);
const quota = (err) => [err?.status, err?.code, err?.response?.status].some((x) => Number(x) === 429) || /quota exceeded|resource has been exhausted/i.test(String(err?.message || ""));
// a thrown error as a sentence anyone may read; { empire: true } says it of the EMPIRE copy (its own sheet and setting) instead of the Schedule A sheet
function words(err, { empire = false } = {}) {
  if (err?.plain) return String(err.message).slice(0, 500); // (its own words; a header row read back into one is cut)
  const who = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "").trim();
  if (denied(err)) return empire ? `The EMPIRE copy isn't shared with the site's Google account${who ? ` (${who})` : ""}. Share it with that account as Editor.` : `The dashboard's Google account${who ? ` (${who})` : ""} can't edit the Schedule A sheet. Share it with that account as Editor.`;
  if (quota(err)) return "Google Sheets was busy: too many requests in one minute. It tries again.";
  if ([err?.status, err?.code].some((x) => Number(x) === 404)) return empire ? "The EMPIRE copy wasn't found. Check SCHEDULE_A_EMPIRE_SHEET_ID." : "The Schedule A sheet wasn't found. Check SCHEDULE_A_SHEET_ID.";
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 300);
}
const plainError = (message) => Object.assign(new Error(message), { plain: true });

// every client, the songs of the producers, each song's ISRC (the song's own record, else the Spotify catalog's for its track), the auto-added songs, and the streams
// Roster › Catalog shows for every song (catalogStreams, over every client's songs: the EMPIRE copy's)
async function loadSite() {
  const [clients, all, tracking, autoAdded] = await Promise.all([
    sql`SELECT id, name, credit, role, sheet_tab_name, on_roster, roster_order FROM clients`,
    sql`SELECT id, client_id, song, artist, release_date, link, splits, streams FROM placements`,
    rowsOrNoneIfNoTable(sql`SELECT placement_id, isrc FROM song_tracking WHERE isrc <> ''`),
    getState("autoAdded"),
  ]);
  const mine = new Set(clients.filter(isProducer).map((c) => c.id));
  const placements = all.filter((p) => mine.has(p.client_id));
  const ids = [...new Set(placements.map((p) => spotifyTrack(p.link)).filter(Boolean))].map((t) => `t:${t}`);
  const entities = ids.length ? await rowsOrNoneIfNoTable(sql`SELECT id, isrc FROM data_entities WHERE kind = 'track' AND isrc <> '' AND id = ANY(${ids})`) : [];
  const own = new Map(tracking.map((t) => [t.placement_id, cleanIsrc(t.isrc)]));
  const cat = new Map(entities.map((e) => [String(e.id).slice(2), cleanIsrc(e.isrc)]));
  return { clients, placements, autoAdded, isrcOf: (id, p) => own.get(id) || cat.get(spotifyTrack(p?.link)) || "", streams: catalogStreams({ clients, placements: all }) };
}

// ---------------------------------------------------------------- the EMPIRE copy (pure)
// The streams Roster › Catalog shows for each song, by placement id: lib/roster-catalog.js catalogRows over every client's songs, the very call the Catalog page makes
// (components/dash/roster-views.jsx: the biggest placements.streams among the song's copies, never a sum), so the copy says what the site says. clients and placements: the
// DB's rows (client_id, release_date) or the site's own shape (clientId, releaseDate). -> Map placement id -> { streams, key (the Catalog song's) }
export function catalogStreams({ clients = [], placements = [] } = {}) {
  const rows = catalogRows({
    clients: (clients || []).map((c) => ({ id: c.id, name: c.name })),
    placements: (placements || []).map((p) => ({ id: p.id, clientId: p.client_id ?? p.clientId, song: p.song, artist: p.artist, link: p.link, releaseDate: p.release_date ?? p.releaseDate, streams: Number(p.streams) || 0 })),
  });
  const out = new Map();
  for (const r of rows) for (const id of r.placementIds) out.set(String(id), { streams: r.streams, key: r.key });
  return out;
}
// (2026-11-25) whether an owner's note says the song has an uncleared sample: "Uncleared sample: …", "un-cleared sample", "uncleared samples", "sample not cleared",
// "sample (not cleared)", "sample isn't cleared", "sample has not been cleared", "samples uncleared", "sample (uncleared)"; any case, curly quotes and dashes as plain
// ones. Not "sample cleared", "cleared sample", "sample clearance done", and not when the words are denied right before them ("no uncleared samples", "not an uncleared
// sample", "without any uncleared sample") or answered "none" after them ("Uncleared samples: none").
const UNCLEARED = [
  /(?<!\b(?:no|not|without)\s+(?:an?\s+|any\s+)?)\bun[\s-]*cleared\s+samples?\b(?!\s*[:=-]?\s*(?:none|n\/a)\b)/,
  /(?<!\b(?:no|not|without)\s+(?:an?\s+|any\s+)?)\bsamples?\b[\s(\[:,-]*(?:(?:is|are|was|were|has|have|had|still|currently|yet|been)\s+)*(?:not|never|[a-z]+n't|un)[\s-]*(?:(?:yet|been|being|fully|properly)\s+)*cleared\b/,
];
export function unclearedSample(note) {
  const t = String(note ?? "").normalize("NFKC").toLowerCase().replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, " ");
  return !!t.trim() && UNCLEARED.some((re) => re.test(t));
}
// The main table's rows (by their place in `rows`) whose SONG has an uncleared sample: a row is out when it, or any row of the same song, has an owner's note that says so
// (unclearedSample). The same song: rows (of any writer; manual: buildSheet's "Only on this sheet" rows, which have no Site ID) that share a Catalog song (catalogStreams' key
// of any of the row's cards, or the Spotify track of its link: Catalog's "t:" key), an ISRC, or a title and artists (titleKey, artistKey: any order, case and punctuation
// aside), each joined to the next. rows: buildSheet's (notes: the owner's only). -> Set of indexes into rows
export function unclearedRows({ rows = [], manual = [], streams = new Map() } = {}) {
  const nodes = [
    ...rows.map((r) => {
      const ids = [r.siteId, ...(r.alsoIds || [])].map(String);
      return { notes: r.notes, keys: [...ids.map((id) => streams.get(id)?.key), spotifyTrack(r.link) && `t:${spotifyTrack(r.link)}`].filter(Boolean).map((k) => `song:${k}`), isrc: r.isrc, title: r.song, artist: r.artist };
    }),
    ...manual.map((m) => ({ notes: m.notes, keys: spotifyTrack(m.link) ? [`song:t:${spotifyTrack(m.link)}`] : [], isrc: m.isrc, title: m.title, artist: m.artist })),
  ];
  const parent = nodes.map((_, i) => i);
  const root = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const first = new Map();
  nodes.forEach((n, i) => {
    const isrc = cleanIsrc(n.isrc), tk = titleKey(n.title);
    for (const k of [...n.keys, isrc && `isrc:${isrc}`, tk && `name:${tk}|${artistKey(n.artist)}`].filter(Boolean)) {
      if (!first.has(k)) first.set(k, i); else parent[root(i)] = root(first.get(k));
    }
  });
  const flagged = new Set(nodes.flatMap((n, i) => (unclearedSample(n.notes) ? [root(i)] : [])));
  return new Set(rows.flatMap((_, i) => (flagged.has(root(i)) ? [i] : [])));
}
// The EMPIRE copy's rows: the main table's (scheduleAPlan's or buildSheet's rows: by producer, then title, one per writer; never a row only on the sheet) whose song has MORE THAN
// EMPIRE_MIN streams and no uncleared sample (unclearedRows: buildSheet's rows carry the owner's notes; manual, its "Only on this sheet" rows, count too). A row the dedupe made of
// several cards takes the biggest of their songs' numbers. streams: catalogStreams'. -> { rows: [{ ...row, streams, songKey }], songs (how many different songs: a song under two
// producers is two rows, one song), leftOut (how many different songs over the line were left out for an uncleared sample) }
export function empirePlan({ plan, streams = new Map(), manual = [] } = {}) {
  const all = plan?.rows || [], out = unclearedRows({ rows: all, manual, streams });
  const rows = [], left = new Set();
  all.forEach((r, i) => {
    const hits = [r.siteId, ...(r.alsoIds || [])].map((id) => streams.get(String(id))).filter((h) => h && Number.isFinite(Number(h.streams)));
    if (!hits.length) return;
    const best = hits.reduce((a, b) => (Number(b.streams) > Number(a.streams) ? b : a));
    if (!(Number(best.streams) > EMPIRE_MIN)) return;
    const songKey = best.key || r.siteId;
    if (out.has(i)) { left.add(songKey); return; }
    rows.push({ ...r, streams: Math.round(Number(best.streams)), songKey });
  });
  return { rows, songs: new Set(rows.map((r) => r.songKey)).size, leftOut: left.size };
}
const dayText = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const nyDay = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric" }).format(d);
export const EMPIRE_STREAMS_LINE = "Streams: as shown on the Defied site (Luminate), ";
// The EMPIRE copy as it is written: the header, the rows, a blank row, the totals, the day the streams are from, the time. asOf: "YYYY-MM-DD" (lib/streams-on.js
// streamsOn, the day Catalog's "Streams as of" says) or null (then the sync's own New York day: "synced Nov 24, 2026")
export function buildEmpire({ rows = [], songs = 0, now = new Date(), asOf = null } = {}) {
  const n = EMPIRE_HEADERS.length, line = (text) => Object.assign(Array(n).fill(""), { 0: text });
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(asOf ?? "")) ? `as of ${dayText(asOf)}` : `synced ${nyDay(new Date(now))}`;
  return [
    EMPIRE_HEADERS.slice(),
    ...rows.map((r) => [r.writer, r.song, r.artist, r.share == null ? "" : fraction(r.share), r.releaseDate, r.isrc, r.link, r.streams]),
    Array(n).fill(""),
    line(`TOTAL SONGS: ${songs}${rows.length !== songs ? ` (${rows.length} rows: one per writer)` : ""}`),
    line(`${EMPIRE_STREAMS_LINE}${day}`),
    line(`${UPDATED}${nyStamp(new Date(now))}`),
  ];
}
// a cell as Sheets' updateCells takes it: a number as a number, text as text (never read as a date or a formula: the main sheet's RAW), blank as no value
const cellOf = (v) => (typeof v === "number" && Number.isFinite(v) ? { userEnteredValue: { numberValue: v } } : str(v) === "" ? {} : { userEnteredValue: { stringValue: str(v) } });

// ---------------------------------------------------------------- the EMPIRE copy (Google)
// Its tab: the one called "Schedule A" (any case, spaces aside), else the first tab (renamed "Schedule A" by the write). One read of the tab list.
async function empireTab(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tabs = (res.data.sheets || []).map((x) => x.properties || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const named = tabs.find((t) => String(t.title ?? "").trim().toLowerCase() === TAB.toLowerCase()), tab = named || tabs[0];
  if (!tab || tab.sheetId == null) throw plainError("The EMPIRE copy has no tab to write to.");
  return { title: String(tab.title), sheetId: tab.sheetId, rowCount: tab.gridProperties?.rowCount || 0, columnCount: tab.gridProperties?.columnCount || 0, rename: !named };
}
// The copy written whole: the tab read once (it must read empty, or be a Schedule A: row 1 starting Writer, Song Title), then ONE batchUpdate: the tab renamed if it
// isn't "Schedule A" yet, grown if it is too small, every value cleared and the copy written (so nothing of a longer copy is left), and the looks
async function writeEmpire(sheets, spreadsheetId, grid) {
  const tab = await empireTab(sheets, spreadsheetId);
  const got = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quote(tab.title)}!A1:Z`, valueRenderOption: "UNFORMATTED_VALUE" })).data.values || [];
  const filled = got.some((r) => (r || []).some((c) => str(c) !== ""));
  if (filled && !(hk(got[0]?.[0]) === hk(EMPIRE_HEADERS[0]) && hk(got[0]?.[1]) === hk(EMPIRE_HEADERS[1]))) {
    throw plainError(`The EMPIRE copy wasn't written: its tab "${tab.title}" has something else in it (row 1 reads: ${(got[0] || []).map(str).filter(Boolean).slice(0, 6).join(" | ") || "nothing"}). Check SCHEDULE_A_EMPIRE_SHEET_ID, or empty that tab.`);
  }
  const width = EMPIRE_HEADERS.length, id = tab.sheetId;
  const requests = [
    ...(tab.rename ? [{ updateSheetProperties: { properties: { sheetId: id, title: TAB }, fields: "title" } }] : []),
    ...(tab.rowCount < grid.length ? [{ appendDimension: { sheetId: id, dimension: "ROWS", length: grid.length - tab.rowCount + 50 } }] : []),
    ...(tab.columnCount < width ? [{ appendDimension: { sheetId: id, dimension: "COLUMNS", length: width - tab.columnCount } }] : []),
    { updateCells: { range: { sheetId: id }, fields: "userEnteredValue" } }, // every value of the tab cleared (no rows given: the whole range is cleared) ...
    { updateCells: { start: { sheetId: id, rowIndex: 0, columnIndex: 0 }, rows: grid.map((row) => ({ values: row.map(cellOf) })), fields: "userEnteredValue" } }, // ... and the copy written, in the same call
    ...empireFormatRequests(id),
  ];
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}
// The EMPIRE copy, after the main sheet. Never throws. -> { ok: true, rows, songs, leftOut? (only when some were: empirePlan's), at } or { error } (words for anyone)
// empire: empirePlan's answer
async function syncEmpire({ sheets, empire, at, prior = {}, mainId = "" }) {
  try {
    const spreadsheetId = empireId();
    if (spreadsheetId === mainId) throw plainError("The EMPIRE copy wasn't written: SCHEDULE_A_EMPIRE_SHEET_ID is the Schedule A sheet's own id.");
    const { rows, songs, leftOut = 0 } = empire;
    // no song over the line at all, when the copy had some: more likely a read gone wrong than a wish (as an empty site is for the main sheet). Songs over it that were all
    // left out for an uncleared sample are no read gone wrong: the copy is written with none
    if (!rows.length && !leftOut && Number(prior.empire?.songs) > 0) throw plainError(`No song is over ${EMPIRE_MIN.toLocaleString("en-US")} streams on the site just now, so the EMPIRE copy was left as it is.`);
    const asOf = await streamsOn().catch(() => null);
    await writeEmpire(sheets, spreadsheetId, buildEmpire({ rows, songs, now: at, asOf }));
    return { ok: true, rows: rows.length, songs, ...(leftOut ? { leftOut } : {}), at: at.toISOString() };
  } catch (err) {
    console.error("schedule a: the EMPIRE copy:", err?.message || err); // (the message only: a Google error object carries the request)
    return { error: words(err, { empire: true }) };
  }
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
// Before a write: the tab's merges read, and the ones that would hide a value of `out` unmerged (hidingMerges), whole, in one batchUpdate. Never throws (a failure leaves the
// write as it was before this step: Google drops what a merge hides). -> { sheetId (the tab's, for the looks; null if not read), unmerged (how many) }
async function unmergeHiding(sheets, spreadsheetId, title, out) {
  let sheetId = null;
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title),merges)" });
    const s = (res.data.sheets || []).find((x) => x.properties?.title === title);
    if (!s) return { sheetId, unmerged: 0 };
    sheetId = s.properties.sheetId ?? null;
    const hit = hidingMerges(s.merges, out);
    if (hit.length && sheetId != null) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: hit.map((m) => ({ unmergeCells: { range: { ...m, sheetId } } })) } });
    }
    return { sheetId, unmerged: sheetId != null ? hit.length : 0 };
  } catch (err) {
    console.error("schedule a: the merged cells weren't checked:", err?.message || err); // (the message only: a Google error object carries the request)
    return { sheetId, unmerged: 0 };
  }
}
// a tab too small for the table (a sheet has 1,000 rows to begin with): rows and columns added, once, by what the table needs
async function growTab(sheets, spreadsheetId, title, rows, cols = COLS) {
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const p = (res.data.sheets || []).map((x) => x.properties).find((x) => x.title === title);
  if (!p) throw plainError(`The sheet has no tab called "${title}".`);
  const requests = [];
  const rowCount = p.gridProperties?.rowCount || 0, columnCount = p.gridProperties?.columnCount || 0;
  if (rowCount < rows) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: "ROWS", length: rows - rowCount + 200 } });
  if (columnCount < cols) requests.push({ appendDimension: { sheetId: p.sheetId, dimension: "COLUMNS", length: cols - columnCount } });
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

// The sync. { now, dryRun, store }: dryRun plans and reads (one read of the tab) and writes nothing, here, in the EMPIRE copy or in the database; store: where the state is
// kept (DB_STORE's three: get, set, merge), app_state unless a run against a test copy passes its own.
// -> { ok: true, at, rows, producers, onlyOnSheet, summary, changed, wrote: { values, formatted, blanked, unmerged }, empire? } (blanked: the blank rows that wipe what is left of a longer
// sheet, in the same write; unmerged: the merges taken off first, hidingMerges; empire, when the copy is on: { ok, rows, songs, leftOut? } or { error }; leftOut: the songs left out for an
// uncleared sample, only when there are some), { ok: true, dryRun: true, …, planned, empire?: { dryRun, rows, songs, leftOut? } }, { off }, or
// { error }. It never throws. It doesn't take the run lock: runScheduleA does.
export async function syncScheduleA({ now = new Date(), dryRun = false, store = DB_STORE } = {}) {
  const at = Number.isFinite(new Date(now).getTime()) ? new Date(now) : new Date();
  let spreadsheetId = "";
  try {
    if (!scheduleAOn()) return { off: NOT_SET };
    if (!dryRun && !scheduleAWritesOn()) return { off: WRITES_OFF };
    spreadsheetId = scheduleAId();
    const [site, prior, stashed] = await Promise.all([loadSite(), Promise.resolve().then(() => store.get(KEY)).catch(() => null).then((v) => v || {}), store.get(STASH_KEY)]);
    const plan = scheduleAPlan(site);
    const sheets = getSheetsClient();
    const tab = await readTab(sheets, spreadsheetId);
    const read = parseSheet(tab.values);
    // a header that isn't the nine (any order, J1 blank), the ten of before or the owner's old five: a column deleted or one added inside A:I, a header renamed, one typed in J1.
    // Nothing is written over it, and no note is read from a place it isn't in
    if (read.layout === "unknown") throw plainError(read.problem || headerChanged(read.header));
    // a tab that reads empty after the site has synced it is more likely a read that went wrong than a wish: writing it would make a table with none of the notes
    if (read.layout === "empty" && (prior.lastSyncAt || Number(prior.rows) > 0)) {
      throw plainError(`The ${TAB} tab reads empty, but the site has synced it before, so nothing was written (a read that went wrong would wipe the notes). If you emptied it on purpose, type the nine headers back into row 1 (${HEADERS.join(", ")}) and sync again.`);
    }
    // an empty site is not a reason to empty the sheet: it is more likely a read that went wrong
    if (!plan.rows.length && read.rows.length) throw plainError("The site has no producer songs just now, so Schedule A was left as it is.");
    const kept = cleanStash(stashed);
    const built = buildSheet({ plan, read, clients: site.clients, now: at, stash: kept });
    // (a sheet in any layout but the nine is always written: the ten of before has its J to clear even when the rest reads the same)
    const same = read.layout === "new" && sameSheet(tab.values, built.grid);
    const styled = prior.layoutDone === LAYOUT && read.layout === "new" && read.canonical;
    // (the EMPIRE copy: from buildSheet's rows, which carry the owner's notes this sync read, so a song with an uncleared sample is left out of it: unclearedRows)
    const empire = empireOn() ? empirePlan({ plan: { rows: built.rows }, streams: site.streams, manual: built.manual }) : null;
    const result = {
      ok: true, at: at.toISOString(), rows: built.rows.length, producers: plan.producers.length, onlyOnSheet: built.manual.length, summary: built.summary,
      changed: !same, wrote: { values: false, formatted: false, blanked: 0, unmerged: 0 },
    };
    if (dryRun) {
      return { ...result, dryRun: true, wouldFormat: !styled, planned: [...built.rows, ...built.manual.map((m) => ({ ...m, status: STATUS.manual }))], ...(empire ? { empire: { dryRun: true, rows: empire.rows.length, songs: empire.songs, ...(empire.leftOut ? { leftOut: empire.leftOut } : {}) } } : {}) };
    }
    let knownSheetId = tab.sheetId ?? null;
    if (!same) {
      // the notes of the rows this write takes off are kept FIRST: a note is never only in a write that may have gone wrong
      const stash = { ...kept, ...built.stash.add };
      if (Object.keys(built.stash.add).length) await store.set(STASH_KEY, cleanStash(stash));
      // ONE write: the table, then blank rows down to what was read, so what is left of a longer sheet is wiped by the very same call (a second call, a clear, could cut short a table
      // a later run had written). Read in the ten columns of before, every row is ten cells wide, J blank: the old Site IDs in J go in that same call
      const width = read.layout === "ten" ? READ_COLS : COLS;
      const blanked = Math.max(0, tab.values.length - built.grid.length);
      const out = [...built.grid.map((row) => (row.length < width ? [...row, ...Array(width - row.length).fill("")] : row)), ...Array.from({ length: blanked }, () => Array(width).fill(""))];
      const write = () => sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `${quote(tab.title)}!A1`, values: out }] } });
      // the merges that would hide something of this write are taken off first (WS-1: Google drops a value written under a merge)
      if (fillsEmpty(tab.values, out)) {
        const um = await unmergeHiding(sheets, spreadsheetId, tab.title, out);
        knownSheetId = knownSheetId ?? um.sheetId; result.wrote.unmerged = um.unmerged;
      }
      try { await write(); } catch (err) {
        if (!/exceeds grid limits/i.test(String(err?.message || ""))) throw err;
        await growTab(sheets, spreadsheetId, tab.title, out.length, width);
        await write();
      }
      result.wrote.values = true; result.wrote.blanked = blanked;
      // the notes that came back with their rows are on the sheet now: they leave the keeping
      if (built.stash.restore.length) await store.set(STASH_KEY, cleanStash(Object.fromEntries(Object.entries(stash).filter(([id]) => !built.stash.restore.includes(id)))));
    }
    let layout = { layoutDone: LAYOUT };
    if (!styled) {
      const sheetId = knownSheetId ?? (await listTabs(sheets, spreadsheetId)).find((t) => t.title === tab.title)?.sheetId;
      if (sheetId == null) throw plainError(`The sheet has no tab called "${tab.title}".`);
      // (the ten columns of before, or a sheet formatted for them: J, their hidden Site ID, is shown again and its header cell made plain)
      const requests = formatRequests(sheetId, { unhide: read.layout === "new" || read.layout === "ten", clearJ: read.layout === "ten" || prior.layoutDone !== LAYOUT });
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      result.wrote.formatted = true;
      layout = { layoutDone: LAYOUT, sheetId };
    }
    // the main sheet is synced now, whatever the EMPIRE copy does next
    await store.merge({ lastSyncAt: at.toISOString(), rows: result.rows, producers: result.producers, onlyOnSheet: result.onlyOnSheet, lastError: null, lastErrorAt: null, ...layout,
      summary: { added: built.summary.added, removed: built.summary.removed, removedArtistRows: built.summary.removedArtistRows, duplicatesDropped: built.summary.duplicatesOnSite + built.summary.duplicatesOnSheet }, ...(result.changed ? { changedAt: at.toISOString() } : {}) });
    if (empire) {
      const e = await syncEmpire({ sheets, empire, at, prior, mainId: spreadsheetId });
      const left = e.leftOut ? { leftOut: e.leftOut } : {};
      result.empire = e.ok ? { ok: true, rows: e.rows, songs: e.songs, ...left } : { error: e.error };
      // the last good write is kept beside an error, for Site › Sync to say when it last worked (and how many it left out)
      const next = e.ok ? { at: e.at, rows: e.rows, songs: e.songs, ...left, error: null, errorAt: null } : { ...(prior.empire || {}), error: e.error, errorAt: at.toISOString() };
      await Promise.resolve().then(() => store.merge({ empire: next })).catch((err) => console.error("schedule a: the EMPIRE copy's state wasn't saved:", err?.message || err));
    }
    return result;
  } catch (err) {
    console.error("schedule a:", err?.message || err); // (the message only: a Google error object carries the request)
    const error = words(err);
    if (!dryRun && spreadsheetId) await Promise.resolve().then(() => store.merge({ lastError: error, lastErrorAt: at.toISOString() })).catch((e) => console.error("schedule a: the error wasn't saved:", e?.message || e));
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

// (2026-11-23) A change the sheet shows (an ISRC or a link the nightly finder saved) marked without running the sync: the run that comes next (the nightly run's own
// last step, the Sync check) writes it, and a run in progress is not started a second time for it. Never throws: what was saved is saved.
export async function markScheduleADirty({ now = new Date() } = {}) {
  try {
    if (!scheduleAWritesOn()) return { off: scheduleAOn() ? WRITES_OFF : NOT_SET };
    await patchState({ dirtyAt: new Date(now).toISOString() });
    return { marked: true };
  } catch (err) {
    console.error("schedule a: the change wasn't marked:", err?.message || err);
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
// (2026-11-24, the owner: the deal is confidential) who may see anything of the EMPIRE copy on the site: the EMPIRE deal pages' own gate (pages/api/empire.js, the
// dashboard's seeDeals): a Founder with Money and every artist. access: lib/access.js's req.access ({ role, sections, ownOnly }). Everyone else sees nothing of it:
// not the Sync line's EMPIRE part, not the route's state, preview or answer (withoutEmpire).
export const seesEmpire = (access) => !!access && access.role === "founder" && !access.ownOnly && Array.isArray(access.sections) && access.sections.includes("money");
export const withoutEmpire = (o) => { if (!o || typeof o !== "object" || Array.isArray(o)) return o; const { empire, ...rest } = o; return rest; };
// The EMPIRE copy's line under Schedule A's (Site › Sync), from the state: its link, how many songs it has, how many were left out for an uncleared sample (2026-11-25), when
// it was last written, and why the last write failed. null when the copy is off (or writes are). ok: true written, null not yet, false the last write failed (the main line
// keeps its own colour: the main sync is done). Only a Founder's line carries it (scheduleALine's { empire }: seesEmpire)
export function empireLine(st = {}) {
  if (!empireOn() || !scheduleAWritesOn()) return null;
  const e = st?.empire && typeof st.empire === "object" ? st.empire : {};
  const songs = Number(e.songs) || 0, left = Math.max(0, Math.floor(Number(e.leftOut) || 0)), when = e.at ? nyWhen(e.at) : "";
  const many = `${songs} ${s(songs, "song", "songs")} over 1M streams${left ? ` · ${left} left out (uncleared sample)` : ""}`;
  const text = e.error ? `EMPIRE copy: the last write failed: ${String(e.error).replace(/[.\s]+$/, "")}.${when ? ` Last written ${when} (${many}).` : ""}`
    : when ? `EMPIRE copy: ${many} · written ${when}.` : "EMPIRE copy: not written yet (the next sync writes it).";
  return { ok: e.error ? false : when ? true : null, text, url: empireUrl(), label: "Open the EMPIRE copy ↗" };
}
// The check's line, from the state (no Google call). ok: true synced, null not set up / off / not run yet / the nightly run is late, false the last sync failed. empire: empireLine's,
// only with { empire: true } (seesEmpire: a Founder's); without it the line says nothing of the copy
export function scheduleALine(st = {}, { now = Date.now(), empire = false } = {}) {
  const url = scheduleAUrl();
  const copy = empire ? empireLine(st) : null;
  const sheet = url ? { also: { kind: "url", label: "Open the sheet ↗", url }, url, ...(copy ? { empire: copy } : {}) } : {};
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
// empire: the account sees the EMPIRE copy (seesEmpire)
export async function scheduleACheck({ now = Date.now(), empire = false } = {}) {
  if (!scheduleAOn()) return scheduleALine({}, { now });
  try {
    let st = await scheduleAState();
    if (scheduleAWritesOn() && needsSync(st)) {
      const r = await runScheduleA({ source: "the sync check", budgetMs: 20000, minutes: RUN_MIN, now: new Date(now) });
      if (!r.skipped && !r.off && !r.busy) st = await scheduleAState();
    }
    return scheduleALine(st, { now, empire });
  } catch (err) {
    console.error("sync: schedule a", err?.message || err);
    return { id: "scheduleA", ok: null, text: "Couldn't check Schedule A just now." };
  }
}
// the route's GET: where it stands, and what a sync would do (a dry run: one read of the sheet; the EMPIRE copy's rows and songs, when it is on, without a read of it).
// empire: the account sees the EMPIRE copy (seesEmpire); without it the state and the preview say nothing of the copy
export async function scheduleAStatus({ empire = false } = {}) {
  const on = scheduleAOn();
  const out = { on, writes: scheduleAWritesOn(), url: scheduleAUrl(), last: on ? (empire ? await scheduleAState() : withoutEmpire(await scheduleAState())) : null };
  if (on) {
    const r = await runScheduleA({ dryRun: true, budgetMs: 40000 });
    out.preview = r.ok ? { rows: r.rows, producers: r.producers, onlyOnSheet: r.onlyOnSheet, changed: r.changed, wouldFormat: r.wouldFormat, summary: r.summary, ...(r.empire && empire ? { empire: r.empire } : {}) } : { error: r.error || r.skipped || r.off };
  }
  return out;
}
