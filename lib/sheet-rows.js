// Room on the pub sheet's writer tabs (owner 2026-11-13: "i dont want things to break … make sure everything still
// works how it should be on the sheet especially"). A client's tab with fewer than ROOM_MIN empty song rows above its
// Total row gets ROOM_ADD more, the way GloryTonio's tab was given 100 by hand on 2026-11-12:
//   - the rows go in INSIDE the summed range, above the tab's last song row, so Sheets itself widens every range that
//     covers the songs: the Total row's SUMs, rows 1-2 (which read Total) and MASTER's COUNTA / Total refs
//   - one batchUpdate, all or nothing: the insert, the row above's formatting copied down, and each new row's C and
//     E:L set to the standard formulas (lib/sheets.js standardFormula), never copied from a neighbour, so a rate typed
//     on one row by hand stays on that row only
//   - refused, with the reason, when the tab isn't laid out as every client tab is (a Total row whose C, E, G, H, J,
//     K and L are =SUM(x5:x<the last song row>))
//   - read back: every cell of the tab where it moved to, formulas with their rows shifted; the new rows blank but for
//     their formulas; every formula on another tab that points here (MASTER's row) widened and reading the same value;
//     the tab's summary block the same values. A difference is a loud `alarm` (the rows went in)
// One run per tab at a time (an app_state claim). Writes only with the pub sheet's write gate on (PUB_SHARE_WRITES).
//   keepRoom    the nightly cron: every client's tab, at most MAX_RUN extended a night (the state Site › Sync reads)
//   extendTab   one tab; also lib/sheet-writes.js guardedPush, when a push finds the tab full
// Server-only.
import { sql } from "./db";
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, standardFormula } from "./sheets";
import { isFormula, shortF } from "./sheet-guard";
import { shareWritesOn } from "./split-fixes-store";
import { claimState, setState } from "./app-state";

export const ROOM_MIN = 20; // fewer empty song rows than this and the nightly run adds more
export const ROOM_ADD = 50;
export const ROOM_KEY = "sheetRoom"; // app_state: the last nightly check (Site › Sync)
const MAX_RUN = 3; // tabs extended in one nightly run (each is about six Sheets calls)
const LEASE_MIN = 3; // a run that never finished frees its tab after this long
const DATA_START = 5; // rows 1-4 are each tab's summary block (lib/sheets.js DATA_START_ROW)
const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // read and compared A:Z (the tabs use A:N; anything past N moves too)
const SUMMED = ["C", "E", "G", "H", "J", "K", "L"]; // the Total row's =SUM columns
const STANDARD = ["C", "E", "F", "G", "H", "I", "J", "K", "L"]; // the formula columns a new row gets (D, the share, stays blank)
const qt = (title) => title.replace(/'/g, "''");
const cell = (grid, row, col) => grid[row - 1]?.[COLS.indexOf(col)];
const blank = (v) => v == null || String(v).trim() === "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- pure (tests/tab-room.mjs) -------------------------------------------------------------------------------------
// the tab's "Total" row (column A), or null
export function totalOf(grid) {
  for (let r = DATA_START; r <= grid.length; r++) if (String(grid[r - 1]?.[0] ?? "").trim() === "Total") return r;
  return null;
}
// empty song rows above Total (A blank): what a push can still use (lib/sheets.js firstEmptyRow); null without Total
export function freeRows(grid, total = totalOf(grid)) {
  if (total == null) return null;
  let n = 0;
  for (let r = DATA_START; r < total; r++) if (blank(grid[r - 1]?.[0])) n++;
  return n;
}
// why rows can't be added to this tab (a sentence), or null: it has a Total row, song rows above it, and the Total
// row's sums cover exactly rows 5 to the one above it
export function layoutProblem(grid, tab) {
  const total = totalOf(grid);
  if (total == null) return `The ${tab} tab has no Total row, so no rows were added.`;
  const last = total - 1;
  if (last < DATA_START + 1) return `The ${tab} tab has no song rows above its Total row, so no rows were added.`;
  const off = SUMMED.find((c) => String(cell(grid, total, c) ?? "").replace(/\s+/g, "").toUpperCase() !== `=SUM(${c}${DATA_START}:${c}${last})`);
  if (off) return `${off}${total} on the ${tab} tab reads ${shortF(cell(grid, total, off))}, not =SUM(${off}${DATA_START}:${off}${last}), so no rows were added.`;
  return null;
}

// A1 refs in a formula with their rows moved the way inserting `add` rows at row `at` of `tab` moves them: every row
// number from `at` down goes up by `add`, each end of a range on its own (so a range across the insert widens). On the
// tab itself (own) a ref without a sheet name moves; anywhere, a ref naming the tab moves; text in "quotes" never does.
const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)`;
const ONE = String.raw`\$?[A-Z]{1,3}\$?\d+`;
const TOKEN = new RegExp(String.raw`(?<![A-Za-z0-9_.$'!])(${SHEET}!)?(${ONE})(?::(${ONE}))?(?![A-Za-z0-9_(!])`, "g");
const sheetName = (prefix) => (prefix.startsWith("'") ? prefix.slice(1, -2).replace(/''/g, "'") : prefix.slice(0, -1));
const moveOne = (ref, at, add) => ref.replace(/^(\$?[A-Z]{1,3}\$?)(\d+)$/, (m, col, n) => col + (Number(n) >= at ? Number(n) + add : n));
export function shiftRows(f, { tab, at, add, own = false }) {
  return String(f).split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(TOKEN, (m, prefix, a, b) => {
    const mine = prefix ? sheetName(prefix) === tab : own;
    if (!mine) return m;
    return `${prefix || ""}${moveOne(a, at, add)}${b ? `:${moveOne(b, at, add)}` : ""}`;
  }))).join("");
}
// does this formula name the tab? ('Liyakk!'!C65, GloryTonio!A5)
export function namesTab(f, tab) {
  if (!isFormula(f)) return false;
  for (const part of String(f).split(/("(?:[^"]|"")*")/).filter((_, i) => i % 2 === 0)) {
    for (const m of part.matchAll(new RegExp(`${SHEET}!`, "g"))) if (sheetName(m[0]) === tab) return true;
  }
  return false;
}

