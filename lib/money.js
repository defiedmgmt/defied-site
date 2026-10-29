// The Dashboard's money, put together for /api/home and the daily cron: Stripe's commission, the
// accounting sheet's numbers, which payments the sheet doesn't have yet, and who paid. Server-only,
// staff-only data (payer names and emails): no client route may import this.
import { sql } from "./db";
import { commissionSummary, toMs } from "./stripe";
import { accountingSummary, matchPayments, clientsByPayer } from "./accounting";
import { runPaymentsTask, runWeeklySync, writesOn } from "./clickup-tasks";
import { syncTasksNow } from "./sync-tasks";
import { getState, setState } from "./luminate";
import { personKey } from "./names";

// H.4: the August batch of tests, paid through two managers' links and typed as one row, counts as
// logged, so rule 2 may add up payments across managers
export const BATCH_MANAGERS = "any";
const CHECK_KEY = "clickupTasksCheck"; // when the Dashboard last re-checked the two ClickUp tasks
const CHECK_MS = 10 * 60 * 1000;

export async function moneyState({ now = new Date(), fresh = false } = {}) {
  const [pay, acct] = await Promise.all([commissionSummary({ now }), accountingSummary({ now, fresh })]);
  // only when both read fine: an outage must never look like "everything's logged"
  const match = pay.list && acct.rows ? matchPayments(pay.list, acct.rows, acct.year, { batchManagers: BATCH_MANAGERS }) : null;
  return { pay, acct, match };
}

// Who a payment is from, by F's tiers: 1. the client the accounting sheet always logs that payer as,
// 2. a client login with the payer's email, 3. a client whose name or credit is the payer's name.
// Nothing matched: the payer's own name.
export async function payerNamer(match) {
  const bySheet = match ? clientsByPayer(match) : new Map();
  let logins = [], clients = [];
  try {
    [logins, clients] = await Promise.all([
      sql`SELECT u.email, c.name FROM users u JOIN clients c ON c.id = u.client_id WHERE u.role = 'client'`,
      sql`SELECT name, credit FROM clients`,
    ]);
  } catch (err) { console.error("payerNamer: clients unavailable", err); }
  const byLogin = new Map(logins.map((r) => [String(r.email).toLowerCase(), r.name]));
  const byKey = new Map();
  for (const c of clients) for (const n of [c.name, c.credit]) { const k = personKey(n); if (k && !byKey.has(k)) byKey.set(k, c.name); }
  return (p) => {
    const email = String(p.payerEmail || "").toLowerCase(), name = String(p.payerName || "").toLowerCase();
    const hit = (email && bySheet.get(`email:${email}`)) || (name && bySheet.get(`name:${name}`));
    if (hit) return { client: hit, how: "sheet" };
    if (email && byLogin.has(email)) return { client: byLogin.get(email), how: "login" };
    const k = personKey(p.payerName);
    if (k && byKey.has(k)) return { client: byKey.get(k), how: "name" };
    return { client: null, how: null };
  };
}

// One payment as the Dashboard shows it (dollars; no emails or account ids leave the server)
export function paymentRow(p, nameOf, loggedIds) {
  const who = nameOf(p);
  return {
    id: p.id, at: new Date(toMs(p.at)).toISOString(),
    client: who.client, payer: who.client ? null : p.payerName || null, matchedBy: who.how,
    via: p.link?.owner || null, direct: !!p.direct, amount: p.amount / 100, fee: p.fee / 100,
    logged: loggedIds ? loggedIds.has(p.id) : null,
  };
}

// The unlogged payments in the shape the ClickUp task lists them
export const forTask = (unlogged, nameOf) => unlogged.map((p) => ({ id: p.id, at: p.at, client: nameOf(p).client || p.payerName || "", amount: p.amount }));

// Brings the two ClickUp tasks up to date ("Log new payments" and the weekly sync). The cron forces
// it; a Dashboard load does it at most once every 10 minutes. Writes nothing unless
// CLICKUP_TASK_WRITES is "on", and leaves the payments task alone when Stripe or the sheet can't be read.
export async function checkClickUpTasks({ match, nameOf, force = false, weekly = true } = {}) {
  if (!writesOn()) return { skipped: "writes off" };
  if (!force) {
    const last = await getState(CHECK_KEY);
    if (last?.at && Date.now() - new Date(last.at).getTime() < CHECK_MS) return { skipped: "checked recently" };
  }
  await setState(CHECK_KEY, { at: new Date().toISOString() });
  const out = {};
  if (match === undefined) { const m = await moneyState(); match = m.match; nameOf = await payerNamer(match); }
  out.payments = match ? await runPaymentsTask({ unlogged: forTask(match.unlogged, nameOf) }) : { skipped: "Stripe or the accounting sheet couldn't be read" };
  if (weekly) {
    try { out.weeklySync = await runWeeklySync({ syncTasks: await syncTasksNow() }); } catch (err) {
      console.error("weekly sync task failed:", err);
      out.weeklySync = { error: "Couldn't work out the sync tasks" };
    }
  }
  return out;
}
