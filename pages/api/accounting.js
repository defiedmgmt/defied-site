// Staff-only Accounting section (lib/accounting-section.js): everything it shows in one GET. The
// sheet's balance tiles, the month-by-month check of Stripe against the sheet, the payments still to
// log, the rows to check, every payment, and the Income tab's own lists for Log with details.
// ?counts=1 is the sidebar badge only. POST {ok: key} marks one To check row as fine (kept until that
// row changes). Clients get 401. Nothing here writes to the sheet: logging is /api/accounting-log,
// behind ACCOUNTING_SHEET_WRITES. (2026-11-26 owner: automatic) Auto-log (lib/auto-log.js): a read with a payment no Auto-log note has told yet
// runs it (autoLogSoon: at most once every 10 minutes, one run at a time), and a Founder's read (counts too) carries `counts.refunds` while there are
// auto-logged payments refunded since, until each is marked handled: POST { action: "refundHandled", id }, Founders only. The switch is Money › Settings'
// (/api/accounting-books).
import { withSheetsQuick } from "../../lib/sheets";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { accountingState, markOk } from "../../lib/accounting-section";
import { autoLogSoon, openRefunds, markRefundHandled } from "../../lib/auto-log";
import { PREVIEW, PREVIEW_OFF } from "../../lib/preview";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "money");
  if (!session) return;
  const founder = req.access?.role === "founder";
  try {
    if (req.method === "GET") {
      // beside the section's own read (the same shared Stripe + sheet read); waited for before the answer (work left after it may never run); never throws
      const soon = autoLogSoon();
      const [st, refunds] = await Promise.all([withSheetsQuick(() => accountingState({ fresh: !!req.query.fresh, counts: !!req.query.counts })), founder ? openRefunds() : null]);
      await soon;
      if (!refunds?.length || !st.connected || !st.counts) return res.status(200).json(st);
      return res.status(200).json({ ...st, counts: { ...st.counts, refunds } });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    if (req.body?.action === "refundHandled") {
      if (!founder) return res.status(403).json({ error: "Only a Founder can mark a refund handled." });
      const id = String(req.body.id || "");
      if (!/^[A-Za-z0-9_]{3,80}$/.test(id)) return res.status(400).json({ error: "Which payment?" });
      if (PREVIEW) return res.status(503).json({ error: PREVIEW_OFF });
      if (!(await markRefundHandled(id, session.user.name || session.user.email || "staff"))) return res.status(409).json({ error: "That refund isn't on the list any more. Reload to see what's left." });
      return res.status(200).json({ ok: true, refunds: await openRefunds() });
    }
    // Mark as OK: only a check that is on the list right now, keyed by the row's content
    const key = String(req.body?.ok || "");
    if (!/^[0-9a-f]{20}$/.test(key)) return res.status(400).json({ error: "Nothing to mark." });
    const st = await accountingState({ fresh: true, counts: false });
    if (!st.toCheck?.items.some((x) => x.key === key)) return res.status(409).json({ error: "That row isn't on the list any more. Reload to see what's left." });
    await markOk(key, session.user.name || session.user.email || "staff");
    return res.status(200).json({ ok: true, left: st.counts.toCheck == null ? null : st.counts.toCheck - 1 });
  } catch (err) {
    console.error("accounting failed:", err);
    return res.status(500).json({ error: "Couldn't load the accounting numbers. Try again in a minute." });
  }
}
