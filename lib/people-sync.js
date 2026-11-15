// People sync (owner 2026-11-13: "i just want an easier way to add the managers and clients and stuff on the site and
// have it all sync to the sheets"). The site's Roster form and Site › Users write the people to the two sheets, the
// way the owner types them by hand, and nothing else:
//   accounting sheet, INFO tab   a client's row (C name, D Comm. Rate, E Assigned Manager, F Manager Gets %) and the
//                                managers list (L4:L13, the list E's dropdown and Stripe Fees / Annual Summary read)
//   accounting sheet, Annual Summary   its CLIENT SPLITS block grown to read every INFO row (4 to 43), once, so a new
//                                client is never missing from it
//   pub sheet                    a free "WRITER n" tab renamed for a client, and MASTER's label for that row
// "Don't break the sheets": every write is planned from a fresh read first and refused, with a plain sentence, when
// the sheet isn't laid out the way it was on 2026-11-13 (INFO's row-3 headers, no gaps in C4:C43 or L4:L13, G's
// standard formula, Annual Summary's exact formulas, a free WRITER tab with its MASTER row). Typed cells only (RAW,
// so a name is never read as a formula), never a cell holding a formula. One save at a time (an app_state claim). After
// each write the cells are read back; anything that reads differently is a loud `alarm`, never a quiet "done".
// (2026-11-13 review) A client save carries the row the form was filled from (add, or update with INFO's D, E and F as
// read then): a row changed on INFO since is refused, never typed over, and only the cells the save changes are written.
// INFO is read again after Annual Summary is grown (seconds), and the client written only if the plan is still the same.
// Annual Summary's new rows go in at its TOTAL row, so no client row moves. A pub sheet tab is made one at a time, also
// against a song push claiming one (withTabLock), and never from a WRITER tab a client already goes by.
// Names: a client's INFO row is found the way refreshManagers finds it (lib/info-managers.js: a "Sheet tab name"
// override, then the name, exact then personKey); a manager must be exactly a name on INFO's list. Caden (prodzo's
// manager, no login) and Cayden (the intern) are two people: nothing here ever matches one name to another spelling.
// Gates: ACCOUNTING_SHEET_WRITES for the accounting sheet (lib/accounting-log.js logWritesOn), PUB_SHARE_WRITES for
// the pub sheet (lib/split-fixes-store.js shareWritesOn). Server-only.
//   infoLayout / planClient / planManager / planAnnualClients   pure (tests/people-sync.mjs)
//   planManagerArtists / followProblem   pure (tests/manager-artists.mjs)
//   saveClientToInfo   the Roster form's "Add to / Update the accounting sheet"
//   addManagerToInfo   Site › Users' "Add to the sheet" and "Add a manager"
//   saveManagerArtists   Site › Users' checklist of a manager's artists: E and F of every row changed, in one write
//   extendAnnualClients   Annual Summary's client splits to INFO row 43 (also for a supervised one-time run)
//   createClientTab   the Roster form's "Give them a pub sheet tab"
import { sql } from "./db";
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, WRITER_TAB_RE } from "./sheets";
import { ownerOf, personKey } from "./names";
import { accountingSheetId, clearAccountingCache } from "./accounting";
import { logWritesOn } from "./accounting-log";
import { shareWritesOn } from "./split-fixes-store";
import { offText } from "./preview";
import { claimState } from "./app-state";
import { refreshManagers, managersByClient, managersProblem } from "./info-managers";
import { shiftRows, namesTab, rowSpans } from "./sheet-rows";
import { isFormula, shortF } from "./sheet-guard";
import { infoOwnerOf, withInfoNames } from "./info-links";

export const INFO_TAB = "INFO";
export const ANNUAL_TAB = "Annual Summary";
export const FIRST_ROW = 4, LAST_ROW = 43; // INFO's roster rows (the Income formulas read INFO!$C$4:$C$43)
export const FIRST_MANAGER = 4, LAST_MANAGER = 13; // INFO's managers list (E's dropdown is =$L$4:$L$13)
export const ACCOUNTING_OFF = offText("Writing to the accounting sheet from here isn't switched on yet.");
export const PUB_OFF = offText("Writing to the pub sheet from here isn't switched on yet.");
export const NO_FREE_TAB = "No free WRITER tab left on the pub sheet, so no tab was made.";
const INFO_RANGE = "INFO!A1:M45";
const ANNUAL_RANGE = `'${ANNUAL_TAB}'!A1:Z300`;
const INFO_LOCK = "peopleSync:info", TAB_LOCK = "peopleSync:tab";
const LEASE_MIN = 3; // a save that never finished frees the lock after this long
const BUSY = "Someone else is saving to the sheet right now. Try again in a minute.";
export const TAB_BUSY = "Someone else is making a pub sheet tab right now. Try again in a minute.";
const HEADERS = [["C", "Artists / Clients"], ["D", "Comm. Rate"], ["E", "Assigned Manager"], ["F", "Manager Gets %"], ["G", "Defied Gets %"], ["L", "Managers"]];
const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const qt = (title) => title.replace(/'/g, "''");
const at = (grid, row, col) => grid[row - 1]?.[COLS.indexOf(col)];
const blank = (v) => v == null || String(v).trim() === "";
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
// formulas compared without spaces or case (Sheets keeps what was typed; ours have no text but "")
const sameF = (a, b) => String(a ?? "").replace(/\s+/g, "").toUpperCase() === String(b ?? "").replace(/\s+/g, "").toUpperCase();
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : blank(v) || isFormula(v) || !Number.isFinite(Number(v)) ? null : Number(v));
const close = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-9;
export const pct = (x) => `${Math.round(Number(x) * 10000) / 100}%`;
const isCompany = (name) => /^general\b|\bcompany$/i.test(String(name || "").trim());

// The sheet's own formulas (2026-11-13 FORMULA read): INFO's Defied Gets %, and Annual Summary's CLIENT SPLITS row r
// reading INFO row n
export const standardG = (r) => `=IF($C${r}="","",IF($E${r}="",1,1-$F${r}))`;
export const annualFormulas = (r, n) => ({
  D: `=IF(INFO!$C$${n}="","",INFO!$C$${n})`,
  E: `=IF($D${r}="",0,SUMIF(Income!$D$4:$D$303,$D${r},Income!$F$4:$F$303))`,
  F: `=IF(OR($D${r}="",INFO!$D$${n}="",INFO!$D$${n}=0,$E${r}=0),0,$E${r}/INFO!$D$${n})`,
});

// --- pure (tests/people-sync.mjs) ----------------------------------------------------------------------------------
// INFO A1:M45 read as FORMULA -> { problem } or { roster: [{ row, name, rate, manager, cut, company }], managers:
// [{ row, name }], nextClientRow, nextManagerRow } (a next row is null when that list is full). The lists must be
// unbroken, because lib/info-managers.js parseInfoManagers stops at the first blank name after a client: a new name
// always goes in the first blank row right after the last one.
export function infoLayout(grid) {
  const g = grid || [];
  for (const [col, want] of HEADERS) {
    if (norm(at(g, 3, col)) !== norm(want)) return { problem: `INFO's ${col}3 reads "${String(at(g, 3, col) ?? "").trim() || "blank"}", not "${want}", so the sheet wasn't changed. INFO's columns may have moved.` };
  }
  const lastOf = (col, from, to) => { let last = from - 1; for (let r = from; r <= to; r++) if (!blank(at(g, r, col))) last = r; return last; };
  const lastC = lastOf("C", FIRST_ROW, LAST_ROW), lastL = lastOf("L", FIRST_MANAGER, LAST_MANAGER);
  for (let r = FIRST_ROW; r <= lastC; r++) if (blank(at(g, r, "C"))) return { problem: `INFO has a blank row (C${r}) between clients, so the sheet wasn't changed. Fill or remove that gap on INFO first.` };
  for (let r = FIRST_MANAGER; r <= lastL; r++) if (blank(at(g, r, "L"))) return { problem: `INFO's manager list has a blank cell (L${r}) between names, so the sheet wasn't changed. Fill or remove that gap on INFO first.` };
  const roster = [];
  for (let r = FIRST_ROW; r <= lastC; r++) {
    const name = String(at(g, r, "C")).trim();
    // raw: D, E and F as read (formulas as written), what a form opened on this row sends back with its save
    roster.push({ row: r, name, rate: num(at(g, r, "D")), manager: blank(at(g, r, "E")) ? "" : String(at(g, r, "E")).trim(), cut: num(at(g, r, "F")), company: isCompany(name),
      raw: { D: at(g, r, "D") ?? "", E: at(g, r, "E") ?? "", F: at(g, r, "F") ?? "" } });
  }
  const managers = [];
  for (let r = FIRST_MANAGER; r <= lastL; r++) managers.push({ row: r, name: String(at(g, r, "L")).trim() });
  const nextClientRow = lastC < LAST_ROW ? lastC + 1 : null, nextManagerRow = lastL < LAST_MANAGER ? lastL + 1 : null;
  if (nextClientRow && !sameF(at(g, nextClientRow, "G"), standardG(nextClientRow))) {
    return { problem: `INFO's G${nextClientRow} reads ${shortF(at(g, nextClientRow, "G"))}, not the usual Defied Gets % formula, so the sheet wasn't changed.` };
  }
  // the raw cells a plan checks before writing (never over a formula)
  const cells = (row) => ({ C: at(g, row, "C"), D: at(g, row, "D"), E: at(g, row, "E"), F: at(g, row, "F"), G: at(g, row, "G"), L: at(g, row, "L") });
  return { roster, managers, nextClientRow, nextManagerRow, cells };
}

