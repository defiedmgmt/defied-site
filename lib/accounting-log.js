// One-click logging: a Stripe payment the accounting sheet doesn't have yet becomes a new row on the
// Income tab, typed the way the owner types them. Only the typed columns (Date, Revenue Type, Artist /
// Client, Gross Commission, Account, Source / Notes) are written, USER_ENTERED like typing; the
// Month / Manager / Manager Share / DEFIED SHARE formulas already sit in every empty row (copied down
// from the row above only where one is missing, never a total). The one exception: a co-manager's
// General / Company row gets Manager and Manager Share typed, like the owner's (coSplit). Rows go
// below the last used row of the ledger, above its TOTALS row, and never over a cell that holds
// anything but a formula.
// Safety: staff only (the route), a fresh re-check that each payment is still unlogged and in the
// sheet's year, one claim per Stripe payment in accounting_log (so a double click or two tabs can't
// log it twice; released when the write fails, kept once the rows may have landed), a lease lock around
// the append, and a read-back. Log it only places payers the sheet has always typed as Management
// Commission; any other payment goes in with the owner's own Revenue Type and client (Log with details).
// Writes are OFF unless ACCOUNTING_SHEET_WRITES=on. Server-only, staff-only data.
import { sql } from "./db";
import { uid } from "./id";
import { getSheetsClient } from "./sheets";
import { accountingSheetId, clearAccountingCache, clientsByPayer, rowTypesByPayer, applyLog, INCOME_TAB, INCOME_HEADER_ROW, cents, sheetDay, isTestPay, totalsIndex } from "./accounting";
import { moneyState, payerNamer, forTask, logEntries } from "./money";
import { runPaymentsTask } from "./clickup-tasks";
import { nyDay } from "./stripe";
import { placement, payWhat, coSplit } from "./accounting-place";
import { offText } from "./preview";
export { rosterName, placement, payWhat, coSplit } from "./accounting-place";

export const logWritesOn = () => String(process.env.ACCOUNTING_SHEET_WRITES ?? "").trim().toLowerCase() === "on";
export const OFF_TEXT = offText("Logging from the dashboard isn't switched on yet.");
const FIRST_ROW = INCOME_HEADER_ROW + 1;
const COLS = "ABCDEFGHIJ";
const TYPED = [0, 2, 3, 5, 8, 9]; // A C D F I J: what the owner types
const FORMULA_COLS = [1, 4, 6, 7]; // B E G H: the sheet works these out
const ROSTER = "INFO!C4:C43"; // the names the Income formulas look up (INFO!$C$4:$C$43)
const COMMISSION = "Management Commission";
const STALE_MIN = 2; // minutes: a claim this old from a request that never finished can be taken over
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const isFormula = (v) => typeof v === "string" && v.startsWith("=");
// a column total (=SUM(G4:G303), SUBTOTAL…): the TOTALS row's, never a ledger row's
const isTotal = (f) => /^=\s*(SUM|SUBTOTAL|AGGREGATE|SUMIFS?|SUMPRODUCT|COUNTA?|AVERAGE)\s*\(/i.test(f) && /\$?[A-Z]{1,3}\$?\d+\s*:\s*\$?[A-Z]{1,3}\$?\d+/i.test(f);
const nyYear = (at) => Number(nyDay(at).slice(0, 4));
const mdy = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}/${ymd.slice(0, 4)}`;
// the August-style test payments (isTestPay) are typed as Distribution / General / Company / Test Deposit
// USER_ENTERED reads "=…", "+…" or "-…" as a formula: a leading ' keeps typed text as text
const asText = (s) => (/^[=+\-@]/.test(s) ? `'${s}` : s);

export class LogError extends Error { constructor(status, message) { super(message); this.status = status; } }

// A formula copied one row down the way Sheets' fill does: relative row numbers move, $-anchored ones
// and anything inside "quotes" stay
export function shiftFormula(f, delta) {
  return String(f).split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part
    : part.replace(/(^|[^A-Za-z0-9_.$])(\$?[A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, col, abs, row) => (abs ? m : `${pre}${col}${Number(row) + delta}`)))).join("");
}

