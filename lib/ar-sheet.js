// The A&R tabs of the pub sheet: OUTREACH, ADVANCE CALCULATOR and ASSUMPTIONS. Reads are one
// unformatted snapshot (no more "33.3%" read back and re-saved as 0.333), plus ADVANCE's own
// formulas to find each prospect's row there. Every write goes through one recipe: a lease lock, a
// fresh read, the same-person check, the browser's `expect` for each field it changes, and only the
// cells that really changed, written RAW in one request and logged before/after in ar_events. The
// row always comes from the prospect's record, never from the browser. Nothing here inserts,
// deletes or sorts rows, or writes a formula cell (OUTREACH C:N, ADVANCE A:N, A2/E2/I2/B4, ASSUMPTIONS).
import { sql } from "./db";
import { uid } from "./id";
import { getSheetsClient, getSheetId, tabLink } from "./sheets";
import { getState, setState } from "./luminate";
import {
  OUTREACH_TAB, ADVANCE_TAB, ASSUMPTIONS_TAB, OUTREACH_FIRST_ROW, ADVANCE_FIRST_ROW, TOTAL_LABEL, OUTREACH_STATUSES,
  SLOT_COLS, OWNED_COLS, CALC_COLS, COL_LABEL, colIdx, isBlank, isErrorValue, text, toNum, numOrNull, pct4,
  isoToSerial, givenOf, lastContactOf, nameKey, sameValue, kindOfCol, ArError, checkName, checkText, checkStatus,
  checkSlot, checkStreams, checkShare, checkDate, nextFollowUp, nyToday, addDays, FOLLOW_UP_DAYS, outreachTotalsOf,
} from "./ar";

const LAST_ROW = 200; // reads stop here: room for 196 OUTREACH rows
const RANGE = {
  assumptions: `'${ASSUMPTIONS_TAB}'!B7:B11`,
  budget: `'${ADVANCE_TAB}'!A2:I2`,
  recoup: `'${ADVANCE_TAB}'!B4`,
  advance: `'${ADVANCE_TAB}'!A7:O${LAST_ROW}`,
  outreach: `'${OUTREACH_TAB}'!A5:AA${LAST_ROW}`,
  outreachTop: `'${OUTREACH_TAB}'!A1:L2`, // row 1 labels over row 2 totals
  advanceFormulas: `'${ADVANCE_TAB}'!A7:A${LAST_ROW}`,
  outreachFormulas: `'${OUTREACH_TAB}'!C5:C${LAST_ROW}`,
};
const DAY = 864e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evId = () => uid() + uid();
const q = (tab) => `'${tab.replace(/'/g, "''")}'`;

// AR_SHEET_WRITES=on lets the A&R tab save to the pub sheet. Unset, it's off on the live site, so the
// first real deploy only reads (and the read-only Sheet check can run) until someone turns it on.
export function arWritesOn() {
  const v = String(process.env.AR_SHEET_WRITES ?? "").trim();
  if (v) return /^(on|1|true|yes)$/i.test(v);
  return process.env.NODE_ENV !== "production";
}

async function batchGet(sheets, spreadsheetId, ranges, render = "UNFORMATTED_VALUE") {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId, ranges, valueRenderOption: render, ...(render === "UNFORMATTED_VALUE" ? { dateTimeRenderOption: "SERIAL_NUMBER" } : {}),
  });
  return (res.data.valueRanges || []).map((v) => v.values || []);
}

// The three tabs' ids (for the "Open in sheet" links) and the status dropdown, from app_state for a
// day: two calls the page load doesn't have to make every time. `force` reads them again.
export async function sheetMeta(sheets, spreadsheetId, { force = false } = {}) {
  const cached = await getState("arSheetCheck");
  const ids = cached?.tabIds || {};
  const complete = [OUTREACH_TAB, ADVANCE_TAB, ASSUMPTIONS_TAB].every((t) => ids[t] != null);
  if (!force && complete && cached?.at && Date.now() - Date.parse(cached.at) < DAY) return cached;
  const props = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const tabIds = Object.fromEntries((props.data.sheets || []).map((s) => [s.properties.title, s.properties.sheetId])
    .filter(([t]) => [OUTREACH_TAB, ADVANCE_TAB, ASSUMPTIONS_TAB].includes(t)));
  let statuses = null, strict = false;
  if (tabIds[OUTREACH_TAB] != null) {
    const dv = await sheets.spreadsheets.get({ spreadsheetId, ranges: [`${q(OUTREACH_TAB)}!O5`], fields: "sheets.data.rowData.values.dataValidation" }).catch(() => null);
    const rule = dv?.data?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
    let vals = null;
    if (rule?.condition?.type === "ONE_OF_LIST") vals = (rule.condition.values || []).map((x) => text(x.userEnteredValue).trim());
    else if (rule?.condition?.type === "ONE_OF_RANGE") {
      // a dropdown "from a range": its list lives in those cells
      const ref = text(rule.condition.values?.[0]?.userEnteredValue).replace(/^=/, "");
      const got = ref ? await sheets.spreadsheets.values.get({ spreadsheetId, range: ref }).catch(() => null) : null;
      vals = (got?.data?.values || []).flat().map((x) => text(x).trim());
    }
    vals = (vals || []).filter(Boolean);
    if (vals.length) { statuses = [...new Set(vals)]; strict = !!rule.strict; }
  }
  const meta = { ...(cached || {}), at: new Date().toISOString(), tabIds, statuses: statuses || OUTREACH_STATUSES, statusSource: statuses ? "sheet" : "built-in", strict };
  await setState("arSheetCheck", meta);
  return meta;
}

// --- reading ------------------------------------------------------------
const cellOf = (row, col) => row?.[colIdx(col)] ?? "";

// OUTREACH rows 5 up to the row above PIPELINE TOTAL that have a name
function outreachRows(out) {
  const totalIdx = out.findIndex((r) => text(r?.[0]).trim().toUpperCase() === TOTAL_LABEL);
  const scope = totalIdx === -1 ? out : out.slice(0, totalIdx);
  const rows = [];
  scope.forEach((r, i) => {
    const name = text(cellOf(r, "A")).trim();
    if (!name) return;
    rows.push({
      row: OUTREACH_FIRST_ROW + i, name, key: nameKey(name),
      cells: Object.fromEntries(OWNED_COLS.map((c) => [c, cellOf(r, c)])),
      calc: Object.fromEntries(CALC_COLS.map((c) => [c, cellOf(r, c)])),
      formulaError: "CDEFGHIJKLMN".split("").some((c) => isErrorValue(cellOf(r, c))),
    });
  });
  return { rows, totalRow: totalIdx === -1 ? null : OUTREACH_FIRST_ROW + totalIdx };
}

// ADVANCE CALCULATOR rows, found from that tab's own formulas (A7 = …OUTREACH!A5…): Sheets rewrites
// those when rows are inserted or deleted by hand, so the map follows them, where "+2" wouldn't
export function advanceRowMap(formulas) {
  const map = new Map();
  (formulas || []).forEach((r, i) => {
    const m = /OUTREACH'?!\$?A\$?(\d+)/i.exec(text(r?.[0]));
    if (m && !map.has(Number(m[1]))) map.set(Number(m[1]), ADVANCE_FIRST_ROW + i);
  });
  return map;
}
function advanceIndex(adv, formulas) {
  return {
    map: advanceRowMap(formulas), adv,
    nameAt: (row) => text(adv[row - ADVANCE_FIRST_ROW]?.[0]).trim(),
    rawGiven: (row) => adv[row - ADVANCE_FIRST_ROW]?.[14] ?? "",
    givenType: adv.some((r) => typeof r?.[14] === "boolean") ? "checkbox" : "text",
  };
}
// a prospect's ADVANCE row: the one its formula points at, if that row shows their name; else the one
// row that shows their name; else none, and "Advance given?" is paused for them
function advanceFor(p, ai) {
  const mapped = ai.map.get(p.row);
  let row = mapped != null && ai.nameAt(mapped) === p.name ? mapped : null;
  if (row == null) {
    const hits = ai.adv.map((r, i) => [ADVANCE_FIRST_ROW + i, text(r?.[0]).trim()]).filter(([, n]) => n === p.name);
    if (hits.length === 1) row = hits[0][0];
  }
  if (row == null) return { given: "", row: null, editable: false, why: `Can't find ${p.name}'s row in the ADVANCE CALCULATOR tab, so 'Advance given?' is paused. Check that tab's rows in the sheet.`, shifted: false };
  return { given: givenOf(ai.rawGiven(row)), row, editable: true, why: null, shifted: row !== p.row + 2 };
}

const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const LEVERS = [["B7", "blendedRate", "the rate a stream"], ["B8", "decayRate", "the yearly decay"], ["B9", "runRate", "the run-rate"], [null], ["B11", "adminFeeRate", "the admin fee"]];

