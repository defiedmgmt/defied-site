// Staff-only one-click logging of Stripe payments into the accounting sheet's Income tab
// (lib/accounting-log.js). POST {ids:[…], dryRun?:true, details?:{[id]:{type, client}}}: the dry run says the exact rows that would be
// added (and why any can't be); without it the rows are added, each payment at most once. Writes are
// off unless ACCOUNTING_SHEET_WRITES=on (503 with a plain line).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { logPayments, LogError } from "../../lib/accounting-log";

// a fresh Stripe + sheet read, then the append and its read-back
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "money");
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;
  const body = req.body || {};
  try {
    const by = session.user.name || session.user.email || "staff";
    return res.status(200).json(await logPayments({ ids: body.ids, by, dryRun: !!body.dryRun, details: body.details }));
  } catch (err) {
    if (err instanceof LogError) return res.status(err.status).json({ error: err.message });
    console.error("accounting-log failed:", err);
    return res.status(502).json({ error: "Couldn't log to the accounting sheet just now. Try again in a minute." });
  }
}
