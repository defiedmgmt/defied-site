// Server side of lib/split-fixes.js. Server-only.
//   autoState / recordAuto / undoAuto: the even splits confirmed by themselves (app_state "splitsAuto": done =
//     [{ id, song, client, before, after, at }], newest last; held = song ids Undo put back, never confirmed again)
//   fillBlankShare: the one sheet write, "fill in the sheet's blank share". Only the Writer Share cell (D) of the
//     song's own row is written, only while that cell is still blank and the row is the one the dialog named, only
//     for a song whose split here is still the client's 100%, with the share typed in the dialog (r11: 100 unless
//     the owner types another; the browser then saves that share on the site too), and only with
//     PUB_SHARE_WRITES=on (read at call time; off by default, so the live site writes nothing until the owner
//     says so). The song's sheet facts are read again afterwards (and on a refusal, so a reload shows the sheet).
//   setSheetShare (r11 todoedit): "Use the sheet's split" with a share typed other than the sheet's: the same one
//     cell (D) of the song's row, only while the site still has no split for it, the row is the one the dialog
//     named and the cell still holds the share the dialog showed; PUB_SHARE_WRITES as above.
//   pushGuard / pushAfter (r11 todoedit; r11 todofix: the guard itself is inside the routes that write now,
//     lib/sheet-writes.js, so these are To do's own reads around it): pushGuard is the cards' pre-check, run before
//     anything changes, so the owner sees a problem first: it finds the row the push will write the way the push
//     does and holds it to the same rules (lib/sheet-guard.js rowRefusal, lib/split-fixes.js pushShareProblem),
//     and returns the tab's formulas in short; pushAfter reads them again when a push or a stamp didn't come back
//     (no answer, an error that doesn't say nothing was written) and says loudly if any changed. Both read the
//     tab of the song's own client, worked out here from the placement, never one the browser names.
// Every write here reads the tab with FORMULA first: a cell that holds a formula is never written (refused, naming
// the cell), nor the Total row, and after the write the whole tab's formulas are read again and must be exactly as
// they were (else the answer says which ones changed, loudly).
import { sql } from "./db";
import { offText } from "./preview";
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, readTabRows, normalizeTitle } from "./sheets";
import { sheetRowFor } from "./sheet-facts";
import { sheetFactQueries, saveSheetFacts } from "./sheet-facts-store";
import { findByName, ownerOf, personKey } from "./names";
import { typedShare, pushShareProblem } from "./split-fixes";
import { readFormulas, formulaChanges, rowRefusal, readBack, isFormula, alarmText, shortF, totalRowOf, cellAt, sharePct, DATA_START as START } from "./sheet-guard";
import { extendProblem } from "./sheet-rows";
export { formulaChanges };

const KEY = "splitsAuto";
const KEEP = 800; // the newest confirmations kept for Undo (a first run on a real catalog can confirm a hundred or more)
// read like logWritesOn: "On", "ON" or a trailing newline from the env editor still count as on
export const shareWritesOn = () => String(process.env.PUB_SHARE_WRITES ?? "").trim().toLowerCase() === "on";