// Everything one page load needs, from readArSheet's raw values. Pure.
export function parseArSheet({ assum, budget, recoup, adv, out, advFormulas, meta, spreadsheetId }) {
  const problems = [];
  const { rows, totalRow } = outreachRows(out);
  const ai = advanceIndex(adv, advFormulas);
  const unmapped = [], shifted = [];
  for (const p of rows) {
    const a = advanceFor(p, ai);
    p.advance = { given: a.given, row: a.row, editable: a.editable, why: a.why };
    p.given = a.row == null ? null : a.given;
    if (!a.editable) unmapped.push(p.name);
    if (a.shifted) shifted.push(p.name);
  }
  const assumptions = {};
  LEVERS.forEach(([cell, key, what], i) => {
    if (!cell) return;
    const v = assum[i]?.[0];
    let n = typeof v === "number" ? v : /%\s*$/.test(text(v)) ? toNum(v) / 100 : toNum(v);
    // a percent typed as a whole number (25 instead of 25%) would make every advance 100× too big
    if (key !== "blendedRate" && n > 1.5) {
      problems.push({ id: "assumptionsOdd", text: `ASSUMPTIONS!${cell} (${what}) reads ${n}, which looks like a percent typed as a whole number, so the dashboard used ${n}%. Check that cell.` });
      n /= 100;
    }
    assumptions[key] = n;
  });
  if (totalRow == null) problems.push({ id: "noTotalRow", text: "Couldn't find the PIPELINE TOTAL row in the OUTREACH tab, so adding prospects is paused and nobody is taken off the board. Put PIPELINE TOTAL back in column A, below the last prospect row." });
  if (unmapped.length) problems.push({ id: "advanceUnmapped", text: unmapped.length === 1 ? `Can't find ${unmapped[0]}'s row in the ADVANCE CALCULATOR tab, so 'Advance given?' is paused. Check that tab's rows in the sheet.` : `Can't find the rows of ${list(unmapped)} in the ADVANCE CALCULATOR tab, so 'Advance given?' is paused for them. Check that tab's rows in the sheet.` });
  if (shifted.length) problems.push({ id: "advanceShifted", text: `The ADVANCE CALCULATOR rows of ${list(shifted)} no longer sit 2 rows below their OUTREACH rows (rows were added or removed by hand). The dashboard follows the sheet's own formulas, so 'Advance given?' still goes to the right row.` });
  if (meta.statusSource !== "sheet") problems.push({ id: "statusesBuiltIn", text: `Couldn't read the status dropdown in the OUTREACH tab, so the dashboard is using its own list of ${OUTREACH_STATUSES.length} statuses.` });
  const b = budget[0] || [];
  const capacity = totalRow == null ? null : totalRow - OUTREACH_FIRST_ROW;
  const ids = meta.tabIds || {};
  return {
    ok: true,
    links: {
      outreach: ids[OUTREACH_TAB] != null ? tabLink(spreadsheetId, ids[OUTREACH_TAB]) : null,
      advanceCalculator: ids[ADVANCE_TAB] != null ? tabLink(spreadsheetId, ids[ADVANCE_TAB]) : null,
    },
    layout: { firstRow: OUTREACH_FIRST_ROW, totalRow, capacity, used: rows.length, free: capacity == null ? null : Math.max(0, capacity - rows.length) },
    rows, problems, assumptions,
    recoupTargetMonths: toNum(recoup[0]?.[0]) || 12,
    budget: { starting: toNum(b[0]), committed: toNum(b[4]), remaining: toNum(b[8]) },
    statuses: meta.statuses || OUTREACH_STATUSES, statusSource: meta.statusSource || "built-in", strict: !!meta.strict,
    givenType: ai.givenType, pType: rows.some((r) => typeof r.cells.P === "number") ? "serial" : "text",
  };
}

// One page load: about 2 Google calls (the tab ids and dropdown come from a day-long cache)
export async function readArSheet({ sheets = getSheetsClient(), spreadsheetId = getSheetId(), force = false } = {}) {
  const meta = await sheetMeta(sheets, spreadsheetId, { force });
  const [[assum, budget, recoup, adv, out, top], advFormulas] = await Promise.all([
    batchGet(sheets, spreadsheetId, [RANGE.assumptions, RANGE.budget, RANGE.recoup, RANGE.advance, RANGE.outreach, RANGE.outreachTop]),
    sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE.advanceFormulas, valueRenderOption: "FORMULA" }).then((r) => r.data.values || []),
  ]);
  return { ...parseArSheet({ assum, budget, recoup, adv, out, advFormulas, meta, spreadsheetId }), totals: outreachTotalsOf(top), readAt: new Date().toISOString(), raw: { out, adv } };
}

// The shape the A&R tab draws (13.1). `cells` are the raw values, sent back as `expect`; `songs` the
// same slots for display (writer % on a 0-100 scale, to 4 places).
export function sheetProspect(id, r, statuses, stale = false) {
  const c = r.cells || {}, calc = r.calc || {};
  const status = text(c.O).trim();
  return {
    id, row: r.row, name: r.name, contact: text(c.B), status, statusOnList: !status || statuses.includes(status),
    lastContact: lastContactOf(c.P), notes: text(c.Q), formulaError: !!r.formulaError,
    cells: { A: c.A ?? "", B: c.B ?? "", O: c.O ?? "", P: c.P ?? "", Q: c.Q ?? "", slots: SLOT_COLS.map(([s, w], i) => ({ slot: i + 1, streams: numOrNull(c[s]), share: numOrNull(c[w]) })) },
    songs: SLOT_COLS.map(([s, w], i) => ({ slot: i + 1, streams: toNum(c[s]), writerShare: pct4(c[w]) })),
    money: { grossStreams: toNum(calc.C), writerShare: pct4(calc.D), netStreams: toNum(calc.E), grossRevenue: toNum(calc.G), adminFee: toNum(calc.H), totalEstValue: toNum(calc.N) },
    advance: r.advance, stale,
  };
}
// a prospect as last seen, for when the sheet can't be read
export function seenProspect(rec, statuses) {
  const seen = rec.sheet_seen || {};
  return sheetProspect(rec.id, {
    row: rec.outreach_row == null ? null : Number(rec.outreach_row), name: rec.name, cells: seen, calc: seen.calc || {},
    advance: { given: rec.advance_given || "", row: seen.adv ?? null, editable: false, why: "Couldn't read the pub sheet just now, so saving is paused." },
  }, statuses, true);
}

// --- the lock (5.4.1): a 45-second lease in app_state --------------------
export async function withSheetLock(fn) {
  const holder = evId();
  const giveUp = Date.now() + 3000;
  for (;;) {
    const [got] = await sql`
      INSERT INTO app_state (key, value, updated_at)
      VALUES ('arSheetLock', jsonb_build_object('holder', ${holder}::text, 'until', now() + interval '45 seconds'), now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE (app_state.value->>'until')::timestamptz < now() OR app_state.value->>'holder' = ''
      RETURNING value->>'holder' AS holder`;
    if (got?.holder === holder) break;
    if (Date.now() + 250 > giveUp) throw new ArError(503, "Someone else is saving to the OUTREACH tab right now. Try again in a few seconds.");
    await sleep(250);
  }
  try {
    return await fn();
  } finally {
    // 'until' = now: a page load that read the sheet before this moment knows a write overlapped it
    await sql`UPDATE app_state SET value = jsonb_build_object('holder', '', 'until', now()), updated_at = now()
      WHERE key = 'arSheetLock' AND value->>'holder' = ${holder}`.catch((err) => console.error("arSheetLock release failed:", err));
  }
}

// --- the write recipe (5.4) ----------------------------------------------
const unreachable = () => new ArError(503, "Couldn't reach the pub sheet just now, so nothing was saved. Try again in a minute.");
// a Google error on the write itself: nothing was changed (one request is all or nothing)
function writeFailed(err) {
  console.error("ar sheet write failed:", err);
  if (/data validation/i.test(err?.message || "")) return new ArError(409, "The OUTREACH tab's status dropdown refused that value. Reload to get its current list. Nothing was saved.", { reload: true });
  return new ArError(502, "Couldn't save to the pub sheet just now — try again in a minute. Nothing was changed.");
}

