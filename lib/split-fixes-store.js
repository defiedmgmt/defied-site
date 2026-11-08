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
//   pushGuard / pushAfter (r11 todoedit): the formula guard around the writes this file doesn't make itself, the
//     song row push (pages/api/sheets-push.js, via pushOwnShare) Splits to confirm and the merge card send, and the
//     merge's Site Sync ID stamp (/api/sheets-claim). Read-only: pushGuard finds the row the push will write the
//     way the push does, refuses one whose A, B, D or N holds a formula, and returns the tab's formulas in short;
//     pushAfter reads them again once the push is done and says loudly if any changed.
// Every write here, and every write guarded here, reads the tab with FORMULA first: a cell that holds a formula is
// never written (refused, naming the cell), and after the write the whole tab's formulas are read again and must
// be exactly as they were (else the answer says which ones changed, loudly).
import { sql } from "./db";
import { offText } from "./preview";
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, readTabRows, normalizeTitle } from "./sheets";
import { sheetRowFor } from "./sheet-facts";
import { sheetFactQueries, saveSheetFacts } from "./sheet-facts-store";
import { findByName, ownerOf, personKey } from "./names";
import { typedShare, splitProblem } from "./split-fixes";

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

// ---- the formula guard
const COLS = "ABCDEFGHIJKLMN"; // a pub sheet tab: A Song Title … M Luminate ID, N Site Sync ID (lib/sheets.js)
const isFormula = (v) => typeof v === "string" && v.trim().startsWith("=");
// the tab as its formulas (FORMULA render), every row from the top: the summary block, the songs, the Total row
async function readFormulas(sheets, spreadsheetId, title) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(title)}'!A1:N2000`, valueRenderOption: "FORMULA" });
  return res.data.values || [];
}
// { "E41": "=IF(…)" } for every formula on the tab
const formulasOf = (grid) => {
  const out = {};
  grid.forEach((r, i) => (r || []).forEach((v, j) => { if (j < COLS.length && isFormula(v)) out[`${COLS[j]}${i + 1}`] = v; }));
  return out;
};
// what changed between two reads of the tab's formulas, in words ("E41 was =IF(…), now 0.5"); [] when nothing did
const shortF = (v) => (v == null || v === "" ? "blank" : String(v).length > 60 ? `${String(v).slice(0, 57)}…` : String(v));
export function formulaChanges(before, after) {
  const out = [];
  for (const [cell, f] of Object.entries(before)) if (after[cell] !== f) out.push(`${cell} was ${shortF(f)}, now ${after[cell] == null ? "not a formula" : shortF(after[cell])}`);
  for (const cell of Object.keys(after)) if (!(cell in before)) out.push(`${cell} has a new formula`);
  return out;
}
// the loud line when the read-back finds a formula changed (the write itself went through)
const alarmText = (tab, changes) => `Check the ${tab} tab now: after the write, ${changes.length === 1 ? "a formula there isn't" : `${changes.length} formulas there aren't`} what ${changes.length === 1 ? "it was" : "they were"} (${changes.slice(0, 3).join("; ")}${changes.length > 3 ? `; ${changes.length - 3} more` : ""}).`;
// a cell the write would replace, named, when it holds a formula: "D41 on the Stack!e tab holds a formula"
const formulaIn = (grid, row, cols, tab) => {
  const hit = cols.find((c) => isFormula(grid[row - 1]?.[COLS.indexOf(c)]));
  return hit ? `${hit}${row} on the ${tab} tab holds a formula, so nothing was written there.` : null;
};
// One cell of a pub sheet row written by this file (D: the Writer Share), with the guard on both sides: read the tab
// with FORMULA, refuse the cell if it holds a formula, write, read the tab again and compare every formula, and read
// the cell back. { ok, alarm? } or { refused }
async function writeShareCell(sheets, spreadsheetId, tab, row, value) {
  const before = await readFormulas(sheets, spreadsheetId, tab);
  const refused = formulaIn(before, row, ["D"], tab);
  if (refused) return { refused };
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data: [{ range: `'${qt(tab)}'!D${row}`, values: [[value]] }] } });
  const after = await readFormulas(sheets, spreadsheetId, tab);
  const changes = formulaChanges(formulasOf(before), formulasOf(after));
  const back = after[row - 1]?.[3];
  if (Number(back) !== value || back === "") changes.push(`D${row} reads ${shortF(back)}, not ${value}`);
  return changes.length ? { ok: true, alarm: alarmText(tab, changes) } : { ok: true };
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

