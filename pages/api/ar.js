// Staff-only A&R data from Postgres alone: the board can draw from this first, and it keeps working
// while the pub sheet can't be read. GET = every prospect with its follow-up, socials and tracked
// songs (?summary=1: the counts for the sidebar badge and the Dashboard's tasks). POST takes one
// {action} that never touches the sheet. Pub-sheet changes go through /api/ar-write.
import { sql } from "../../lib/db";
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { arState, arSummary, mergeProspect, ArError } from "../../lib/ar";

async function act(body, by) {
  const { action } = body;
  if (action === "mergeProspect") return mergeProspect(String(body.fromId || ""), String(body.intoId || ""), by);
  if (action === "dismissFirstRun") {
    await sql`UPDATE app_state SET value = value || '{"dismissed": true}'::jsonb, updated_at = now() WHERE key = 'arFirstRun'`;
    return { ok: true };
  }
  throw new ArError(400, "Unknown action.");
}

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") return res.status(200).json(req.query.summary ? await arSummary() : await arState());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    return res.status(200).json(await act(req.body || {}, session.user.name || session.user.email || "staff"));
  } catch (err) {
    if (err instanceof ArError) return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("ar route failed:", err);
    return res.status(502).json({ error: "Couldn't load the A&R data just now — try again in a minute." });
  }
}