// A fresh read of the whole tab under the lock: the row, the PIPELINE TOTAL row, ADVANCE's formula
// map and which OUTREACH rows still have their formulas (for adds).
async function readForWrite() {
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  try {
    const [meta, [out, adv], [advF, cF]] = await Promise.all([
      sheetMeta(sheets, spreadsheetId),
      batchGet(sheets, spreadsheetId, [RANGE.outreach, RANGE.advance]),
      batchGet(sheets, spreadsheetId, [RANGE.advanceFormulas, RANGE.outreachFormulas], "FORMULA"),
    ]);
    const { rows, totalRow } = outreachRows(out);
    const ai = advanceIndex(adv, advF);
    for (const p of rows) p.advance = advanceFor(p, ai);
    return {
      sheets, spreadsheetId, meta, out, adv, ai, rows, totalRow,
      statuses: meta.statuses || OUTREACH_STATUSES,
      pType: rows.some((r) => typeof r.cells.P === "number") ? "serial" : "text",
      rowArr: (n) => out[n - OUTREACH_FIRST_ROW] || [],
      hasFormula: (n) => text(cF[n - OUTREACH_FIRST_ROW]?.[0]).startsWith("="),
    };
  } catch (err) {
    if (err instanceof ArError) throw err;
    console.error("ar sheet read before a write failed:", err);
    throw unreachable();
  }
}
// a cell's raw value in a snapshot ({out, adv}): OUTREACH A5:AA200, ADVANCE A7:O200
function cellAt(snap, tab, a1) {
  const m = /^([A-Z]+)(\d+)$/.exec(a1);
  if (!m) return undefined;
  const r = Number(m[2]), c = colIdx(m[1]);
  if (tab === OUTREACH_TAB) return r >= OUTREACH_FIRST_ROW && c >= 0 ? snap.out[r - OUTREACH_FIRST_ROW]?.[c] ?? "" : undefined;
  if (tab === ADVANCE_TAB) return r >= ADVANCE_FIRST_ROW && c >= 0 && c <= 14 ? snap.adv[r - ADVANCE_FIRST_ROW]?.[c] ?? "" : undefined;
  return undefined;
}
const reloadError = (rec) => new ArError(409, `${rec.name} isn't in row ${rec.outreach_row ?? "?"} of the OUTREACH tab anymore (the sheet was changed by hand). Reload to see the current list. Nothing was saved.`, { reload: true });

async function liveRecord(id) {
  // (a date column arrives as a Date at the server's local midnight: the text form never shifts a day)
  const [rec] = id ? await sql`SELECT *, follow_up_on::text AS follow_up_day FROM ar_prospects WHERE id = ${String(id)}` : [];
  if (!rec || rec.merged_into) throw new ArError(404, "That prospect isn't on the dashboard anymore. Reload the page.", { reload: true });
  if (rec.removed_at) throw new ArError(409, `${rec.name} is off the board. Put them back first.`, { reload: true });
  return { ...rec, outreach_row: rec.outreach_row == null ? null : Number(rec.outreach_row) };
}
// the same-person check (5.4.2): the record's row must still hold its name. If the name now sits in
// exactly one other row (a hand sort), that's where they are; anything else needs a reload.
function locate(rec, snap) {
  const at = rec.outreach_row == null ? null : snap.rows.find((r) => r.row === rec.outreach_row);
  if (at && (at.key === rec.name_key || at.name === String(rec.name).trim())) return at;
  const hits = snap.rows.filter((r) => r.key === rec.name_key);
  if (hits.length !== 1) throw reloadError(rec);
  return { ...hits[0], movedFrom: rec.outreach_row };
}
// A moved prospect takes its new row over from whichever record still claims it from before the sort
// (the sheet shows this prospect's name there; the next load re-matches the other one by name)
const takeRow = (rec, row) => (row.movedFrom !== undefined ? [sql`UPDATE ar_prospects SET outreach_row = NULL WHERE outreach_row = ${row.row} AND id <> ${rec.id}`] : []);

async function logPending(prospectId, by, kind, what, cells) {
  const id = evId();
  await sql`INSERT INTO ar_events (id, prospect_id, by, kind, text, cells, status)
    VALUES (${id}, ${prospectId}, ${by}, ${kind}, ${what}, ${JSON.stringify(cells.map(eventCell))}::jsonb, 'pending')`;
  return id;
}
const eventCell = (c) => ({ tab: c.tab, cell: c.cell, before: c.current ?? "", after: c.value ?? "", ...(c.pid ? { pid: c.pid } : {}) });
async function writeCells(snap, cells) {
  await snap.sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: snap.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data: cells.map((c) => ({ range: `${q(c.tab)}!${c.cell}`, values: [[c.value ?? ""]] })) },
  });
}
// the row again after a write, for the sheet's recomputed numbers (the previous read, if that fails)
async function reread(snap, row, written) {
  const advRow = row.advance?.row;
  let out, adv;
  try {
    [out, adv] = await batchGet(snap.sheets, snap.spreadsheetId, [`${q(OUTREACH_TAB)}!A${row.row}:AA${row.row}`, ...(advRow ? [`${q(ADVANCE_TAB)}!A${advRow}:O${advRow}`] : [])]);
  } catch (err) {
    console.error("ar sheet re-read failed:", err);
    const cells = { ...row.cells };
    for (const c of written) if (c.tab === OUTREACH_TAB) cells[/^[A-Z]+/.exec(c.cell)[0]] = c.value ?? "";
    return { ...row, cells };
  }
  const r = out[0] || [];
  const given = advRow ? givenOf(adv?.[0]?.[14]) : row.advance?.given || "";
  return {
    ...row, name: text(cellOf(r, "A")).trim() || row.name,
    cells: Object.fromEntries(OWNED_COLS.map((c) => [c, cellOf(r, c)])),
    calc: Object.fromEntries(CALC_COLS.map((c) => [c, cellOf(r, c)])),
    formulaError: "CDEFGHIJKLMN".split("").some((c) => isErrorValue(cellOf(r, c))),
    advance: { ...row.advance, given }, given: advRow ? given : row.given,
  };
}
const seenOf = (r) => ({ ...Object.fromEntries(OWNED_COLS.map((c) => [c, r.cells[c] ?? ""])), calc: r.calc, given: r.advance?.row ? r.advance.given : null, adv: r.advance?.row ?? null });
const publicAdvance = (a) => ({ given: a?.given || "", row: a?.row ?? null, editable: !!a?.editable, why: a?.why ?? null });
const outRow = (r) => ({ ...r, advance: publicAdvance(r.advance) });

// Normalizes the browser's `expect` (field names, or the cell letters A/B/O/P/Q) for one field
const EXPECT_ALIAS = { name: "A", contact: "B", status: "O", lastContact: "P", notes: "Q" };
function expectOf(expect, field) {
  if (!expect || typeof expect !== "object") return { has: false };
  if (field in expect) return { has: true, v: expect[field] };
  const alias = EXPECT_ALIAS[field];
  if (alias && alias in expect) return { has: true, v: expect[alias] };
  return { has: false };
}
const outOfDate = () => new ArError(400, "This page is out of date. Reload it and try again.", { reload: true });

// Validated field changes (no sheet needed): what staff sent, cleaned, before taking the lock
export function cleanChanges(changes, statuses) {
  const c = changes && typeof changes === "object" ? changes : {};
  const out = {};
  if ("name" in c) out.name = checkName(c.name);
  if ("contact" in c) out.contact = checkText(c.contact, 200, "Contact");
  if ("notes" in c) out.notes = checkText(c.notes, 2000, "Notes");
  if ("lastContact" in c) out.lastContact = checkDate(c.lastContact);
  if ("status" in c) out.status = checkStatus(c.status, statuses);
  if (c.slots !== undefined) {
    if (!Array.isArray(c.slots) || c.slots.length > 5) throw new ArError(400, "Pick a song slot from 1 to 5.");
    out.slots = c.slots.map((s) => {
      const slot = checkSlot(s?.slot);
      return { slot, ...("streams" in (s || {}) ? { streams: checkStreams(s.streams) } : {}), ...("share" in (s || {}) ? { share: checkShare(s.share) } : {}) };
    });
  }
  return out;
}

// The cells a set of field changes means for one row, with the sheet's current value and the
// browser's expect beside each
function plannedCells(row, ch, expect, snap, { needExpect = true } = {}) {
  const cells = [];
  const add = (field, col, value, kindOf = kindOfCol(col)) => {
    const e = field.startsWith("slot") ? slotExpect(expect, field) : expectOf(expect, field);
    if (needExpect && !e.has) throw outOfDate();
    cells.push({ field, tab: OUTREACH_TAB, col, cell: `${col}${row.row}`, value, current: row.cells[col] ?? "", expect: e.v, hasExpect: e.has, kind: kindOf });
  };
  if ("name" in ch) add("name", "A", ch.name);
  if ("contact" in ch) add("contact", "B", ch.contact);
  if ("status" in ch) add("status", "O", ch.status);
  // Last Contact matches its column: a date serial where the sheet holds dates, else YYYY-MM-DD text
  if ("lastContact" in ch) add("lastContact", "P", ch.lastContact && snap.pType === "serial" ? isoToSerial(ch.lastContact) : ch.lastContact);
  if ("notes" in ch) add("notes", "Q", ch.notes);
  for (const s of ch.slots || []) {
    const [sc, wc] = SLOT_COLS[s.slot - 1];
    if ("streams" in s) add(`slot${s.slot}.streams`, sc, s.streams ?? "");
    if ("share" in s) add(`slot${s.slot}.share`, wc, s.share ?? "");
  }
  return cells;
}
function slotExpect(expect, field) {
  const [, n, k] = /^slot(\d)\.(streams|share)$/.exec(field);
  const e = (Array.isArray(expect?.slots) ? expect.slots : []).find((x) => Number(x?.slot) === Number(n));
  return e && k in e ? { has: true, v: e[k] } : { has: false };
}
// per-field expect (5.4.3): a field the sheet changed meanwhile is a conflict, unless it already
// holds what staff want; fields not being changed are never compared or written
function conflictsOf(cells) {
  return cells.filter((c) => c.hasExpect && !sameValue(c.expect, c.current, c.kind) && !sameValue(c.value, c.current, c.kind))
    .map((c) => ({ field: c.field, yours: c.value, sheet: c.current, was: c.expect }));
}
const conflictError = (conflict) => new ArError(409, "Someone changed this in the OUTREACH tab while you were editing. Nothing was saved.", { conflict });
const what = (cells) => list([...new Set(cells.map((c) => (c.tab === ADVANCE_TAB ? "'Advance given?'" : COL_LABEL[c.col] || c.cell)))]);

