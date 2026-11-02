// A&R prospects: the permanent ids behind the OUTREACH tab's rows. The sheet stays the source of
// truth for everything it has a column for; ar_prospects holds the id each row is matched to (by
// name, every time the tab is read), plus what the sheet has no place for. matchProspects is pure;
// reconcile persists its answer and never writes to the sheet. Server-only.
import { sql } from "./db";
import { uid } from "./id";
import { personKey } from "./names";
import { weekFromRows, weekFromSnapshots, exportDay, byWow, rankTop, spanOf } from "./weekly";
import { arHeldLatest, seriesFor, PORTFOLIO_CAP, portfolioName, portfolioUrl } from "./luminate";

// --- the sheet's layout and values -------------------------------------
export const OUTREACH_TAB = "OUTREACH";
export const ADVANCE_TAB = "ADVANCE CALCULATOR";
export const ASSUMPTIONS_TAB = "ASSUMPTIONS";
export const OUTREACH_FIRST_ROW = 5;
export const ADVANCE_FIRST_ROW = 7;
export const TOTAL_LABEL = "PIPELINE TOTAL";
// The exact values OUTREACH!O's dropdown holds today; the list read from the sheet's own dropdown
// wins when it can be read (lib/ar-sheet.js sheetMeta)
export const OUTREACH_STATUSES = ["Not Contacted", "Researching", "Contacted", "In Talks", "Offer Out", "Signed", "Passed"];
export const SLOT_COLS = [["R", "S"], ["T", "U"], ["V", "W"], ["X", "Y"], ["Z", "AA"]];
// the cells of an OUTREACH row the site may write (5.1); C:N are the sheet's formulas
export const OWNED_COLS = ["A", "B", "O", "P", "Q", ...SLOT_COLS.flat()];
export const CALC_COLS = ["C", "D", "E", "G", "H", "N"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(["AA"]);
export const colIdx = (letter) => LETTERS.indexOf(letter);
export const COL_LABEL = {
  A: "name", B: "contact", O: "status", P: "last contact", Q: "notes",
  ...Object.fromEntries(SLOT_COLS.flatMap(([s, w], i) => [[s, `Song ${i + 1} streams`], [w, `Song ${i + 1} writer %`]])),
};

export const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const ERR_RE = /^#(REF!|N\/A|DIV\/0!|VALUE!|NAME\?|ERROR!|NUM!|NULL!)$/;
export const isErrorValue = (v) => typeof v === "string" && ERR_RE.test(v.trim());
export const text = (v) => (v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
// a typed-in "1,234" or "$0.0025" still reads as a number; an error value (#REF!) counts as 0
export const toNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (isBlank(v) || isErrorValue(v)) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v) => (isBlank(v) ? null : typeof v === "number" ? v : Number.isFinite(Number(String(v).replace(/,/g, ""))) ? Number(String(v).replace(/,/g, "")) : v);
// a writer % for display: the exact fraction × 100, to 4 places (1/3 → 33.3333, never 33.3)
export const pct4 = (v) => Math.round(toNum(v) * 1e6) / 1e4;
// Sheets' date serials count days from 1899-12-30
export const serialToIso = (n) => new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10);
export const isoToSerial = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 864e5);
export const givenOf = (v) => (v === true ? "Yes" : v === false ? "No" : /^yes$/i.test(text(v).trim()) ? "Yes" : /^no$/i.test(text(v).trim()) ? "No" : "");
export const lastContactOf = (v) => {
  if (typeof v === "number") { const d = serialToIso(v); return { date: d, text: d }; }
  const t = text(v).trim();
  return { date: /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null, text: t };
};

// One identity rule for a prospect's name, the same as everyone else's (lib/names.js), with a
// plain lower-case fallback for a name with no letters or digits at all
export const nameKey = (name) => personKey(name) || String(name ?? "").trim().toLowerCase();

// How a field's value is compared (the browser's `expect`, and "did this change at all?"): text
// trimmed, numbers to 1e-9, dates as YYYY-MM-DD, "Advance given?" as Yes/No/blank
export function sameValue(a, b, kind = "text") {
  if (kind === "given") return givenOf(a) === givenOf(b);
  if (isBlank(a) && isBlank(b)) return true;
  if (kind === "date") return lastContactOf(a).text === lastContactOf(b).text;
  if (kind === "number") {
    if (isBlank(a) || isBlank(b)) return false;
    const x = typeof a === "number" ? a : Number(String(a).replace(/,/g, "")), y = typeof b === "number" ? b : Number(String(b).replace(/,/g, ""));
    if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) < 1e-9;
  }
  return text(a).trim() === text(b).trim();
}
export const kindOfCol = (col) => (col === "P" ? "date" : SLOT_COLS.flat().includes(col) ? "number" : "text");

