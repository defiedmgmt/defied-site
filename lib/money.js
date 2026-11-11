// The Dashboard's money, put together for /api/home and the daily cron: Stripe's commission, the
// accounting sheet's numbers, which payments the sheet doesn't have yet, and who paid. Server-only,
// staff-only data (payer names and emails): no client route may import this.
import { sql } from "./db";
import { commissionSummary, toMs } from "./stripe";
import { accountingSummary, matchPayments, clientsByPayer, soleClientByPayer, applyLog, isTestPay } from "./accounting";
import { runPaymentsTask, writesOn } from "./clickup-tasks";
import { refreshAreaTasks } from "./area-tasks";
import { personKey } from "./names";

// H.4: the August batch of tests, paid through two managers' links and typed as one row, counts as
// logged, so rule 2 may add up test payments across managers (lib/accounting.js isTestPay)
export const BATCH_MANAGERS = "any";
const CHECK_KEY = "clickupTasksCheck"; // when the two ClickUp tasks were last re-checked (its updated_at)

export async function moneyState({ now = new Date(), fresh = false } = {}) {
  const [pay, acct, entries] = await Promise.all([commissionSummary({ now }), accountingSummary({ now, fresh }), logEntries()]);
  // only when both read fine: an outage must never look like "everything's logged"
  const raw = pay.list && acct.rows ? matchPayments(pay.list, acct.rows, acct.year, { batchManagers: BATCH_MANAGERS }) : null;
  // ...and the rows the dashboard added itself count as logged (match.loggedHere)
  const match = raw && applyLog(raw, entries, acct.rows, acct.readAt);
  return { pay, acct, match, entries };
}

// The payments the dashboard logged to the sheet (lib/accounting-log.js), one row per Stripe payment
export async function logEntries() {
  try {
    return await sql`SELECT payment_id, claim, status, day, amount_cents, client, sheet_row, logged_at FROM accounting_log`;
  } catch (err) {
    // before the migration runs there's no table: nothing was logged from here yet
    console.error("accounting_log unavailable:", err.message);
    return [];
  }
}

// Who a payment is from, by F's tiers: 0. the client who paid from their portal (the link carried their id,
// 2026-11-11), 1. the client the accounting sheet always logs that payer as, 2. a client login with the payer's
// email, 3. a client whose name or credit is the payer's name.
// Nothing matched: the payer's own name.
export async function payerNamer(match, { onlyOne = false } = {}) {
  const bySheet = match ? (onlyOne ? soleClientByPayer(match) : clientsByPayer(match)) : new Map();
  let logins = [], clients = [];
  try {
    [logins, clients] = await Promise.all([
      sql`SELECT u.email, c.name FROM users u JOIN clients c ON c.id = u.client_id WHERE u.role = 'client'`,
      sql`SELECT id, name, credit FROM clients`,
    ]);
  } catch (err) { console.error("payerNamer: clients unavailable", err); }
  const byLogin = new Map(logins.map((r) => [String(r.email).toLowerCase(), r.name]));
  const byId = new Map(clients.map((c) => [c.id, c.name]));
  const byKey = new Map();
  for (const c of clients) for (const n of [c.name, c.credit]) { const k = personKey(n); if (k && !byKey.has(k)) byKey.set(k, c.name); }
  return (p) => {
    if (p.clientRef && byId.has(p.clientRef)) return { client: byId.get(p.clientRef), how: "portal" };
    const email = String(p.payerEmail || "").toLowerCase(), name = String(p.payerName || "").toLowerCase();
    const hit = (email && bySheet.get(`email:${email}`)) || (name && bySheet.get(`name:${name}`));
    // the sheet's spelling of a roster client ("reallyindig0") reads as the roster's own name
    if (hit) return { client: byKey.get(personKey(hit)) || hit, how: "sheet" };
    if (email && byLogin.has(email)) return { client: byLogin.get(email), how: "login" };
    const k = personKey(p.payerName);
    if (k && byKey.has(k)) return { client: byKey.get(k), how: "name" };
    return { client: null, how: null };
  };
}