// Field edits of one prospect: updateProspect, setStatus, setSlot, clearSlot, logContact. `after`
// adds the Postgres changes that go with an action (a follow-up date, a song losing its slot).
async function editProspect({ prospectId, by, kind, changes, expect, describe, needExpect = true, linkedCheck = true, after }) {
  return withSheetLock(async () => {
    const rec = await liveRecord(prospectId);
    const snap = await readForWrite();
    const row = locate(rec, snap);
    const ch = typeof changes === "function" ? changes(row, snap) : changes;
    const planned = plannedCells(row, ch, expect, snap, { needExpect });
    // a slot whose streams come from Luminate keeps them (only fillSlots writes them)
    if (linkedCheck) for (const c of planned.filter((x) => /\.streams$/.test(x.field) && !sameValue(x.value, x.current, "number"))) {
      const n = Number(c.field[4]);
      const [linked] = await sql`SELECT 1 FROM ar_tracking WHERE prospect_id = ${rec.id} AND slot = ${n} AND removed_at IS NULL AND luminate_id <> '' AND NOT skip`;
      if (linked) throw new ArError(400, `Song ${n}'s streams come from Luminate.`);
    }
    if ("name" in ch && nameKey(ch.name) !== rec.name_key) {
      const k = nameKey(ch.name);
      const [taken] = await sql`SELECT name FROM ar_prospects WHERE name_key = ${k} AND id <> ${rec.id} AND removed_at IS NULL AND merged_into IS NULL`;
      if (taken || snap.rows.some((r) => r.key === k && r.row !== row.row)) throw new ArError(409, `${ch.name} is already on the board.`);
    }
    const conflict = conflictsOf(planned);
    if (conflict.length) throw conflictError(conflict);
    const cells = planned.filter((c) => !sameValue(c.value, c.current, c.kind));
    const db = []; // Postgres changes that go with this one: [sql, …]
    const extraCells = []; // [{tab:'db', …}] kept in the event so Undo can put them back
    const done = after ? await after({ rec, row, ch, cells, db, extraCells }) : {};
    if (!cells.length && !db.length) return { ok: true, unchanged: true, prospect: sheetProspect(rec.id, outRow(row), snap.statuses), ...done.response };
    let eventId = null, fresh = row;
    if (cells.length) {
      eventId = await logPending(rec.id, by, kind, describe(cells, row), cells);
      try { await writeCells(snap, cells); } catch (err) {
        await sql`UPDATE ar_events SET status = 'failed' WHERE id = ${eventId}`;
        throw writeFailed(err);
      }
      fresh = await reread(snap, row, cells);
    }
    const nameChanged = "name" in ch && cells.some((c) => c.col === "A");
    await sql.transaction([
      ...(eventId ? [sql`UPDATE ar_events SET status = 'done', cells = cells || ${JSON.stringify(extraCells)}::jsonb WHERE id = ${eventId}`] : []),
      ...takeRow(rec, row),
      sql`UPDATE ar_prospects SET outreach_row = ${row.row}, sheet_seen = ${JSON.stringify(seenOf(fresh))}::jsonb, sheet_seen_at = now(),
        name = ${nameChanged ? ch.name : rec.name}, name_key = ${nameChanged ? nameKey(ch.name) : rec.name_key}, updated_at = now() WHERE id = ${rec.id}`,
      ...db,
    ]);
    return { ok: true, prospect: sheetProspect(rec.id, outRow(fresh), snap.statuses), eventId, ...done.response };
  });
}

// a status move sets (or clears) the next follow-up, Postgres only (section 9)
function followUpFor(status, rec, db, extraCells) {
  const cur = rec.follow_up_day || null;
  const next = nextFollowUp(status, cur);
  if (next === undefined) return undefined;
  db.push(sql`UPDATE ar_prospects SET follow_up_on = ${next}, follow_up_note = ${next ? rec.follow_up_note : ""}, updated_at = now() WHERE id = ${rec.id}`);
  extraCells.push({ tab: "db", cell: "follow_up_on", before: cur || "", after: next || "" });
  return next;
}

const statusText = (by, cells) => {
  const o = cells.find((c) => c.col === "O");
  return o ? `${by} moved them to ${o.value || "no status"}` : `${by} changed the ${what(cells)}`;
};

export async function updateProspect({ prospectId, changes, expect }, by) {
  const snapStatuses = await statusesNow();
  const ch = cleanChanges(changes, snapStatuses);
  if (!Object.keys(ch).length) throw new ArError(400, "Nothing to save.");
  return editProspect({
    prospectId, by, kind: "status" in ch && Object.keys(ch).length === 1 ? "status" : "edit", changes: ch, expect,
    describe: (cells) => (cells.length === 1 && cells[0].col === "O" ? statusText(by, cells) : `${by} changed the ${what(cells)}`),
    after: async ({ rec, cells, db, extraCells }) => {
      const o = cells.find((c) => c.col === "O");
      const followUpSet = o ? followUpFor(o.value, rec, db, extraCells) : undefined;
      return { response: followUpSet !== undefined ? { followUpSet } : {} };
    },
  });
}
export async function setStatus({ prospectId, status, expect }, by) {
  // a blank is only written when it's asked for ("" clears it); a missing status never erases one
  if (status === undefined || status === null) throw new ArError(400, "Pick a status from the list.");
  const exp = expect !== null && typeof expect === "object" ? expect : { status: expect };
  return updateProspect({ prospectId, changes: { status }, expect: exp }, by);
}
export async function setSlot({ prospectId, slot, streams, share, expect }, by, body = {}) {
  const s = { slot };
  if ("streams" in body) s.streams = streams;
  if ("share" in body) s.share = share;
  if (!("streams" in s) && !("share" in s)) throw new ArError(400, "Nothing to save.");
  const n = checkSlot(slot);
  return updateProspect({ prospectId, changes: { slots: [s] }, expect: { slots: [{ slot: n, ...(expect || {}) }] } }, by);
}
export async function clearSlot({ prospectId, slot, expect }, by) {
  const n = checkSlot(slot);
  return editProspect({
    prospectId, by, kind: "song", changes: { slots: [{ slot: n, streams: null, share: null }] }, expect: { slots: [{ slot: n, ...(expect || {}) }] },
    linkedCheck: false, describe: () => `${by} cleared Song ${n}`,
    // its song (if one is named) stays followed, just without a sheet slot; its writer % moves with it
    after: async ({ rec, row, db }) => {
      const share = toNum(row.cells[SLOT_COLS[n - 1][1]]);
      db.push(sql`UPDATE ar_tracking SET slot = NULL, share = COALESCE(share, ${share > 0 && share <= 1 ? share : null}), updated_at = now()
        WHERE prospect_id = ${rec.id} AND slot = ${n} AND removed_at IS NULL`);
      return {};
    },
  });
}
// one sheet write: Last Contact = the day, and a prospect not contacted yet moves to Contacted (9)
export async function logContact({ prospectId, on, note, expect }, by) {
  const day = on ? checkDate(on) : nyToday();
  const cleanNote = checkText(note, 2000, "The note");
  return editProspect({
    prospectId, by, kind: "contact", expect,
    changes: (row) => {
      const st = text(row.cells.O).trim();
      return { lastContact: day, ...(!st || st === "Not Contacted" || st === "Researching" ? { status: "Contacted" } : {}) };
    },
    describe: (cells) => `${by} logged a contact${cells.some((c) => c.col === "O") ? " (now Contacted)" : ""}${cleanNote ? `: ${cleanNote}` : ""}`,
    after: async ({ rec, row, ch, db, extraCells }) => {
      const status = ch.status || text(row.cells.O).trim();
      const days = FOLLOW_UP_DAYS[status || ""] ?? 7;
      const cur = rec.follow_up_day || "";
      const closed = ["Signed", "Passed"].includes(status);
      const next = closed ? null : addDays(nyToday(), days);
      if (next !== (cur || null)) {
        db.push(sql`UPDATE ar_prospects SET follow_up_on = ${next}, updated_at = now() WHERE id = ${rec.id}`);
        extraCells.push({ tab: "db", cell: "follow_up_on", before: cur, after: next || "" });
      }
      return { response: { followUpSet: next } };
    },
  });
}
async function statusesNow() {
  try { return (await sheetMeta(getSheetsClient(), getSheetId())).statuses || OUTREACH_STATUSES; } catch { throw unreachable(); }
}

