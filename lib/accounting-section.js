// The Accounting section's data, put together for /api/accounting (and the counts for /api/home):
// the sheet's tiles, the month-by-month check (lib/accounting-checks.js), what's left to log, the rows
// to check minus the ones marked OK, and every payment. Server-only, staff-only data.
import { sql } from "./db";
import { moneyState, payerNamer, paymentRow } from "./money";
import { accountingSheetId, clientsByPayer, rowTypesByPayer } from "./accounting";
import { logWritesOn, incomeOptions } from "./accounting-log";
import { placement } from "./accounting-place";
import { reconcile, checkRows, acceptedOf, DEFAULT_CUTS } from "./accounting-checks";
import { cachedSheetRead } from "./sheet-cache";

const OK_KEY = "accountingChecksOk"; // app_state: { [check key]: { by, at } }

export async function okKeys() {
  try {
    const [r] = await sql`SELECT value FROM app_state WHERE key = ${OK_KEY}`;
    return r?.value && typeof r.value === "object" ? r.value : {};
  } catch (err) { console.error("accounting: ok keys unavailable", err); return {}; }
}

// The month-by-month check and the To check list (less the rows marked OK). Only when Stripe and the
// sheet were both read: an outage must never look like "nothing to check".
export async function sectionChecks({ pay, acct, match, namer }) {
  if (!match || !acct?.rows) return { months: null, all: [], toCheck: [], accepted: { c: 0, n: 0 } };
  const nameOf = (p) => namer(p).client || p.payerName || "";
  // the Co-Management Cut history as the Stripe Fees tab has it (what Stripe is set to), else the known one
  const cuts = acct.coCuts || DEFAULT_CUTS;
  const months = reconcile({ list: pay.list, rows: acct.rows, match, year: acct.year, nameOf, cuts });
  const ok = await okKeys();
  const all = checkRows({ rows: acct.rows, match, list: pay.list, year: acct.year, months, nameOf, cuts });
  // accepted: the part of the year's difference on the rows marked OK (acceptedOf), which the banner counts as matched
  return { months, all, toCheck: all.filter((x) => !ok[x.key]), accepted: acceptedOf({ months, all, ok, rows: acct.rows, match }) };
}