// The one batchUpdate: `add` rows inserted above the last song row (total - 1), inheriting the row above's
// properties; that row's formatting (and validation) pasted onto them; their C and E:L given the standard formulas
export function insertRequests(sheetId, grid, add) {
  const total = totalOf(grid), at = total - 1, src = at - 1;
  const rows = [];
  for (let r = at; r < at + add; r++) rows.push({ values: "CDEFGHIJKL".split("").map((c) => (STANDARD.includes(c) ? { userEnteredValue: { formulaValue: standardFormula(c, r) } } : {})) });
  const span = (r0, r1) => ({ sheetId, startRowIndex: r0 - 1, endRowIndex: r1, startColumnIndex: 0, endColumnIndex: 14 });
  return [
    { insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: at - 1, endIndex: at - 1 + add }, inheritFromBefore: true } },
    { copyPaste: { source: span(src, src), destination: span(at, at + add - 1), pasteType: "PASTE_FORMAT" } },
    { updateCells: { start: { sheetId, rowIndex: at - 1, columnIndex: 2 }, rows, fields: "userEnteredValue" } },
  ];
}

// What reads differently after the insert, in words ([] = all as it should be). before/after: the tab A1:Z as
// formulas; refs: [{ t, cell, f, v }] formulas elsewhere that name the tab, with their value before; refsAfter:
// [{ f, v }] the same cells after; summary/summaryAfter: rows 1-2 as values
const sameValue = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : String(a ?? "") === String(b ?? ""));
export function readBackProblems({ tab, at, add, before, after, refs = [], refsAfter = [], summary = [], summaryAfter = [] }) {
  const bad = [], total = totalOf(before);
  if (totalOf(after) !== total + add) bad.push(`its Total row is row ${totalOf(after)}, not ${total + add}`);
  before.forEach((row, i) => (row || []).forEach((v, j) => {
    if (j >= COLS.length) return;
    const r = i + 1, nr = r >= at ? r + add : r;
    const want = isFormula(v) ? shiftRows(v, { tab, at, add, own: true }) : v, got = after[nr - 1]?.[j];
    if (!sameValue(got, want)) bad.push(`${COLS[j]}${r} (now ${COLS[j]}${nr}) reads ${shortF(got)}, not ${shortF(want)}`);
  }));
  for (let r = at; r < at + add; r++) for (const c of COLS) {
    const want = STANDARD.includes(c) ? standardFormula(c, r) : "", got = cell(after, r, c);
    if (String(got ?? "") !== want) bad.push(`new ${c}${r} reads ${shortF(got)}, not ${shortF(want)}`);
  }
  refs.forEach((x, i) => {
    const want = shiftRows(x.f, { tab, at, add }), got = refsAfter[i] || {};
    if (got.f !== want) bad.push(`${x.t}!${x.cell} reads ${shortF(got.f)}, not ${shortF(want)}`);
    else if (!sameValue(got.v, x.v)) bad.push(`${x.t}!${x.cell} was ${x.v}, now ${got.v}`);
  });
  summary.forEach((row, i) => (row || []).forEach((v, j) => { if (!sameValue(summaryAfter[i]?.[j], v)) bad.push(`${COLS[j]}${i + 1} was ${v}, now ${summaryAfter[i]?.[j] ?? "blank"}`); }));
  return bad;
}