// The INFO row that is this client's: the first roster row whose name lib/names.js ownerOf gives to it (the rule
// refreshManagers uses). clients: [{ id, name, sheet_tab_name }]. null when INFO has none.
// (2026-11-14, people link) A client's stored link (clients.info_name, lib/info-links.js) comes first, so a client
// renamed on the site keeps their row and is never added to INFO a second time.
const liveNames = (layout) => (layout?.roster || []).map((r) => r.name);
export function infoRowOf(layout, clients, clientId) {
  const live = liveNames(layout);
  for (const r of layout?.roster || []) if (infoOwnerOf(clients, r.name, live)?.id === clientId) return r;
  return null;
}
// Each roster row with the client it belongs to (only a client's first row gets its id, as refreshManagers does)
export function rosterWithClients(layout, clients) {
  const seen = new Set(), live = liveNames(layout);
  return (layout?.roster || []).map((r) => {
    const c = r.company ? null : infoOwnerOf(clients, r.name, live);
    const clientId = c && !seen.has(c.id) ? c.id : null;
    if (clientId) seen.add(clientId);
    return { ...r, clientId };
  });
}

// (2026-11-13 review) The row the form was filled from against INFO as it reads now, so a form left open never types
// over a row someone changed by hand since -> { text, stale } (refused) or null. input.mode: "add" (the form said "Not
// on the accounting sheet yet") or "update", with input.row and input.was (that row's raw D, E and F as GET
// /api/people-sync read them). existing: infoRowOf on the fresh read.
const sameCell = (a, b) => (blank(a) && blank(b)) || (typeof a === "number" && typeof b === "number" ? close(a, b) : String(a ?? "").trim() === String(b ?? "").trim());
export function staleProblem(existing, input = {}, name = "The client") {
  const again = "The form shows what INFO reads now. Check it and save again.";
  if (input.mode === "add") return existing ? { stale: true, text: `${name} is on INFO already (row ${existing.row}). They were added after this form was opened, so nothing was written. ${again}` } : null;
  if (input.mode !== "update") return { text: "Reload the page and try again, so nothing was written." };
  const was = input.was && typeof input.was === "object" ? input.was : {};
  if (!existing) return { stale: true, text: `${name} isn't on INFO row ${input.row} any more, so nothing was written. ${again}` };
  if (existing.row !== Number(input.row)) return { stale: true, text: `${name} is on INFO row ${existing.row} now, not row ${input.row}, so nothing was written. ${again}` };
  if (!["D", "E", "F"].every((c) => sameCell(existing.raw?.[c], was[c]))) return { stale: true, text: `INFO row ${existing.row} changed after this form was opened, so nothing was written. ${again}` };
  return null;
}

// What to write for one client -> { row, cells: { C?, D?, E?, F? }, unchanged? } or { refused }. rate and cut are
// fractions (0.2, 0.67: what INFO holds). manager "" is no manager (Defied keeps 100%: F written blank, G works out 1),
// else exactly a name on INFO's list. existingRow: the client's INFO row (infoRowOf), whose name stays as it is; on it
// a rate or cut of null is left as INFO has it, and only the cells that would read differently are written (a cut
// typed as 0.666667 isn't rewritten as 0.6667 by a commission change; unchanged: nothing to write).
export function planClient(layout, input = {}, existingRow = null) {
  if (!layout || layout.problem) return { refused: layout?.problem || "INFO couldn't be read, so nothing was written." };
  const name = String(input.name ?? "").trim(), manager = String(input.manager ?? "").trim();
  const given = (v) => v !== "" && v != null;
  let mine = null;
  if (existingRow != null) {
    mine = layout.roster.find((x) => x.row === existingRow);
    if (!mine) return { refused: `INFO's row ${existingRow} has no client on it any more, so nothing was written.` };
    if (mine.company) return { refused: `INFO's row ${existingRow} is the company row, so nothing was written.` };
  }
  if (!name) return { refused: "The client has no name, so nothing was written." };
  const keepRate = !!mine && input.rate == null, keepCut = !!mine && !!manager && input.cut == null;
  // (2026-11-14, lib/people-link.js) a new row may go in with its commission blank (blankRate), for a person to fill in
  const blankRate = !mine && input.blankRate === true && !given(input.rate);
  const rate = given(input.rate) ? Number(input.rate) : NaN, cut = given(input.cut) ? Number(input.cut) : NaN;
  if (!keepRate && !blankRate && (!Number.isFinite(rate) || rate < 0 || rate > 1)) return { refused: "The commission has to be a number from 0 to 100%, so nothing was written." };
  if (manager && !keepCut && (!Number.isFinite(cut) || cut < 0 || cut > 1)) return { refused: "The manager's cut has to be a number from 0 to 100%, so nothing was written." };
  if (keepCut && mine.cut == null) return { refused: `INFO's F${mine.row} has no manager's cut, so nothing was written. Type the cut.` };
  if (manager && !layout.managers.some((m) => m.name === manager)) return { refused: `${manager} isn't on INFO's manager list, so nothing was written. Add them to the list first.` };
  let row, cells;
  if (mine) {
    row = mine.row;
    const was = layout.cells?.(row) || {}, same = (v, x) => typeof v === "number" && close(v, x);
    cells = {};
    if (!keepRate && !same(was.D, rate)) cells.D = rate;
    if (String(was.E ?? "").trim() !== manager) cells.E = manager;
    if (manager ? !keepCut && !same(was.F, cut) : !blank(was.F)) cells.F = manager ? cut : "";
    if (!Object.keys(cells).length) return { row, cells, unchanged: true };
  } else {
    const k = personKey(name), hit = layout.roster.find((x) => personKey(x.name) === k);
    if (hit) return { refused: `INFO already has ${hit.name} on row ${hit.row} as a different client, so nothing was written.` };
    if (layout.nextClientRow == null) return { refused: `INFO's client list is full (rows ${FIRST_ROW} to ${LAST_ROW}), so ${name} wasn't added. Make room on INFO first.` };
    row = layout.nextClientRow;
    cells = { D: blankRate ? "" : rate, E: manager, F: manager ? cut : "", C: name };
  }
  const now = layout.cells?.(row) || {};
  if (layout.cells && !sameF(now.G, standardG(row))) return { refused: `INFO's G${row} reads ${shortF(now.G)}, not the usual Defied Gets % formula, so nothing was written.` };
  const over = Object.keys(cells).find((c) => isFormula(now[c]));
  if (over) return { refused: `INFO's ${over}${row} holds a formula (${shortF(now[over])}), so nothing was written over it.` };
  return { row, cells };
}

// One more name on INFO's managers list -> { row, cell, value } or { refused }
export function planManager(layout, name) {
  if (!layout || layout.problem) return { refused: layout?.problem || "INFO couldn't be read, so nothing was written." };
  const value = String(name ?? "").trim();
  if (!value || !personKey(value)) return { refused: "Type the manager's name first." };
  if (value.length > 60) return { refused: "That name is too long for INFO's manager list." };
  const hit = layout.managers.find((m) => personKey(m.name) === personKey(value));
  if (hit) return { refused: `${hit.name} is already on the list (INFO L${hit.row}).` };
  if (layout.nextManagerRow == null) return { refused: `INFO's manager list is full (L${FIRST_MANAGER} to L${LAST_MANAGER}, the cells the dropdowns read), so ${value} wasn't added.` };
  const row = layout.nextManagerRow, now = layout.cells?.(row)?.L;
  if (isFormula(now)) return { refused: `INFO's L${row} holds a formula, so nothing was written over it.` };
  return { row, cell: `L${row}`, value };
}