// payerNamer with the accounting sheet's names when the sheet can be read (the Management Commission card, My
// payments, 2026-11-11): a payment made under the payer's own name reads as the client the sheet logs it as, as on
// Money. The sheet not answering: the portal's id, a login's email, the client's name.
export async function sheetNamer(list) {
  const acct = await accountingSummary().catch(() => null);
  return payerNamer(acct?.rows && list ? matchPayments(list, acct.rows, acct.year, { batchManagers: BATCH_MANAGERS }) : null, { onlyOne: true });
}

// One payment as the Dashboard shows it (dollars; no emails or account ids leave the server). The
// sheet is one year's book: a payment from another year (New York time) gets no logged flag either way.
const nyYear = (ms) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(new Date(ms)));
export function paymentRow(p, nameOf, loggedIds, sheetYear = null) {
  const who = nameOf(p);
  const otherYear = !!sheetYear && nyYear(toMs(p.at)) !== Number(sheetYear);
  return {
    id: p.id, at: new Date(toMs(p.at)).toISOString(),
    client: who.client, payer: who.client ? null : p.payerName || null, matchedBy: who.how,
    via: p.link?.owner || null, direct: !!p.direct, amount: p.amount / 100, fee: p.fee / 100,
    logged: loggedIds && !otherYear ? loggedIds.has(p.id) : null,
    test: isTestPay(p), // the grey Test chip (the rule the matching uses); it changes no total
  };
}

// The unlogged payments in the shape the ClickUp task lists them (a test payment marked, as To do says it)
export const forTask = (unlogged, nameOf) => unlogged.map((p) => ({ id: p.id, at: p.at, client: nameOf(p).client || p.payerName || "", amount: p.amount, test: isTestPay(p) }));

// The run is claimed in one statement before any ClickUp write, so two overlapping runs (two
// Dashboard loads, or one beside the cron) can't both create a task: only the one that gets the row
// back goes ahead. A Dashboard load waits 10 minutes after the last run, the cron 1 minute.
async function claimRun(force) {
  const value = JSON.stringify({ at: new Date().toISOString(), by: force ? "cron" : "dashboard" });
  const rows = force
    ? await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${CHECK_KEY}, ${value}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE app_state.updated_at < now() - interval '1 minute' RETURNING key`
    : await sql`INSERT INTO app_state (key, value, updated_at) VALUES (${CHECK_KEY}, ${value}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now() WHERE app_state.updated_at < now() - interval '10 minutes' RETURNING key`;
  return rows.length > 0;
}

// Brings the dashboard's ClickUp tasks up to date ("Log new payments" and one per area: Publishing,
// A&R, Money). The cron forces it (at most once a
// minute); a Dashboard load does it at most once every 10 minutes. Writes nothing unless
// CLICKUP_TASK_WRITES is "on", and leaves the payments task alone when Stripe or the sheet can't be read.
export async function checkClickUpTasks({ match, nameOf, force = false, weekly = true } = {}) {
  if (!writesOn()) return { skipped: "writes off" };
  if (!(await claimRun(force))) return { skipped: "checked recently" };
  const out = {};
  if (match === undefined) { const m = await moneyState(); match = m.match; nameOf = await payerNamer(match); }
  out.payments = match ? await runPaymentsTask({ unlogged: forTask(match.unlogged, nameOf) }) : { skipped: "Stripe or the accounting sheet couldn't be read" };
  if (weekly) out.areas = await refreshAreaTasks();
  return out;
}

// Right after an action that logs a payment: the "Log new payments" task follows at once (ticked,
// renamed, or completed at zero) instead of at the next Dashboard load or cron. Never throws.
export async function refreshPaymentsTask() {
  if (!writesOn()) return { skipped: "writes off" };
  try {
    const m = await moneyState({ fresh: true });
    if (!m.match) return { skipped: "Stripe or the accounting sheet couldn't be read" };
    const nameOf = await payerNamer(m.match);
    return await runPaymentsTask({ unlogged: forTask(m.match.unlogged, nameOf) });
  } catch (err) {
    console.error("payments task refresh failed:", err);
    return { error: "Couldn't reach ClickUp" };
  }
}
