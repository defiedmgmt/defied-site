// Staff-only Sync view (lib/sync-checks.js): every check at once. Home's sync pill reads outOfSync from the same
// answer. GET only, but not read only: with Money, the INFO check copies INFO's managers onto the clients when they
// differ, and the people link runs (lib/people-link.js: users, clients and team rows added hidden, INFO writes behind
// ACCOUNTING_SHEET_WRITES), each at most every 2 minutes and the people link only after its first run was confirmed.
import { withSheetsQuick } from "../../lib/sheets";
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
    // (2026-11-20) a page someone waits on: its reads don't sit out Google's quota (lib/sheets.js withSheetsQuick)
    return res.status(200).json(await withSheetsQuick(() => syncChecks({ money: req.access.sections.includes("money"), fresh: req.query.fresh === "1" })));
  } catch (err) {
    console.error("sync failed:", err);
    return res.status(500).json({ error: "Couldn't run the sync checks. Try again in a minute." });
  }
}