// (2026-11-14) One manager's artists ticked in one place (Site › Users; the owner: "can we just have like a select box for
// his artists and have that sync to the accounting sheet"). input: { manager, rows: [{ row, was, on, cut }] }, the
// checklist's changed rows: was = that row's C, D, E and F as GET /api/people-sync read them (what the checklist was filled
// from), on = ticked, cut a fraction or null (leave F as INFO has it: only for an artist the manager already has). The
// manager is exactly a name on INFO's list (Caden is not Cayden, "caden" is not Caden). Every row is checked against INFO
// as it reads now before anything is planned, so one changed since the checklist was filled (by hand, or by someone
// else's save) refuses the WHOLE save. -> { refused, stale? } (nothing written) | { unchanged: true, rows: [] } |
// { manager, rows: [{ row, name, kind, cells: { E?, F? }, from: { manager, cut }, to: { manager, cut } }] }; kind "tick"
// (nobody had them), "move" (another manager's: the cut is asked for, never inherited from the old one), "untick" (E and F
// cleared, which is how planClient writes no manager: G works out Defied's 100%) or "cut" (still theirs, only the cut
// changed). Each row is planned by planClient, so its formula and cell guards apply. A tick that already reads that, and
// an untick on an artist this manager doesn't have, write nothing: unticking never clears another manager's artist.
export function planManagerArtists(layout, input = {}) {
  if (!layout || layout.problem) return { refused: layout?.problem || "INFO couldn't be read, so nothing was written." };
  const manager = String(input.manager ?? "").trim();
  if (!manager) return { refused: "The manager has no name, so nothing was written." };
  if (!layout.managers.some((m) => m.name === manager)) return { refused: `${manager} isn't on INFO's manager list, so nothing was written. Add them to the list first.` };
  const asked = Array.isArray(input.rows) ? input.rows : [];
  if (!asked.length) return { refused: "No artists were sent, so nothing was written." };
  const seen = new Set(), list = [];
  for (const x of asked) {
    const row = Number(x?.row);
    if (!Number.isInteger(row) || row < FIRST_ROW || row > LAST_ROW) return { refused: `INFO row ${x?.row} isn't a client row, so nothing was written.` };
    if (seen.has(row)) return { refused: `INFO row ${row} was sent twice, so nothing was written.` };
    if (typeof x.on !== "boolean") return { refused: `INFO row ${row} was sent without saying ticked or not, so nothing was written.` };
    seen.add(row);
    list.push({ row, was: x.was && typeof x.was === "object" ? x.was : {}, on: x.on, cut: x.cut == null || x.cut === "" ? null : Number(x.cut) });
  }
  list.sort((a, b) => a.row - b.row);
  const again = "The form shows what INFO reads now. Check it and save again.";
  for (const x of list) {
    const mine = layout.roster.find((r) => r.row === x.row), said = String(x.was.C ?? "").trim();
    const st = staleProblem(mine, { mode: "update", row: x.row, was: x.was }, said || `Row ${x.row}`);
    if (st) return { refused: st.text, ...(st.stale ? { stale: true } : {}) };
    if (mine.name !== said) return { refused: `INFO row ${x.row} is ${mine.name} now, not ${said || "blank"}, so nothing was written. ${again}`, stale: true };
  }
  const rows = [];
  for (const x of list) {
    const mine = layout.roster.find((r) => r.row === x.row);
    const has = mine.manager === manager; // exactly this name
    if (!x.on && !has) continue;
    if (x.on && !has && x.cut == null) return { refused: `${mine.name}: type ${manager}'s cut as a number from 0 to 100%, so nothing was written.` };
    const plan = planClient(layout, { name: mine.name, rate: null, manager: x.on ? manager : "", cut: x.on ? x.cut : null }, x.row);
    if (plan.refused) return { refused: `${mine.name}: ${plan.refused}` };
    if (plan.unchanged) continue;
    rows.push({ row: x.row, name: mine.name, kind: !x.on ? "untick" : !has ? (mine.manager ? "move" : "tick") : "cut", cells: plan.cells,
      from: { manager: mine.manager, cut: mine.cut }, to: x.on ? { manager, cut: "F" in plan.cells ? plan.cells.F : mine.cut } : { manager: "", cut: null } });
  }
  return rows.length ? { manager, rows } : { unchanged: true, rows: [] };
}

// Would lib/info-managers.js refuse to copy INFO to the site after this plan? Its copy refuses to take the manager away from
// most of the clients that have one (a broken sheet looks the same), so a save that would is refused BEFORE anything is
// written: written first, INFO would change and the site could never follow (its copy keeps refusing the same read). Uses
// that guard itself (managersProblem), on INFO as the plan leaves it. siteClients: [{ id, name, sheet_tab_name, manager }].
// -> a sentence, or null (also null when the copy would refuse anyway, with or without this save: that isn't this save's doing)
export function followProblem(layout, plan, siteClients) {
  const info = (managerOf) => (layout?.roster || []).filter((r) => !r.company).map((r) => ({ name: r.name, manager: managerOf(r) }));
  const after = info((r) => { const c = plan?.rows?.find((x) => x.row === r.row)?.cells; return c && "E" in c ? c.E : r.manager; });
  if (!managersProblem(siteClients, managersByClient(siteClients, after))) return null;
  if (managersProblem(siteClients, managersByClient(siteClients, info((r) => r.manager)))) return null;
  return "Saving this would take the manager away from more artists at once than the site's copy of the managers accepts (more than half of the artists that have one), so nothing was written. Untick fewer artists in one save, then save again.";
}

// Annual Summary's CLIENT SPLITS block as it is: { head, first, last, total, offset, covered } (row r reads INFO row
// r - offset; covered: the last INFO row it reads) or { problem }. The block: a "Artist / Client" header in D, rows
// whose D, E and F are exactly annualFormulas, a TOTAL row whose E and F sum them, nothing under it, and nothing
// beside the block from its first row down (rows will go in across the whole sheet).
export function annualBlock(grid) {
  const g = grid || [];
  let head = null;
  for (let r = 1; r <= g.length; r++) if (norm(at(g, r, "D")) === "artist / client") { head = r; break; }
  if (!head) return { problem: `Annual Summary has no client splits block (no "Artist / Client" in column D), so it wasn't changed.` };
  const first = head + 1, offset = first - FIRST_ROW;
  const maps = (r) => { const f = annualFormulas(r, r - offset); return ["D", "E", "F"].every((c) => sameF(at(g, r, c), f[c])); };
  let last = first - 1;
  while (last + 1 <= g.length && last + 1 - offset <= LAST_ROW && maps(last + 1)) last++;
  if (last < first + 1) return { problem: `Annual Summary's row ${first} doesn't read INFO the usual way (${shortF(at(g, first, "D"))}), so it wasn't changed.` };
  const total = last + 1;
  if (norm(at(g, total, "D")) !== "total") return { problem: `Annual Summary's D${total} reads ${shortF(at(g, total, "D"))}, not TOTAL or the next client row, so it wasn't changed.` };
  for (const c of ["E", "F"]) if (!sameF(at(g, total, c), `=SUM(${c}${first}:${c}${last})`)) return { problem: `Annual Summary's ${c}${total} reads ${shortF(at(g, total, c))}, not =SUM(${c}${first}:${c}${last}), so it wasn't changed.` };
  for (let r = total + 1; r <= g.length; r++) {
    const j = (g[r - 1] || []).findIndex((v) => !blank(v));
    if (j >= 0) return { problem: `Annual Summary has something under its client splits (${COLS[j]}${r}), so it wasn't changed.` };
  }
  for (let r = first; r <= total; r++) {
    const j = (g[r - 1] || []).findIndex((v, i) => !blank(v) && !["D", "E", "F"].includes(COLS[i]));
    if (j >= 0) return { problem: `Annual Summary has something beside its client splits (${COLS[j]}${r}), so it wasn't changed.` };
  }
  return { head, first, last, total, offset, covered: last - offset };
}