// --- the row a payment becomes (pure) --------------------------------------------------------------
// The most used Account on the ledger (every row so far: Business Checking)
const usualAccount = (rows) => {
  const n = new Map();
  for (const r of rows || []) if (r.account) n.set(r.account, (n.get(r.account) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || "Business Checking";
};
// What the owner types for a Stripe payment: the full amount paid as Gross Commission (the sheet
// splits it into Manager Share and DEFIED SHARE itself), Management Commission for a client, the
// test-deposit wording for a test. `type` is the owner's own pick (Log with details), written as picked.
// A co-manager's General / Company row also carries the Manager and Manager Share to type (coSplit).
export function rowFor(p, { client, account, test = false, type = null }) {
  const day = nyDay(p.at);
  return {
    id: p.id, day, date: mdy(day), type: type || (test ? "Distribution" : COMMISSION), client,
    amount: p.amount / 100, account, notes: !type && test ? (p.direct ? "Test Deposit (direct)" : "Test Deposit") : "",
    ...(coSplit(p, client) || {}),
  };
}
const typedCells = (r) => ({ 0: r.date, 2: asText(r.type), 3: asText(r.client), 5: r.amount, 8: asText(r.account), 9: asText(r.notes),
  ...(r.manager ? { 4: asText(r.manager), 6: r.managerShare } : {}) });

// --- the lock: one append at a time, so two can't pick the same empty row ---------------------------
async function withLedgerLock(fn) {
  const holder = uid() + uid();
  const giveUp = Date.now() + 8000;
  for (;;) {
    const [got] = await sql`
      INSERT INTO app_state (key, value, updated_at)
      VALUES ('accountingLogLock', jsonb_build_object('holder', ${holder}::text, 'until', now() + interval '45 seconds'), now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
        WHERE (app_state.value->>'until')::timestamptz < now() OR app_state.value->>'holder' = ''
      RETURNING value->>'holder' AS holder`;
    if (got?.holder === holder) break;
    if (Date.now() + 250 > giveUp) throw new LogError(503, "Someone else is adding rows to the accounting sheet right now. Try again in a few seconds.");
    await sleep(250);
  }
  try { return await fn(); } finally {
    await sql`UPDATE app_state SET value = jsonb_build_object('holder', '', 'until', now()), updated_at = now()
      WHERE key = 'accountingLogLock' AND value->>'holder' = ${holder}`.catch((err) => console.error("accountingLogLock release failed:", err));
  }
}

// --- the Income tab's own lists (Log with details) --------------------------------------------------
const readRoster = async (sheets, spreadsheetId) => {
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: [ROSTER], valueRenderOption: "FORMULA" });
  return ((res.data.valueRanges || [])[0]?.values || []).map((r) => String(r[0] ?? "").trim()).filter(Boolean);
};
// Revenue Type from column C's own dropdown, its list or the range it points at (the v2 book's
// =INFO!$B$4:$B$13), else the distinct values already typed there; Artist / Client from INFO, and the
// tab's gid for "Open row" links. Reads only.
export async function incomeOptions({ sheets = getSheetsClient(), spreadsheetId = accountingSheetId(), rows = [] } = {}) {
  const [meta, clients] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId, ranges: [`'${INCOME_TAB}'!C${FIRST_ROW}`], fields: "sheets(properties(sheetId,title),data(rowData(values(dataValidation))))" }),
    readRoster(sheets, spreadsheetId),
  ]);
  const sh = meta.data.sheets?.[0];
  const dv = sh?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
  let listed = dv?.condition?.type === "ONE_OF_LIST" ? (dv.condition.values || []).map((v) => String(v.userEnteredValue ?? "").trim()).filter(Boolean) : [];
  if (dv?.condition?.type === "ONE_OF_RANGE") {
    const ref = String(dv.condition.values?.[0]?.userEnteredValue || "").replace(/^=/, "").replace(/\$/g, "");
    // a range that won't read leaves the typed types, as before
    try { listed = ((await sheets.spreadsheets.values.get({ spreadsheetId, range: ref })).data.values || []).map((x) => String(x?.[0] ?? "").trim()).filter(Boolean); }
    catch (err) { console.error("accounting: revenue types range", err); }
  }
  const typed = [...new Set((rows || []).map((r) => String(r.type || "").trim()).filter(Boolean))];
  return { gid: sh?.properties?.sheetId ?? null, types: listed.length ? listed : typed, typesFrom: listed.length ? "dropdown" : "column", clients };
}
// What's wrong with a Log with details pick, or null
export function detailsProblem(d, opts) {
  const type = String(d?.type ?? "").trim(), client = String(d?.client ?? "").trim();
  if (!opts.types.includes(type)) return "Pick a Revenue Type from the sheet's own list.";
  if (client && !opts.clients.includes(client)) return "Pick an Artist / Client from the sheet's INFO tab, or leave it blank.";
  if (!client && type === COMMISSION) return "A Management Commission row needs an Artist / Client.";
  return null;
}

