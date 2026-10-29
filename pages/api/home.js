// Staff-only Dashboard data: the money row (Stripe's commission), recent payments (?all=1 for the
// last 100), the accounting sheet's numbers with the payments it doesn't have yet, and one ClickUp
// list's open tasks (?list=internal|pub|ar on its own for the card's switcher). Each part fails on
// its own with a plain line, so the Dashboard always loads. ?fresh=1 skips the few-minute caches
// (the accounting sheet's 5, ClickUp's 2). GET only; nothing here writes, except
// the two ClickUp tasks the dashboard keeps (lib/money.js, at most once every 10 minutes).
import { requireStaff } from "../../lib/session";
import { moneyState, payerNamer, paymentRow, checkClickUpTasks } from "../../lib/money";
import { listTasks, LISTS, clearTaskCache } from "../../lib/clickup-tasks";

const WORKSPACE = "90141502305";
const listUrl = (id) => `https://app.clickup.com/${WORKSPACE}/v/li/${id}`;

async function clickupPart(key) {
  const list = LISTS[key] || LISTS.internal;
  const r = await listTasks(list.id);
  const lists = Object.entries(LISTS).map(([k, l]) => ({ key: k, id: l.id, name: l.name }));
  if (r.error) return { lists, key: LISTS[key] ? key : "internal", name: list.name, url: listUrl(list.id), error: "Couldn't reach ClickUp." };
  return { lists, key: LISTS[key] ? key : "internal", name: list.name, url: listUrl(list.id), tasks: r.tasks.filter((t) => !t.done) };
}

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    const fresh = !!req.query.fresh;
    if (fresh) clearTaskCache();
    if (req.query.list) return res.status(200).json({ clickup: await clickupPart(String(req.query.list)) });
    const [{ pay, acct, match }, clickup] = await Promise.all([moneyState({ fresh }), req.query.all ? null : clickupPart("internal")]);
    const nameOf = await payerNamer(match);
    const logged = match ? new Set([...match.matched, ...match.loggedTogether].map((p) => p.id)) : null;

    const money = !pay.connected ? { connected: false }
      : pay.error ? { connected: true, error: pay.error }
      : { connected: true, thisMonth: pay.totals.thisMonth / 100, lastMonth: pay.totals.lastMonth / 100, thisYear: pay.totals.thisYear / 100, updatedAt: new Date().toISOString() };
    const payments = !pay.connected ? { connected: false }
      : pay.error ? { connected: true, error: pay.error }
      : { connected: true, total: pay.list.length, items: pay.list.slice(0, req.query.all ? 100 : 8).map((p) => paymentRow(p, nameOf, logged)) };
    if (req.query.all) return res.status(200).json({ payments });

    const accounting = !acct.connected ? { connected: false }
      : acct.error ? { connected: true, error: acct.error }
      : {
        connected: true, month: acct.month, year: acct.year, readAt: acct.readAt,
        monthRevenue: acct.monthRevenue, monthExpenses: acct.monthExpenses, monthNet: acct.monthNet,
        yearNet: acct.yearNet, checkingBalance: acct.checkingBalance, taxSetAside: acct.taxSetAside,
        // null = Stripe couldn't be read, so nobody can say what's missing
        unlogged: match ? match.unlogged.map((p) => paymentRow(p, nameOf, null)) : null,
        unloggedTotal: match ? match.unloggedTotal / 100 : null,
      };

    // keep the two ClickUp tasks in step with what was just read (debounced; never blocks the page)
    let tasks = null;
    try { tasks = await checkClickUpTasks({ match, nameOf }); } catch (err) { console.error("home: clickup tasks", err); }
    return res.status(200).json({ money, payments, accounting, clickup, tasks: tasks && { ran: !tasks.skipped } });
  } catch (err) {
    console.error("home failed:", err);
    return res.status(500).json({ error: "Couldn't load the Dashboard's numbers. Try again in a minute." });
  }
}
