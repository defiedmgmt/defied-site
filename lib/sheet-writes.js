// The pub sheet's song row writes, each with the formula guard (lib/sheet-guard.js) around it, inside the code that
// writes (r11 todofix), so every caller is held to it: To do's cards, the song editor's Save and Delete, the sheet
// sync's Site Sync ID stamps, a page opened before a deploy, a hand-made request.
//   guardedPush   one split's row (pages/api/sheets-push.js): found exactly as before, then written only if A, B,
//                 D and N hold no formula, the row is above Total, and the share passes pushShareProblem; a formula
//                 column of the row left blank gets its standard formula back with it (2026-11-13); a full tab gets
//                 more rows first (lib/sheet-rows.js extendTab, 2026-11-13)
//   guardedStamp  Site Sync IDs into N (pages/api/sheets-claim.js, lib/site-sync.js)
//   guardedClear  a deleted song's own cells, A B D M N (pages/api/sheets-delete.js)
// Each reads the tab with FORMULA first (one read) and again after the write (one more), whatever the write did:
// every formula must be as it was, and the cells read what was sent, else the answer carries a loud `alarm`. A write
// call that fails is read back too, and the error carries that read-back (err.readBack). Server-only.
import { findRowBySyncId, findRowByLuminateId, findUnclaimedRowByTitle, firstEmptyRow, writeSongRow, writeSyncIds, clearSongRow, restoreFormulas, FORMULA_COLS, standardFormula, normalizeTitle } from "./sheets";
import { readFormulas, rowRefusal, readBack, cellAt, sharePct } from "./sheet-guard";
import { pushShareProblem } from "./split-fixes";
import { extendTab } from "./sheet-rows";

// the write, then its read-back, even when the write call itself throws (it may have landed): { ok } / { ok: false, alarm }.
// want: the tab's formulas as they should read after a write that puts some back (guardedPush), else as before
async function writeThenRead(sheets, spreadsheetId, tab, before, write, expect, want = before) {
  try { await write(); } catch (err) {
    err.readBack = await readBack(sheets, spreadsheetId, tab, before, []);
    throw err;
  }
  return readBack(sheets, spreadsheetId, tab, want, expect);
}
// the grid with these columns of `row` holding their standard formulas (what the read-back should find)
const withFormulas = (grid, row, cols) => {
  const g = [...grid], r = [...(g[row - 1] || [])];
  for (const c of cols) r["ABCDEFGHIJKLMN".indexOf(c)] = standardFormula(c, row);
  g[row - 1] = r;
  return g;
};