// --- the sheet ----------------------------------------------------------------------------------------------------
const readGrid = async (sheets, spreadsheetId, tab, render = "FORMULA", range = "A1:Z2000") =>
  (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tab)}'!${range}`, valueRenderOption: render })).data.values || [];
// the formulas on every other tab that name this one, and what each reads now
async function refsTo(sheets, spreadsheetId, others, tab) {
  if (!others.length) return [];
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: others.map((t) => `'${qt(t)}'!A1:Z2000`), valueRenderOption: "FORMULA" });
  const refs = [];
  (got.data.valueRanges || []).forEach((vr, k) => (vr.values || []).forEach((row, i) => (row || []).forEach((f, j) => {
    if (j < COLS.length && namesTab(f, tab)) refs.push({ t: others[k], cell: `${COLS[j]}${i + 1}`, f });
  })));
  return refs;
}
async function refCells(sheets, spreadsheetId, refs, render) {
  if (!refs.length) return [];
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: refs.map((x) => `'${qt(x.t)}'!${x.cell}`), valueRenderOption: render });
  return (got.data.valueRanges || []).map((vr) => vr.values?.[0]?.[0] ?? "");
}
const release = (key) => sql`UPDATE app_state SET updated_at = now() - interval '1 day' WHERE key = ${key}`.catch((err) => console.error("sheet rows: claim not released", err));

