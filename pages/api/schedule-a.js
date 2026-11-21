// Staff-only Schedule A (lib/schedule-a.js): the sheet that lists every producer's songs with their share, written from the site. Publishing access, and an
// account that sees every artist (the sheet is the whole roster's: an account limited to its own artists is refused).
//   GET  -> { on, writes, url, last, preview }  where it stands (app_state "scheduleA") and what a sync would do now, a dry run: one read of the sheet,
//           nothing written. preview is { rows, producers, onlyOnSheet, changed, wouldFormat, summary } or { error }.
//   POST -> runs the sync now (Site › Sync's "Sync Schedule A now"): { ok, at, rows, producers, onlyOnSheet, summary, changed, wrote }.
// 503 with the words when it isn't set up (SCHEDULE_A_SHEET_ID) or its writes are off (SCHEDULE_A_WRITES); 409 when another run is writing the sheet just now (one at a
// time: { busy: true }); 502 when Google or the sheet said no, or the sheet's header row isn't one the site knows (nothing is written then).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { runScheduleA, scheduleAStatus, scheduleAOn, scheduleAWritesOn } from "../../lib/schedule-a";

// the database, one read of the sheet, one write of it and its looks
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "publishing", { whole: true });
  if (!session) return;
  if (req.method === "GET") {
    try { return res.status(200).json(await scheduleAStatus()); } catch (err) {
      console.error("schedule a status failed:", err);
      return res.status(500).json({ error: "Couldn't read Schedule A's state. Try again in a minute." });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!requireSameOrigin(req, res)) return;
  if (!scheduleAOn()) return res.status(503).json({ error: "Schedule A isn't set up yet: SCHEDULE_A_SHEET_ID isn't set.", off: true });
  if (!scheduleAWritesOn()) return res.status(503).json({ error: "Writing to Schedule A is switched off (SCHEDULE_A_WRITES).", off: true });
  const out = await runScheduleA({ source: session.user?.name || session.user?.email || "staff", budgetMs: 40000 });
  if (out.error) return res.status(502).json({ error: out.error });
  if (out.off) return res.status(503).json({ error: `Schedule A is off: ${out.off}.`, off: true });
  if (out.busy) return res.status(409).json({ error: "Schedule A is being written right now (another run is in progress). Try again in a minute.", busy: true });
  // (a run that ran out of time goes on by itself: the answer says so)
  if (out.late || out.skipped) return res.status(200).json({ ok: false, skipped: out.skipped, late: !!out.late });
  return res.status(200).json(out);
}