// "Advance given?" on the prospect's formula-mapped ADVANCE row only (5.3)
export async function setGiven({ prospectId, given, expect }, by) {
  if (typeof given !== "boolean") throw new ArError(400, "Say yes or no.");
  return withSheetLock(async () => {
    const rec = await liveRecord(prospectId);
    const snap = await readForWrite();
    const row = locate(rec, snap);
    const adv = row.advance;
    if (!adv?.editable) throw new ArError(409, adv?.why || "'Advance given?' is paused for this prospect.");
    const e = expectOf(expect, "given");
    if (!e.has) throw outOfDate();
    const current = snap.ai.rawGiven(adv.row);
    const value = snap.ai.givenType === "checkbox" ? given : given ? "Yes" : "No";
    if (!sameValue(e.v, current, "given") && !sameValue(value, current, "given")) throw conflictError([{ field: "given", yours: givenOf(value), sheet: givenOf(current), was: givenOf(e.v) }]);
    const cell = { tab: ADVANCE_TAB, col: "O", cell: `O${adv.row}`, value, current, kind: "given", pid: rec.id };
    const want = given ? "Yes" : "No";
    if (sameValue(value, current, "given")) {
      if ((rec.advance_given || "") !== want) await sql.transaction([...takeRow(rec, row), sql`UPDATE ar_prospects SET advance_given = ${want}, outreach_row = ${row.row}, updated_at = now() WHERE id = ${rec.id}`]);
      return { ok: true, unchanged: true, prospect: sheetProspect(rec.id, outRow(row), snap.statuses) };
    }
    const eventId = await logPending(rec.id, by, "given", `${by} set 'Advance given?' to ${want}`, [cell]);
    try { await writeCells(snap, [cell]); } catch (err) {
      await sql`UPDATE ar_events SET status = 'failed' WHERE id = ${eventId}`;
      throw writeFailed(err);
    }
    const fresh = await reread(snap, row, [cell]);
    await sql.transaction([
      sql`UPDATE ar_events SET status = 'done' WHERE id = ${eventId}`,
      ...takeRow(rec, row),
      sql`UPDATE ar_prospects SET advance_given = ${want}, outreach_row = ${row.row}, sheet_seen = ${JSON.stringify(seenOf(fresh))}::jsonb, sheet_seen_at = now(), updated_at = now() WHERE id = ${rec.id}`,
    ]);
    return { ok: true, prospect: sheetProspect(rec.id, outRow(fresh), snap.statuses), eventId };
  });
}