// How to grow the block to read INFO rows 4..upTo -> null (it already does), { problem }, or { insertAt, add, first,
// last, newLast, totalRow, offset, formulas: { [row]: { D, E, F } }, totals: { E, F } }. (2026-11-13 review) The rows go
// in AT the TOTAL row, under the block's last client row, so no client row moves: a cell anywhere that reads one (=F67,
// prodzo's split) still reads the same client. The new rows get D, E and F reading INFO rows covered+1..upTo, and TOTAL
// (moved down by Sheets) is given =SUM over the whole block, all in the one batchUpdate.
export function planAnnualClients(grid, { upTo = LAST_ROW } = {}) {
  const b = annualBlock(grid);
  if (b.problem) return { problem: b.problem };
  if (b.covered >= upTo) return null;
  const add = upTo - b.covered, newLast = b.last + add, formulas = {};
  for (let r = b.last + 1; r <= newLast; r++) formulas[r] = annualFormulas(r, r - b.offset);
  return { insertAt: b.total, add, first: b.first, last: b.last, newLast, totalRow: b.total + add, offset: b.offset, covered: b.covered, formulas,
    totals: { E: `=SUM(E${b.first}:E${newLast})`, F: `=SUM(F${b.first}:F${newLast})` } };
}

// The cells whose formulas read a range of Annual Summary that ends on the block's last client row (=SUM(E48:E67) on
// another tab, say): the new rows go in under that row, so such a range would leave them out. TOTAL's own E and F are
// rewritten with the grow, so they don't count. before: Annual Summary as formulas; refs: other tabs' formulas naming it.
export function narrowRefs(plan, before, refs = []) {
  const ends = (f, own) => rowSpans(f, { tab: ANNUAL_TAB, own }).some(([a, b]) => a < b && b === plan.last);
  const oldTotal = plan.totalRow - plan.add, out = [];
  (before || []).forEach((row, i) => (row || []).forEach((v, j) => {
    if (j >= COLS.length || !isFormula(v) || (i + 1 === oldTotal && (COLS[j] === "E" || COLS[j] === "F"))) return;
    if (ends(v, true)) out.push(`${COLS[j]}${i + 1}`);
  }));
  for (const x of refs) if (ends(x.f, false)) out.push(`${x.t}!${x.cell}`);
  return out;
}

// What reads differently on Annual Summary after the insert ([] = all as planned). before/after: A1:Z as formulas;
// valsBefore/valsAfter: the same as values. Every cell is where the insert moved it, its formula shifted the way Sheets
// shifts it, but for the new rows' D:F and TOTAL's E:F, which must be exactly the planned formulas; and every formula
// that was there reads the same value after (the new rows read blank INFO rows, so nothing adds up differently), but
// for ones that change by themselves (NOW, RAND, IMPORTRANGE …).
const sameValue = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : String(a ?? "") === String(b ?? ""));
const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|IMPORTRANGE|IMPORTDATA|IMPORTHTML|IMPORTXML|IMPORTFEED|GOOGLEFINANCE)\s*\(/i;
export function annualReadBackProblems(plan, before, after, valsBefore = null, valsAfter = null) {
  const bad = [], { insertAt: atRow, add, last, newLast, totalRow } = plan;
  const rewritten = (r, c) => (r > last && r <= newLast && ["D", "E", "F"].includes(c)) || (r === totalRow && (c === "E" || c === "F"));
  before.forEach((row, i) => (row || []).forEach((v, j) => {
    if (j >= COLS.length) return;
    const r = i + 1, nr = r >= atRow ? r + add : r, c = COLS[j];
    if (!rewritten(nr, c)) {
      const want = isFormula(v) ? shiftRows(v, { tab: ANNUAL_TAB, at: atRow, add, own: true }) : v, got = after[nr - 1]?.[j];
      if (!sameValue(got, want)) { bad.push(`${c}${r} (now ${c}${nr}) reads ${shortF(got)}, not ${shortF(want)}`); return; }
    }
    if (valsBefore && valsAfter && isFormula(v) && !VOLATILE.test(v)) {
      const was = valsBefore[i]?.[j], now = valsAfter[nr - 1]?.[j];
      if (!sameValue(now, was)) bad.push(`${c}${r}${nr !== r ? ` (now ${c}${nr})` : ""} was ${shortF(was)}, now ${shortF(now)}`);
    }
  }));
  for (let r = last + 1; r <= newLast; r++) for (const c of ["D", "E", "F"]) {
    const got = at(after, r, c), want = plan.formulas[r][c];
    if (!sameF(got, want)) bad.push(`${c}${r} reads ${shortF(got)}, not ${shortF(want)}`);
  }
  for (const c of ["E", "F"]) {
    const got = at(after, totalRow, c), want = plan.totals[c];
    if (!sameF(got, want)) bad.push(`${c}${totalRow} reads ${shortF(got)}, not ${shortF(want)}`);
  }
  return bad;
}

// --- the sheets -----------------------------------------------------------------------------------------------------
const release = (key) => sql`UPDATE app_state SET updated_at = now() - interval '1 day' WHERE key = ${key}`.catch((err) => console.error("people sync: claim not released", err));
const denied = (err) => [err?.status, err?.code, err?.response?.status].some((x) => Number(x) === 403);
// the dashboard's Google account can read a sheet but not edit it (a Viewer share)
export const noEditText = (sheet = "the accounting sheet") => {
  const who = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "").trim();
  return `The dashboard's Google account${who ? ` (${who})` : ""} can't edit ${sheet}, so nothing was changed. Share the sheet with it as Editor, then try again.`;
};
export { denied as googleDenied };

const readGrid = async (sheets, spreadsheetId, range, render = "FORMULA") => (await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: render })).data.values || [];
// INFO and Annual Summary in one read (formulas)
async function readInfoAndAnnual(sheets, spreadsheetId) {
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [INFO_RANGE, ANNUAL_RANGE], valueRenderOption: "FORMULA" });
  const [info, annual] = (got.data.valueRanges || []).map((v) => v.values || []);
  return { grid: info || [], annual: annual || [] };
}
// For GET /api/people-sync: INFO's layout with each row's client, and how far Annual Summary reads. Reads only.
export async function readPeople({ sheets = getSheetsClient(), spreadsheetId = accountingSheetId(), clients = null } = {}) {
  const [{ grid, annual }, known] = await Promise.all([readInfoAndAnnual(sheets, spreadsheetId), clients ? clients : loadClientTabNames()]);
  const layout = infoLayout(grid), block = annualBlock(annual);
  return {
    info: layout.problem ? { problem: layout.problem, roster: [], managers: [] } : { roster: rosterWithClients(layout, known), managers: layout.managers, nextClientRow: layout.nextClientRow, nextManagerRow: layout.nextManagerRow, problem: null },
    annualCovered: block.problem ? null : block.covered, annualProblem: block.problem || null,
  };
}

// the formulas on every other tab that name `tab`, each with its cell
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

