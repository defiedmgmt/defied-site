// Staff-only A&R changes that touch the pub sheet's OUTREACH / ADVANCE CALCULATOR tabs. Every one
// is aimed at a prospect's permanent id (never a row number from the browser) and goes through the
// write recipe in lib/ar-sheet.js: the lease lock, a fresh read, the same-person check, the
// browser's `expect` per field, only the changed cells, RAW, logged before/after. Success is
// {ok, prospect, eventId} (+ unchanged when nothing differed). AR_SHEET_WRITES switches the sheet
// writes off (503); Postgres-only actions keep working. Still walled off from MASTER/roster totals.
import { requireStaff, requireSameOrigin } from "../../lib/session";
import {
  arWritesOn, createProspect, updateProspect, setStatus, setSlot, clearSlot, logContact,
  setGiven, fixGiven, removeProspect, restoreProspect, undoEvent,
} from "../../lib/ar-sheet";
import { ArError, mergeProspect } from "../../lib/ar";

const SHEET_ACTIONS = {
  createProspect, updateProspect, setStatus, setSlot, clearSlot, logContact,
  setGiven, fixGiven, removeProspect, restoreProspect, undo: undoEvent,
};
// the old row-number actions: an A&R tab opened before this version can't write by row anymore
const LEGACY = ["saveProspectFull", "deleteProspect", "setAdvanceGiven", "saveProspect", "saveSong", "deleteSong"];

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireSameOrigin(req, res)) return;

  const body = req.body || {};
  const { action } = body;
  const by = session.user.name || session.user.email || "staff";
  if (LEGACY.includes(action)) return res.status(400).json({ error: "This page is out of date. Reload it and try again.", reload: true });
  try {
    // Postgres only: "same person as…", and keeping the sheet's own "Advance given?" answers
    if (action === "mergeProspect") return res.status(200).json(await mergeProspect(String(body.fromId || ""), String(body.intoId || ""), by));
    if (action === "fixGiven" && body.use === "sheet") return res.status(200).json(await fixGiven(body, by));
    const run = SHEET_ACTIONS[action];
    if (!run) return res.status(400).json({ error: "Unknown action." });
    if (!arWritesOn()) return res.status(503).json({ error: "Saving A&R changes to the pub sheet is switched off right now." });
    return res.status(200).json(action === "setSlot" ? await setSlot(body, by, body) : await run(body, by));
  } catch (err) {
    if (err instanceof ArError) return res.status(err.status).json({ error: err.message, ...err.extra });
    console.error("ar-write failed:", err);
    return res.status(502).json({ error: "Couldn't save just now — try again in a minute." });
  }
}
