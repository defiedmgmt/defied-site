// The Accounting section's data, put together for /api/accounting (and the counts for /api/home):
// the sheet's tiles, the month-by-month check (lib/accounting-checks.js), what's left to log, the rows
// to check minus the ones marked OK, and every payment. Server-only, staff-only data.
import { sql } from "./db";
import { moneyState, payerNamer, paymentRow } from "./money";
import { accountingSheetId } from "./accounting";
import { logWritesOn, incomeOptions } from "./accounting-log";
import { reconcile, checkRows } from "./accounting-checks";

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
  if (!match || !acct?.rows) return { months: null, all: [], toCheck: [] };
  const nameOf = (p) => namer(p).client || p.payerName || "";
  const months = reconcile({ list: pay.list, rows: acct.rows, match, year: acct.year, nameOf });
  const ok = await okKeys();
  const all = checkRows({ rows: acct.rows, match, list: pay.list, year: acct.year, months, nameOf });
  return { months, all, toCheck: all.filter((x) => !ok[x.key]) };
}

// Mark as OK, merged into the one app_state row (two clicks at once both stay)
export async function markOk(key, by) {
  await sql`INSERT INTO app_state (key, value, updated_at)
    VALUES (${OK_KEY}, jsonb_build_object(${key}::text, jsonb_build_object('by', ${by}::text, 'at', now())), now())
    ON CONFLICT (key) DO UPDATE SET value = app_state.value || EXCLUDED.value, updated_at = now()`;
}

// Everything the section (or, with counts, the badge) needs, from one fresh-enough read
export async function accountingState({ fresh = false, counts = false } = {}) {
  const { pay, acct, match } = await moneyState({ fresh });
  if (!acct.connected) return { connected: false };
  if (acct.error) return { connected: true, error: acct.error };
  const namer = await payerNamer(match);
  const { months, all, toCheck } = await sectionChecks({ pay, acct, match, namer });
  const toLog = match ? [...match.unlogged].reverse().map((p) => paymentRow(p, namer, null)) : null;
  const out = { connected: true, year: acct.year, counts: { toLog: toLog ? toLog.length : null, toCheck: toCheck.length } };
  if (counts) return out;
  let opts = { gid: null, types: [], clients: [] };
  try { opts = await incomeOptions({ rows: acct.rows }); } catch (err) { console.error("accounting: income options", err); }
  const id = accountingSheetId();
  const rowUrl = (n) => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=${opts.gid ?? 0}${n ? `&range=A${n}` : ""}`;
  const logged = match ? new Set([...match.matched, ...match.loggedTogether, ...(match.loggedHere || [])].map((p) => p.id)) : null;
  return {
    ...out,
    month: acct.month, readAt: acct.readAt, sheetUrl: rowUrl(null),
    tiles: { monthRevenue: acct.monthRevenue, monthExpenses: acct.monthExpenses, monthNet: acct.monthNet, yearNet: acct.yearNet, checkingBalance: acct.checkingBalance, taxSetAside: acct.taxSetAside },
    stripe: pay.connected ? (pay.error ? { error: pay.error } : { ok: true }) : { connected: false },
    // cents → dollars for the page; the parts keep their own words
    months: months && months.map((m) => ({ ...m, stripe: m.stripe / 100, sheet: m.sheet / 100, diff: m.diff / 100, residual: m.residual / 100, parts: m.parts.map((x) => ({ amount: x.c / 100, text: x.text, kind: x.kind })) })),
    sheetSource: "Income tab, DEFIED SHARE by the row's date",
    toLog: toLog && { items: toLog, total: match.unloggedTotal / 100, canLog: logWritesOn() },
    toCheck: { items: toCheck.map((x) => ({ ...x, url: rowUrl(x.row) })), okCount: all.length - toCheck.length },
    payments: pay.list ? { total: pay.list.length, items: pay.list.map((p) => paymentRow(p, namer, logged, acct.year)) } : null,
    options: { types: opts.types, typesFrom: opts.typesFrom || null, clients: opts.clients },
  };
}

