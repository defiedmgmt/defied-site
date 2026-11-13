// Staff-only Sync view (lib/sync-checks.js): every check at once, read only. Home's sync pill reads
// outOfSync from the same answer. GET only; nothing here writes.
import { requireAccess } from "../../lib/access";
import { syncChecks } from "../../lib/sync-checks";

// the pub sheet, Stripe, the accounting sheet and ClickUp, read side by side
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, ["site", "home"], { whole: true });
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    // Stripe and the accounting sheet are Money's: an account without it gets the other checks, and the pub sheet's
    // line without its dollar figures (2026-11-13: the intern's Site › Sync showed the admin fee)
    return res.status(200).json(await syncChecks({ money: req.access.sections.includes("money") }));
  } catch (err) {
    console.error("sync failed:", err);
    return res.status(500).json({ error: "Couldn't run the sync checks. Try again in a minute." });
  }
}