// Annual Summary's CLIENT SPLITS grown to read INFO rows 4..upTo, in ONE batchUpdate (the rows inserted at the TOTAL
// row, their D:F formulas, TOTAL's sums over the whole block). Refused, before anything is written, when a formula here
// or on another tab reads the block's client rows as a range ending on its last one (it wouldn't take in the new rows).
// Read back after: every cell of the tab where the insert moved it, every formula there reading the same value, every
// D in the block the INFO name it reads, every formula on another tab that names Annual Summary moved with it and
// reading the same value. -> { covered } (nothing to do), { refused } (not the known block, or writes off: nothing
// written), { added, at, totalRow, covered, alarm? } (the rows are in). Throws when Google refuses the write (all or
// nothing). Exported for a supervised one-time run.
export async function extendAnnualClients(sheets = getSheetsClient(), spreadsheetId = accountingSheetId(), { upTo = LAST_ROW } = {}) {
  if (!spreadsheetId) return { refused: "The accounting sheet isn't connected yet.", off: true };
  if (!logWritesOn()) return { refused: ACCOUNTING_OFF, off: true };
  const props = await listTabs(sheets, spreadsheetId);
  const me = props.find((p) => p.title === ANNUAL_TAB);
  if (!me) return { refused: "The accounting sheet has no Annual Summary tab, so it wasn't changed." };
  const [before, valsBefore, refs] = await Promise.all([readGrid(sheets, spreadsheetId, ANNUAL_RANGE), readGrid(sheets, spreadsheetId, ANNUAL_RANGE, "UNFORMATTED_VALUE"),
    refsTo(sheets, spreadsheetId, props.filter((p) => p.title !== ANNUAL_TAB).map((p) => p.title), ANNUAL_TAB)]);
  const plan = planAnnualClients(before, { upTo });
  if (!plan) return { covered: upTo };
  if (plan.problem) return { refused: plan.problem };
  const narrow = narrowRefs(plan, before, refs);
  if (narrow.length) return { refused: `${narrow[0]} reads Annual Summary's client rows as a range that ends on row ${plan.last}. New rows under it wouldn't be counted there, so Annual Summary wasn't changed.` };
  const vals = await refCells(sheets, spreadsheetId, refs, "UNFORMATTED_VALUE");
  refs.forEach((x, i) => { x.v = vals[i]; });
  const fv = (f) => ({ userEnteredValue: { formulaValue: f } });
  const rows = [];
  for (let r = plan.last + 1; r <= plan.newLast; r++) rows.push({ values: ["D", "E", "F"].map((c) => fv(plan.formulas[r][c])) });
  const requests = [
    { insertDimension: { range: { sheetId: me.sheetId, dimension: "ROWS", startIndex: plan.insertAt - 1, endIndex: plan.insertAt - 1 + plan.add }, inheritFromBefore: true } },
    { updateCells: { start: { sheetId: me.sheetId, rowIndex: plan.last, columnIndex: 3 }, rows, fields: "userEnteredValue" } },
    { updateCells: { start: { sheetId: me.sheetId, rowIndex: plan.totalRow - 1, columnIndex: 4 }, rows: [{ values: [fv(plan.totals.E), fv(plan.totals.F)] }], fields: "userEnteredValue" } },
  ];
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  } catch (err) {
    // an answer that never came may still have landed: the block says which
    const now = await readGrid(sheets, spreadsheetId, ANNUAL_RANGE).then((g) => planAnnualClients(g, { upTo })).catch(() => undefined);
    if (now !== null) throw err;
  }
  // the rows are in from here: a read-back that fails is an alarm, never "couldn't grow"
  const base = { added: plan.add, at: plan.insertAt, totalRow: plan.totalRow, covered: upTo };
  const what = `Annual Summary's client splits were grown by ${plan.add} rows (rows ${plan.last + 1} to ${plan.newLast}) to read INFO rows ${FIRST_ROW} to ${upTo}`;
  try {
    const [after, valsAfter, names, fAfter, vAfter] = await Promise.all([
      readGrid(sheets, spreadsheetId, ANNUAL_RANGE),
      readGrid(sheets, spreadsheetId, ANNUAL_RANGE, "UNFORMATTED_VALUE"),
      readGrid(sheets, spreadsheetId, `INFO!C${FIRST_ROW}:C${upTo}`, "UNFORMATTED_VALUE"),
      refCells(sheets, spreadsheetId, refs, "FORMULA"),
      refCells(sheets, spreadsheetId, refs, "UNFORMATTED_VALUE"),
    ]);
    const bad = annualReadBackProblems(plan, before, after, valsBefore, valsAfter);
    for (let r = plan.first; r <= plan.newLast; r++) {
      const want = String(names[r - plan.offset - FIRST_ROW]?.[0] ?? "").trim(), got = String(at(valsAfter, r, "D") ?? "").trim();
      if (want !== got) bad.push(`D${r} shows ${got || "blank"}, not INFO's C${r - plan.offset} (${want || "blank"})`);
    }
    refs.forEach((x, i) => {
      const want = shiftRows(x.f, { tab: ANNUAL_TAB, at: plan.insertAt, add: plan.add });
      if (fAfter[i] !== want) bad.push(`${x.t}!${x.cell} reads ${shortF(fAfter[i])}, not ${shortF(want)}`);
      else if (!sameValue(vAfter[i], x.v)) bad.push(`${x.t}!${x.cell} was ${x.v}, now ${vAfter[i]}`);
    });
    if (bad.length) {
      const alarm = `Check Annual Summary now: ${what}, but ${bad.length === 1 ? "one thing reads" : `${bad.length} things read`} differently after (${bad.slice(0, 3).join("; ")}${bad.length > 3 ? `; ${bad.length - 3} more` : ""}).`;
      console.error(`people sync: ${alarm}`);
      return { ...base, refs: refs.length, alarm };
    }
    return { ...base, refs: refs.length };
  } catch (err) {
    const alarm = `Check Annual Summary now: ${what}, but it couldn't be read back after (${err.message}).`;
    console.error(`people sync: ${alarm}`);
    return { ...base, alarm };
  }
}

// One INFO cell read back, as values
const cellValue = async (sheets, spreadsheetId, a1) => (await readGrid(sheets, spreadsheetId, `INFO!${a1}`, "UNFORMATTED_VALUE"))[0]?.[0];
// The managers list's next cell, written alone (E's dropdown reads the list) and read back. -> { row, name } or
// { alarm } (it reads differently). Throws when Google refuses.
async function writeManagerCell(sheets, spreadsheetId, pm) {
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data: [{ range: `INFO!${pm.cell}`, values: [[pm.value]] }] } });
  const got = await cellValue(sheets, spreadsheetId, pm.cell).catch((err) => ({ err }));
  if (got?.err) return { alarm: `Check INFO now: ${pm.value} was written to ${pm.cell}, but it couldn't be read back (${got.err.message}).` };
  if (String(got ?? "").trim() !== pm.value) return { alarm: `Check INFO now: ${pm.value} was written to ${pm.cell}, but it reads ${shortF(got)}.` };
  return { row: pm.row, name: pm.value };
}

const manWords = (manager, cut) => (manager ? `${manager} gets ${pct(cut)}` : "no manager, so Defied keeps 100%");