// --- logging ---------------------------------------------------------------------------------------
// The payments asked for, checked against a fresh read: each is either a row to add or a reason it
// can't be. `entries` are accounting_log's rows as read before the check.
// `details` ({[id]: {type, client}}) are the owner's own picks for a payment Log it can't place.
async function plan(ids, { now, details = {} }) {
  // the match already counts what this dashboard logged before (accounting_log, lib/money.js)
  const { pay, acct, match, entries } = await moneyState({ now, fresh: true });
  if (!pay.list || !acct.rows || !match) throw new LogError(503, acct.error || pay.error || "Couldn't read Stripe or the accounting sheet just now, so nothing was logged. Try again in a minute.");
  const sheets = getSheetsClient();
  const spreadsheetId = accountingSheetId();
  const roster = await readRoster(sheets, spreadsheetId);
  const opts = ids.some((id) => details[id]) ? await incomeOptions({ sheets, spreadsheetId, rows: acct.rows }) : null;
  const nameOf = await payerNamer(match);
  const bySheet = clientsByPayer(match);
  const typesOf = rowTypesByPayer(match);
  const account = usualAccount(acct.rows);
  const unlogged = new Set(match.unlogged.map((p) => p.id));
  const byPay = new Map(pay.list.map((p) => [p.id, p]));
  const rows = [], skipped = [];
  for (const id of ids) {
    const p = byPay.get(id);
    if (!p) { skipped.push({ id, reason: "Stripe doesn't list this payment." }); continue; }
    const y = nyYear(p.at);
    const what = payWhat(p, nameOf);
    if (y !== acct.year) { skipped.push({ id, what, reason: `This payment is from ${y}. The accounting sheet is the ${acct.year} book, so it can't be logged there.` }); continue; }
    if (!(p.amount > 0)) { skipped.push({ id, what, reason: "This payment was refunded in full, so there's nothing to log." }); continue; }
    if (!unlogged.has(id)) { skipped.push({ id, what, reason: "It's already in the accounting sheet.", already: true }); continue; }
    // the owner's own Revenue Type and Artist / Client (blank for Other Income, like the 8/1 rows)
    if (details[id]) {
      const why = detailsProblem(details[id], opts);
      if (why) { skipped.push({ id, what, reason: why }); continue; }
      rows.push({ ...rowFor(p, { client: String(details[id].client ?? "").trim(), account, type: String(details[id].type).trim() }), p, details: true });
      continue;
    }
    const place = placement(p, { roster, typesOf, bySheet, nameOf });
    if (place.reason) { skipped.push({ id, what, reason: place.reason, details: true }); continue; }
    const { client, test } = place;
    rows.push({ ...rowFor(p, { client, account, test }), p });
  }
  return { rows, skipped, match, entries, nameOf, spreadsheetId, sheets, year: acct.year, sheetRows: acct.rows, readAt: acct.readAt };
}

