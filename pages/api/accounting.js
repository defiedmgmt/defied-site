// Staff-only Accounting section (lib/accounting-section.js): everything it shows in one GET. The
// sheet's balance tiles, the month-by-month check of Stripe against the sheet, the payments still to
// log, the rows to check, every payment, and the Income tab's own lists for Log with details.
// ?counts=1 is the sidebar badge only. POST {ok: key} marks one To check row as fine (kept until that
// row changes). Clients get 401. Nothing here writes to the sheet: logging is /api/accounting-log,
// behind ACCOUNTING_SHEET_WRITES.
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { accountingState, markOk } from "../../lib/accounting-section";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") return res.status(200).json(await accountingState({ fresh: !!req.query.fresh, counts: !!req.query.counts }));
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    // Mark as OK: only a check that is on the list right now, keyed by the row's content
    const key = String(req.body?.ok || "");
    if (!/^[0-9a-f]{20}$/.test(key)) return res.status(400).json({ error: "Nothing to mark." });
    const st = await accountingState({ fresh: true, counts: false });
    if (!st.toCheck?.items.some((x) => x.key === key)) return res.status(409).json({ error: "That row isn't on the list any more. Reload to see what's left." });
    await markOk(key, session.user.name || session.user.email || "staff");
    return res.status(200).json({ ok: true, left: st.counts.toCheck - 1 });
  } catch (err) {
    console.error("accounting failed:", err);
    return res.status(500).json({ error: "Couldn't load the accounting numbers. Try again in a minute." });
  }
}
