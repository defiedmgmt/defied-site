// A&R prospects: the permanent ids behind the OUTREACH tab's rows. The sheet stays the source of
// truth for everything it has a column for; ar_prospects holds the id each row is matched to (by
// name, every time the tab is read), plus what the sheet has no place for. matchProspects is pure;
// reconcile persists its answer and never writes to the sheet. Server-only.
import { sql } from "./db";
import { uid } from "./id";
import { personKey } from "./names";

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
    portfolios: portfolios.map((p) => ({ id: p.id, luminateId: p.luminate_id, name: p.name, url: p.url, holds: p.holds, capacity: Number(p.capacity),
      usedCount: 0, pendingCount: 0, missingCount: 0, artistCount: 0, songCount: 0, otherCount: 0, exportedAt: null, weekly: false, fileName: "" })),
    plan: { artists: { slots: [], left: [] }, songs: { slots: [], left: [] } },
    unmatched: [], waiting: [], freeUp: [],
    gainers: { prospects: { byWeek: [], byPct: [] }, songs: { byWeek: [], byPct: [] }, asOf: null },
    lastUpload: lastUpload[0]?.value ?? null, cron: { lastRanAt: cron[0]?.value?.at ?? null }, untitled,
  };
}

// The sidebar badge and the Dashboard's task lines
export async function arSummary() {
  const today = nyToday();
  const [{ due }] = await sql`SELECT count(*)::int AS due FROM ar_prospects
    WHERE follow_up_on <= ${today}::date AND removed_at IS NULL AND merged_into IS NULL AND client_id IS NULL
      AND COALESCE(sheet_seen->>'O', '') NOT IN ('Signed', 'Passed')`;
  return { followUpsDue: due, toMatch: 0, toAdd: 0, arStaleDays: null };
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
