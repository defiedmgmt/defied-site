// Staff-only Sync view (lib/sync-checks.js): every check at once, read only. Home's sync pill reads
// outOfSync from the same answer. GET only; nothing here writes.
import { requireStaff } from "../../lib/session";
import { syncChecks } from "../../lib/sync-checks";

// the pub sheet, STREAM DATA, Stripe, the accounting sheet and ClickUp, read side by side
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  try {
    return res.status(200).json(await syncChecks());
  } catch (err) {
    console.error("sync failed:", err);
    return res.status(500).json({ error: "Couldn't run the sync checks. Try again in a minute." });
  }
}