// The Roster form's save to INFO. input: { clientId, mode, row, was, rate, manager, cut, newManager } with rate and
// cut as fractions (the route turns the form's percents into them; null on an existing row: leave that cell as it is).
// mode/row/was: the row the form was filled from (staleProblem). newManager: a name to add to INFO's list first and
// use. -> { ok, row, text, unchanged?, alarm? } (alarm: written, but Annual Summary couldn't be grown to cover it),
// { refused, off?, busy?, stale?, addedManager? } (the client's row not written; stale: INFO changed since the form
// was filled; addedManager: the new manager did go on the list), { alarm } (something read back differently: stop and
// look). Throws when Google refuses a write (with addedManager when the new manager had gone in).
export async function saveClientToInfo(input = {}, { by = "", sheets = null, spreadsheetId = accountingSheetId() } = {}) {
  if (!spreadsheetId) return { refused: "The accounting sheet isn't connected yet.", off: true };
  if (!logWritesOn()) return { refused: ACCOUNTING_OFF, off: true };
  const id = String(input.clientId || "");
  const clients = await withInfoNames(await loadClientTabNames());
  const client = clients.find((c) => c.id === id);
  if (!client) return { refused: "Save the client on the site first, so nothing was written." };
  if (!(await claimState(INFO_LOCK, LEASE_MIN, { at: new Date().toISOString(), by }))) return { refused: BUSY, busy: true };
  let added = null;
  const addedText = () => (added ? `${added.name} was added to INFO's manager list (L${added.row}). ` : "");
  const addedTo = (out) => (added ? { ...out, addedManager: added.name } : out);
  // a refusal, said with the new manager that did go on the list (the form picks them then)
  const no = (text, extra = {}) => addedTo({ refused: `${addedText()}${text}`, ...extra });
  const stale = (st) => no(st.text, st.stale ? { stale: true } : {});
  try {
    const S = sheets || getSheetsClient();
    let { grid, annual } = await readInfoAndAnnual(S, spreadsheetId);
    let layout = infoLayout(grid);
    if (layout.problem) return no(layout.problem);
    // the row the form was filled from, first: one changed on INFO since is never typed over
    const st0 = staleProblem(infoRowOf(layout, clients, id), input, client.name);
    if (st0) return stale(st0);
    let manager = String(input.manager ?? "").trim();
    const want = () => ({ name: client.name, rate: input.rate, manager, cut: input.cut });
    const newName = String(input.newManager ?? "").trim();
    if (newName) {
      const pm = planManager(layout, newName);
      if (pm.refused) return no(pm.refused);
      manager = pm.value;
      // the client's plan checked before anything is written, as if the name were on the list already
      const pre = planClient({ ...layout, managers: [...layout.managers, { row: pm.row, name: pm.value }] }, want(), infoRowOf(layout, clients, id)?.row ?? null);
      if (pre.refused) return no(pre.refused);
      const w = await writeManagerCell(S, spreadsheetId, pm);
      if (w.alarm) { console.error(`people sync: ${w.alarm}`); return { alarm: `${w.alarm} ${client.name} wasn't written to INFO.` }; }
      added = w;
      ({ grid, annual } = await readInfoAndAnnual(S, spreadsheetId)); // fresh, for the client's own plan
      layout = infoLayout(grid);
      if (layout.problem) return no(`${client.name} wasn't written: ${layout.problem}`);
      const st1 = staleProblem(infoRowOf(layout, clients, id), input, client.name);
      if (st1) return stale(st1);
    }
    const existing = infoRowOf(layout, clients, id);
    const plan = planClient(layout, want(), existing?.row ?? null);
    if (plan.refused) return no(plan.refused);
    if (plan.unchanged) return addedTo({ ok: true, row: plan.row, unchanged: true, text: `${addedText()}INFO row ${plan.row} already reads that, so nothing was changed.` });
    // Annual Summary first, so the client never shows up on INFO without it; a block it can't grow is said, loudly
    let pending = null, grown = "";
    // (a block it can't read: a new client's row may be past it; an existing client's row reads as it did before)
    const block = annualBlock(annual);
    if (block.problem ? !existing : plan.row > block.covered) {
      // (2026-11-14) lib/people-link.js's own adds never grow Annual Summary: a person does that, from the client's form
      if (input.noGrow) return no(`Annual Summary's client splits don't read INFO row ${plan.row} yet, so ${client.name} wasn't added to INFO automatically. Add them from their form (Website › Roster › the accounting sheet), which grows Annual Summary first.`, { noGrow: true });
      try {
        const ext = await extendAnnualClients(S, spreadsheetId);
        if (ext.alarm) return { alarm: `${addedText()}${ext.alarm} ${client.name} wasn't written to INFO.` };
        if (ext.refused) pending = ext.refused;
        else if (ext.added) grown = ` Annual Summary's client splits now read INFO rows ${FIRST_ROW} to ${ext.covered}.`;
      } catch (err) { console.error("people sync: Annual Summary", err); pending = `Annual Summary couldn't be grown just now (${denied(err) ? "the dashboard's Google account can't edit it" : err.message}).`; }
      // (2026-11-13 review) that takes seconds: INFO read again and the client planned again, so a row typed on INFO
      // meanwhile is never written over; anything different and the client isn't written (the grow is said as done)
      const done = grown ? `${grown.trim()} ` : "";
      let fresh;
      try { fresh = infoLayout(await readGrid(S, spreadsheetId, INFO_RANGE)); } catch (err) {
        return no(`${done}INFO couldn't be read again after that (${err.message}), so ${client.name} wasn't written. Try again in a minute.`);
      }
      const ex2 = fresh.problem ? null : infoRowOf(fresh, clients, id);
      const again = fresh.problem || staleProblem(ex2, input, client.name) ? null : planClient(fresh, want(), ex2?.row ?? null);
      if (!again || again.refused || again.row !== plan.row || JSON.stringify(again.cells) !== JSON.stringify(plan.cells)) {
        return no(`${done}INFO changed while Annual Summary was being ${grown ? "grown" : "checked"}, so ${client.name} wasn't written. The form shows what INFO reads now. Check it and save again.`, { stale: true });
      }
      layout = fresh;
    }
    const data = Object.entries(plan.cells).map(([col, v]) => ({ range: `INFO!${col}${plan.row}`, values: [[v]] }));
    // a refused client write, said with the manager that did go in (the route answers it as it is)
    const refusedWrite = (err) => {
      if (!added) return err;
      const e = new Error(`${addedText()}${client.name} wasn't written to INFO: ${denied(err) ? noEditText() : err.message}`);
      e.status = denied(err) ? 403 : 502;
      e.sentence = true;
      e.addedManager = added.name;
      return e;
    };
    let writeErr = null;
    try { await S.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } }); } catch (err) { writeErr = err; }
    // read back C:G (also after a failed write: it may have landed)
    let vals, forms;
    try {
      [vals, forms] = await Promise.all([readGrid(S, spreadsheetId, `INFO!C${plan.row}:G${plan.row}`, "UNFORMATTED_VALUE"), readGrid(S, spreadsheetId, `INFO!C${plan.row}:G${plan.row}`, "FORMULA")]);
    } catch (err) {
      if (writeErr) throw refusedWrite(writeErr);
      const alarm = `${addedText()}Check INFO row ${plan.row} now: ${client.name} was written there, but it couldn't be read back (${err.message}).`;
      console.error(`people sync: ${alarm}`);
      return { alarm, row: plan.row };
    }
    const v = vals[0] || [], f = forms[0] || [], cl = plan.cells;
    const nameNow = existing ? existing.name : client.name;
    const bad = [];
    // the cells written read what was sent; the ones left alone aren't checked against anything
    if (String(v[0] ?? "").trim() !== nameNow) bad.push(`C${plan.row} reads ${shortF(v[0])}, not ${nameNow}`);
    if ("D" in cl && (cl.D === "" ? !blank(v[1]) : !close(v[1], Number(cl.D)))) bad.push(`D${plan.row} reads ${shortF(v[1])}, not ${cl.D === "" ? "blank" : cl.D}`);
    if ("E" in cl && String(v[2] ?? "").trim() !== cl.E) bad.push(`E${plan.row} reads ${shortF(v[2])}, not ${cl.E || "blank"}`);
    if ("F" in cl && (cl.F === "" ? !blank(v[3]) : !close(v[3], Number(cl.F)))) bad.push(`F${plan.row} reads ${shortF(v[3])}, not ${cl.F === "" ? "blank" : cl.F}`);
    const gWant = blank(v[2]) ? 1 : typeof v[3] === "number" ? 1 - v[3] : null;
    if (!sameF(f[4], standardG(plan.row))) bad.push(`G${plan.row}'s formula reads ${shortF(f[4])}, not ${standardG(plan.row)}`);
    else if (typeof v[4] === "number" && gWant != null && !close(v[4], gWant)) bad.push(`G${plan.row} works out ${v[4]}, not ${gWant}`);
    if (writeErr) {
      // an error Google answered (403, 429, 500) wrote nothing; a lost answer may have, and the read-back says which
      const was = layout.cells(plan.row), same = (a, b) => (typeof a === "number" || typeof b === "number" ? close(Number(a), Number(b)) || (blank(a) && blank(b)) : String(a ?? "").trim() === String(b ?? "").trim());
      const untouched = [v[0], v[1], v[2], v[3]].every((x, i) => same(x, was["CDEF"[i]]));
      const status = (x) => x != null && x !== "" && Number.isFinite(Number(x));
      const answered = status(writeErr.code) || status(writeErr.status) || status(writeErr.response?.status);
      if (answered || (bad.length && untouched)) throw refusedWrite(writeErr);
    }
    clearAccountingCache();
    if (bad.length) {
      const alarm = `${addedText()}Check INFO row ${plan.row} now: ${client.name} was written there, but ${bad.length === 1 ? "one cell reads" : `${bad.length} cells read`} differently after (${bad.join("; ")}).`;
      console.error(`people sync: ${alarm}`);
      return { alarm, row: plan.row };
    }
    // every client's manager copied from INFO again (Magnus's own-artists view, the Sync check)
    try { const m = await refreshManagers({ sheets: S, spreadsheetId }); if (m.error) console.error("people sync: managers", m.error); } catch (err) { console.error("people sync: managers", err); }
    // the row as it reads now: what was written, and what was left as it was
    const ex = existing ? layout.roster.find((x) => x.row === plan.row) : null;
    const fin = { D: "D" in cl ? cl.D : ex?.rate, E: "E" in cl ? cl.E : ex?.manager || "", F: "F" in cl ? cl.F : ex?.cut };
    const text = `${addedText()}${existing ? `Updated ${client.name} on the accounting sheet (INFO row ${plan.row})` : `${client.name} is on the accounting sheet now (INFO row ${plan.row})`}: ${fin.D == null || fin.D === "" ? "commission left blank" : `${pct(fin.D)} commission`}, ${manWords(fin.E, fin.F)}.${grown}`;
    const out = addedTo({ ok: true, row: plan.row, text });
    if (pending) {
      out.alarm = `${client.name} is on INFO row ${plan.row}, but Annual Summary's client splits don't read that row yet: ${pending} Add the row to Annual Summary by hand, or ask for the sheet to be checked.`;
      console.error(`people sync: ${out.alarm}`);
    }
    return out;
  } finally { await release(INFO_LOCK); }
}

