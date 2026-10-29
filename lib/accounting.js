// The accounting sheet ("Defied Accounting Master Sheet"), read-only for now: the Income ledger plus
// the few totals the Dashboard shows (this month's revenue, expenses and net, the year's net, the
// Business Checking balance, the quarterly tax set-aside). matchPayments is pure: it says which
// Stripe payments are already in the Income tab. Nothing in this module writes to the sheet.
// Server-only, same boundary as lib/sheets.js.
import { getSheetsClient } from "./sheets";
import { nyDay } from "./stripe";

export const INCOME_TAB = "Income";
export const INCOME_HEADER_ROW = 3;
export const INCOME_HEADERS = ["Date", "Month", "Revenue Type", "Artist / Client", "Manager", "Gross Commission", "Manager Share", "DEFIED SHARE", "Account", "Source / Notes"];
export const SUMMARY_TAB = "Monthly Summary";
export const BALANCE_TAB = "Accounts & Balance";
export const TAX_TAB = "Member Tax";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OWNER = "Devin"; // a blank Manager on the sheet is Devin's own client
const CACHE_MS = 5 * 60 * 1000;

const qt = (title) => title.replace(/'/g, "''");
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const label = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const num = (v) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0);
export const cents = (v) => Math.round(num(v) * 100);
// dollars to the cent: sheet sums come back as floats (3182.6300000000006)
const usd = (v) => cents(v) / 100;

// A sheet date as "YYYY-MM-DD": a date serial (UNFORMATTED reads), "M/D/YYYY" text, or ISO already
export function sheetDay(v) {
  if (typeof v === "number") { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return d.toISOString().slice(0, 10); }
  const s = String(v ?? "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
}
const dayNum = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 864e5;

// --- reading ---------------------------------------------------------------------
// Each check names what moved, so the Dashboard can say "the accounting sheet's layout changed"
// instead of showing numbers read from the wrong cells.
class LayoutError extends Error {}
const moved = (what) => { throw new LayoutError(`The accounting sheet's layout changed (${what}), so its numbers aren't shown. Nothing was changed in the sheet.`); };

export function parseIncome(values) {
  const header = (values[0] || []).map((h) => String(h ?? "").trim());
  INCOME_HEADERS.forEach((h, i) => { if (label(header[i]) !== label(h)) moved(`Income column ${String.fromCharCode(65 + i)} isn't "${h}"`); });
  const rows = [];
  values.slice(1).forEach((r, i) => {
    const [date, month, type, client, manager, gross, managerShare, defiedShare, account, notes] = r;
    if ([date, type, client, gross, account, notes].every(blank)) return; // a pre-filled formula row
    rows.push({
      row: INCOME_HEADER_ROW + 1 + i, date: sheetDay(date), month: String(month ?? ""), type: String(type ?? ""),
      client: String(client ?? ""), manager: String(manager ?? ""), gross: usd(gross), managerShare: usd(managerShare),
      defiedShare: usd(defiedShare), account: String(account ?? ""), notes: String(notes ?? ""),
    });
  });
  return rows;
}

// The row whose first cell is `name`, and the column under the header row's `col` label
function findRow(values, name) { return values.find((r) => label(r[0]) === label(name)) || null; }
function findHeader(values, test) {
  for (let r = 0; r < values.length; r++) { const c = (values[r] || []).findIndex((v) => test(label(v))); if (c >= 0) return { r, c }; }
  return null;
}

export function parseSummary(values, month) {
  const monthsRow = values.findIndex((r) => MONTHS.every((m) => (r || []).some((v) => label(v) === label(m))));
  if (monthsRow < 0) moved("Monthly Summary has no Jan…Dec header row");
  const head = values[monthsRow].map(label);
  const yearCol = head.findIndex((v) => v === "year" || v === "total" || v === "ytd" || /^20\d\d$/.test(v));
  if (yearCol < 0) moved("Monthly Summary has no year total column");
  const col = head.indexOf(label(MONTHS[month - 1]));
  const pick = (name) => { const r = findRow(values, name); if (!r) moved(`Monthly Summary has no "${name}" row`); return r; };
  const rev = pick("TOTAL REVENUE"), exp = pick("TOTAL EXPENSES"), net = pick("NET");
  return { monthRevenue: usd(rev[col]), monthExpenses: usd(exp[col]), monthNet: usd(net[col]), yearNet: usd(net[yearCol]) };
}

export function parseBalance(values) {
  const h = findHeader(values, (v) => v === "balance");
  if (!h) moved("Accounts & Balance has no Balance column");
  const row = findRow(values, "Business Checking");
  if (!row) moved('Accounts & Balance has no "Business Checking" row');
  return { checkingBalance: usd(row[h.c]) };
}

export function parseTax(values) {
  const h = findHeader(values, (v) => /quarterly.*set.?aside/.test(v));
  if (!h) moved("Member Tax has no quarterly set-aside column");
  const row = values.slice(h.r + 1).find((r) => label(r[0]) === "total");
  if (!row) moved('Member Tax has no "TOTAL" row');
  return { taxSetAside: usd(row[h.c]) };
}

let cache = null; // { at, id, data }
export function accountingSheetId() { return process.env.ACCOUNTING_SHEET_ID || ""; }

// One batchGet of UNFORMATTED values (numbers stay numbers, dates come back as serials)
export async function readAccounting({ now = new Date(), sheets, fresh = false } = {}) {
  const spreadsheetId = accountingSheetId();
  if (!spreadsheetId) return { connected: false };
  if (!fresh && cache && cache.id === spreadsheetId && Date.now() - cache.at < CACHE_MS) return cache.data;
  const client = sheets || getSheetsClient();
  const res = await client.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`'${INCOME_TAB}'!A${INCOME_HEADER_ROW}:J`, `'${qt(SUMMARY_TAB)}'!A1:P80`, `'${qt(BALANCE_TAB)}'!A1:J40`, `'${qt(TAX_TAB)}'!A1:J40`],
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "SERIAL_NUMBER",
  });
  const [inc, sum, bal, tax] = (res.data.valueRanges || []).map((v) => v.values || []);
  const today = nyDay(now);
  const rows = parseIncome(inc || []);
  const data = {
    connected: true,
    year: Number(today.slice(0, 4)),
    month: today.slice(0, 7),
    rows,
    ...parseSummary(sum || [], Number(today.slice(5, 7))),
    ...parseBalance(bal || []),
    ...parseTax(tax || []),
    readAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), id: spreadsheetId, data };
  return data;
}
export const isLayoutError = (err) => err instanceof LayoutError;
export function clearAccountingCache() { cache = null; }

