// The formula guard every cell write to a pub sheet tab goes through (r11 todofix: inside the code that writes, so
// every caller is held to it: To do's cards, the song editor's Save and Delete, the sheet sync's Site Sync ID stamps,
// a page opened before a deploy, a hand-made request). One tab at a time, around one write:
//   readFormulas  the tab as its formulas (FORMULA render), A1:N2000: one read before the write, one after
//   rowRefusal    why a write into these cells of a row can't go ahead, as a sentence naming the cell (a row above
//                 the songs, the Total row or below it, a cell holding a formula, a value the sheet would take as a
//                 formula), or null
//   readBack      the tab read again after the write: every formula on it exactly as it was, and each written cell
//                 reading what was sent. { ok } or { ok: false, alarm } (said loudly: the write itself went through)
// Used by lib/sheet-writes.js (the song row push, the Site Sync ID stamp, a deleted song's row cleared) and
// lib/split-fixes-store.js (the blank share fill, "Use the sheet's split", To do's pre-check). Server-only.
const COLS = "ABCDEFGHIJKLMN"; // a pub sheet tab: A Song Title … M Luminate ID, N Site Sync ID (lib/sheets.js)
export const DATA_START = 5; // rows 1-4 are each tab's summary block (lib/sheets.js DATA_START_ROW)
const qt = (title) => title.replace(/'/g, "''");
export const isFormula = (v) => typeof v === "string" && v.trim().startsWith("=");

// the tab as its formulas, every row from the top: the summary block, the songs, the Total row and below
export async function readFormulas(sheets, spreadsheetId, title) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${qt(title)}'!A1:N2000`, valueRenderOption: "FORMULA" });
  return res.data.values || [];
}
// { "E41": "=IF(…)" } for every formula on the tab
export const formulasOf = (grid) => {
  const out = {};
  grid.forEach((r, i) => (r || []).forEach((v, j) => { if (j < COLS.length && isFormula(v)) out[`${COLS[j]}${i + 1}`] = v; }));
  return out;
};
// what changed between two reads of the tab's formulas, in words ("E41 was =IF(…), now not a formula"); [] if nothing
export const shortF = (v) => (v == null || v === "" ? "blank" : String(v).length > 60 ? `${String(v).slice(0, 57)}…` : String(v));
export function formulaChanges(before, after) {
  const out = [];
  for (const [cell, f] of Object.entries(before)) if (after[cell] !== f) out.push(`${cell} was ${shortF(f)}, now ${after[cell] == null ? "not a formula" : shortF(after[cell])}`);
  for (const cell of Object.keys(after)) if (!(cell in before)) out.push(`${cell} has a new formula`);
  return out;
}
// the loud line when the read-back finds a formula changed (the write itself went through)
export const alarmText = (tab, changes) => `Check the ${tab} tab now: after the write, ${changes.length === 1 ? "a formula there isn't" : `${changes.length} formulas there aren't`} what ${changes.length === 1 ? "it was" : "they were"} (${changes.slice(0, 3).join("; ")}${changes.length > 3 ? `; ${changes.length - 3} more` : ""}).`;
// the tab's "Total" row (its SUMs, which MASTER reads), or null for a tab without one
export const totalRowOf = (grid) => {
  for (let r = DATA_START; r <= grid.length; r++) if (String(grid[r - 1]?.[0] ?? "").trim() === "Total") return r;
  return null;
};
export const cellAt = (grid, row, col) => grid[row - 1]?.[COLS.indexOf(col)];
// a share cell as a % (0.5 -> 50), or null: blank, text, a formula
export const sharePct = (v) => (typeof v === "number" && Number.isFinite(v) ? v * 100 : null);

// Why writing `values` ({ A: "Echoes", D: 0.25 }; a clear passes none) into these columns of `row` can't go ahead,
// or null. verb: what would have happened ("written", "cleared")
export function rowRefusal(grid, tab, row, cols, values = {}, verb = "written") {
  if (!Number.isInteger(row) || row < DATA_START) return `Row ${row} of the ${tab} tab is above its songs, so nothing was ${verb}.`;
  const total = totalRowOf(grid);
  if (total != null && row >= total) return `Row ${row} is the ${tab} tab's Total row or below it, so nothing was ${verb}.`;
  const hit = cols.find((c) => isFormula(cellAt(grid, row, c)));
  if (hit) return `${hit}${row} on the ${tab} tab holds a formula, so nothing was ${verb} there.`;
  // (a title starting with "=": the song row and Site Sync IDs are written RAW since 2026-11-13, so the sheet keeps it
  // as text, but this guard's FORMULA read can't tell that text from a formula: every later write to the row would be
  // refused and every read-back would call it a new formula. Still refused, as when it was written USER_ENTERED)
  const eq = cols.find((c) => typeof values[c] === "string" && values[c].trim().startsWith("="));
  if (eq) return `"${shortF(values[eq])}" starts with "=", so it would read as a formula in ${eq}${row} on the ${tab} tab. Nothing was ${verb}.`;
  return null;
}

// After the write: the tab read again. Every formula exactly as `before` had it (a push that puts a lost formula back
// passes the grid with it, lib/sheet-writes.js), and each expected cell reading what was sent: [{ cell: "D7", value:
// 0.25 }] (a number, to Sheets' own precision), [{ cell: "M7", text: "SG12" }] (text, exactly) or [{ cell: "N7",
// blank: true }]. A cell written as text that came back a formula is among the changes already ("N7 has a new formula").
// { ok } or { ok: false, alarm }; a read that fails says so (the write may have gone through). throwQuota: Google's
// per-minute read limit is thrown instead, for a caller that carries on later (lib/lum-setup.js)
export async function readBack(sheets, spreadsheetId, tab, before, expect = [], { throwQuota = false } = {}) {
  let after;
  try { after = await readFormulas(sheets, spreadsheetId, tab); } catch (err) {
    if (throwQuota && (err?.code === 429 || err?.response?.status === 429 || /quota|rate limit/i.test(String(err?.message || "")))) throw err;
    return { ok: false, alarm: `Check the ${tab} tab now: it couldn't be read back after the write${expect[0] ? ` to ${expect.map((e) => e.cell).join(", ")}` : ""}.` };
  }
  const changes = formulaChanges(formulasOf(before), formulasOf(after));
  for (const e of expect) {
    const [, col, r] = /^([A-N])(\d+)$/.exec(e.cell);
    const v = cellAt(after, Number(r), col);
    if (e.blank) { if (v != null && v !== "") changes.push(`${e.cell} reads ${shortF(v)}, not blank`); }
    else if (typeof e.text === "string") { if (String(v ?? "") !== e.text) changes.push(`${e.cell} reads ${shortF(v)}, not ${e.text}`); }
    else if (typeof e.value === "number" && (v == null || v === "" || !(Math.abs(Number(v) - e.value) < 1e-9))) changes.push(`${e.cell} reads ${shortF(v)}, not ${e.value}`);
  }
  return changes.length ? { ok: false, alarm: alarmText(tab, changes) } : { ok: true };
}
