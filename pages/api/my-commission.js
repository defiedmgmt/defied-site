// A client's Management Commission card (lib/commission.js): GET -> their manager and that manager's pay link, the
// rate, and their last payment (from the Stripe payments the dashboard last read, app_state; Stripe itself isn't
// asked from here). Their own only: no other client's payments, no fees, no emails.
import { requireUser } from "../../lib/session";
import { sql } from "../../lib/db";
import { PAY_LINKS } from "../../lib/pay-links";
import { STATE_KEY } from "../../lib/stripe";
import { COMMISSION_RATE, payKeyOf, payPage, paymentsOf } from "../../lib/commission";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireUser(req, res);
  if (!session) return;
  const { role, clientId, id: userId } = session.user;
  if (role !== "client" || !clientId) return res.status(403).json({ error: "This is a client's own page." });
  res.setHeader("Cache-Control", "no-store");
  try {
    const [[c], [u], [st]] = await Promise.all([
      sql`SELECT id, name, credit, manager FROM clients WHERE id = ${clientId}`,
      sql`SELECT email FROM users WHERE id = ${userId}`,
      sql`SELECT value FROM app_state WHERE key = ${STATE_KEY}`.catch(() => []),
    ]);
    if (!c) return res.status(404).json({ error: "Client record not found." });
    const key = payKeyOf(c.manager);
    const v = typeof st?.value === "string" ? JSON.parse(st.value) : st?.value;
    const list = v ? [...Object.values(v.fees || {}), ...Object.values(v.charges || {})] : null;
    const mine = list ? paymentsOf(list, { clientId, email: u?.email || "", names: [c.name, c.credit] }) : null;
    const last = mine?.[0] ? { amount: mine[0].amount, at: new Date(mine[0].at < 1e11 ? mine[0].at * 1000 : mine[0].at).toISOString() } : null;
    return res.status(200).json({ rate: COMMISSION_RATE, manager: { key, name: PAY_LINKS[key].owner, page: payPage(key) }, last, count: mine ? mine.length : null });
  } catch (err) {
    console.error("my-commission failed:", err);
    return res.status(503).json({ error: "Couldn't load this. Try again in a minute." });
  }
}