// One split's row on its tab. The row is found as the push always found it (its Site Sync ID, its Luminate ID, a row
// with its title nobody live has claimed, else the first empty row above Total); then the tab is read with FORMULA
// and nothing is written when A, B, D or N of that row holds a formula, the row is the Total row or below it, the
// title would read as a formula, or the share fails `rules` ({ site, splits, check, who }, pushShareProblem: the
// cell's own share now is always fine). Written RAW (lib/sheets.js writeSongRow): the title, artist and Site Sync ID
// read back exactly as sent. (2026-11-13) The row is checked against the FORMULA read before anything is written: a row
// found by its IDs or title still carries one of them, a new row is still empty (rows move when a full tab is given
// more, lib/sheet-rows.js, or by hand); else it's found again once, then refused.
// { row, updated, restored?, extended?, alarm? } or { refused, row }
export async function guardedPush(sheets, spreadsheetId, tab, push) {
  let extended = null;
  for (let attempt = 0; ; attempt++) {
    const out = await pushOnce(sheets, spreadsheetId, tab, push, extended);
    extended = out.extended || extended;
    if (!out.moved) return out;
    if (attempt) return { refused: `Row ${out.row} of the ${tab} tab changed while this song was being written there, so nothing was written. Try again.`, row: out.row };
  }
}
// the row as it was found: a found row still has the song's Site Sync ID (its placement), its Luminate ID or its
// title; a new one still has no title
const stillTheRow = (grid, row, { found, song, syncId, luminateId }) => {
  const a = String(cellAt(grid, row, "A") ?? "").trim(), m = String(cellAt(grid, row, "M") ?? "").trim(), n = String(cellAt(grid, row, "N") ?? "");
  if (!found) return !a;
  const pid = (v) => String(v || "").split(":")[0];
  return (!!syncId && !!n && pid(n) === pid(syncId)) || (!!luminateId && m === String(luminateId).trim()) || (!!normalizeTitle(song) && normalizeTitle(a) === normalizeTitle(song));
};
async function pushOnce(sheets, spreadsheetId, tab, { song, artist, percent, syncId, luminateId, liveIds, rules = {} }, extendedBefore) {
  const existing = await findRowBySyncId(sheets, spreadsheetId, tab, syncId)
    ?? (luminateId ? await findRowByLuminateId(sheets, spreadsheetId, tab, luminateId) : null)
    ?? await findUnclaimedRowByTitle(sheets, spreadsheetId, tab, song, liveIds);
  // (a new row's share cell is blank: a share the rules refuse is said before a full tab is given more rows for it)
  const found = existing != null ? { row: existing } : await emptyRowOrMore(sheets, spreadsheetId, tab, () => pushShareProblem({ ...rules, percent, sheet: null }));
  if (found.refused) return { refused: `${found.refused} Nothing was written to the ${tab} tab.`, row: null };
  const row = found.row, extended = found.extended || extendedBefore;
  const before = await readFormulas(sheets, spreadsheetId, tab);
  if (!stillTheRow(before, row, { found: existing != null, song, syncId, luminateId })) return { moved: true, row, extended };
  const refused = rowRefusal(before, tab, row, ["A", "B", "D", "N"], { A: song, B: artist, N: syncId });
  if (refused) return { refused, row };
  const bad = pushShareProblem({ ...rules, percent, sheet: sharePct(cellAt(before, row, "D")) });
  if (bad) return { refused: `${bad} Nothing was written to the ${tab} tab.`, row };
  // (2026-11-13) a formula column of this row left blank (Sauceproducedit's C15 was cleared by hand, and it's the first
  // empty row: the song pushed there would show 0 streams for good, with nothing said) gets its standard formula back
  // in the same write; a typed value (a hand-set rate) is never touched. The read-back expects exactly that formula
  const lost = FORMULA_COLS.filter((c) => { const v = cellAt(before, row, c); return v == null || v === ""; });
  const write = async () => {
    await writeSongRow(sheets, spreadsheetId, tab, row, { song, artist, percent, syncId });
    if (lost.length) await restoreFormulas(sheets, spreadsheetId, tab, row, lost);
  };
  const expect = [{ cell: `A${row}`, text: song }, { cell: `B${row}`, text: artist }, { cell: `D${row}`, value: percent / 100 }, { cell: `N${row}`, text: syncId }];
  const back = await writeThenRead(sheets, spreadsheetId, tab, before, write, expect, lost.length ? withFormulas(before, row, lost) : before);
  const alarm = [extended?.alarm, back.ok ? null : back.alarm].filter(Boolean).join(" ");
  return { row, updated: existing != null, ...(lost.length ? { restored: lost.map((c) => `${c}${row}`) } : {}), ...(extended ? { extended: { added: extended.added, at: extended.at } } : {}), ...(alarm ? { alarm } : {}) };
}

