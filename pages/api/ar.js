// Staff-only A&R data from Postgres alone: the board can draw from this first, and it keeps working
// while the pub sheet can't be read. GET = every prospect with its follow-up, socials and tracked
// songs (?summary=1: the counts for the sidebar badge and the Dashboard's tasks; ?events=<id>: one
// prospect's History for the panel, newest first). POST takes one
// {action} that never touches the sheet. Pub-sheet changes go through /api/ar-write.
import { sql } from "../../lib/db";
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { arState, arSummary, mergeProspect, ArError } from "../../lib/ar";

// the panel's History: plain sentences only (the cells stay server-side); pending ones are left out
// until the next load settles them
const UNDOABLE = ["edit", "status", "contact", "song", "given", "undo"];
async function eventsOf(prospectId) {
  const rows = await sql`SELECT id, at, by, kind, text, status FROM ar_events WHERE prospect_id = ${prospectId} AND status <> 'pending' ORDER BY at DESC LIMIT 40`;
  // nothing from before a merge offers Undo: those cells may be the other record's (the server refuses it too)
  let merged = false;
  return rows.map((e) => {
    const out = { id: e.id, at: e.at, by: e.by, kind: e.kind, text: e.text, status: e.status, undoable: !merged && e.status === "done" && UNDOABLE.includes(e.kind) };
    if (e.kind === "merge") merged = true;
    return out;
  });
}

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
    if (req.method === "GET" && req.query.events) return res.status(200).json({ events: await eventsOf(String(req.query.events)) });
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