// `add` more song rows on one tab. { tab, added, at, total, free, alarm? } once the rows are in, else { tab, refused }
// (the layout isn't the known one, nothing written), { tab, busy } (another run is on this tab), { tab, skipped }
// (writes off). Throws when Google refuses the write (nothing changed: it's all or nothing).
export async function extendTab(sheets, spreadsheetId, tab, { add = ROOM_ADD, by = "" } = {}) {
  if (!shareWritesOn()) return { tab, skipped: "Adding rows to the pub sheet is off (PUB_SHARE_WRITES)." };
  const key = `sheetRows:${tab}`;
  if (!(await claimState(key, LEASE_MIN, { at: new Date().toISOString(), by }))) return { tab, busy: true };
  try {
    const props = await listTabs(sheets, spreadsheetId);
    const me = props.find((p) => p.title === tab);
    if (!me) return { tab, refused: `There's no ${tab} tab on the pub sheet, so no rows were added.` };
    const [before, refs] = await Promise.all([readGrid(sheets, spreadsheetId, tab), refsTo(sheets, spreadsheetId, props.filter((p) => p.title !== tab).map((p) => p.title), tab)]);
    const refused = layoutProblem(before, tab);
    if (refused) return { tab, refused };
    const total = totalOf(before), at = total - 1;
    const [vals, summary] = await Promise.all([refCells(sheets, spreadsheetId, refs, "UNFORMATTED_VALUE"), readGrid(sheets, spreadsheetId, tab, "UNFORMATTED_VALUE", "A1:N2")]);
    refs.forEach((x, i) => { x.v = vals[i]; });
    try {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: insertRequests(me.sheetId, before, add) } });
    } catch (err) {
      // an answer that never came may still have landed: the Total row says which
      const now = await readGrid(sheets, spreadsheetId, tab, "FORMULA", "A1:A2000").then(totalOf).catch(() => null);
      if (now !== total + add) throw new Error(`Couldn't add rows to the ${tab} tab: ${err.message}`);
    }
    const [after, fAfter, vAfter, summaryAfter] = await Promise.all([readGrid(sheets, spreadsheetId, tab), refCells(sheets, spreadsheetId, refs, "FORMULA"), refCells(sheets, spreadsheetId, refs, "UNFORMATTED_VALUE"), readGrid(sheets, spreadsheetId, tab, "UNFORMATTED_VALUE", "A1:N2")]);
    const bad = readBackProblems({ tab, at, add, before, after, refs, refsAfter: refs.map((_, i) => ({ f: fAfter[i], v: vAfter[i] })), summary, summaryAfter });
    const out = { tab, added: add, at, total: total + add, free: freeRows(after), refs: refs.length };
    if (bad.length) {
      out.alarm = `Check the ${tab} tab now: ${add} rows were added above row ${at}, but ${bad.length === 1 ? "one thing reads" : `${bad.length} things read`} differently after (${bad.slice(0, 3).join("; ")}${bad.length > 3 ? `; ${bad.length - 3} more` : ""}).`;
      console.error(`sheet rows: ${out.alarm}`);
    }
    return out;
  } finally { await release(key); }
}

// The nightly check: every client's tab, its empty song rows counted in one read; the tabs under ROOM_MIN get
// ROOM_ADD more, the fewest first, at most MAX_RUN a night and none started after `budgetMs` (the rest the next
// night). Saved for Site › Sync (ROOM_KEY). Never throws for one tab: each says what happened to it.
export async function keepRoom({ sheets = getSheetsClient(), spreadsheetId = getSheetId(), budgetMs = 20000, now = Date.now } = {}) {
  const start = now();
  const [props, known] = await Promise.all([listTabs(sheets, spreadsheetId), loadClientTabNames()]);
  const mine = [];
  for (const c of known) {
    const tab = findTab(props, (c.sheet_tab_name || c.name || "").trim(), tabsOfOthers(known, c));
    if (tab && !mine.some((t) => t.title === tab.title)) mine.push({ ...tab, client: c.name });
  }
  const got = mine.length ? await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: mine.map((t) => `'${qt(t.title)}'!A1:A2000`) }) : { data: {} };
  const room = mine.map((t, i) => ({ tab: t.title, sheetId: t.sheetId, client: t.client, free: freeRows(got.data.valueRanges?.[i]?.values || []) }));
  const out = { at: new Date(start).toISOString(), min: ROOM_MIN, add: ROOM_ADD, off: !shareWritesOn(), room, extended: [], refused: [], failed: [], busy: [], later: [] };
  const low = room.filter((x) => x.free != null && x.free < ROOM_MIN).sort((a, b) => a.free - b.free);
  if (!out.off) {
    for (const x of low) {
      if (out.extended.length >= MAX_RUN || now() - start > budgetMs) { out.later.push(x.tab); continue; }
      try {
        const r = await extendTab(sheets, spreadsheetId, x.tab, { by: "nightly" });
        if (r.added) { out.extended.push({ tab: x.tab, added: r.added, from: x.free, ...(r.alarm ? { alarm: r.alarm } : {}) }); x.free = r.free; }
        else if (r.refused) out.refused.push({ tab: x.tab, reason: r.refused });
        else if (r.busy) out.busy.push(x.tab);
      } catch (err) { console.error(`sheet rows: ${x.tab}`, err); out.failed.push({ tab: x.tab, error: err.message }); }
      await sleep(250); // Google's per-minute write limit
    }
  }
  await setState(ROOM_KEY, out);
  return out;
}