export async function autoState() {
  const [r] = await sql`SELECT value FROM app_state WHERE key = ${KEY}`;
  const v = r?.value || {};
  return { done: Array.isArray(v.done) ? v.done : [], held: Array.isArray(v.held) ? v.held : [] };
}
const save = (v) => sql`INSERT INTO app_state (key, value, updated_at) VALUES (${KEY}, ${JSON.stringify(v)}, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;

const isSplits = (x) => Array.isArray(x) && x.length <= 40 && x.every((s) => s && typeof s === "object" && Number.isFinite(Number(s.percent ?? 0)));
// items: what the browser just confirmed ([{ id, song, client, before, after }]); a held song is never recorded
export async function recordAuto(items, by = "") {
  if (!Array.isArray(items) || !items.length || items.length > KEEP) return { error: "Nothing to record." };
  if (!items.every((x) => x && typeof x.id === "string" && x.id.length <= 40 && isSplits(x.before) && isSplits(x.after))) return { error: "Those splits don't look right." };
  const st = await autoState();
  const ids = new Set(items.map((x) => x.id));
  const at = new Date().toISOString();
  const add = items.filter((x) => !st.held.includes(x.id)).map((x) => ({ id: x.id, song: String(x.song || "").slice(0, 200), client: String(x.client || "").slice(0, 120), before: x.before, after: x.after, at, by }));
  await save({ done: [...st.done.filter((d) => !ids.has(d.id)), ...add].slice(-KEEP), held: st.held });
  return { ok: true, recorded: add.length };
}
// Undo: these leave the list and are never confirmed by themselves again (the browser puts the old split back)
export async function undoAuto(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > KEEP || !ids.every((x) => typeof x === "string")) return { error: "Nothing to undo." };
  const st = await autoState();
  const set = new Set(ids);
  const undone = st.done.filter((d) => set.has(d.id));
  await save({ done: st.done.filter((d) => !set.has(d.id)), held: [...new Set([...st.held, ...ids])] });
  return { ok: true, undone };
}

const qt = (title) => title.replace(/'/g, "''");
// the % as the sheet keeps it: 50 -> 0.5, 33.3 -> 0.333 (never 0.33299999999999996), 100 -> 1
const sheetShare = (pct) => Math.round(pct * 10) / 1000;

// ---- the formula guard (lib/sheet-guard.js, shared with the routes that write: lib/sheet-writes.js)
const COLS = "ABCDEFGHIJKLMN"; // a pub sheet tab: A Song Title … M Luminate ID, N Site Sync ID (lib/sheets.js)
// One cell of a pub sheet row written by this file (D: the Writer Share), with the guard on both sides: read the tab
// with FORMULA, refuse the cell if it holds a formula (or the row is the Total row), write, read the tab again,
// compare every formula and read the cell back. { ok, alarm? } or { refused }
async function writeShareCell(sheets, spreadsheetId, tab, row, value) {
  const before = await readFormulas(sheets, spreadsheetId, tab);
  const refused = rowRefusal(before, tab, row, ["D"]);
  if (refused) return { refused };
  try {
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: [{ range: `'${qt(tab)}'!D${row}`, values: [[value]] }] } });
  } catch (err) {
    // read back all the same (it may have landed), and said with the error (pages/api/split-fixes.js)
    err.readBack = await readBack(sheets, spreadsheetId, tab, before, []);
    throw err;
  }
  const back = await readBack(sheets, spreadsheetId, tab, before, [{ cell: `D${row}`, value }]);
  return back.ok ? { ok: true } : { ok: true, alarm: back.alarm };
}
// { ok, tab, row, cell, share, value } or { error, status }. share: the % typed in the dialog (100 when the request
// has none, as before r11); row: the sheet row the dialog named (a row that has moved since is refused).
// io: { sheets, spreadsheetId } for the tests and the dry run (the real client otherwise)
export async function fillBlankShare(placementId, { share = 100, row: shown = null } = {}, io = {}) {
  if (!shareWritesOn()) return { status: 503, off: true, error: offText("Writing to the pub sheet from here isn't switched on yet.") };
  const typed = typedShare(share);
  if (typed.reason) return { status: 400, error: typed.reason };
  const [p] = await sql`SELECT id, client_id, song, luminate_id, splits FROM placements WHERE id = ${String(placementId || "")}`;
  if (!p) return { status: 404, error: "That song isn't on the site anymore. Reload the page." };
  const known = await loadClientTabNames();
  const c = known.find((k) => k.id === p.client_id);
  // the site's own copy decides which songs may be filled: the client's own share there is still the whole 100%
  // (a typed share other than that is saved on the site by the browser, only after this write)
  const own = c && findByName(p.splits || [], c.name);
  if (!own || Math.abs(Number(own.percent) - 100) >= 0.05) return { status: 409, error: "Its split on the site isn't 100% any more. Reload the page." };
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const tab = findTab(await listTabs(sheets, spreadsheetId), (c.sheet_tab_name || c.name || "").trim(), tabsOfOthers(known, c));
  if (!tab) return { status: 409, error: `The pub sheet has no ${c.sheet_tab_name || c.name} tab.` };
  const songs = await sql`SELECT id, client_id, song, luminate_id FROM placements`;
  const live = new Set(songs.map((s) => s.id));
  // what the sheet says now, for that client's songs (the same facts a pull keeps)
  const keepFacts = (rows) => saveSheetFacts(sheetFactQueries(c.id, tab.title, songs.filter((s) => s.client_id === c.id), rows, live));
  const rows = await readTabRows(sheets, spreadsheetId, tab.title);
  const row = sheetRowFor({ id: p.id, song: p.song, luminateId: p.luminate_id }, rows, live);
  if (!row) return { status: 409, error: `"${p.song}" has no row on the ${tab.title} tab any more.` };
  // the dialog named a cell: a row added or removed above it since, and the share would land somewhere else
  if (shown != null && Number(shown) !== row.row) { await keepFacts(rows); return { status: 409, error: `"${p.song}" is on row ${row.row} of the ${tab.title} tab now, not ${shown}. Reload the page.` }; }
  // someone typed a share in meanwhile: theirs stands
  if (!row.shareBlank) { await keepFacts(rows); return { status: 409, error: `The share on row ${row.row} of the ${tab.title} tab isn't blank any more. Reload the page.` }; }
  const value = sheetShare(typed.share);
  // (a blank-looking D can still be a formula that shows nothing: never written over)
  const w = await writeShareCell(sheets, spreadsheetId, tab.title, row.row, value);
  if (w.refused) return { status: 409, error: w.refused };
  await keepFacts(await readTabRows(sheets, spreadsheetId, tab.title));
  return { ok: true, tab: tab.title, row: row.row, cell: `D${row.row}`, share: typed.share, value, ...(w.alarm ? { alarm: w.alarm } : {}) };
}

