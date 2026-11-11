// My payments (2026-11-11, the owner: "a way for the co managers to see their recent payments as well (and the split
// and like what theyre actually keeping in green) on their login portal"): the payments through this staff login's own
// pay link (pay.defiedmgmt.com/<name>), each with Defied's cut and what they keep: the payment less Defied's
// application fee, which is all their Stripe account pays (Stripe's own fee is Defied's; read from the live balance
// transactions on Nov 11). The owner's own link has none (all of it is Defied's). GET only, from Stripe read-only.
import { requireUser } from "../../lib/session";
import { sql } from "../../lib/db";
import { commissionSummary, feeVsSheet, nyMonth, toMs, STATE_KEY } from "../../lib/stripe";
import { payerNamer } from "../../lib/money";
import { isTestPay } from "../../lib/accounting";
import { ownLinkOf, payPage } from "../../lib/commission";

const sum = (xs) => xs.reduce((a, p) => ({ paid: a.paid + p.amount, fee: a.fee + p.fee, keep: a.keep + p.keep, n: a.n + 1 }), { paid: 0, fee: 0, keep: 0, n: 0 });

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = await requireUser(req, res);
  if (!session) return;
  if (session.user.role !== "staff") return res.status(403).json({ error: "Staff only." });
  const me = ownLinkOf(session.user.name);
  if (!me) return res.status(200).json({ none: true });
  res.setHeader("Cache-Control", "no-store");
  try {
    const s = await commissionSummary();
    let list = s.list, stale = false;
    if (!list) {
      // Stripe didn't answer: the payments the dashboard last read
      const [st] = await sql`SELECT value FROM app_state WHERE key = ${STATE_KEY}`.catch(() => []);
      const v = typeof st?.value === "string" ? JSON.parse(st.value) : st?.value;
      if (!v) return res.status(200).json({ link: me, error: s.connected === false ? "Stripe isn't connected." : "Couldn't reach Stripe. Try again in a minute." });
      list = [...Object.values(v.fees || {}), ...Object.values(v.charges || {})]; stale = true;
    }
    const nameOf = await payerNamer(null);
    const mine = list.filter((p) => p.link?.owner === me.owner).sort((a, b) => toMs(b.at) - toMs(a.at)).map((p) => {
      const v = feeVsSheet(p);
      return { id: p.id, at: new Date(toMs(p.at)).toISOString(), client: nameOf(p).client || p.payerName || "Unknown payer", amount: p.amount, fee: p.fee, keep: p.amount - p.fee,
        share: v.sheet, stripeShare: v.covered > 0 ? v.covered : 0, test: isTestPay(p) };
    });
    const month = nyMonth(new Date()), year = month.slice(0, 4);
    const real = mine.filter((p) => !p.test);
    return res.status(200).json({
      link: { ...me, page: payPage(me.key) }, stale,
      month: sum(real.filter((p) => nyMonth(p.at) === month)), year: sum(real.filter((p) => nyMonth(p.at).startsWith(year))),
      payments: mine.slice(0, 40), more: Math.max(0, mine.length - 40),
    });
  } catch (err) {
    console.error("my-payments failed:", err);
    return res.status(502).json({ error: "Couldn't reach Stripe. Try again in a minute." });
  }
}