// Site › Users' "Add to the sheet" / "Add a manager": one more name on INFO's managers list (L4:L13), nothing else.
// -> { ok, row, text } / { refused, off?, busy? } / { alarm }. Throws when Google refuses the write.
export async function addManagerToInfo(name, { by = "", sheets = null, spreadsheetId = accountingSheetId() } = {}) {
  if (!spreadsheetId) return { refused: "The accounting sheet isn't connected yet.", off: true };
  if (!logWritesOn()) return { refused: ACCOUNTING_OFF, off: true };
  if (!(await claimState(INFO_LOCK, LEASE_MIN, { at: new Date().toISOString(), by }))) return { refused: BUSY, busy: true };
  try {
    const S = sheets || getSheetsClient();
    const layout = infoLayout(await readGrid(S, spreadsheetId, INFO_RANGE));
    const pm = planManager(layout, name);
    if (pm.refused) return { refused: pm.refused };
    const w = await writeManagerCell(S, spreadsheetId, pm);
    if (w.alarm) { console.error(`people sync: ${w.alarm}`); return { alarm: w.alarm }; }
    clearAccountingCache();
    return { ok: true, row: w.row, name: w.name, text: `${w.name} is on INFO's manager list now (L${w.row}). They can be picked as a client's manager.` };
  } finally { await release(INFO_LOCK); }
}

// Site › Users' checklist of a manager's artists (planManagerArtists): every row changed, E and F only and only the cells that
// read differently, in ONE RAW write under one lock and one stale check (a row changed on INFO since the checklist was filled
// refuses the whole save). input: { manager, rows: [{ row, was, on, cut }] } with cut as a fraction or null (the route turns
// the checklist's percents into them). Refused up front when the site's manager copy would refuse the result
// (followProblem), so INFO and the site never part. Read back after (C:G of every row written: what each cell reads, G's
// formula and what it works out), then every client's manager copied from INFO again, once (lib/info-managers.js).
// -> { ok, text, changes: [{ row, name, kind, text }], unchanged?, alarm? } (alarm: written, but the site's copy of the
// managers couldn't be updated just now), { refused, off?, busy?, stale? } (nothing written), { alarm } (something read back
// differently: stop and look). Throws when Google refuses the write (nothing was changed).
const doneText = (manager, x) => (x.kind === "untick" ? `${x.name}: ${manWords("", null)}`
  : x.kind === "cut" ? `${x.name}: ${manager}'s cut ${x.from.cut == null ? "was blank" : `was ${pct(x.from.cut)}`}, now ${pct(x.to.cut)}`
  : x.kind === "move" ? `${x.name}: moved from ${x.from.manager} to ${manager}, ${manWords(manager, x.to.cut)}`
  : `${x.name}: ${manWords(manager, x.to.cut)}`);
export async function saveManagerArtists(input = {}, { by = "", sheets = null, spreadsheetId = accountingSheetId() } = {}) {
  if (!spreadsheetId) return { refused: "The accounting sheet isn't connected yet.", off: true };
  if (!logWritesOn()) return { refused: ACCOUNTING_OFF, off: true };
  if (!(await claimState(INFO_LOCK, LEASE_MIN, { at: new Date().toISOString(), by }))) return { refused: BUSY, busy: true };
  try {
    const S = sheets || getSheetsClient();
    const layout = infoLayout(await readGrid(S, spreadsheetId, INFO_RANGE));
    const plan = planManagerArtists(layout, input);
    if (plan.refused) return { refused: plan.refused, ...(plan.stale ? { stale: true } : {}) };
    const manager = String(input.manager ?? "").trim();
    if (plan.unchanged) return { ok: true, unchanged: true, changes: [], text: `${manager}'s artists on INFO already read that, so nothing was changed.` };
    const follow = followProblem(layout, plan, await sql`SELECT id, name, sheet_tab_name, manager FROM clients`);
    if (follow) return { refused: follow };
    const data = plan.rows.flatMap((x) => ["E", "F"].filter((c) => c in x.cells).map((c) => ({ range: `INFO!${c}${x.row}`, values: [[x.cells[c]]] })));
    let writeErr = null;
    try { await S.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: "RAW", data } }); } catch (err) { writeErr = err; }
    // read back C:G from the first row written to the last (also after a failed write: it may have landed)
    const lo = Math.min(...plan.rows.map((x) => x.row)), hi = Math.max(...plan.rows.map((x) => x.row)), range = `INFO!C${lo}:G${hi}`;
    let vals, forms;
    try {
      [vals, forms] = await Promise.all([readGrid(S, spreadsheetId, range, "UNFORMATTED_VALUE"), readGrid(S, spreadsheetId, range, "FORMULA")]);
    } catch (err) {
      if (writeErr) throw writeErr;
      const alarm = `Check INFO rows ${lo} to ${hi} now: ${manager}'s artists were written there, but it couldn't be read back (${err.message}).`;
      console.error(`people sync: ${alarm}`);
      return { alarm };
    }
    const bad = [];
    for (const x of plan.rows) {
      const v = vals[x.row - lo] || [], f = forms[x.row - lo] || [], cl = x.cells;
      // the cells written read what was sent; the ones left alone aren't checked against anything
      if (String(v[0] ?? "").trim() !== x.name) bad.push(`C${x.row} reads ${shortF(v[0])}, not ${x.name}`);
      if ("E" in cl && String(v[2] ?? "").trim() !== cl.E) bad.push(`E${x.row} reads ${shortF(v[2])}, not ${cl.E || "blank"}`);
      if ("F" in cl && (cl.F === "" ? !blank(v[3]) : !close(v[3], Number(cl.F)))) bad.push(`F${x.row} reads ${shortF(v[3])}, not ${cl.F === "" ? "blank" : cl.F}`);
      const gWant = blank(v[2]) ? 1 : typeof v[3] === "number" ? 1 - v[3] : null;
      if (!sameF(f[4], standardG(x.row))) bad.push(`G${x.row}'s formula reads ${shortF(f[4])}, not ${standardG(x.row)}`);
      else if (typeof v[4] === "number" && gWant != null && !close(v[4], gWant)) bad.push(`G${x.row} works out ${v[4]}, not ${gWant}`);
    }
    if (writeErr) {
      // an error Google answered (403, 429, 500) wrote nothing; a lost answer may have, and the read-back says which
      const same = (a, b) => (typeof a === "number" || typeof b === "number" ? close(Number(a), Number(b)) || (blank(a) && blank(b)) : String(a ?? "").trim() === String(b ?? "").trim());
      const untouched = plan.rows.every((x) => { const v = vals[x.row - lo] || [], was = layout.cells(x.row); return [v[0], v[1], v[2], v[3]].every((y, i) => same(y, was["CDEF"[i]])); });
      const status = (x) => x != null && x !== "" && Number.isFinite(Number(x));
      const answered = status(writeErr.code) || status(writeErr.status) || status(writeErr.response?.status);
      if (answered || (bad.length && untouched)) throw writeErr;
    }
    clearAccountingCache();
    if (bad.length) {
      const alarm = `Check INFO now: ${manager}'s artists were written, but ${bad.length === 1 ? "one cell reads" : `${bad.length} cells read`} differently after (${bad.slice(0, 3).join("; ")}${bad.length > 3 ? `; ${bad.length - 3} more` : ""}).`;
      console.error(`people sync: ${alarm}`);
      return { alarm };
    }
    // every client's manager copied from INFO again, once (the site's own-artists view, the Sync check); a refusal or an
    // error here is said, never "saved" alone: INFO is written, the site's copy isn't
    let site = null;
    try { const m = await refreshManagers({ sheets: S, spreadsheetId }); if (m.error) site = m.error; } catch (err) { site = err.message; }
    const changes = plan.rows.map((x) => ({ row: x.row, name: x.name, kind: x.kind, text: doneText(manager, x) }));
    const n = (k) => plan.rows.filter((x) => x.kind === k).length;
    const parts = [n("tick") && `${n("tick")} added`, n("move") && `${n("move")} moved from another manager`, n("untick") && `${n("untick")} taken off (no manager)`, n("cut") && `${n("cut")} cut changed`].filter(Boolean);
    const out = { ok: true, text: `${manager}'s artists are saved on the accounting sheet: ${parts.join(", ")}.`, changes };
    if (site) {
      out.alarm = `The sheet is saved, but the site's copy of each artist's manager wasn't updated just now (${site}). It updates by itself every day, or press Update from the sheet.`;
      console.error(`people sync: ${out.alarm}`);
    }
    return out;
  } finally { await release(INFO_LOCK); }
}