// The first empty row above Total; a tab with none gets ROOM_ADD more rows (lib/sheet-rows.js) and the song takes the
// first of them, unless `refuse()` names a reason the push won't go ahead anyway ({ refused }). Another run already
// adding rows to it: waited for, up to about 15 s. Nothing added (writes off, a layout it doesn't know, Google said
// no): the "No room left" error, with the reason. { row, extended? } or { refused }
async function emptyRowOrMore(sheets, spreadsheetId, tab, refuse = () => null) {
  try { return { row: await firstEmptyRow(sheets, spreadsheetId, tab) }; } catch (err) {
    if (!err.full) throw err;
    const refused = refuse();
    if (refused) return { refused };
    for (let i = 0; i < 6; i++) {
      const ext = await extendTab(sheets, spreadsheetId, tab, { by: "push", below: 1 }).catch((e) => ({ failed: e.message }));
      if (ext.added) return { row: await firstEmptyRow(sheets, spreadsheetId, tab), extended: ext };
      if (ext.enough) return { row: await firstEmptyRow(sheets, spreadsheetId, tab) }; // another run just gave it rows
      if (!ext.busy) throw Object.assign(new Error([err.message, ext.refused, ext.failed].filter(Boolean).join(" ")), { full: true });
      await new Promise((r) => setTimeout(r, 2500));
      try { return { row: await firstEmptyRow(sheets, spreadsheetId, tab) }; } catch (again) { if (!again.full) throw again; }
    }
    throw err;
  }
}

// Site Sync IDs stamped into N: items [{ tab (the tab's real title), row, syncId }], one write per tab (2026-11-13: the
// nightly sync's first heal is 119 rows; one write each hit Google's per-minute limit), with one read of each tab
// before and one after, each stamp read back as sent. A stamp into a formula, the Total row or below it, one that
// would read as a formula, or (2026-11-13) into a row with no song title (rows moved since they were read: a full tab
// given more, lib/sheet-rows.js) is refused; the rest go ahead. { stamped, refused: [{ tab, row, reason }], alarms }
export async function guardedStamp(sheets, spreadsheetId, items) {
  const stamped = [], refused = [], alarms = [];
  for (const tab of [...new Set(items.map((x) => x.tab))]) {
    const mine = items.filter((x) => x.tab === tab);
    const before = await readFormulas(sheets, spreadsheetId, tab);
    const go = [];
    for (const x of mine) {
      const reason = rowRefusal(before, tab, x.row, ["N"], { N: x.syncId })
        || (String(cellAt(before, x.row, "A") ?? "").trim() ? null : `Row ${x.row} of the ${tab} tab has no song title now, so no Site Sync ID was stamped there.`);
      if (reason) refused.push({ tab, row: x.row, reason }); else go.push(x);
    }
    if (!go.length) continue;
    const back = await writeThenRead(sheets, spreadsheetId, tab, before, async () => { await writeSyncIds(sheets, spreadsheetId, tab, go); stamped.push(...go); }, go.map((x) => ({ cell: `N${x.row}`, text: x.syncId })));
    if (!back.ok) alarms.push(back.alarm);
  }
  return { stamped, refused, alarms };
}

// A deleted song's own cells cleared (A, B, D, M, N; never a formula column), only when none of them holds a formula
// and the row is above Total; read back blank. { cleared: true, alarm? } or { refused }
export async function guardedClear(sheets, spreadsheetId, tab, row) {
  const before = await readFormulas(sheets, spreadsheetId, tab);
  const cols = ["A", "B", "D", "M", "N"];
  // (2026-11-13) a row that's already empty: the song's row moved since it was found (rows added above it)
  const refused = rowRefusal(before, tab, row, cols, {}, "cleared")
    || (cols.every((c) => { const v = cellAt(before, row, c); return v == null || String(v).trim() === ""; }) ? `Row ${row} of the ${tab} tab is already empty, so nothing was cleared. Reload the page and try again.` : null);
  if (refused) return { refused };
  const back = await writeThenRead(sheets, spreadsheetId, tab, before, () => clearSongRow(sheets, spreadsheetId, tab, row), cols.map((c) => ({ cell: `${c}${row}`, blank: true })));
  return { cleared: true, ...(back.ok ? {} : { alarm: back.alarm }) };
}