// "Use the sheet's split" with a share typed other than the sheet's (r11 todoedit): the sheet's Writer Share cell
// of the song's row becomes that share too, so both match. share: the % typed; row: the row the dialog named; from:
// the sheet's % the dialog showed. { ok, tab, row, cell, share, value, from, alarm? } or { error, status }
export async function setSheetShare(placementId, { share, row: shown = null, from = null } = {}, io = {}) {
  if (!shareWritesOn()) return { status: 503, off: true, error: offText("Writing to the pub sheet from here isn't switched on yet.") };
  const typed = typedShare(share);
  if (typed.reason) return { status: 400, error: typed.reason };
  if (!(Number(shown) >= 5) || !Number.isFinite(Number(from))) return { status: 400, error: "Reload the page and try again." };
  const [p] = await sql`SELECT id, client_id, song, luminate_id, splits FROM placements WHERE id = ${String(placementId || "")}`;
  if (!p) return { status: 404, error: "That song isn't on the site anymore. Reload the page." };
  // only the songs "Use the sheet's split" is for: no split on the site at all (the site's split is saved by the
  // browser right after this write)
  if ((p.splits || []).reduce((a, r) => a + (Number(r.percent) || 0), 0) > 0) return { status: 409, error: "It has a split on the site now. Reload the page." };
  const known = await loadClientTabNames();
  const c = known.find((k) => k.id === p.client_id);
  if (!c) return { status: 409, error: "Its client isn't on the site anymore. Reload the page." };
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const tab = findTab(await listTabs(sheets, spreadsheetId), (c.sheet_tab_name || c.name || "").trim(), tabsOfOthers(known, c));
  if (!tab) return { status: 409, error: `The pub sheet has no ${c.sheet_tab_name || c.name} tab.` };
  const songs = await sql`SELECT id, client_id, song, luminate_id FROM placements`;
  const live = new Set(songs.map((s) => s.id));
  const keepFacts = (rows) => saveSheetFacts(sheetFactQueries(c.id, tab.title, songs.filter((s) => s.client_id === c.id), rows, live));
  const rows = await readTabRows(sheets, spreadsheetId, tab.title);
  const row = sheetRowFor({ id: p.id, song: p.song, luminateId: p.luminate_id }, rows, live);
  if (!row) return { status: 409, error: `"${p.song}" has no row on the ${tab.title} tab any more.` };
  if (Number(shown) !== row.row) { await keepFacts(rows); return { status: 409, error: `"${p.song}" is on row ${row.row} of the ${tab.title} tab now, not ${shown}. Reload the page.` }; }
  // the share the dialog showed is still the one there: someone else's change since stands
  if (row.shareBlank || Math.abs(row.writerShare - Number(from)) >= 0.05) { await keepFacts(rows); return { status: 409, error: `The share on row ${row.row} of the ${tab.title} tab isn't ${Math.round(Number(from) * 10) / 10}% any more. Reload the page.` }; }
  const value = sheetShare(typed.share);
  const w = await writeShareCell(sheets, spreadsheetId, tab.title, row.row, value);
  if (w.refused) return { status: 409, error: w.refused };
  await keepFacts(await readTabRows(sheets, spreadsheetId, tab.title));
  return { ok: true, tab: tab.title, row: row.row, cell: `D${row.row}`, share: typed.share, value, from: Number(from), ...(w.alarm ? { alarm: w.alarm } : {}) };
}

