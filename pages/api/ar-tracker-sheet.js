// The A&R sheet (r11, lib/ar/tracker-sheet.js): a one-way copy of the A&R lists in its own spreadsheet.
// GET   its status: { on, url, at, rows, error, text } (Site › Sync shows the same line). A&R or Site.
// POST  { action: "rewrite" }: write the Watchlist tab now (the first fill once the sheet is shared, or after a
//       hand edit in the sheet). 503 while AR_TRACKER_SHEET_WRITES is off. Nothing here reads the sheet's values.
import { requireAccess } from "../../lib/access";
import { requireSameOrigin } from "../../lib/session";
import { trackerSheetOn, trackerSheetStatus, rewriteNow } from "../../lib/ar/tracker-sheet";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, ["ar", "site"]);
  if (!session) return;
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") return res.status(200).json(await trackerSheetStatus());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    if ((req.body || {}).action !== "rewrite") return res.status(400).json({ error: "Unknown action." });
    if (!trackerSheetOn()) return res.status(503).json({ error: "Writing the A&R sheet is switched off right now." });
    const out = await rewriteNow();
    if (out.error) return res.status(502).json({ error: out.error });
    return res.status(200).json({ ok: true, rows: out.rows ?? null, logged: out.logged || 0, queued: !!out.queued, created: out.created || [], status: await trackerSheetStatus() });
  } catch (err) {
    console.error("ar-tracker-sheet failed:", err);
    return res.status(502).json({ error: "Couldn't reach the A&R sheet just now. Try again in a minute." });
  }
}
