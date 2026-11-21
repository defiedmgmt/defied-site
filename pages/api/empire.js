// Staff-only EMPIRE deal (lib/empire-deal.js): the publishing-administration deal's recoupment, the $75,000 Defied gives its producers advances from, each producer deal,
// the statements EMPIRE sends, and the numbers behind the advance calculator. CONFIDENTIAL (the contract's terms stay between the parties): Money access, and an account
// that sees every artist (an account limited to its own is refused: the page works on the whole roster). Nothing here writes to a sheet.
//   GET  -> { terms, defaults, levers, recoupment, pot, received, deals, statements, quarters, nextDue, producers, stats, streamsOn, today }
//   POST { action: "saveDeal" | "setDealStatus" | "deleteDeal" | "addStatement" | "deleteStatement" | "setReceived" | "setLevers", ... } -> { ok, ... }
//        400 with the sentence to show when something typed isn't right, 404 for a deal or statement that isn't there, 409 for a statement that quarter already has.
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { empireView, runAction } from "../../lib/empire-deal";

// the database, the saved copy of the pub sheet's levers (or one read of it)
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "money", { whole: true });
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") {
    try { return res.status(200).json(await empireView()); } catch (err) {
      console.error("empire view failed:", err);
      return res.status(500).json({ error: "Couldn't load the EMPIRE numbers. Try again in a minute." });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!requireSameOrigin(req, res)) return;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  try {
    const out = await runAction(body, { by: session.user?.name || session.user?.email || "staff" });
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error("empire write failed:", err);
    return res.status(500).json({ error: "That didn't save. Try again in a minute." });
  }
}