// --- what staff may type (5.4.5) ---------------------------------------
export class ArError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (message) => new ArError(400, message);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export function checkName(v) {
  const s = String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(CONTROL, "").trim();
  if (!s) throw bad("Type a name.");
  if (s.length > 120) throw bad("Names can be up to 120 characters.");
  return s;
}
export function checkText(v, max, what) {
  const s = String(v ?? "").replace(CONTROL, "").trim();
  if (s.length > max) throw bad(`${what} can be up to ${max.toLocaleString("en-US")} characters.`);
  return s;
}
export function checkStatus(v, statuses) {
  const s = String(v ?? "").trim();
  if (s && !statuses.includes(s)) throw bad("Pick a status from the list.");
  return s;
}
export function checkSlot(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw bad("Pick a song slot from 1 to 5.");
  return n;
}
export function checkStreams(v) {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0 || n > 1e12) throw bad("Streams must be a whole number from 0 up.");
  return n;
}
// a share arrives as the fraction the sheet holds (the browser sends % / 100)
export function checkShare(v) {
  if (isBlank(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw bad("Writer % must be more than 0 and at most 100.");
  return n;
}
export function checkDate(v) {
  if (isBlank(v)) return "";
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || serialToIso(isoToSerial(s)) !== s) throw bad("Dates must look like 2026-10-28.");
  return s;
}

// --- follow-ups (section 9): the next date a status move sets -------------
export const FOLLOW_UP_DAYS = { Contacted: 7, "In Talks": 5, "Offer Out": 3 };
const CLOSED = ["Signed", "Passed"];
export const nyToday = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
// undefined = leave it; null = clear it. The sooner of a future date already set and the default wins.
export function nextFollowUp(status, current, today = nyToday()) {
  if (CLOSED.includes(status)) return current ? null : undefined;
  const days = FOLLOW_UP_DAYS[status];
  if (!days) return undefined;
  const want = addDays(today, days);
  return current && current >= today && current <= want ? undefined : want;
}
export function followUpState(on, today = nyToday()) {
  if (!on) return { state: null, daysLate: 0 };
  if (on === today) return { state: "due", daysLate: 0 };
  if (on < today) return { state: "overdue", daysLate: Math.round((Date.parse(today) - Date.parse(on)) / 864e5) };
  return { state: "upcoming", daysLate: 0 };
}

// --- the A&R tab's pages (pure) ------------------------------------------
// OUTREACH's row 1 labels over row 2 totals (the real tab: A1 "PROSPECT GROSS STREAMS" over =C65,
// …, K1 "TOTAL PIPELINE VALUE" over =N65), read unformatted. Publishing A&R shows these as they are,
// never summed again here. null when the labels aren't there.
const TOP_KEYS = {
  "PROSPECT GROSS STREAMS": "grossStreams", "PROSPECT NET STREAMS": "netStreams", "GROSS REVENUE POOL": "grossRevenue",
  "CATALOG TO DATE": "adminFee", "3-YEAR FORECAST": "threeYear", "TOTAL PIPELINE VALUE": "totalValue",
};
export function outreachTotalsOf(top) {
  const labels = top?.[0] || [], values = top?.[1] || [];
  const out = {};
  labels.forEach((l, i) => { const k = TOP_KEYS[text(l).trim().toUpperCase()]; if (k) out[k] = isErrorValue(values[i]) ? null : toNum(values[i]); });
  return Object.keys(out).length ? out : null;
}

// The A&R portfolios' newest exports (one per portfolio, kept apart from the clients' numbers in
// luminate_ar_held) as plain lists for Summary's gainers and the Watchlist. Streams only. Each row's
// week is its own export's This vs Last Period (lib/weekly.js), else three weekly snapshots of its
// all-time count (series: id -> [[day, streams]…], for a file with no Last Period rows), else none.
// current/last/changePct are the same numbers as thisWeek/lastWeek/wowPct (the older names).
// Releases (Luminate's "Release Group" rows) are listed with the songs, as type "release".
const typeOf = (t) => (!t || /^song$/i.test(t) ? "song" : /^artist$/i.test(t) ? "artist" : /release/i.test(t) ? "release" : null);
const nOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export function arListsOf(held, { series = {} } = {}) {
  // the newest list's day: a snapshot week that ended over 8 days before it is no longer this week's
  const asOf = held.map((h) => exportDay(h.exportedAt)).sort().pop();
  return held.map((h) => {
    const day = exportDay(h.exportedAt);
    const rows = (h.entities || []).map((e) => {
      const type = typeOf(e.type);
      if (!type) return null;
      const w = weekFromRows(e, day) || weekFromSnapshots(series[e.id], asOf) || { thisWeek: null, lastWeek: null, wowPct: null, weekOf: null };
      return { id: e.id, type, name: e.name || "", ...w, current: w.thisWeek, last: w.lastWeek, changePct: w.wowPct, ytd: nOrNull(e.ytd), atd: nOrNull(e.atd) };
    }).filter(Boolean).sort(byWow);
    return { id: h.portfolioId, name: h.name, holds: h.holds, exportedAt: new Date(h.exportedAt).toISOString(), count: (h.entities || []).length, period: spanOf(rows), rows };
  }).sort((a, b) => (a.holds === b.holds ? a.name.localeCompare(b.name) : a.holds === "artists" ? -1 : 1));
}

// The Board's stages (the client draws them in plain words; a producer's stage is its sheet status).
// A tracked artist saves one of these ids, or null = not on the board.
export const TRACKED_STAGES = ["reach", "reached", "talking", "offer", "signed", "passed"];
const STAGE_OF_STATUS = { "Not Contacted": "reach", Researching: "reach", "": "reach", Contacted: "reached", "In Talks": "talking", "Offer Out": "offer", Signed: "signed", Passed: "passed" };
export const stageOfStatus = (status) => STAGE_OF_STATUS[String(status ?? "").trim()] || "other";

// The Watchlist: everyone and every song tracked, each with its newest A&R numbers. people =
// producers (prospects, by an ar_tracking 'artist' link first, then the name matcher) and tracked
// artists (luminate_id first, then the name), plus every A&R Artists row nobody claimed ("From
// Luminate"); songs the same way against the A&R Songs rows. Pure: no money in here, ever.
const songKey = (s) => String(s ?? "").normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
// clients ([{ id, name, sheet_tab_name }]): someone in the lists who is already one of ours (matched by
// name the app's way, personKey) carries clientId: the Watchlist tags them "Client" and they're left out
// of the Top gainers ranking, which is for people we haven't signed
export function arWatchOf({ prospects = [], tracked = [], lists = [], clients = [] }) {
  const rowsOf = (type) => lists.flatMap((l) => l.rows.filter((r) => r.type === type).map((r) => ({ ...r, list: l.name, exportedAt: l.exportedAt })));
  const take = (pool, used, id, key, keyOf) => {
    const r = (id && pool.find((x) => x.id === id && !used.has(x.id))) || (key && pool.find((x) => !used.has(x.id) && keyOf(x.name) === key));
    if (r) used.add(r.id);
    return r || null;
  };
  const nums = (r) => (r
    ? { luminateId: r.id, thisWeek: r.thisWeek, lastWeek: r.lastWeek, wowPct: r.wowPct, weekOf: r.weekOf, current: r.current, last: r.last, changePct: r.changePct, atd: r.atd, list: r.list, release: r.type === "release" }
    : { luminateId: null, thisWeek: null, lastWeek: null, wowPct: null, weekOf: null, current: null, last: null, changePct: null, atd: null, list: null, release: false });
  // (a song added on the site may be in Luminate as a release)
  const artists = rowsOf("artist"), songs = [...rowsOf("song"), ...rowsOf("release")], usedA = new Set(), usedS = new Set();
  const people = [
    ...prospects.filter((p) => !p.removedAt).map((p) => {
      const link = (p.tracked || []).find((t) => t.kind === "artist" && t.luminateId);
      return { key: `p:${p.id}`, ref: { type: "prospect", id: p.id }, role: "producer", name: p.name, stage: stageOfStatus(p.status), fromLuminate: false,
        ...nums(take(artists, usedA, link?.luminateId, personKey(p.name), personKey)) };
    }),
    ...tracked.filter((t) => t.kind === "artist").map((t) => ({ key: `t:${t.id}`, ref: { type: "tracked", id: t.id }, role: "artist", name: t.name, handle: t.handle,
      stage: t.stage || null, fromLuminate: false, ...nums(take(artists, usedA, t.luminateId, personKey(t.name), personKey)) })),
  ];
  for (const r of artists) if (!usedA.has(r.id)) { usedA.add(r.id); people.push({ key: `l:${r.id}`, ref: null, role: "artist", name: r.name, stage: null, fromLuminate: true, ...nums(r) }); }
  const ours = new Map(clients.flatMap((c) => [c.name, c.sheet_tab_name].filter(Boolean).map((n) => [personKey(n), c.id])));
  for (const p of people) { const id = ours.get(personKey(p.name)); if (id) p.clientId = id; }
  const out = tracked.filter((t) => t.kind === "song").map((t) => ({ key: `t:${t.id}`, ref: { type: "tracked", id: t.id }, title: t.name, artist: t.artist, personId: t.personId, fromLuminate: false,
    ...nums(take(songs, usedS, t.luminateId, songKey(t.name), songKey)) }));
  for (const r of songs) if (!usedS.has(r.id)) { usedS.add(r.id); out.push({ key: `l:${r.id}`, ref: null, title: r.name, artist: "", personId: null, fromLuminate: true, ...nums(r) }); }
  // biggest week-on-week % first, no % last (by this week's streams), then by name
  const order = (a, b) => byWow(a, b) || String(a.name ?? a.title).localeCompare(String(b.name ?? b.title));
  people.sort(order); out.sort(order);
  // each list's own dates (Artists and Songs are often exported on different days); period is the
  // newest of the two, as before
  const newest = lists.map((l) => l.exportedAt).sort().pop() || null;
  const periods = { people: spanOf(people), songs: spanOf(out) };
  const period = [periods.people, periods.songs].filter(Boolean).sort((a, b) => a.to.localeCompare(b.to)).pop() || null;
  // Summary's Top gainers: ranked by %, from 1,000 streams this week (rankTop)
  const top = { people: rankTop(people.filter((r) => !r.clientId)).map((r) => ({ key: r.key, ranked: r.ranked })), songs: rankTop(out).map((r) => ({ key: r.key, ranked: r.ranked })) };
  return { people, songs: out, period, periods, top, exportedAt: newest };
}

// Artists and songs added on the site (not Passed; producers come from OUTREACH and are left out) that
// no A&R list has a row for yet, grouped by the Luminate list to add them to. They clear once a newer
// export holds them (matched like the Watchlist: Luminate id, then the name). lists = arListsOf's;
// cap = Luminate's per-list limit.
export const AR_TARGETS = { artists: "POR069D735D69A24B35AEE8B7FF6D221BA4", songs: "POR074E2117846F41B1A02150A26A5B0599" };
export function arToLuminateOf({ watch, tracked = [], lists = [], cap = 100 }) {
  const byId = new Map(tracked.map((t) => [t.id, t]));
  const missing = (rows) => rows.filter((r) => r.ref?.type === "tracked" && !r.luminateId && r.stage !== "passed" && byId.get(r.ref.id)?.stage !== "passed");
  const item = (r) => { const t = byId.get(r.ref.id) || {}; return { id: t.id, name: t.name || r.name || r.title, artist: t.artist || "", spotify: t.spotify || "" }; };
  const listOf = (holds) => {
    const l = lists.find((x) => x.id === AR_TARGETS[holds]) || lists.find((x) => x.holds === holds);
    return { name: l?.name || portfolioName(AR_TARGETS[holds], holds === "artists" ? "A&R Artists" : "A&R Songs"), count: l?.count ?? null, cap, full: (l?.count ?? 0) >= cap };
  };
  const artists = missing(watch?.people || []).map(item), songs = missing(watch?.songs || []).map(item);
  const n = artists.length + songs.length;
  return { artists, songs, count: n, text: n ? toLuminateText(artists.length, songs.length) : "", lists: { artists: listOf("artists"), songs: listOf("songs") } };
}
// one wording for the Dashboard and A&R Summary: "2 A&R artists and 1 song you added aren't in your
// Luminate A&R lists yet."
const nOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function toLuminateText(a, s) {
  const what = [a && nOf(a, "A&R artist", "A&R artists"), s && (a ? nOf(s, "song", "songs") : nOf(s, "A&R song", "A&R songs"))].filter(Boolean).join(" and ");
  return `${what} you added ${a + s === 1 ? "isn't" : "aren't"} in your Luminate A&R lists yet.`;
}
// the weekly ClickUp checklist's line for it
export function toLuminateTask(t) {
  if (!t?.count) return null;
  const what = [t.artists.length && nOf(t.artists.length, "A&R artist", "A&R artists"), t.songs.length && nOf(t.songs.length, t.artists.length ? "song" : "A&R song", t.artists.length ? "songs" : "A&R songs")].filter(Boolean).join(" and ");
  return { id: "arLuminate", label: `Add ${what} to your Luminate A&R lists`, count: t.count };
}

// tracked artists and songs (Postgres only: the sheet write path is never called for them)
export const trackedOut = (t) => ({
  id: t.id, kind: t.kind, name: t.name, artist: t.artist, handle: t.handle, spotify: t.spotify, isrc: t.isrc, genre: t.genre, notes: t.notes,
  luminateId: t.luminate_id, personId: t.person_id, stage: t.stage, lastContact: t.last_contact_day || null, followUp: t.follow_up_day || null,
  createdAt: t.created_at, createdBy: t.created_by,
});
export function checkTracked(b, { isNew }) {
  const out = {};
  if (isNew) {
    if (!["artist", "song"].includes(b.kind)) throw bad("Pick what you're adding.");
    out.kind = b.kind;
  }
  if (isNew || b.name !== undefined) out.name = checkName(b.name);
  for (const [k, max, what] of [["artist", 120, "The artist"], ["handle", 200, "The handle"], ["spotify", 300, "The Spotify link"], ["isrc", 15, "The ISRC"], ["genre", 60, "The genre"], ["notes", 5000, "Notes"], ["luminateId", 64, "The Luminate row"]]) {
    if (isNew || b[k] !== undefined) out[k] = checkText(b[k], max, what);
  }
  if (b.personId !== undefined) out.personId = b.personId ? checkText(b.personId, 64, "The person") : null;
  if (b.stage !== undefined) {
    if (b.stage !== null && b.stage !== "" && !TRACKED_STAGES.includes(b.stage)) throw bad("Pick a stage from the list.");
    out.stage = b.stage || null;
  }
  if (b.lastContact !== undefined) out.lastContact = b.lastContact ? checkDate(b.lastContact) : null;
  return out;
}

// --- reconcile (section 4) ---------------------------------------------
// rows: the sheet's prospect rows ({row, key, name, cells, given|null}); records: ar_prospects rows
// ({id, name, name_key, outreach_row, sheet_seen, advance_given, removed}). Returns who is who.
export function matchProspects(rows, records, { totalRow }) {
  const live = records.filter((r) => !r.removed);
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const firstOfKey = new Map();
  for (const r of rows) if (!firstOfKey.has(r.key)) firstOfKey.set(r.key, r.row);
  const pairs = [], usedRows = new Set(), usedRecs = new Set();
  const take = (rec, row, how) => { pairs.push({ rec, row, how }); usedRows.add(row.row); usedRecs.add(rec.id); };
  // 1. same row, same name
  for (const rec of live) {
    const r = rec.outreach_row != null ? byRow.get(rec.outreach_row) : null;
    if (r && r.key === rec.name_key && !usedRows.has(r.row)) take(rec, r, "same");
  }
  // 2. moved: exactly one unmatched record has that name (a hand sort, insert or delete)
  for (const r of rows) {
    if (usedRows.has(r.row) || firstOfKey.get(r.key) !== r.row) continue;
    const cands = live.filter((x) => !usedRecs.has(x.id) && x.name_key === r.key);
    if (cands.length === 1) take(cands[0], r, "moved");
  }
  // 3. renamed in place: the same row with the same non-blank contact, or one of the same songs,
  // and the new name isn't someone else's
  for (const r of rows) {
    if (usedRows.has(r.row)) continue;
    const rec = live.find((x) => !usedRecs.has(x.id) && x.outreach_row === r.row);
    if (!rec || live.some((x) => x.id !== rec.id && x.name_key === r.key)) continue;
    const seen = rec.sheet_seen || {};
    const sameContact = !isBlank(r.cells.B) && sameValue(r.cells.B, seen.B);
    const sameSong = SLOT_COLS.some(([s, w]) => (!isBlank(r.cells[s]) || !isBlank(r.cells[w]))
      && sameValue(r.cells[s], seen[s], "number") && sameValue(r.cells[w], seen[w], "number"));
    if (sameContact || sameSong) take(rec, r, "renamed");
  }
  // 4. new: everything left on the sheet (a second row with a name already there is its own record)
  const created = rows.filter((r) => !usedRows.has(r.row));
  const dups = [];
  for (const [key, first] of firstOfKey) {
    const all = rows.filter((r) => r.key === key);
    if (all.length > 1) dups.push({ key, name: byRow.get(first).name, rows: all.map((r) => r.row) });
  }
  // 5. gone: records left over, unless the tab looks broken rather than edited
  const left = live.filter((x) => !usedRecs.has(x.id));
  const placed = live.filter((x) => x.outreach_row != null).length;
  const guard = !left.length ? null : totalRow == null ? "noTotalRow" : left.length >= 3 && left.length > placed / 2 ? "manyMissing" : null;
  return { pairs, created, gone: guard ? [] : left, held: guard ? left : [], guard, dups };
}

const seenOf = (r) => ({ ...Object.fromEntries(OWNED_COLS.map((c) => [c, r.cells[c] ?? ""])), calc: r.calc, given: r.given, adv: r.advance?.row ?? null });
// jsonb keeps its own key order, so the stored copy is compared key by key
const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
const sameSeen = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const changedCols = (row, seen) => OWNED_COLS.filter((c) => !sameValue(row.cells[c], seen?.[c], kindOfCol(c)));
const cellList = (cols, rowNum, before, after) => cols.map((c) => ({ tab: OUTREACH_TAB, cell: `${c}${rowNum}`, before: before?.[c] ?? "", after: after?.[c] ?? "" }));
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Runs matchProspects against the stored records and saves the answer in one transaction. `read` is
// readArSheet()'s result; readAtDb is the database's clock just before that read began. When a sheet
// write (which holds arSheetLock) overlapped the read, nothing is saved this time: the read may be
// from before that write, and the next load settles it. Returns {byRow: Map(row → id), givenMismatch,
// problems, saved}.
export async function reconcile(read, { readAtDb }) {
  for (let attempt = 0; ; attempt++) {
    const [records, [lock], [first]] = await Promise.all([
      sql`SELECT id, name, name_key, outreach_row, sheet_seen, advance_given, removed_at, updated_at::text AS seen_at
          FROM ar_prospects WHERE merged_into IS NULL`,
      sql`SELECT (value->>'until')::timestamptz > ${new Date(readAtDb).toISOString()}::timestamptz AS overlap FROM app_state WHERE key = 'arSheetLock'`,
      sql`SELECT EXISTS (SELECT 1 FROM ar_prospects) AS any`,
    ]);
    const recs = records.map((r) => ({ ...r, removed: !!r.removed_at, outreach_row: r.outreach_row == null ? null : Number(r.outreach_row) }));
    const m = matchProspects(read.rows, recs, { totalRow: read.layout.totalRow });
    const byRow = new Map(m.pairs.map((p) => [p.row.row, p.rec.id]));
    const givenMismatch = [];
    const stmts = [];
    const ev = (prospectId, kind, textOf, cells = [], onlyIfTouched = true) => {
      const id = uid() + uid();
      // an event about an existing record is only kept when this transaction really changed it (a
      // second load reconciling the same edit at the same moment leaves it to the first)
      stmts.push(onlyIfTouched
        ? sql`INSERT INTO ar_events (id, prospect_id, by, kind, text, cells) SELECT ${id}, ${prospectId}, 'sheet', ${kind}, ${textOf}, ${JSON.stringify(cells)}::jsonb
              WHERE EXISTS (SELECT 1 FROM ar_prospects WHERE id = ${prospectId} AND updated_at = now())`
        : sql`INSERT INTO ar_events (id, prospect_id, by, kind, text, cells) VALUES (${id}, ${prospectId}, 'sheet', ${kind}, ${textOf}, ${JSON.stringify(cells)}::jsonb)`);
    };
    const takenRows = new Set([...m.pairs.map((p) => p.row.row), ...m.created.map((r) => r.row)]);
    // rows first freed, so a hand sort's swaps can't trip the one-record-per-row index
    for (const p of m.pairs) if (p.rec.outreach_row !== p.row.row && p.rec.outreach_row != null)
      stmts.push(sql`UPDATE ar_prospects SET outreach_row = NULL WHERE id = ${p.rec.id} AND updated_at::text = ${p.rec.seen_at}`);
    for (const rec of [...m.gone, ...m.held.filter((x) => takenRows.has(x.outreach_row))])
      stmts.push(sql`UPDATE ar_prospects SET outreach_row = NULL WHERE id = ${rec.id} AND updated_at::text = ${rec.seen_at}`);

    for (const { rec, row, how } of m.pairs) {
      const seen = rec.sheet_seen || {};
      let given = rec.advance_given || "";
      const events = [];
      if (row.given != null) {
        // a hand edit of "Advance given?" in place is the sheet's answer; after a move the flag may be
        // the one left behind by a sort, so it's only reported (the banner's fix decides)
        if (how !== "moved" && row.given !== (seen.given ?? given) && row.given !== given) {
          events.push(["given", `Advance given changed in the sheet: ${given || "blank"} → ${row.given || "blank"}`, []]);
          given = row.given;
        } else if (row.given !== given) givenMismatch.push({ prospectId: rec.id, name: row.name, sheet: row.given, remembered: given });
      }
      const next = { ...seenOf(row), given: row.given ?? seen.given ?? null };
      const cols = changedCols(row, seen).filter((c) => !(how === "renamed" && c === "A"));
      if (how === "moved") events.push(["moved", `Moved in the sheet from row ${rec.outreach_row ?? "?"} to row ${row.row}`, []]);
      if (how === "renamed") events.push(["sheet_edit", `Renamed in the sheet: ${rec.name} → ${row.name}`, cellList(["A"], row.row, seen, row.cells)]);
      if (cols.length && Object.keys(seen).length) events.push(["sheet_edit", `Changed in the sheet: ${list([...new Set(cols.map((c) => COL_LABEL[c]))])}`, cellList(cols, row.row, seen, row.cells)]);
      const differs = rec.outreach_row !== row.row || rec.name !== row.name || rec.name_key !== row.key || given !== (rec.advance_given || "") || !sameSeen(next, seen);
      if (!differs) continue;
      stmts.push(sql`UPDATE ar_prospects SET outreach_row = ${row.row}, name = ${row.name}, name_key = ${row.key}, advance_given = ${given},
        sheet_seen = ${JSON.stringify(next)}::jsonb, sheet_seen_at = now(), updated_at = now() WHERE id = ${rec.id} AND updated_at::text = ${rec.seen_at}`);
      for (const [kind, t, cells] of events) ev(rec.id, kind, t, cells);
    }
    const newIds = [];
    for (const row of m.created) {
      const id = uid();
      newIds.push([row.row, id]);
      stmts.push(sql`INSERT INTO ar_prospects (id, name, name_key, outreach_row, sheet_seen, sheet_seen_at, advance_given, source, created_by)
        VALUES (${id}, ${row.name}, ${row.key}, ${row.row}, ${JSON.stringify(seenOf(row))}::jsonb, now(), ${row.given || ""}, 'sheet', 'sheet')`);
      ev(id, "imported", first.any ? `Typed into the OUTREACH tab by hand (row ${row.row})` : `Found in the OUTREACH tab (row ${row.row})`, [], false);
    }
    for (const rec of m.gone) {
      const seen = rec.sheet_seen || {};
      stmts.push(sql`UPDATE ar_prospects SET removed_at = now(), removed_by = 'sheet', updated_at = now() WHERE id = ${rec.id} AND updated_at::text = ${rec.seen_at}`);
      ev(rec.id, "gone", `Gone from the OUTREACH tab (row ${rec.outreach_row ?? "?"} was cleared in the sheet)`,
        cellList(OWNED_COLS.filter((c) => !isBlank(seen[c])), rec.outreach_row ?? 0, seen, {}));
    }
    // the one-time "found N prospects" card, only for the load that brought them in
    if (!first.any && newIds.length) stmts.push(sql`INSERT INTO app_state (key, value, updated_at) VALUES ('arFirstRun', ${JSON.stringify({ found: newIds.length, at: new Date().toISOString(), dismissed: false })}::jsonb, now())
      ON CONFLICT (key) DO NOTHING`);

    const problems = [];
    for (const d of m.dups) problems.push({ id: "duplicateName", text: `Two OUTREACH rows are named ${d.name} (rows ${list(d.rows.map(String))}). Rename one in the sheet.` });
    if (m.guard === "manyMissing") problems.push({ id: "manyMissing", text: `${m.held.length} prospects disappeared from the OUTREACH tab at once (${list(m.held.map((x) => x.name))}), so the dashboard didn't take them off the board. If that was on purpose, remove them here. If not, undo the change in the sheet.` });

    const result = { byRow, givenMismatch, problems, saved: false };
    if (lock?.overlap || !stmts.length) return result;
    try {
      await sql.transaction(stmts);
      for (const [row, id] of newIds) byRow.set(row, id);
      return { ...result, saved: true };
    } catch (err) {
      // two loads at once both adding the same rows: the second starts over from the first's records
      if (err?.code === "23505" && attempt < 2) continue;
      throw err;
    }
  }
}

// --- GET /api/ar (Postgres only) ---------------------------------------
const trackOut = (t) => ({
  id: t.id, prospectId: t.prospect_id, kind: t.kind, name: t.name, artist: t.artist, cover: t.cover, link: t.link, spotifyId: t.spotify_id,
  isrc: t.isrc, isrcSource: t.isrc_source, isrcChecked: !!t.isrc_checked_at, luminateId: t.luminate_id, via: t.via, portfolioId: t.portfolio_id,
  addedAt: t.added_at, slot: t.slot == null ? null : Number(t.slot), share: t.share == null ? null : Number(t.share), skip: t.skip,
  state: t.skip ? "skip" : t.luminate_id ? "tracked" : t.portfolio_id ? "waiting" : "toAdd", numbers: null,
});

// What the board draws before (or without) the sheet: every record with its follow-up, socials and
// tracked songs. The Luminate parts (portfolios, plan, gainers…) fill in with the A&R exports.
export async function arState() {
  const [recs, tracks, portfolios, lastUpload, cron] = await Promise.all([
    // (follow_up_on as text: the driver's Date for a date column sits at the server's local midnight)
    sql`SELECT *, follow_up_on::text AS follow_up_day FROM ar_prospects WHERE merged_into IS NULL ORDER BY outreach_row NULLS LAST, created_at`,
    sql`SELECT * FROM ar_tracking WHERE removed_at IS NULL ORDER BY slot NULLS LAST, created_at`,
    sql`SELECT * FROM ar_portfolios ORDER BY sort, created_at`,
    sql`SELECT value FROM app_state WHERE key = 'arLastUpload'`,
    sql`SELECT value FROM app_state WHERE key = 'cron'`,
  ]);
  const today = nyToday();
  const byProspect = new Map();
  for (const t of tracks) byProspect.set(t.prospect_id, [...(byProspect.get(t.prospect_id) || []), trackOut(t)]);
  let untitled = 0;
  const prospects = recs.map((r) => {
    const seen = r.sheet_seen || {};
    const tracked = byProspect.get(r.id) || [];
    if (!r.removed_at) untitled += SLOT_COLS.filter(([s, w], i) => (!isBlank(seen[s]) || !isBlank(seen[w])) && !tracked.some((t) => t.slot === i + 1)).length;
    const on = r.follow_up_day || null;
    return {
      id: r.id, name: r.name, row: r.outreach_row == null ? null : Number(r.outreach_row), status: text(seen.O).trim(),
      removedAt: r.removed_at, clientId: r.client_id, convertedAt: r.converted_at, source: r.source,
      followUp: { on, note: r.follow_up_note, ...followUpState(on, today) },
      socials: { instagram: r.instagram, tiktok: r.tiktok, youtube: r.youtube, spotify: r.spotify },
      tracked, growth: null,
    };
  });
  return {
    prospects,
    portfolios: portfolios.map((p) => ({ id: p.id, luminateId: p.luminate_id, name: portfolioName(p.luminate_id, p.name), url: p.url || portfolioUrl(p.luminate_id), holds: p.holds, capacity: Number(p.capacity),
      usedCount: 0, pendingCount: 0, missingCount: 0, artistCount: 0, songCount: 0, otherCount: 0, exportedAt: null, weekly: false, fileName: "" })),
    plan: { artists: { slots: [], left: [] }, songs: { slots: [], left: [] } },
    unmatched: [], waiting: [], freeUp: [],
    gainers: { prospects: { byWeek: [], byPct: [] }, songs: { byWeek: [], byPct: [] }, asOf: null },
    lastUpload: lastUpload[0]?.value ?? null, cron: { lastRanAt: cron[0]?.value?.at ?? null }, untitled,
  };
}

// The Watchlist as GET /api/ar serves it (Postgres only): the A&R lists' newest exports, everyone
// tracked, who matches which row, and who still has to be added in Luminate
export async function arWatchNow(state = null) {
  const [st, held, rows, clients] = await Promise.all([state || arState(), arHeldLatest(),
    sql`SELECT *, last_contact::text AS last_contact_day, follow_up::text AS follow_up_day FROM ar_tracked WHERE removed_at IS NULL ORDER BY created_at`,
    sql`SELECT id, name, sheet_tab_name FROM clients`]);
  const noWeek = held.flatMap((h) => (h.entities || []).filter((e) => e.last == null || e.longPeriod).map((e) => e.id));
  const arLists = arListsOf(held, { series: noWeek.length ? await seriesFor(noWeek) : {} }), tracked = rows.map(trackedOut);
  const watch = arWatchOf({ prospects: st.prospects, tracked, lists: arLists, clients });
  return { state: st, tracked, arLists, watch, toLuminate: arToLuminateOf({ watch, tracked, lists: arLists, cap: PORTFOLIO_CAP }) };
}

// The sidebar badge and the Dashboard's task lines (toLuminate: the "add to your A&R lists" task)
export async function arSummary() {
  const today = nyToday();
  const [[{ due }], { toLuminate, watch }] = await Promise.all([sql`SELECT count(*)::int AS due FROM ar_prospects
    WHERE follow_up_on <= ${today}::date AND removed_at IS NULL AND merged_into IS NULL AND client_id IS NULL
      AND COALESCE(sheet_seen->>'O', '') NOT IN ('Signed', 'Passed')`, arWatchNow()]);
  // the Dashboard's This week › A&R: the same top people as A&R › Summary, only what its rows show
  // (open: tracked here, so the row opens their panel; a Luminate-only row is just shown)
  const byKey = new Map(watch.people.map((r) => [r.key, r]));
  const people = (watch.top?.people || []).filter((k) => byKey.has(k.key)).map((k) => { const r = byKey.get(k.key); return {
    key: r.key, name: r.name, role: r.role, stage: r.stage || null, thisWeek: r.thisWeek, wowPct: r.wowPct, ranked: !!k.ranked, open: !!r.ref,
  }; });
  return { followUpsDue: due, toMatch: 0, toAdd: 0, arStaleDays: null, toLuminate, top: { people, period: watch.periods?.people || null } };
}

// "Same person as…": an off-the-board record's songs, history, follow-up and socials move to the
// live one, and the old record remembers where it went. Postgres only.
export async function mergeProspect(fromId, intoId, by) {
  if (!fromId || !intoId || fromId === intoId) throw new ArError(400, "Pick two different prospects.");
  const [[from], [into]] = await Promise.all([
    sql`SELECT *, follow_up_on::text AS follow_up_day FROM ar_prospects WHERE id = ${fromId}`, sql`SELECT *, follow_up_on::text AS follow_up_day FROM ar_prospects WHERE id = ${intoId}`,
  ]);
  if (!from || !into || from.merged_into || into.merged_into) throw new ArError(404, "One of those prospects isn't on the dashboard anymore. Reload the page.");
  if (!from.removed_at) throw new ArError(409, `${from.name} is still on the board. Take them off the board first.`);
  if (into.removed_at) throw new ArError(409, `${into.name} is off the board. Put them back first.`);
  const later = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  const on = later(into.follow_up_day, from.follow_up_day);
  const keep = (a, b) => a || b || "";
  await sql.transaction([
    // songs it was following go along; their sheet slots stay with the old row, and a song both follow is kept once
    sql`UPDATE ar_tracking SET removed_at = now(), updated_at = now() WHERE prospect_id = ${fromId} AND removed_at IS NULL AND luminate_id <> ''
      AND luminate_id IN (SELECT luminate_id FROM ar_tracking WHERE prospect_id = ${intoId} AND removed_at IS NULL)`,
    sql`UPDATE ar_tracking SET prospect_id = ${intoId}, slot = NULL, updated_at = now() WHERE prospect_id = ${fromId}`,
    sql`UPDATE ar_events SET prospect_id = ${intoId} WHERE prospect_id = ${fromId}`,
    sql`UPDATE ar_prospects SET follow_up_on = ${on}, follow_up_note = ${on === into.follow_up_day ? into.follow_up_note : from.follow_up_note},
      instagram = ${keep(into.instagram, from.instagram)}, tiktok = ${keep(into.tiktok, from.tiktok)}, youtube = ${keep(into.youtube, from.youtube)}, spotify = ${keep(into.spotify, from.spotify)},
      updated_at = now() WHERE id = ${intoId}`,
    sql`UPDATE ar_prospects SET merged_into = ${intoId}, updated_at = now() WHERE id = ${fromId}`,
    sql`INSERT INTO ar_events (id, prospect_id, by, kind, text) VALUES (${uid() + uid()}, ${intoId}, ${by}, 'merge', ${`${by} merged ${from.name} into ${into.name} (same person)`})`,
  ]);
  return { ok: true, prospectId: intoId };
}
