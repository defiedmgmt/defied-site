// Staff-only Dashboard data: the money row (Stripe's commission), recent payments (?all=1 for the
// last 100) and the accounting sheet's numbers with the payments it doesn't have yet. Each part fails on
// its own with a plain line, so the Dashboard always loads. ?fresh=1 skips the few-minute caches
// (the accounting sheet's 5). GET only; nothing here writes, except the two ClickUp tasks the dashboard
// keeps (lib/money.js, at most once every 10 minutes). (r10, C6: Home's ClickUp rows come from /api/tasks,
// so the one list this used to read on every load, and its ?list= switcher, are gone.)
import { withSheetsQuick } from "../../lib/sheets";
import { requireAccess } from "../../lib/access";
import { moneyState, payerNamer, paymentRow, checkClickUpTasks } from "../../lib/money";
import { logWritesOn } from "../../lib/accounting-log";
import { sectionChecks } from "../../lib/accounting-section";
import { loggedToday, autoLogSoon } from "../../lib/auto-log";

// a first Stripe fill reads ~3 things a payment (saved as it goes, lib/stripe.js)
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const t0 = Date.now(); // (review AL-6) Auto-log's run on this load waits out Google's quota only until 40 s after this
  const session = await requireAccess(req, res, "home");
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const fresh = !!req.query.fresh;
    // an account without Money (lib/roles.js) gets Home's other parts only: no Stripe or sheet read at all
    if (!req.access.sections.includes("money")) {
      if (req.query.all) return res.status(403).json({ error: "Your account can't use Money. A Founder can turn it on in Site › Users." });
      const off = { connected: false, hidden: true };
      return res.status(200).json({ money: off, payments: off, accounting: off, tasks: null });
    }
    // (2026-11-20) a page someone waits on: its reads don't sit out Google's quota (lib/sheets.js withSheetsQuick)
    // (2026-11-26) autoLogged: the rows Auto-log added today (lib/auto-log.js), read beside the money; never throws
    const [{ pay, acct, match }, autoLogged0] = await Promise.all([withSheetsQuick(() => moneyState({ fresh })), req.query.all ? 0 : loggedToday()]);
    // (2026-11-26 owner: automatic) a payment no Auto-log note has told yet: Auto-log runs now, beside the rest of this read (at most once every 10 minutes, one
    // run at a time; lib/auto-log.js autoLogSoon never throws). Waited for before the answer: work left after it may never run
    const soon = req.query.all ? Promise.resolve(null) : autoLogSoon({ match, started: t0 });
    const nameOf = await payerNamer(match);
    const logged = match ? new Set([...match.matched, ...match.loggedTogether, ...(match.loggedHere || [])].map((p) => p.id)) : null;

    const money = !pay.connected ? { connected: false }
      : pay.error ? { connected: true, error: pay.error }
      : { connected: true, thisMonth: pay.totals.thisMonth / 100, lastMonth: pay.totals.lastMonth / 100, thisYear: pay.totals.thisYear / 100, updatedAt: new Date().toISOString() };
    const payments = !pay.connected ? { connected: false }
      : pay.error ? { connected: true, error: pay.error }
      : { connected: true, total: pay.list.length, items: pay.list.slice(0, req.query.all ? 100 : 8).map((p) => paymentRow(p, nameOf, logged, acct?.year)) };
    if (req.query.all) return res.status(200).json({ payments });

    // the Accounting section's To check count, for the To do line (the rows themselves are /api/accounting's)
    let toCheck = null;
    if (match && acct.rows) { try { toCheck = (await sectionChecks({ pay, acct, match, namer: nameOf })).toCheck.length; } catch (err) { console.error("home: accounting checks", err); } }
    const accounting = !acct.connected ? { connected: false }
      : acct.error ? { connected: true, error: acct.error }
      : {
        connected: true, month: acct.month, year: acct.year, readAt: acct.readAt,
        monthRevenue: acct.monthRevenue, monthExpenses: acct.monthExpenses, monthNet: acct.monthNet,
        yearNet: acct.yearNet, checkingBalance: acct.checkingBalance, taxSetAside: acct.taxSetAside,
        // null = Stripe couldn't be read, so nobody can say what's missing
        unlogged: match ? match.unlogged.map((p) => paymentRow(p, nameOf, null)) : null,
        unloggedTotal: match ? match.unloggedTotal / 100 : null,
        // the "Log it" buttons: off until ACCOUNTING_SHEET_WRITES=on
        canLog: logWritesOn(),
        toCheck,
      };

    // keep the two ClickUp tasks in step with what was just read (debounced; never blocks the page)
    let tasks = null;
    try { tasks = await checkClickUpTasks({ match, nameOf }); } catch (err) { console.error("home: clickup tasks", err); }
    const ran = await soon;
    const autoLogged = autoLogged0 + (Number(ran?.logged) || 0);
    return res.status(200).json({ money, payments, accounting, tasks: tasks && { ran: !tasks.skipped }, autoLogged });
  } catch (err) {
    console.error("home failed:", err);
    return res.status(500).json({ error: "Couldn't load the Dashboard's numbers. Try again in a minute." });
  }
}