// ---- the guard around the song row push (pushOwnShare -> /api/sheets-push) and the merge's Site Sync ID stamp
// The row the push writes, found the way the push finds it (lib/sheets.js: its Site Sync ID, then its Luminate ID,
// then an unclaimed row with its title, else the first empty row above Total), from one read of the tab as shown.
const START = 5; // DATA_START_ROW
const syncParts = (id) => { const s = String(id || ""), i = s.indexOf(":"); return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };
const totalRowOf = (shown) => { const i = shown.slice(START - 1).findIndex((r) => String(r?.[0] ?? "").trim() === "Total"); return i === -1 ? null : START + i; };
export function pushRowOf(shown, { syncId, luminateId, song, liveIds }) {
  const cell = (r, j) => shown[r - 1]?.[j];
  const totalRow = totalRowOf(shown);
  const last = totalRow === null ? Math.max(shown.length, START) : totalRow - 1;
  // (findRowBySyncId reads N5:N1000, the Total row or not)
  const ns = []; for (let r = START; r <= Math.min(1000, Math.max(shown.length, START)); r++) ns.push(cell(r, 13));
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
// Before a push: { placementId, percent (the share the push sends), splits (the split it comes from; checked as
// splitProblem does, and its client's share must be that percent), exact (a Confirm: 100% in total; the merge: at
// most 100), row (the row the merge card read; else found as the push finds it), keep (a merge that only renames:
// the share goes back as the sheet has it), liveIds }. { ok, tab, row, how, sig, cells } or { error, status }
export async function pushGuard(b = {}, io = {}) {
  const percent = Number(b.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { status: 400, error: "That share has to be more than 0% and at most 100%." };
  const [p] = await sql`SELECT id, client_id, song, luminate_id, splits FROM placements WHERE id = ${String(b.placementId || "")}`;
  if (!p) return { status: 404, error: "That song isn't on the site anymore. Reload the page." };
  const known = await loadClientTabNames();
  const c = known.find((k) => k.id === p.client_id);
  if (!c) return { status: 409, error: "Its client isn't on the site anymore. Reload the page." };
  if (!b.keep) {
    const bad = splitProblem(b.splits, { exact: b.exact !== false });
    if (bad) return { status: 400, error: bad };
    const own = findByName(b.splits, c.name);
    if (!own || Math.abs(Number(own.percent) - percent) > 1e-9) return { status: 400, error: `${c.name}'s share in that split isn't ${Math.round(percent * 10) / 10}%.` };
  }
  // the push writes under the client's sheet tab name (pushOwnShare), trimmed as the push trims it
  const name = String(c.sheet_tab_name || c.name || "").trim();
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const tab = findTab(await listTabs(sheets, spreadsheetId), name, tabsOfOthers(known, ownerOf(known, name, c.id)));
  // (the push would claim a spare tab under their name: never from here)
  if (!tab) return { status: 409, error: `The pub sheet has no ${name} tab, so nothing was written to it.` };
  const shownGrid = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(tab.title)}'!A1:N2000` })).data.values || [];
  const grid = await readFormulas(sheets, spreadsheetId, tab.title);
  let row, how;
  if (b.row != null) {
    row = Number(b.row); how = "named";
    if (!(row >= START) || !Number.isInteger(row)) return { status: 400, error: "Reload the page and try again." };
  } else ({ row, how } = pushRowOf(shownGrid, { syncId: `${p.id}:${name.toLowerCase()}`, luminateId: p.luminate_id, song: p.song, liveIds: Array.isArray(b.liveIds) ? b.liveIds : null }));
  if (!row) return { status: 409, error: `The ${tab.title} tab has no empty row above its Total row.` };
  const total = totalRowOf(shownGrid);
  if (total != null && row >= total) return { status: 409, error: `Row ${row} is the ${tab.title} tab's Total row or below it, so nothing was written.` };
  const refused = formulaIn(grid, row, ["A", "B", "D", "N"], tab.title);
  if (refused) return { status: 409, error: refused };
  const cells = Object.fromEntries((grid[row - 1] || []).map((v, j) => [COLS[j], v]).filter(([, v]) => isFormula(v)));
  return { ok: true, tab: tab.title, row, how, sig: rowSigs(grid), cells };
}
// After the push: { tab, row, sig, cells, percent } from pushGuard. Every row's formulas as they were, the pushed
// row's own formulas exactly, and its share reading the percent sent. { ok } or { ok: false, alarm }
export async function pushAfter(b = {}, io = {}) {
  const tab = String(b.tab || ""), row = Number(b.row);
  if (!tab || !(row >= START) || !b.sig || typeof b.sig !== "object") return { status: 400, error: "Nothing to check." };
  const sheets = io.sheets || getSheetsClient(), spreadsheetId = io.spreadsheetId || getSheetId();
  const grid = await readFormulas(sheets, spreadsheetId, tab);
  const now = rowSigs(grid);
  const changes = [];
  const mine = grid[row - 1] || [];
  for (const [c, f] of Object.entries(b.cells || {})) { const v = mine[COLS.indexOf(c)]; if (v !== f) changes.push(`${c}${row} was ${shortF(f)}, now ${isFormula(v) ? shortF(v) : "not a formula"}`); }
  for (const r of new Set([...Object.keys(b.sig), ...Object.keys(now)])) if (Number(r) !== row && b.sig[r] !== now[r]) changes.push(`the formulas on row ${r} changed`);
  for (const c of ["A", "B", "D", "N"]) if (isFormula(mine[COLS.indexOf(c)])) changes.push(`${c}${row} has a formula now`);
  const pct = Number(b.percent);
  if (Number.isFinite(pct) && Math.abs(Number(mine[3]) * 100 - pct) > 1e-6) changes.push(`D${row} reads ${shortF(mine[3])}, not ${pct / 100}`);
  return changes.length ? { ok: false, alarm: alarmText(tab, changes) } : { ok: true };
}