// After a hand sort the "Advance given?" flags stay where they were (5.6). "remembered" writes each
// prospect's remembered answer onto their own mapped row, in one request (logged, can be undone);
// "sheet" keeps what the sheet says now and only updates what the dashboard remembers.
export async function fixGiven({ prospectIds, use }, by) {
  const ids = Array.isArray(prospectIds) ? [...new Set(prospectIds.map(String))].slice(0, 200) : [];
  if (!ids.length) throw new ArError(400, "Pick the prospects to fix.");
  if (use !== "remembered" && use !== "sheet") throw new ArError(400, "Say which answers to keep.");
  const run = async () => {
    const recs = await sql`SELECT * FROM ar_prospects WHERE id = ANY(${ids}) AND removed_at IS NULL AND merged_into IS NULL`;
    const snap = await readForWrite();
    const cells = [], seen = [], skipped = [];
    for (const r0 of recs) {
      const rec = { ...r0, outreach_row: r0.outreach_row == null ? null : Number(r0.outreach_row) };
      let row;
      try { row = locate(rec, snap); } catch { skipped.push(rec.name); continue; }
      if (!row.advance?.editable) { skipped.push(rec.name); continue; }
      const current = snap.ai.rawGiven(row.advance.row), sheet = givenOf(current), remembered = rec.advance_given || "";
      if (use === "sheet") { seen.push({ rec, row, given: sheet }); continue; }
      const value = !remembered ? "" : snap.ai.givenType === "checkbox" ? remembered === "Yes" : remembered;
      if (!sameValue(value, current, "given")) cells.push({ tab: ADVANCE_TAB, col: "O", cell: `O${row.advance.row}`, value, current, kind: "given", pid: rec.id, name: rec.name, remembered });
      seen.push({ rec, row, given: remembered });
    }
    let eventId = null;
    if (cells.length) {
      eventId = await logPending(null, by, "given", `${by} put 'Advance given?' back with their prospects: ${list(cells.map((c) => `${c.name} (${c.remembered || "blank"})`))}`, cells);
      try { await writeCells(snap, cells); } catch (err) {
        await sql`UPDATE ar_events SET status = 'failed' WHERE id = ${eventId}`;
        throw writeFailed(err);
      }
    }
    await sql.transaction([
      ...(eventId ? [sql`UPDATE ar_events SET status = 'done' WHERE id = ${eventId}`] : []),
      ...seen.flatMap(({ rec, row }) => takeRow(rec, row)),
      ...seen.flatMap(({ rec, row, given }) => {
        const next = { ...seenOf(row), given };
        return [
          sql`UPDATE ar_prospects SET advance_given = ${given}, outreach_row = ${row.row}, sheet_seen = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${rec.id}`,
          ...(use === "sheet" && given !== (rec.advance_given || "") ? [sql`INSERT INTO ar_events (id, prospect_id, by, kind, text) VALUES (${evId()}, ${rec.id}, ${by}, 'given', ${`${by} kept the sheet's 'Advance given?': ${given || "blank"} (was ${rec.advance_given || "blank"})`})`] : []),
        ];
      }),
    ]);
    return { ok: true, eventId, fixed: seen.length, ...(skipped.length ? { skipped } : {}) };
  };
  // keeping the sheet's answers writes nothing to the sheet, so it needs no lock and works with writes off
  return use === "remembered" ? withSheetLock(run) : run();
}

// Rows an add (or a put back) may use: from 5 up to the row above PIPELINE TOTAL, with a blank name,
// no prospect holding it, and the sheet's formulas still in C (an inserted row has none)
async function freeRows(snap) {
  if (snap.totalRow == null) throw new ArError(409, "Couldn't find the PIPELINE TOTAL row in the OUTREACH tab, so adding is paused.");
  const held = new Set((await sql`SELECT outreach_row FROM ar_prospects WHERE outreach_row IS NOT NULL`).map((r) => Number(r.outreach_row)));
  const rows = [];
  for (let n = OUTREACH_FIRST_ROW; n < snap.totalRow; n++) if (isBlank(snap.rowArr(n)[0]) && !held.has(n) && snap.hasFormula(n)) rows.push(n);
  if (!rows.length) throw new ArError(409, "No room left in the OUTREACH tab. Add rows above PIPELINE TOTAL in the sheet (with the formulas, and matching rows in ADVANCE CALCULATOR), then try again.");
  return rows;
}
// what a free row still holds from before (a name cleared by hand leaves the rest): written blank,
// so nobody inherits someone else's notes, songs or "Advance given?"
function leftovers(snap, n, keep) {
  const r = snap.rowArr(n), out = [];
  for (const col of OWNED_COLS) if (!keep.has(col) && !isBlank(cellOf(r, col))) out.push({ tab: OUTREACH_TAB, col, cell: `${col}${n}`, value: "", current: cellOf(r, col), kind: kindOfCol(col) });
  return out;
}
// a blank row's ADVANCE row comes from the formula alone (it shows no name yet)
const advanceRowOf = (snap, n) => {
  const a = snap.ai.map.get(n);
  return a != null && !snap.ai.nameAt(a) ? a : null;
};
const leftGivenNote = (v) => `Cleared an old 'Advance given? ${givenOf(v) || text(v)}' left in that row.`;

// Add a prospect (5.5): one row claimed in Postgres first (the unique row index stops two adds landing
// together), then one batchUpdate of A, B, O, Q and any slots, plus blanks over anything left there.
export async function createProspect(body, by) {
  const statuses = await statusesNow();
  const name = checkName(body.name);
  const ch = cleanChanges({ contact: body.contact ?? "", status: body.status ?? "", notes: body.notes ?? "", ...(body.slots ? { slots: body.slots } : {}) }, statuses);
  const socials = Object.fromEntries(["instagram", "tiktok", "youtube", "spotify"].map((k) => [k, checkText(body.socials?.[k], 300, "That link")]));
  const followUp = body.followUp?.on ? { on: checkDate(body.followUp.on), note: checkText(body.followUp.note, 500, "The follow-up note") } : null;
  const key = nameKey(name);
  return withSheetLock(async () => {
    const [live] = await sql`SELECT name FROM ar_prospects WHERE name_key = ${key} AND removed_at IS NULL AND merged_into IS NULL`;
    const snap = await readForWrite();
    if (live || snap.rows.some((r) => r.key === key)) throw new ArError(409, `${name} is already on the board.`);
    const candidates = await freeRows(snap);
    let n = null;
    const id = uid();
    const on = followUp?.on || nextFollowUp(ch.status, null) || null;
    for (const r of candidates.slice(0, 5)) {
      const [got] = await sql`INSERT INTO ar_prospects (id, name, name_key, outreach_row, source, created_by, instagram, tiktok, youtube, spotify, follow_up_on, follow_up_note)
        VALUES (${id}, ${name}, ${key}, ${r}, 'dashboard', ${by}, ${socials.instagram}, ${socials.tiktok}, ${socials.youtube}, ${socials.spotify}, ${on}, ${followUp?.note || ""})
        ON CONFLICT DO NOTHING RETURNING id`;
      if (got) { n = r; break; }
    }
    if (n == null) throw new ArError(503, "Someone else is adding to the OUTREACH tab right now. Try again in a few seconds.");
    const row = { row: n, name, key, cells: Object.fromEntries(OWNED_COLS.map((c) => [c, cellOf(snap.rowArr(n), c)])), calc: {}, advance: null };
    const planned = plannedCells(row, { name, ...ch }, null, snap, { needExpect: false }).filter((c) => !isBlank(c.value) || !isBlank(c.current));
    const cells = [...planned, ...leftovers(snap, n, new Set(planned.map((c) => c.col)))];
    const advRow = advanceRowOf(snap, n);
    const left = advRow ? snap.ai.rawGiven(advRow) : "";
    if (advRow && !isBlank(left)) cells.push({ tab: ADVANCE_TAB, col: "O", cell: `O${advRow}`, value: "", current: left, kind: "given", pid: id });
    row.advance = advRow ? { given: "", row: advRow, editable: true, why: null } : { given: "", row: null, editable: false, why: `Can't find ${name}'s row in the ADVANCE CALCULATOR tab, so 'Advance given?' is paused. Check that tab's rows in the sheet.` };
    const eventId = await logPending(id, by, "created", `${by} added them to the board (OUTREACH row ${n})`, cells);
    try { await writeCells(snap, cells); } catch (err) {
      await sql.transaction([sql`DELETE FROM ar_prospects WHERE id = ${id}`, sql`UPDATE ar_events SET status = 'failed' WHERE id = ${eventId}`]);
      throw writeFailed(err);
    }
    const fresh = await reread(snap, row, cells);
    await sql.transaction([
      sql`UPDATE ar_events SET status = 'done' WHERE id = ${eventId}`,
      sql`UPDATE ar_prospects SET sheet_seen = ${JSON.stringify(seenOf(fresh))}::jsonb, sheet_seen_at = now(), updated_at = now() WHERE id = ${id}`,
    ]);
    return { ok: true, prospect: sheetProspect(id, outRow(fresh), snap.statuses), eventId, ...(advRow && !isBlank(left) ? { note: leftGivenNote(left) } : {}), ...(on ? { followUpSet: on } : {}) };
  });
}

// Off the board (5.5): one batchClear of A, B, O:Q and R:AA, and the mapped ADVANCE O (no more
// inherited "Yes"); the record keeps everything, and the event the values, for "Put back"
export async function removeProspect({ prospectId, expect }, by) {
  return withSheetLock(async () => {
    const rec = await liveRecord(prospectId);
    const snap = await readForWrite();
    const row = locate(rec, snap);
    const e = expectOf(expect, "name");
    if (!e.has) throw outOfDate();
    if (!sameValue(e.v, row.cells.A)) throw conflictError([{ field: "name", yours: "", sheet: row.cells.A, was: e.v }]);
    const adv = row.advance;
    const cells = OWNED_COLS.filter((c) => !isBlank(row.cells[c])).map((c) => ({ tab: OUTREACH_TAB, col: c, cell: `${c}${row.row}`, value: "", current: row.cells[c] }));
    const left = adv?.row ? snap.ai.rawGiven(adv.row) : "";
    if (adv?.row && !isBlank(left)) cells.push({ tab: ADVANCE_TAB, col: "O", cell: `O${adv.row}`, value: "", current: left, pid: rec.id });
    const n = row.row;
    const ranges = [`${q(OUTREACH_TAB)}!A${n}`, `${q(OUTREACH_TAB)}!B${n}`, `${q(OUTREACH_TAB)}!O${n}:Q${n}`, `${q(OUTREACH_TAB)}!R${n}:AA${n}`, ...(adv?.row ? [`${q(ADVANCE_TAB)}!O${adv.row}`] : [])];
    const eventId = await logPending(rec.id, by, "remove", `${by} took them off the board (OUTREACH row ${n} cleared)`, cells);
    try { await snap.sheets.spreadsheets.values.batchClear({ spreadsheetId: snap.spreadsheetId, requestBody: { ranges } }); } catch (err) {
      await sql`UPDATE ar_events SET status = 'failed' WHERE id = ${eventId}`;
      throw writeFailed(err);
    }
    await sql.transaction([
      sql`UPDATE ar_events SET status = 'done' WHERE id = ${eventId}`,
      sql`UPDATE ar_prospects SET removed_at = now(), removed_by = ${by}, outreach_row = NULL, sheet_seen = ${JSON.stringify(seenOf(row))}::jsonb, updated_at = now() WHERE id = ${rec.id}`,
    ]);
    return { ok: true, prospect: { id: rec.id, name: rec.name, removedAt: new Date().toISOString() }, eventId, ...(adv?.row ? {} : { note: "Couldn't find their row in the ADVANCE CALCULATOR tab, so 'Advance given?' there wasn't cleared." }) };
  });
}

// "Put back" (5.5): a free row as for an add, then the values from when they left the board (the
// remove's log, or what the sheet last showed), and their remembered "Advance given?" on that row
export async function restoreProspect({ prospectId }, by) {
  return withSheetLock(async () => {
    const [r0] = prospectId ? await sql`SELECT * FROM ar_prospects WHERE id = ${String(prospectId)}` : [];
    if (!r0 || r0.merged_into) throw new ArError(404, "That prospect isn't on the dashboard anymore. Reload the page.", { reload: true });
    if (!r0.removed_at) throw new ArError(409, `${r0.name} is already on the board.`, { reload: true });
    const [twin] = await sql`SELECT name FROM ar_prospects WHERE name_key = ${r0.name_key} AND id <> ${r0.id} AND removed_at IS NULL AND merged_into IS NULL`;
    const snap = await readForWrite();
    if (twin || snap.rows.some((r) => r.key === r0.name_key)) throw new ArError(409, `Someone named ${r0.name} is already on the board. Rename one of them first, or use "Same person as…".`);
    const [last] = await sql`SELECT cells FROM ar_events WHERE prospect_id = ${r0.id} AND kind IN ('remove', 'gone') AND status = 'done' ORDER BY at DESC LIMIT 1`;
    const logged = {};
    for (const c of last?.cells || []) if (c.tab === OUTREACH_TAB) logged[/^[A-Z]+/.exec(c.cell)[0]] = c.before;
    const seen = r0.sheet_seen || {};
    for (const col of OWNED_COLS) if (!(col in logged) && !isBlank(seen[col])) logged[col] = seen[col];
    if (isBlank(logged.A)) logged.A = r0.name;
    const candidates = await freeRows(snap);
    let n = null;
    for (const r of candidates.slice(0, 5)) {
      try {
        const [got] = await sql`UPDATE ar_prospects SET outreach_row = ${r} WHERE id = ${r0.id} AND outreach_row IS NULL RETURNING id`;
        if (got) { n = r; break; }
      } catch (err) { if (err?.code !== "23505") throw err; }
    }
    if (n == null) throw new ArError(503, "Someone else is adding to the OUTREACH tab right now. Try again in a few seconds.");
    const notes = [];
    // an old status that the dropdown no longer allows would make a strict sheet refuse the whole write
    if (!isBlank(logged.O) && snap.meta.strict && !snap.statuses.includes(text(logged.O).trim())) {
      notes.push(`Their old status "${text(logged.O)}" isn't in the sheet's dropdown anymore, so it was left blank.`);
      delete logged.O;
    }
    const target = snap.rowArr(n);
    const cells = OWNED_COLS.filter((c) => !isBlank(logged[c]) || !isBlank(cellOf(target, c)))
      .map((c) => ({ tab: OUTREACH_TAB, col: c, cell: `${c}${n}`, value: isBlank(logged[c]) ? "" : logged[c], current: cellOf(target, c), kind: kindOfCol(c) }))
      .filter((c) => !sameValue(c.value, c.current, c.kind));
    const advRow = advanceRowOf(snap, n);
    const remembered = r0.advance_given || "";
    if (advRow) {
      const cur = snap.ai.rawGiven(advRow);
      const value = !remembered ? "" : snap.ai.givenType === "checkbox" ? remembered === "Yes" : remembered;
      if (!sameValue(value, cur, "given")) cells.push({ tab: ADVANCE_TAB, col: "O", cell: `O${advRow}`, value, current: cur, kind: "given", pid: r0.id });
    } else if (remembered) notes.push(`Couldn't find their new row in the ADVANCE CALCULATOR tab, so 'Advance given? ${remembered}' wasn't put back there.`);
    const row = { row: n, name: text(logged.A).trim() || r0.name, key: r0.name_key, cells: Object.fromEntries(OWNED_COLS.map((c) => [c, cellOf(target, c)])), calc: {},
      advance: advRow ? { given: givenOf(remembered), row: advRow, editable: true, why: null } : { given: "", row: null, editable: false, why: `Can't find ${r0.name}'s row in the ADVANCE CALCULATOR tab, so 'Advance given?' is paused. Check that tab's rows in the sheet.` } };
    const eventId = await logPending(r0.id, by, "restore", `${by} put them back on the board (OUTREACH row ${n})`, cells);
    try { await writeCells(snap, cells); } catch (err) {
      await sql.transaction([sql`UPDATE ar_prospects SET outreach_row = NULL WHERE id = ${r0.id}`, sql`UPDATE ar_events SET status = 'failed' WHERE id = ${eventId}`]);
      throw writeFailed(err);
    }
    const fresh = await reread(snap, row, cells);
    await sql.transaction([
      sql`UPDATE ar_events SET status = 'done' WHERE id = ${eventId}`,
      sql`UPDATE ar_prospects SET removed_at = NULL, removed_by = '', name = ${row.name}, name_key = ${nameKey(row.name)}, advance_given = ${advRow ? remembered : r0.advance_given},
        sheet_seen = ${JSON.stringify(seenOf(fresh))}::jsonb, sheet_seen_at = now(), updated_at = now() WHERE id = ${r0.id}`,
    ]);
    return { ok: true, prospect: sheetProspect(r0.id, outRow(fresh), snap.statuses), eventId, ...(notes.length ? { note: notes.join(" ") } : {}) };
  });
}

// Undo (5.5): only while every cell still holds what that change wrote; then the old values go
// back through the same recipe, as a new event, and the old one is marked undone
const UNDOABLE = ["edit", "status", "contact", "song", "given", "undo"];
const rowOfCell = (a1) => Number(/\d+$/.exec(a1)?.[0]);
// The same-person check (5.4.2) for an undo: the logged addresses are only theirs while the prospect
// still sits in that OUTREACH row and that row's mapped ADVANCE row (a hand sort leaves ADVANCE O
// behind, and a merge hands over the other record's cells), so anything else is refused, not moved
async function undoWho(e, sheetCells, snap) {
  const who = new Map();
  const find = async (pid) => {
    if (!who.has(pid)) {
      const rec = await liveRecord(pid);
      who.set(pid, { rec, row: locate(rec, snap) });
    }
    return who.get(pid);
  };
  const ids = [...new Set([e.prospect_id, ...sheetCells.filter((c) => c.tab === ADVANCE_TAB).map((c) => c.pid)].filter(Boolean))];
  if (ids.length) {
    const [merged] = await sql`SELECT 1 FROM ar_events WHERE prospect_id = ANY(${ids}) AND kind = 'merge' AND at > (SELECT at FROM ar_events WHERE id = ${e.id}) LIMIT 1`;
    if (merged) throw new ArError(409, "That change was made before two prospects were merged into one, so it can't be undone. Change it on their card instead. Nothing was saved.");
  }
  for (const c of sheetCells) {
    const pid = c.tab === ADVANCE_TAB ? c.pid || e.prospect_id : e.prospect_id;
    if (!pid) throw new ArError(409, "Can't tell whose row that change was in, so it can't be undone. Nothing was saved.");
    const { rec, row } = await find(pid);
    if (c.tab === OUTREACH_TAB && rowOfCell(c.cell) !== row.row) {
      throw new ArError(409, `${rec.name} has moved from row ${rowOfCell(c.cell)} to row ${row.row} of the OUTREACH tab since that change (the sheet was changed by hand), so it can't be undone. Change it on their card instead. Nothing was saved.`, { reload: true });
    }
    if (c.tab === ADVANCE_TAB && rowOfCell(c.cell) !== row.advance?.row) {
      throw new ArError(409, row.advance?.row
        ? `${rec.name}'s 'Advance given?' is in row ${row.advance.row} of the ADVANCE CALCULATOR tab now, not row ${rowOfCell(c.cell)} (the sheet was changed by hand), so it can't be undone. Set it on their card instead. Nothing was saved.`
        : row.advance?.why || `Can't find ${rec.name}'s row in the ADVANCE CALCULATOR tab. Nothing was saved.`, { reload: true });
    }
  }
  // the event's own prospect, for the name, the follow-up and the card afterwards (even with no sheet cells)
  if (e.prospect_id && !who.has(e.prospect_id)) {
    const rec = await liveRecord(e.prospect_id);
    let row = null;
    try { row = locate(rec, snap); } catch { /* a follow-up-only undo still goes through */ }
    who.set(e.prospect_id, { rec, row });
  }
  return who;
}
export async function undoEvent({ eventId }, by) {
  return withSheetLock(async () => {
    const [e] = eventId ? await sql`SELECT * FROM ar_events WHERE id = ${String(eventId)}` : [];
    if (!e) throw new ArError(404, "That change isn't in the history anymore. Reload the page.");
    if (e.kind === "remove") throw new ArError(409, "Use Put back to return them to the board.");
    if (e.kind === "created") throw new ArError(409, "Use Remove from board to take them off again.");
    if (e.status !== "done" || !UNDOABLE.includes(e.kind)) throw new ArError(409, "That change can't be undone.");
    const snap = await readForWrite();
    const sheetCells = (e.cells || []).filter((c) => c.tab === OUTREACH_TAB || c.tab === ADVANCE_TAB);
    const who = await undoWho(e, sheetCells, snap);
    const moved = sheetCells.filter((c) => !sameValue(cellAt(snap, c.tab, c.cell), c.after, c.tab === ADVANCE_TAB ? "given" : kindOfCol(/^[A-Z]+/.exec(c.cell)[0])));
    if (moved.length) throw new ArError(409, `Those cells changed again since, so they weren't put back: ${list([...new Set(moved.map((c) => (c.tab === ADVANCE_TAB ? "'Advance given?'" : COL_LABEL[/^[A-Z]+/.exec(c.cell)[0]] || c.cell).replace(/^./, (x) => x.toUpperCase())))])}.`);
    const cells = sheetCells.map((c) => ({ tab: c.tab, col: /^[A-Z]+/.exec(c.cell)[0], cell: c.cell, value: c.before, current: cellAt(snap, c.tab, c.cell), pid: c.pid }));
    const dbCells = (e.cells || []).filter((c) => c.tab === "db");
    const mine = e.prospect_id ? who.get(e.prospect_id) : null, rec = mine?.rec || null;
    const id = await logPending(e.prospect_id, by, "undo", `${by} undid: ${e.text}`, cells);
    if (cells.length) {
      try { await writeCells(snap, cells); } catch (err) {
        await sql`UPDATE ar_events SET status = 'failed' WHERE id = ${id}`;
        throw writeFailed(err);
      }
    }
    const db = [];
    const a = cells.find((c) => c.tab === OUTREACH_TAB && c.col === "A");
    if (rec && a && !isBlank(a.value)) db.push(sql`UPDATE ar_prospects SET name = ${text(a.value).trim()}, name_key = ${nameKey(a.value)}, updated_at = now() WHERE id = ${rec.id}`);
    for (const c of cells.filter((x) => x.tab === ADVANCE_TAB && x.pid)) db.push(sql`UPDATE ar_prospects SET advance_given = ${givenOf(c.value)}, updated_at = now() WHERE id = ${c.pid}`);
    for (const c of dbCells) if (rec && c.cell === "follow_up_on") db.push(sql`UPDATE ar_prospects SET follow_up_on = ${c.before || null}, updated_at = now() WHERE id = ${rec.id}`);
    let prospect = null;
    if (mine?.row) {
      const fresh = await reread(snap, mine.row, cells);
      db.push(...takeRow(rec, mine.row), sql`UPDATE ar_prospects SET outreach_row = ${mine.row.row}, sheet_seen = ${JSON.stringify(seenOf(fresh))}::jsonb, sheet_seen_at = now(), updated_at = now() WHERE id = ${rec.id}`);
      prospect = sheetProspect(rec.id, outRow(fresh), snap.statuses);
    }
    await sql.transaction([
      sql`UPDATE ar_events SET status = 'done', cells = cells || ${JSON.stringify(dbCells.map((c) => ({ ...c, before: c.after, after: c.before })))}::jsonb WHERE id = ${id}`,
      sql`UPDATE ar_events SET status = 'undone' WHERE id = ${e.id}`,
      ...db,
    ]);
    return { ok: true, prospect, eventId: id };
  });
}

// Recovery (5.4.7): a write logged as pending more than 2 minutes ago whose request never came back.
// Against this page load's read: every cell as written → done, every cell as before → failed, and
// anything else is listed under "Changes to check".
export async function settlePending(read) {
  const pending = await sql`SELECT id, at, text, cells FROM ar_events WHERE status = 'pending' AND at < now() - interval '2 minutes' ORDER BY at`;
  const check = [], done = [], failed = [];
  for (const e of pending) {
    const cells = (e.cells || []).filter((c) => c.tab === OUTREACH_TAB || c.tab === ADVANCE_TAB);
    const kindOf = (c) => (c.tab === ADVANCE_TAB ? "given" : kindOfCol(/^[A-Z]+/.exec(c.cell)?.[0] || ""));
    const now = cells.map((c) => cellAt(read.raw, c.tab, c.cell));
    if (cells.length && now.every((v, i) => v !== undefined && sameValue(v, cells[i].after, kindOf(cells[i])))) done.push(e.id);
    else if (cells.length && now.every((v, i) => v !== undefined && sameValue(v, cells[i].before, kindOf(cells[i])))) failed.push(e.id);
    else check.push({ eventId: e.id, at: e.at, text: e.text });
  }
  if (done.length || failed.length) await sql.transaction([
    ...(done.length ? [sql`UPDATE ar_events SET status = 'done' WHERE id = ANY(${done}) AND status = 'pending'`] : []),
    ...(failed.length ? [sql`UPDATE ar_events SET status = 'failed' WHERE id = ANY(${failed}) AND status = 'pending'`] : []),
  ]);
  return check;
}

// The read-only Sheet check (5.7, GET /api/ar-data?check=1): how the real tabs are laid out, in
// plain sentences, so every warning can be fixed before writes are switched on. Writes nothing to
// the sheet; refreshes the cached tab ids and dropdown and keeps its answer in app_state.
const HEADERS = {
  A: /prospect|producer|name/, B: /contact|handle/, C: /gross/, E: /net/, G: /revenue|earning/, H: /admin/, N: /total|value/,
  O: /status/, P: /contact|date/, Q: /note/,
  ...Object.fromEntries(SLOT_COLS.flatMap(([s, w], i) => [[s, new RegExp(`song\\s*${i + 1}.*stream`)], [w, new RegExp(`song\\s*${i + 1}.*(writer|%|share)`)]])),
};
const FORMULA_COLS = ["C", "D", "E", "G", "H", "J", "N"];
const runs = (ns) => {
  const out = [];
  for (const n of ns) { const last = out[out.length - 1]; if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]); }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
};
export async function sheetCheck() {
  const sheets = getSheetsClient(), spreadsheetId = getSheetId();
  const meta = await sheetMeta(sheets, spreadsheetId, { force: true });
  const checks = [];
  // fix: what to do about a failed check, in plain words (the Board lists these first)
  const add = (id, ok, t, fix) => checks.push({ id, ok, text: t, ...(!ok && fix ? { fix } : {}) });
  const missing = [OUTREACH_TAB, ADVANCE_TAB, ASSUMPTIONS_TAB].filter((t) => meta.tabIds?.[t] == null);
  add("tabs", !missing.length, missing.length ? `Couldn't find the ${list(missing)} tab${missing.length > 1 ? "s" : ""}. Check the tab names in the sheet.` : "Found the OUTREACH, ADVANCE CALCULATOR and ASSUMPTIONS tabs.");
  if (missing.length) {
    await setState("arSheetCheck", { ...meta, checks });
    return { at: meta.at, checks };
  }
  const [[assum, budget, recoup, adv, out, head], [advFormulas, advJ, outF]] = await Promise.all([
    batchGet(sheets, spreadsheetId, [RANGE.assumptions, RANGE.budget, RANGE.recoup, RANGE.advance, RANGE.outreach, `${q(OUTREACH_TAB)}!A4:AA4`]),
    batchGet(sheets, spreadsheetId, [RANGE.advanceFormulas, `${q(ADVANCE_TAB)}!J7:J8`, `${q(OUTREACH_TAB)}!C5:N${LAST_ROW}`], "FORMULA"),
  ]);
  const read = parseArSheet({ assum, budget, recoup, adv, out, advFormulas, meta, spreadsheetId });
  const h = head[0] || [];
  const off = Object.entries(HEADERS).filter(([col, re]) => !re.test(text(cellOf(h, col)).toLowerCase())).map(([col]) => `${col} ("${text(cellOf(h, col))}")`);
  add("headers", !off.length, off.length ? `These OUTREACH headers in row 4 aren't what the dashboard expects: ${off.join(", ")}. Check that the columns haven't moved.` : "The OUTREACH headers in row 4 are where the dashboard expects them (A–Q and the 5 song columns R–AA).");
  const { totalRow, capacity, free } = read.layout;
  add("totalRow", totalRow != null, totalRow != null ? `PIPELINE TOTAL in row ${totalRow}: room for ${capacity} prospects (${free} free).` : "Couldn't find PIPELINE TOTAL in column A of the OUTREACH tab, so adding prospects would be paused.");
  if (totalRow != null) {
    const noFormula = [];
    for (let n = OUTREACH_FIRST_ROW; n < totalRow; n++) {
      const r = outF[n - OUTREACH_FIRST_ROW] || [];
      if (FORMULA_COLS.some((c) => !text(r[colIdx(c) - 2]).startsWith("="))) noFormula.push(n);
    }
    add("formulas", !noFormula.length, !noFormula.length ? `Formulas are in place in ${list(FORMULA_COLS)} on every row (${OUTREACH_FIRST_ROW}–${totalRow - 1}).` : `Rows missing formulas in ${list(FORMULA_COLS)}: ${runs(noFormula)}. New prospects never go into those rows.`,
      `${noFormula.length === 1 ? "Row" : "Rows"} ${runs(noFormula)} of OUTREACH ${noFormula.length === 1 ? "is" : "are"} missing the sheet's formulas (columns ${list(FORMULA_COLS)}). Copy them down from a row above.`);
  }
  const unmapped = read.rows.filter((r) => !r.advance.editable).map((r) => r.name);
  add("advanceRows", !unmapped.length, !unmapped.length ? `Every prospect's ADVANCE CALCULATOR row was found from its formulas (${read.rows.length} of ${read.rows.length}).` : `Couldn't find the ADVANCE CALCULATOR rows of ${list(unmapped)}, so 'Advance given?' is paused for them.`);
  add("advanceFormula", true, `ADVANCE CALCULATOR J7 (the recommended advance) reads ${text(advJ[0]?.[0]) || "(blank)"}.`);
  add("statuses", meta.statusSource === "sheet", meta.statusSource === "sheet"
    ? `Status list read from the sheet's dropdown (${meta.statuses.length} options; it rejects other values: ${meta.strict ? "yes" : "no"}).`
    : `Couldn't read a status dropdown on OUTREACH!O5, so the dashboard uses its own list of ${OUTREACH_STATUSES.length} statuses.`);
  const oddGiven = adv.map((r, i) => [ADVANCE_FIRST_ROW + i, r?.[14]]).filter(([, v]) => !isBlank(v) && typeof v !== "boolean" && !givenOf(v)).map(([n]) => n);
  const yesNo = read.givenType === "checkbox" ? "a tick box" : "Yes or No";
  add("given", !oddGiven.length, `'Advance given?' is ${read.givenType === "checkbox" ? "a checkbox (TRUE/FALSE)" : "Yes/No text"}.${oddGiven.length ? ` Rows with something else in it: ${runs(oddGiven)}.` : ""}`,
    `${oddGiven.length === 1 ? "Row" : "Rows"} ${runs(oddGiven)} of ADVANCE CALCULATOR ${oddGiven.length === 1 ? "has" : "have"} something other than ${yesNo} under "Advance given?". Change ${oddGiven.length === 1 ? "it" : "them"} to ${yesNo}.`);
  const ps = read.rows.filter((r) => !isBlank(r.cells.P));
  const dates = ps.filter((r) => typeof r.cells.P === "number").length;
  add("lastContact", !(dates && dates < ps.length), dates && dates < ps.length ? `Last Contact mixes dates (${dates}) and typed text (${ps.length - dates}). The dashboard writes dates there.` : dates ? "Last Contact holds dates." : "Last Contact holds text (or is empty), so the dashboard writes dates as text like 2026-10-28.",
    `OUTREACH's Last Contact column has both dates and typed text. The dashboard writes dates there, so change the ${ps.length - dates} typed one${ps.length - dates === 1 ? "" : "s"} to dates.`);
  const a = read.assumptions;
  const odd = read.problems.filter((p) => p.id === "assumptionsOdd");
  add("assumptions", !odd.length, `ASSUMPTIONS: $${a.blendedRate} a stream, ${Math.round(a.decayRate * 1000) / 10}% yearly decay, ${Math.round(a.runRate * 1000) / 10}% run-rate, ${Math.round(a.adminFeeRate * 1000) / 10}% admin fee.${odd.length ? ` ${odd.map((p) => p.text).join(" ")}` : ""}`);
  const badShares = [];
  for (const r of read.rows) SLOT_COLS.forEach(([, w], i) => { const v = r.cells[w]; if (!isBlank(v) && !(typeof v === "number" && v > 0 && v <= 1)) badShares.push(`${r.name}'s Song ${i + 1} (${text(v)})`); });
  add("shares", !badShares.length, !badShares.length ? "Every writer % is stored as a fraction (50% = 0.5)." : `These writer % cells aren't a fraction between 0 and 1: ${list(badShares)}.`,
    `In OUTREACH, a writer % should be a percent of 100 or less (50% is stored as 0.5). Fix ${list(badShares)}.`);
  const at = new Date().toISOString();
  await setState("arSheetCheck", { ...meta, at, checks, givenType: read.givenType, pType: read.pType });
  return { at, checks };
}
