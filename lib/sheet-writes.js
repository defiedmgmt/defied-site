// The pub sheet's song row writes, each with the formula guard (lib/sheet-guard.js) around it, inside the code that
// writes (r11 todofix), so every caller is held to it: To do's cards, the song editor's Save and Delete, the sheet
// sync's Site Sync ID stamps, a page opened before a deploy, a hand-made request.
//   guardedPush   one split's row (pages/api/sheets-push.js): found exactly as before, then written only if A, B,
//                 D and N hold no formula, the row is above Total, and the share passes pushShareProblem
//   guardedStamp  Site Sync IDs into N (pages/api/sheets-claim.js, lib/site-sync.js)
//   guardedClear  a deleted song's own cells, A B D M N (pages/api/sheets-delete.js)
// Each reads the tab with FORMULA first (one read) and again after the write (one more), whatever the write did:
// every formula must be as it was, and the cells read what was sent, else the answer carries a loud `alarm`. A write
// call that fails is read back too, and the error carries that read-back (err.readBack). Server-only.
import { findRowBySyncId, findRowByLuminateId, findUnclaimedRowByTitle, firstEmptyRow, writeSongRow, writeSyncId, clearSongRow } from "./sheets";
import { readFormulas, rowRefusal, readBack, cellAt, sharePct } from "./sheet-guard";
import { pushShareProblem } from "./split-fixes";

// the write, then its read-back, even when the write call itself throws (it may have landed): { ok } / { ok: false, alarm }
async function writeThenRead(sheets, spreadsheetId, tab, before, write, expect) {
  try { await write(); } catch (err) {
    err.readBack = await readBack(sheets, spreadsheetId, tab, before, []);
    throw err;
  }
  return readBack(sheets, spreadsheetId, tab, before, expect);
}

// One split's row on its tab. The row is found as the push always found it (its Site Sync ID, its Luminate ID, a row
// with its title nobody live has claimed, else the first empty row above Total); then the tab is read with FORMULA
// and nothing is written when A, B, D or N of that row holds a formula, the row is the Total row or below it, the
// title would read as a formula, or the share fails `rules` ({ site, splits, check, who }, pushShareProblem: the
// cell's own share now is always fine). { row, updated, alarm? } or { refused, row }
export async function guardedPush(sheets, spreadsheetId, tab, { song, artist, percent, syncId, luminateId, liveIds, rules = {} }) {
  const existing = await findRowBySyncId(sheets, spreadsheetId, tab, syncId)
    ?? (luminateId ? await findRowByLuminateId(sheets, spreadsheetId, tab, luminateId) : null)
    ?? await findUnclaimedRowByTitle(sheets, spreadsheetId, tab, song, liveIds);
  const row = existing ?? await firstEmptyRow(sheets, spreadsheetId, tab);
  const before = await readFormulas(sheets, spreadsheetId, tab);
  const refused = rowRefusal(before, tab, row, ["A", "B", "D", "N"], { A: song, B: artist, N: syncId });
  if (refused) return { refused, row };
  const bad = pushShareProblem({ ...rules, percent, sheet: sharePct(cellAt(before, row, "D")) });
  if (bad) return { refused: `${bad} Nothing was written to the ${tab} tab.`, row };
  const back = await writeThenRead(sheets, spreadsheetId, tab, before, () => writeSongRow(sheets, spreadsheetId, tab, row, { song, artist, percent, syncId }), [{ cell: `D${row}`, value: percent / 100 }]);
  return { row, updated: existing != null, ...(back.ok ? {} : { alarm: back.alarm }) };
}

// Site Sync IDs stamped into N: items [{ tab (the tab's real title), row, syncId }], written one by one as before
// (values.update), with one read of each tab before and one after. A stamp into a formula, the Total row or below
// it, or one that would read as a formula is refused; the rest go ahead. { stamped, refused: [{ tab, row, reason }],
// alarms }
export async function guardedStamp(sheets, spreadsheetId, items) {
  const stamped = [], refused = [], alarms = [];
  for (const tab of [...new Set(items.map((x) => x.tab))]) {
    const mine = items.filter((x) => x.tab === tab);
    const before = await readFormulas(sheets, spreadsheetId, tab);
    const go = [];
    for (const x of mine) {
      const reason = rowRefusal(before, tab, x.row, ["N"], { N: x.syncId });
      if (reason) refused.push({ tab, row: x.row, reason }); else go.push(x);
    }
    if (!go.length) continue;
    const back = await writeThenRead(sheets, spreadsheetId, tab, before, async () => { for (const x of go) { await writeSyncId(sheets, spreadsheetId, tab, x.row, x.syncId); stamped.push(x); } }, []);
    if (!back.ok) alarms.push(back.alarm);
  }
  return { stamped, refused, alarms };
}

// A deleted song's own cells cleared (A, B, D, M, N; never a formula column), only when none of them holds a formula
// and the row is above Total; read back blank. { cleared: true, alarm? } or { refused }
export async function guardedClear(sheets, spreadsheetId, tab, row) {
  const before = await readFormulas(sheets, spreadsheetId, tab);
  const cols = ["A", "B", "D", "M", "N"];
  const refused = rowRefusal(before, tab, row, cols, {}, "cleared");
  if (refused) return { refused };
  const back = await writeThenRead(sheets, spreadsheetId, tab, before, () => clearSongRow(sheets, spreadsheetId, tab, row), cols.map((c) => ({ cell: `${c}${row}`, blank: true })));
  return { cleared: true, ...(back.ok ? {} : { alarm: back.alarm }) };
}