// Mark as OK, merged into the one app_state row (two clicks at once both stay)
export async function markOk(key, by) {
  await sql`INSERT INTO app_state (key, value, updated_at)
    VALUES (${OK_KEY}, jsonb_build_object(${key}::text, jsonb_build_object('by', ${by}::text, 'at', now())), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
}

// (2026-11-24, speed) The Income tab's Revenue Type dropdown and INFO's roster (incomeOptions: two or three Sheets reads on every Money load)
// change rarely: one saved copy shared by every server for 3 minutes (lib/sheet-cache.js), never served after the site writes to the
// accounting sheet (lib/sheets.js marks every write), the last good copy for a passing failure (Google's quota), and a fresh Money read
// (Refresh) reads them again. The types typed in the Income column (used when there's no dropdown) come from this read's own rows, as before.
export async function cachedIncomeOptions({ rows = [], fresh = false } = {}) {
  const got = await cachedSheetRead(accountingSheetId(), "incomeOptions", () => incomeOptions({ rows: [] }), { fresh });
  const v = got?.v || {};
  if (v.typesFrom === "dropdown") return v;
  return { ...v, types: [...new Set((rows || []).map((r) => String(r.type || "").trim()).filter(Boolean))], typesFrom: "column" };
}

// Everything the section (or, with counts, the badge) needs, from one fresh-enough read
export async function accountingState({ fresh = false, counts = false } = {}) {
  const { pay, acct, match } = await moneyState({ fresh });
  if (!acct.connected) return { connected: false };
  if (acct.error) return { connected: true, error: acct.error };
  const namer = await payerNamer(match);
  const { months, all, toCheck, accepted } = await sectionChecks({ pay, acct, match, namer });
  const toLog = match ? [...match.unlogged].reverse().map((p) => paymentRow(p, namer, null)) : null;
  // toLogTotal: the dollars still to log (To do's row and Home's ranking weigh money by it)
  const tests = (toLog || []).filter((p) => p.test);
  const out = { connected: true, year: acct.year, counts: { toLog: toLog ? toLog.length : null, toCheck: toCheck.length, toLogTotal: match ? match.unloggedTotal / 100 : null,
    toLogTests: { n: tests.length, total: Math.round(tests.reduce((a, p) => a + p.amount, 0) * 100) / 100 } } };
  if (counts) return out;
  let opts = { gid: null, types: [], clients: [] };
  try { opts = await cachedIncomeOptions({ rows: acct.rows, fresh }); } catch (err) { console.error("accounting: income options", err); }
  // r10 fix: the links open ACCOUNTING_SHEET_LINK_ID when it's set (a preview reading a stand-in sheet still opens
  // the real one, as Site › Sync does); the stand-in's tab and row numbers aren't the real sheet's, so then it's
  // the sheet itself, no tab or row
  const linkId = String(process.env.ACCOUNTING_SHEET_LINK_ID || "").trim();
  const id = linkId || accountingSheetId();
  const rowUrl = (n) => (linkId && linkId !== accountingSheetId() ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit` : `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${opts.gid ?? 0}${n ? `&range=A${n}` : ""}`);
  // which payments Log it can't place (the same check it runs, dry, no claims): To log offers only Log
  // with details on those, and Log all leaves them out. Only when INFO was read: an outage flags nothing.
  if (toLog && opts.clients.length) {
    const ctx = { roster: opts.clients, typesOf: rowTypesByPayer(match), bySheet: clientsByPayer(match), nameOf: namer };
    const byId = new Map(match.unlogged.map((p) => [p.id, p]));
    for (const it of toLog) { const place = placement(byId.get(it.id), ctx); if (place.reason) it.needsDetails = place.reason; }
  }
  const logged = match ? new Set([...match.matched, ...match.loggedTogether, ...(match.loggedHere || [])].map((p) => p.id)) : null;
  return {
    ...out,
    month: acct.month, readAt: acct.readAt, sheetUrl: rowUrl(null),
    tiles: { monthRevenue: acct.monthRevenue, monthExpenses: acct.monthExpenses, monthNet: acct.monthNet, yearNet: acct.yearNet, checkingBalance: acct.checkingBalance, taxSetAside: acct.taxSetAside },
    stripe: pay.connected ? (pay.error ? { error: pay.error } : { ok: true }) : { connected: false },
    // cents → dollars for the page; the parts keep their own words
    months: months && months.map((m) => ({ ...m, stripe: m.stripe / 100, sheet: m.sheet / 100, covered: m.covered / 100, diff: m.diff / 100, residual: m.residual / 100, parts: m.parts.map((x) => ({ amount: x.c / 100, text: x.text, kind: x.kind, row: x.row || null, url: x.row ? rowUrl(x.row) : null })) })),
    sheetSource: "Income tab, DEFIED SHARE by the row's date",
    toLog: toLog && { items: toLog, total: match.unloggedTotal / 100, canLog: logWritesOn() },
    // okAmount (dollars) and okRows: the year's difference that sits on the rows marked OK, and how many rows (lib/accounting-checks.js acceptedOf)
    toCheck: { items: toCheck.map((x) => ({ ...x, url: rowUrl(x.row || x.open) })), okCount: all.length - toCheck.length, okAmount: accepted.c / 100, okRows: accepted.n },
    payments: pay.list ? { total: pay.list.length, items: pay.list.map((p) => paymentRow(p, namer, logged, acct.year)) } : null,
    options: { types: opts.types, typesFrom: opts.typesFrom || null, clients: opts.clients },
  };
}