// One claim per payment: a new row, or taking over one that is done but gone from the sheet, or
// stale. Compare-and-swap on the claim token, so of two requests only one gets it.
async function claim(r, prev, token, by) {
  const got = prev
    ? await sql`UPDATE accounting_log SET claim = ${token}, status = 'pending', day = ${r.day}, amount_cents = ${cents(r.amount)},
        client = ${r.client}, sheet_row = NULL, row_values = NULL, by_name = ${by}, claimed_at = now(), logged_at = NULL
        WHERE payment_id = ${r.id} AND claim = ${prev.claim} AND (status <> 'pending' OR claimed_at < now() - make_interval(mins => ${STALE_MIN}))
        RETURNING payment_id`
    : await sql`INSERT INTO accounting_log (payment_id, claim, status, day, amount_cents, client, by_name)
        VALUES (${r.id}, ${token}, 'pending', ${r.day}, ${cents(r.amount)}, ${r.client}, ${by})
        ON CONFLICT (payment_id) DO NOTHING RETURNING payment_id`;
  return got.length > 0;
}
const release = (id, token) => sql`DELETE FROM accounting_log WHERE payment_id = ${id} AND claim = ${token} AND status = 'pending'`;

// Below the last used row of the ledger: the first rows after the last one with anything but a formula
// in A:J, counting only the rows above the TOTALS row (its "TOTALS" and the note under it aren't used
// rows). No room left above TOTALS: refused, nothing written (a row below it is in no total).
export function targetRows(formulaRows, count) {
  const end = totalsIndex(formulaRows);
  let last = FIRST_ROW - 1;
  (end >= 0 ? formulaRows.slice(0, end) : formulaRows).forEach((r, i) => { if ((r || []).slice(0, 10).some((v) => !blank(v) && !isFormula(v))) last = FIRST_ROW + i; });
  if (end >= 0 && last + count >= FIRST_ROW + end) {
    const room = FIRST_ROW + end - 1 - last;
    throw new LogError(409, `The Income tab has ${room ? `room for only ${room} more ${room === 1 ? "row" : "rows"}` : "no empty rows left"} above its TOTALS row (row ${FIRST_ROW + end}), so nothing was written. Make room above TOTALS in the sheet, then try again.`);
  }
  return Array.from({ length: count }, (_, k) => last + 1 + k);
}
// One row's A:J as written: typed cells, the formulas copied down only where the row has none (null =
// leave the cell as it is). A co-manager's Manager / Manager Share go over the row's own formulas, as
// the owner typed them on rows 4, 37 and 58.
export function rowValues(r, n, formulaRows) {
  const at = (row) => formulaRows[row - FIRST_ROW] || [];
  const cells = typedCells(r);
  const full = () => new LogError(409, `Row ${n} of the Income tab isn't empty, so nothing was written. Reload and try again.`);
  return Array.from({ length: 10 }, (_, c) => {
    const have = at(n)[c];
    if (TYPED.includes(c)) {
      if (!blank(have)) throw full();
      return cells[c] === "" ? null : cells[c];
    }
    if (cells[c] !== undefined) { if (!blank(have) && !isFormula(have)) throw full(); return cells[c]; }
    if (isFormula(have)) return null;
    if (!blank(have)) throw full();
    for (let k = n - 1; k >= FIRST_ROW; k--) {
      const f = at(k)[c];
      if (!isFormula(f)) continue;
      // the nearest formula above is a column total: this row is under the totals, in none of them
      if (isTotal(f)) throw new LogError(409, `Row ${n} of the Income tab is below its totals, so nothing was written. Reload and try again.`);
      return shiftFormula(f, n - k);
    }
    return null;
  });
}
// Only the Gross Commission cells just added get a number format: the column's own, read from the last
// row above it (Sheets' plain dollars when that one has none). Values are never touched here, and a
// format that doesn't take leaves the logged rows logged.
const USD = { type: "CURRENCY", pattern: '"$"#,##0.00' };
async function formatAmounts(P, rowsAdded, above) {
  try {
    const src = `'${INCOME_TAB}'!F${Math.max(FIRST_ROW, above)}`;
    const got = await P.sheets.spreadsheets.get({ spreadsheetId: P.spreadsheetId, ranges: [src], fields: "sheets(properties(sheetId),data(rowData(values(userEnteredFormat(numberFormat)))))" });
    const sh = got.data.sheets?.[0];
    const nf = sh?.data?.[0]?.rowData?.[0]?.values?.[0]?.userEnteredFormat?.numberFormat;
    const numberFormat = nf && (nf.type === "CURRENCY" || /\$/.test(nf.pattern || "")) ? { type: nf.type, ...(nf.pattern ? { pattern: nf.pattern } : {}) } : USD;
    const sheetId = sh?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) return;
    await P.sheets.spreadsheets.batchUpdate({ spreadsheetId: P.spreadsheetId, requestBody: { requests: rowsAdded.map((n) => ({
      repeatCell: { range: { sheetId, startRowIndex: n - 1, endRowIndex: n, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat } }, fields: "userEnteredFormat.numberFormat" },
    })) } });
  } catch (err) { console.error("accounting log: amount format", err); }
}
const heldBy = (got, r) => sheetDay(got[0]) === r.day && String(got[2] ?? "") === r.type && String(got[3] ?? "") === r.client
  && cents(got[5]) === cents(r.amount) && String(got[8] ?? "") === r.account
  && (!r.manager || (String(got[4] ?? "") === r.manager && cents(got[6]) === cents(r.managerShare)));