// What the Dashboard's Accounting card needs; a moved layout or a Sheets outage is a plain line, never a crash
export async function accountingSummary(opts = {}) {
  try {
    return await readAccounting(opts);
  } catch (err) {
    console.error("accountingSummary failed:", err);
    return { connected: true, error: isLayoutError(err) ? err.message : "Couldn't read the accounting sheet. Try again in a minute." };
  }
}

// --- matching (pure) ---------------------------------------------------------------
// Which of the year's Stripe payments are already in the Income tab (addendum G):
//  1. same Gross in cents, dates at most 3 days apart in New York, same Manager (blank = Devin),
//     nearest dates first, each row used once;
//  2. a leftover row may be the SUM of several same-manager payments within 2 days of it
//     ("logged together", like the August batch of test payments typed as one row);
//  3. payments straight to Defied's own account are Devin's (their link owner is Devin).
// `batchManagers: "any"` lets rule 2 combine payments across managers, but only test payments ($2 or
// less, or "test" in the description) or into a Distribution / Test row; the default follows G.
// a test payment: what the August batch was, so a real row can't swallow other managers' payments
const isTestPay = (p) => p.amount <= 200 || /\btest\b/i.test(p.description || "");
export function matchPayments(stripeList, incomeRows, year, { batchManagers = "same" } = {}) {
  const y = String(year);
  const pays = stripeList
    .filter((p) => nyDay(p.at).slice(0, 4) === y && p.amount > 0) // refunded in full: nothing to log
    .map((p) => ({ p, day: dayNum(nyDay(p.at)), cents: p.amount, manager: p.link?.owner || OWNER }));
  const rows = incomeRows
    .map((r) => ({ r, ymd: sheetDay(r.date) }))
    .filter((x) => x.ymd.slice(0, 4) === y && cents(x.r.gross) > 0)
    .map((x) => ({ r: x.r, day: dayNum(x.ymd), cents: cents(x.r.gross), manager: x.r.manager?.trim() || OWNER }));

  // rule 1: every allowed pair, nearest first (then the earlier payment, then the higher row)
  const pairs = [];
  pays.forEach((a, i) => rows.forEach((b, j) => {
    const gap = Math.abs(a.day - b.day);
    if (a.cents === b.cents && a.manager === b.manager && gap <= 3) pairs.push({ i, j, gap });
  }));
  pairs.sort((x, y2) => x.gap - y2.gap || pays[x.i].p.at - pays[y2.i].p.at || rows[x.j].r.row - rows[y2.j].r.row);
  const payUsed = new Map(), rowUsed = new Set();
  for (const { i, j } of pairs) {
    if (payUsed.has(i) || rowUsed.has(j)) continue;
    payUsed.set(i, { kind: "matched", row: rows[j].r.row });
    rowUsed.add(j);
  }

  // rule 2: a leftover row that is the exact sum of two or more leftover payments
  const together = [];
  rows.forEach((b, j) => {
    if (rowUsed.has(j)) return;
    const testRow = /^(distribution|test)\b/i.test(String(b.r.type ?? "").trim());
    const cands = pays
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => !payUsed.has(i) && Math.abs(a.day - b.day) <= 2 && (a.manager === b.manager || (batchManagers === "any" && (testRow || isTestPay(a.p)))))
      .sort((x, z) => Math.abs(x.a.day - b.day) - Math.abs(z.a.day - b.day) || x.a.p.at - z.a.p.at)
      .slice(0, 24);
    const pick = subsetSum(cands.map((c) => c.a.cents), b.cents);
    if (!pick || pick.length < 2) return;
    const ids = pick.map((k) => cands[k].i);
    const span = Math.max(...ids.map((i) => pays[i].day)) - Math.min(...ids.map((i) => pays[i].day));
    if (span > 2) return;
    ids.forEach((i) => payUsed.set(i, { kind: "together", row: b.r.row }));
    rowUsed.add(j);
    together.push({ row: b.r.row, ids: ids.map((i) => pays[i].p.id) });
  });

  const matched = [], loggedTogether = [], unlogged = [];
  pays.forEach((a, i) => {
    const u = payUsed.get(i);
    const out = { ...a.p, manager: a.manager, row: u?.row ?? null, client: u ? rows.find((x) => x.r.row === u.row)?.r.client || "" : "" };
    (u?.kind === "matched" ? matched : u?.kind === "together" ? loggedTogether : unlogged).push(out);
  });
  const byAt = (a, b) => a.at - b.at;
  return {
    year: Number(y),
    matched: matched.sort(byAt),
    loggedTogether: loggedTogether.sort(byAt),
    together,
    unlogged: unlogged.sort(byAt),
    // rows no Stripe payment explains (cash, a bank deposit, a typo): shown, never "fixed"
    extraRows: rows.filter((_, j) => !rowUsed.has(j)).map((x) => x.r.row),
    unloggedTotal: unlogged.reduce((s, p) => s + p.amount, 0),
    unloggedFees: unlogged.reduce((s, p) => s + p.fee, 0),
  };
}

// Indexes of the first subset (in the given order) summing to target; small inputs only
function subsetSum(values, target) {
  let found = null;
  const walk = (k, left, picked) => {
    if (found) return;
    if (left === 0) { if (picked.length >= 2) found = [...picked]; return; }
    if (left < 0 || k >= values.length) return;
    picked.push(k); walk(k + 1, left - values[k], picked); picked.pop();
    walk(k + 1, left, picked);
  };
  walk(0, target, []);
  return found;
}

// The client each payer has always been logged as (payer email, else name, from matched rows):
// the first way the Dashboard names who paid
export function clientsByPayer(result) {
  const out = new Map();
  for (const p of [...result.matched, ...result.loggedTogether]) {
    if (!p.client) continue;
    for (const k of [p.payerEmail && `email:${p.payerEmail.toLowerCase()}`, p.payerName && `name:${p.payerName.toLowerCase()}`]) if (k && !out.has(k)) out.set(k, p.client);
  }
  return out;
}