// ---- To do's pre-check and read-back around the song row push (pushShare -> /api/sheets-push) and the merge's Site
// Sync ID stamp (/api/sheets-claim); the guard itself is inside those routes (lib/sheet-writes.js)
// The row the push writes, found the way the push finds it (lib/sheets.js: its Site Sync ID, then its Luminate ID,
// then an unclaimed row with its title, else the first empty row above Total), from one read of the tab as shown.
const syncParts = (id) => { const s = String(id || ""), i = s.indexOf(":"); return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };
export function pushRowOf(shown, { syncId, luminateId, song, liveIds }) {
  const cell = (r, j) => shown[r - 1]?.[j];
  const totalRow = totalRowOf(shown);
  const last = totalRow === null ? Math.max(shown.length, START) : totalRow - 1;
  // (findRowBySyncId reads N5:N2000, the Total row or not)
  const ns = []; for (let r = START; r <= Math.min(2000, Math.max(shown.length, START)); r++) ns.push(cell(r, 13));
  const [pid, who] = syncParts(syncId);
  let i = ns.findIndex((v) => v === syncId);
  if (i === -1 && personKey(who)) i = ns.findIndex((v) => { const [p, w] = syncParts(v); return p === pid && personKey(w) === personKey(who); });
  if (i !== -1) return { row: START + i, how: "syncId", totalRow };
  const lum = String(luminateId || "").trim();
  if (lum) for (let r = START; r <= last; r++) if (String(cell(r, 12) ?? "").trim() === lum) return { row: r, how: "luminate", totalRow };
  const want = normalizeTitle(String(song ?? ""));
  const live = liveIds == null ? null : new Set(liveIds);
  if (want) for (let r = START; r <= last; r++) {
    const sid = cell(r, 13) || "";
    if (sid && !(live && !live.has(String(sid).split(":")[0]))) continue;
    if (normalizeTitle(String(cell(r, 0) ?? "")) === want) return { row: r, how: "title", totalRow };
  }
  for (let r = START; r <= (totalRow === null ? shown.length : totalRow - 1); r++) if (!cell(r, 0)) return { row: r, how: "new", totalRow };
  return totalRow === null ? { row: Math.max(shown.length, START - 1) + 1, how: "new", totalRow } : { row: null, how: "full", totalRow };
}
// a short fingerprint of each row's formulas, so the after-check can name a row that changed anywhere on the tab
// without the whole tab going to the browser and back
const hash = (s) => { let h = 0x811c9dc5; for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193); return (h >>> 0).toString(36); };
const rowSigs = (grid) => {
  const out = {};
  grid.forEach((r, i) => { const f = (r || []).map((v, j) => (isFormula(v) ? `${COLS[j]}${v}` : "")).filter(Boolean).join("\u0001"); if (f) out[i + 1] = hash(f); });
  return out;
};
// The tab a song's push writes to: its own client's (the client's sheet tab name, trimmed, as pushShare sends it),
// worked out from the placement here, never one the browser names. memo: the client list and the tab list, read once
// for a whole Confirm all. { p, c, tab } or { error, status }
async function songTab(placementId, sheets, spreadsheetId, memo = {}) {
  const [p] = await sql`SELECT id, client_id, song, luminate_id, splits FROM placements WHERE id = ${String(placementId || "")}`;
  if (!p) return { status: 404, error: "That song isn't on the site anymore. Reload the page." };
  const known = memo.known || (memo.known = await loadClientTabNames());
  const c = known.find((k) => k.id === p.client_id);
  if (!c) return { status: 409, error: "Its client isn't on the site anymore. Reload the page." };
  const name = String(c.sheet_tab_name || c.name || "").trim();
  const tab = findTab(memo.tabs || (memo.tabs = await listTabs(sheets, spreadsheetId)), name, tabsOfOthers(known, ownerOf(known, name, c.id)));
  // (the push would claim a spare tab under their name: never from here)
  if (!tab) return { status: 409, error: `The pub sheet has no ${name} tab, so nothing was written to it.` };
  return { p, c, tab };
}
// The cards' pre-check, before anything changes (read-only): { placementId, percent (the share the push will send),
// splits (the split it comes from, about to be saved), exact (a Confirm: 100% in total; false, the merge: at most
// 100), row (the row the merge card read; else found as the push finds it), song (a merge's new title), liveIds }.
// The same rules the push route holds the write to: no formula in A, B, D or N of that row, not the Total row or
// below, and pushShareProblem for the share (the cell's own share now is always fine: a merge that only renames).
// memo: shared by a Confirm all's songs (each tab read once). (2026-11-13) A full tab passes when the push can give it
// more rows (lib/sheet-rows.js: the writes on, its layout the known one), the share checked as a new row's: how
// "extend", no row (rows move; guardAfter has nothing to compare). { ok, tab, row, how, sig, cells } or { error, status }
export async function pushGuard(b = {}, io = {}, memo = {}) {
  const percent = Number(b.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { status: 400, error: "That share has to be more than 0% and at most 100%." };
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const st = await songTab(b.placementId, sheets, spreadsheetId, memo);
  if (st.error) return st;
  const { p, c, tab } = st;
  const grids = memo.grids || (memo.grids = {});
  const g = grids[tab.title] || (grids[tab.title] = {
    shown: (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tab.title)}'!A1:N2000` })).data.values || [],
    formulas: await readFormulas(sheets, spreadsheetId, tab.title),
  });
  let row, how;
  if (b.row != null) {
    row = Number(b.row); how = "named";
    if (!(row >= START) || !Number.isInteger(row)) return { status: 400, error: "Reload the page and try again." };
  } else ({ row, how } = pushRowOf(g.shown, { syncId: `${p.id}:${String(c.sheet_tab_name || c.name || "").trim().toLowerCase()}`, luminateId: p.luminate_id, song: p.song, liveIds: Array.isArray(b.liveIds) ? b.liveIds : null }));
  const own = findByName(Array.isArray(b.splits) ? b.splits : [], c.name);
  const shareRules = { percent, site: own ? Number(own.percent) : null, splits: b.splits, check: b.exact === false ? "merge" : "confirm", who: c.name };
  if (!row) {
    const why = how === "full" ? extendProblem(g.formulas, tab.title) : null;
    if (how !== "full" || why) return { status: 409, error: `The ${tab.title} tab has no empty row above its Total row.${why ? ` ${why}` : ""}` };
    const bad = pushShareProblem({ ...shareRules, sheet: null });
    if (bad) return { status: 400, error: bad };
    return { ok: true, tab: tab.title, row: null, how: "extend", sig: null, cells: {} };
  }
  const refused = rowRefusal(g.formulas, tab.title, row, ["A", "B", "D", "N"], { A: typeof b.song === "string" ? b.song : p.song });
  if (refused) return { status: 409, error: refused };
  const bad = pushShareProblem({ ...shareRules, sheet: sharePct(cellAt(g.formulas, row, "D")) });
  if (bad) return { status: 400, error: bad };
  const cells = Object.fromEntries((g.formulas[row - 1] || []).map((v, j) => [COLS[j], v]).filter(([, v]) => isFormula(v)));
  return { ok: true, tab: tab.title, row, how, sig: rowSigs(g.formulas), cells };
}
// Confirm all's pre-check: each song as pushGuard checks it, the client list, the tab list and each tab read once.
// { ok, items: [each song's answer, in order] } or { error, status }
export async function pushGuards(items, io = {}) {
  if (!Array.isArray(items) || !items.length || items.length > 400) return { status: 400, error: "Nothing to check." };
  const memo = {}, out = [];
  for (const b of items) out.push(await pushGuard(b && typeof b === "object" ? b : {}, io, memo));
  return { ok: true, items: out };
}
// The read-back when a push or a stamp didn't come back (no answer, or an error that doesn't say nothing was
// written; the routes read their own writes back otherwise): { placementId, row, sig, cells, percent? } from
// pushGuard, on the song's own client's tab (from the placement). Every row's formulas as they were, the row's own
// formulas exactly, and (percent given) its share reading the percent sent. { ok } or { ok: false, alarm }
export async function pushAfter(b = {}, io = {}) {
  const row = Number(b.row);
  if (!(row >= START) || !b.sig || typeof b.sig !== "object") return { status: 400, error: "Nothing to check." };
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const st = await songTab(b.placementId, sheets, spreadsheetId);
  if (st.error) return st;
  const tab = st.tab.title;
  const grid = await readFormulas(sheets, spreadsheetId, tab);
  const now = rowSigs(grid);
  const changes = [];
  const mine = grid[row - 1] || [];
  for (const [c, f] of Object.entries(b.cells || {})) { const v = mine[COLS.indexOf(c)]; if (v !== f) changes.push(`${c}${row} was ${shortF(f)}, now ${isFormula(v) ? shortF(v) : "not a formula"}`); }
  for (const r of new Set([...Object.keys(b.sig), ...Object.keys(now)])) if (Number(r) !== row && b.sig[r] !== now[r]) changes.push(`the formulas on row ${r} changed`);
  for (const c of ["A", "B", "D", "N"]) if (isFormula(mine[COLS.indexOf(c)])) changes.push(`${c}${row} has a formula now`);
  const pct = Number(b.percent);
  if (b.percent != null && Number.isFinite(pct) && Math.abs(Number(mine[3]) * 100 - pct) > 1e-6) changes.push(`D${row} reads ${shortF(mine[3])}, not ${pct / 100}`);
  return changes.length ? { ok: false, alarm: alarmText(tab, changes) } : { ok: true };
}