// a 403 on the write: the dashboard's Google account can read the sheet but not edit it (a Viewer
// share), and trying again won't change that
const noEditText = () => {
  const who = String(process.env.GOOGLE_SHEETS_CLIENT_EMAIL || "").trim();
  return `The dashboard's Google account${who ? ` (${who})` : ""} can't edit the accounting sheet, so nothing was logged. Share the sheet with it as Editor, then try again.`;
};

export async function logPayments({ ids, by = "staff", dryRun = false, now = new Date(), details = null } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^[A-Za-z0-9_]{3,80}$/.test(x)))].slice(0, 50);
  if (!list.length) throw new LogError(400, "No payments were picked.");
  if (!accountingSheetId()) throw new LogError(503, "The accounting sheet isn't connected yet.");
  if (!logWritesOn()) throw new LogError(503, OFF_TEXT);
  // only plain {type, client} picks for the payments asked about
  const picks = {};
  if (details && typeof details === "object") for (const id of list) { const d = details[id]; if (d && typeof d === "object") picks[id] = { type: String(d.type ?? "").slice(0, 80), client: String(d.client ?? "").slice(0, 120) }; }
  const P = await plan(list, { now, details: picks });
  // test: for the confirm's Test chip only (what is written doesn't change)
  const show = (r) => ({ id: r.id, date: r.date, type: r.type, client: r.client, amount: r.amount, account: r.account, notes: r.notes, test: isTestPay(r.p), details: !!r.details,
    ...(r.manager ? { manager: r.manager, managerShare: r.managerShare } : {}) });
  if (dryRun) return { rows: P.rows.map(show), skipped: P.skipped, year: P.year };

  // claims first: a payment another click is logging right now is skipped, not written twice
  const token = uid() + uid();
  const prevOf = new Map(P.entries.map((e) => [e.payment_id, e]));
  const mine = [], skipped = [...P.skipped];
  for (const r of P.rows) {
    if (await claim(r, prevOf.get(r.id), token, by)) mine.push(r);
    else skipped.push({ id: r.id, what: payWhat(r.p, P.nameOf), reason: "It's already being logged (another click or tab).", already: true });
  }
  const logged = [];
  let error = null, left = null, task = null, sent = false;
  // what's left to log after this and every click that finished before it (their claims are done)
  const leftNow = async () => applyLog(P.match, await logEntries(), P.sheetRows, P.readAt).unlogged.filter((p) => !logged.some((x) => x.id === p.id));
  if (mine.length) {
    try {
      await withLedgerLock(async () => {
        const fr = await P.sheets.spreadsheets.values.get({ spreadsheetId: P.spreadsheetId, range: `'${INCOME_TAB}'!A${FIRST_ROW}:J`, valueRenderOption: "FORMULA" });
        const formulaRows = fr.data.values || [];
        const at = targetRows(formulaRows, mine.length);
        const data = mine.map((r, k) => ({ range: `'${INCOME_TAB}'!A${at[k]}:J${at[k]}`, values: [rowValues(r, at[k], formulaRows)] }));
        // the row each claim is about to fill, before writing: a request that dies mid-way leaves enough to tell later
        for (const [k, r] of mine.entries()) await sql`UPDATE accounting_log SET sheet_row = ${at[k]}, row_values = ${JSON.stringify(data[k].values[0])} WHERE payment_id = ${r.id} AND claim = ${token}`;
        let writeErr = null;
        sent = true; // from here the rows may be in the sheet, whatever happens next
        try {
          await P.sheets.spreadsheets.values.batchUpdate({ spreadsheetId: P.spreadsheetId, requestBody: { valueInputOption: "USER_ENTERED", data } });
        } catch (err) { writeErr = err; }
        // read back what the sheet now has on those rows (also after a failed write: it may have landed)
        let back = null;
        try {
          const rb = await P.sheets.spreadsheets.values.get({ spreadsheetId: P.spreadsheetId, range: `'${INCOME_TAB}'!A${at[0]}:J${at[at.length - 1]}`, valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
          back = rb.data.values || [];
        } catch (err) { console.error("accounting log read-back failed:", err); }
        // an error Sheets answered (4xx/5xx) wrote nothing; a lost connection may have
        const refused = writeErr && (writeErr.code || writeErr.response?.status);
        const denied = !!writeErr && [writeErr.status, writeErr.response?.status, writeErr.code].some((x) => Number(x) === 403);
        for (const [k, r] of mine.entries()) {
          const ok = back ? heldBy(back[k] || [], r) : !writeErr;
          if (ok) {
            await sql`UPDATE accounting_log SET status = 'done', logged_at = now() WHERE payment_id = ${r.id} AND claim = ${token}`;
            logged.push({ ...show(r), row: at[k], month: back ? String((back[k] || [])[1] ?? "") : "" });
          } else {
            // not there: let it go, so the button works again. Unknown: the claim stays and goes stale,
            // and the next try checks its row first
            if (back || refused) await release(r.id, token);
            skipped.push({ id: r.id, what: payWhat(r.p, P.nameOf), reason: denied ? noEditText() : "The accounting sheet didn't take this row, so nothing was logged. Try again in a minute." });
          }
        }
        // the amounts show as money ($10.00, not 10) even where the empty rows were never formatted
        if (logged.length) await formatAmounts(P, logged.map((x) => x.row), at[0] - 1);
        if (writeErr && !logged.length) console.error("accounting log write failed:", writeErr);
        // the "Log new payments" ClickUp task follows right away (renamed, or closed at zero), still
        // under the lock so two clicks' updates land in the order they logged
        if (logged.length) {
          left = await leftNow();
          try { task = await runPaymentsTask({ unlogged: forTask(left, P.nameOf) }); } catch (err) { console.error("accounting log: clickup task", err); }
        }
      });
    } catch (err) {
      console.error("accounting log failed:", err);
      if (sent) {
        // the rows went to the sheet before this failed: the claims stay (each holds its sheet row and
        // values), go stale, and the next try checks those rows first, so nothing is logged twice
        error = "Something went wrong after the rows were sent to the accounting sheet, so they may already be there. Check the Income tab before adding anything by hand.";
      } else {
        for (const r of mine) if (!logged.some((x) => x.id === r.id)) await release(r.id, token).catch(() => {});
        error = err instanceof LogError ? err.message : "Couldn't write to the accounting sheet just now, so nothing was logged. Try again in a minute.";
      }
    }
  }
  clearAccountingCache();
  if (!left) left = await leftNow();
  return { logged, skipped, error, left: left.length, leftTotal: left.reduce((s, p) => s + p.amount, 0) / 100, task: task && (task.action || (task.error ? "error" : task.skipped || null)) };
}