// --- the pub sheet --------------------------------------------------------------------------------------------------
// MASTER's writer table (column A "Writer" down to "ROSTER TOTAL"): the rows whose formulas name `title`
export function masterRowsFor(master, title) {
  const head = (master || []).findIndex((r) => String(r?.[0] ?? "").trim() === "Writer");
  const out = [];
  for (let i = head + 1; head !== -1 && i < master.length; i++) {
    const row = master[i] || [];
    if (String(row[0] ?? "").trim() === "ROSTER TOTAL") break;
    if (row.some((f) => namesTab(f, title))) out.push(i + 1);
  }
  return out;
}
const writerNo = (t) => Number(String(t).split(" ")[1]) || 0;
const ownLabel = (t) => String(t.label ?? "").trim() === t.title;
// The free WRITER tabs (A5:A10 blank, the rule claimTabForNewCollaborator uses) that have a row on MASTER: [{ title,
// sheetId, masterRow, label }], the ones whose MASTER label still reads their own name first, then lowest number first.
// skip: tabs to leave out (2026-11-13 review: a WRITER tab a client goes by, typed as their Sheet tab name, is theirs
// even with no songs yet). Two reads (the tab list, then one batchGet).
export async function freeWriterTabs(sheets, spreadsheetId, tabs = null, skip = () => false) {
  const all = tabs || (await listTabs(sheets, spreadsheetId));
  const pool = all.filter((t) => WRITER_TAB_RE.test(t.title) && !skip(t.title)).sort((a, b) => writerNo(a.title) - writerNo(b.title));
  if (!pool.length) return { free: [], pool: 0 };
  const got = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: ["'MASTER'!A1:L300", ...pool.map((t) => `'${qt(t.title)}'!A5:A10`)], valueRenderOption: "FORMULA" });
  const [master, ...cols] = (got.data.valueRanges || []).map((v) => v.values || []);
  const empty = pool.filter((t, i) => (cols[i] || []).every((r) => blank(r?.[0])));
  // each with its MASTER row and that row's column-A label as it reads now
  const free = empty.map((t) => { const masterRow = masterRowsFor(master || [], t.title)[0] ?? null; return { ...t, masterRow, label: masterRow ? master[masterRow - 1]?.[0] ?? "" : null }; })
    .filter((t) => t.masterRow).sort((a, b) => (ownLabel(a) ? 0 : 1) - (ownLabel(b) ? 0 : 1) || writerNo(a.title) - writerNo(b.title));
  return { free, empty: empty.length, pool: pool.length };
}
// For GET /api/people-sync: how many free WRITER tabs, and the clients with no tab of their own. Reads only.
export async function readTabs({ sheets = getSheetsClient(), spreadsheetId = getSheetId(), clients = null } = {}) {
  const [tabs, known] = await Promise.all([listTabs(sheets, spreadsheetId), clients ? clients : loadClientTabNames()]);
  const { free } = await freeWriterTabs(sheets, spreadsheetId, tabs, (title) => !!ownerOf(known, title));
  const noTab = known.filter((c) => !findTab(tabs, String(c.sheet_tab_name || c.name || "").trim(), tabsOfOthers(known, c))).map((c) => c.id);
  return { freeTabs: free.length, noTab };
}

// (2026-11-13 review) One pub sheet tab made at a time: the Roster form's "Give them a pub sheet tab" and a song push
// that claims a tab for a new co-writer (pages/api/sheets-push.js) both rename the lowest free WRITER tab. fn runs
// holding the lock -> { value } (what fn gave) or { busy }. waits: how many times to wait 2.5 s for the other first.
export async function withTabLock(by, fn, { waits = 0 } = {}) {
  for (let i = 0; !(await claimState(TAB_LOCK, LEASE_MIN, { at: new Date().toISOString(), by: by || "" })); i++) {
    if (i >= waits) return { busy: true };
    await new Promise((r) => setTimeout(r, 2500));
  }
  try { return { value: await fn() }; } finally { await release(TAB_LOCK); }
}

// The Roster form's "Give them a pub sheet tab": a free WRITER tab (never a TEMPLATE copy: a copy has no MASTER row,
// never one a client goes by) renamed to the client's sheet tab name or name, that name saved as their "Sheet tab
// name", and MASTER's label for that row set to their name if it still reads the old "WRITER n" (else the answer says
// so). Sheets itself moves MASTER's formulas to the new name. -> { ok, tab, from, masterRow, text, alarm? } /
// { refused, off?, busy? }. Throws when Google refuses the rename.
export async function createClientTab(clientId, { by = "", sheets = null, spreadsheetId = null } = {}) {
  if (!shareWritesOn()) return { refused: PUB_OFF, off: true };
  const known = await loadClientTabNames();
  const c = known.find((x) => x.id === clientId);
  if (!c) return { refused: "Save the client on the site first, so no tab was made." };
  const title = String(c.sheet_tab_name || c.name || "").trim();
  if (!title) return { refused: "The client has no name, so no tab was made." };
  if (title.length > 100) return { refused: "That name is too long for a sheet tab, so no tab was made." };
  const got = await withTabLock(by, () => makeClientTab(c, title, known, sheets, spreadsheetId));
  return got.busy ? { refused: TAB_BUSY, busy: true } : got.value;
}
async function makeClientTab(c, title, known, sheets, spreadsheetId) {
  const S = sheets || getSheetsClient(), id = spreadsheetId || getSheetId();
  const tabs = await listTabs(S, id);
  const mine = findTab(tabs, title, tabsOfOthers(known, c));
  if (mine) return { refused: `${c.name} already has a tab on the pub sheet (${mine.title}), so no tab was made.`, tab: mine.title };
  const clash = tabs.find((t) => t.title.toLowerCase() === title.toLowerCase());
  if (clash) return { refused: `The pub sheet already has a tab called ${clash.title} (another client's), so no tab was made.` };
  const { free, empty } = await freeWriterTabs(S, id, tabs, tabsOfOthers(known, c));
  if (!free.length) return { refused: empty ? "The free WRITER tabs on the pub sheet have no row on MASTER, so no tab was made." : NO_FREE_TAB };
  const pick = free[0], old = pick.title;
  try {
    await S.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests: [{ updateSheetProperties: { properties: { sheetId: pick.sheetId, title }, fields: "title" } }] } });
  } catch (err) {
    const now = await listTabs(S, id).then((ts) => ts.find((t) => t.sheetId === pick.sheetId)?.title).catch(() => null);
    if (now !== title) throw err;
  }
  // the tab is renamed from here: anything after that goes wrong is an alarm, never "no tab was made"
  const issues = [];
  try { await sql`UPDATE clients SET sheet_tab_name = ${title} WHERE id = ${c.id}`; } catch (err) { console.error("people sync: sheet tab name", err); issues.push(`the site couldn't save "${title}" as their Sheet tab name (type it in their form)`); }
  let labelled = false;
  if (ownLabel(pick)) {
    try {
      await S.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data: [{ range: `'MASTER'!A${pick.masterRow}`, values: [[c.name]] }] } });
      labelled = true;
    } catch (err) { console.error("people sync: MASTER label", err); issues.push(`MASTER's A${pick.masterRow} still reads ${old}`); }
  } else {
    // (2026-11-13 review) a label someone typed over is left as it is, and said: it may name someone else
    issues.push(`MASTER's A${pick.masterRow} reads "${shortF(pick.label)}", not ${old}, so it was left as it is (type ${c.name} there if that row is theirs now)`);
  }
  try {
    const [ts, row] = await Promise.all([listTabs(S, id), readGrid(S, id, `'MASTER'!A${pick.masterRow}:L${pick.masterRow}`)]);
    const r = row[0] || [];
    if (ts.find((t) => t.sheetId === pick.sheetId)?.title !== title) issues.push(`the tab reads ${ts.find((t) => t.sheetId === pick.sheetId)?.title || "missing"}, not ${title}`);
    if (!r.some((f) => namesTab(f, title))) issues.push(`MASTER row ${pick.masterRow}'s formulas don't name ${title}`);
    if (r.some((f) => namesTab(f, old))) issues.push(`MASTER row ${pick.masterRow} still names ${old}`);
    if (labelled && String(r[0] ?? "") !== c.name) issues.push(`MASTER's A${pick.masterRow} reads ${shortF(r[0])}, not ${c.name}`);
  } catch (err) { issues.push(`it couldn't be read back (${err.message})`); }
  const text = `${c.name} has a pub sheet tab now: ${title} (it was ${old}). MASTER row ${pick.masterRow} reads it.`;
  const out = { ok: true, tab: title, from: old, masterRow: pick.masterRow, text };
  if (issues.length) {
    out.alarm = `Check the pub sheet now: ${old} was renamed ${title}, but ${issues.join("; ")}.`;
    console.error(`people sync: ${out.alarm}`);
  }
  return out;
}
