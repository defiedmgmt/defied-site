// The monthly Luminate true-up (lib/trueup.js). Publishing only, and every artist at once (an account limited to
// its own artists is refused), as /api/songs is.
//   GET                                   the song list for the Luminate report, the true-up's To do rows, runs, schedule
//   POST { action: "preview", files }     what Apply would do (files: [{ name, text }]); nothing is written
//   POST { action: "apply", files }       saves it as one run (trueup_runs + trueup_points), nothing else
//   POST { action: "undo", runId }        the newest run only, and everything it wrote
//   POST { action: "schedule", ends | copied }   a Founder moves the day Luminate's schedule ends
// Nothing here writes the sheet: the STREAM DATA writer does, behind STREAM_SHEET_WRITES (default off).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { trueUpState, previewTrueUp, applyTrueUp, undoTrueUp, setSchedule } from "../../lib/trueup";

// two reports of 500 songs, in the portfolio exports' layout, fit easily
export const config = { api: { bodyParser: { sizeLimit: "4mb" } }, maxDuration: 60 };
const files = (v) => (Array.isArray(v) ? v.filter((f) => f && typeof f.name === "string" && typeof f.text === "string").slice(0, 12) : []);
// the plan as the page shows it: every roster row, the counts, and the rows left out (A&R, not linked here, older)
const short = (p) => p && {
  rows: p.rows.map(({ lumId, name, list, total, on, before, ratio, oldRatio, ratioKept, why, same, spotify, spotifyAt }) => ({ lumId, name, list, total, on, before, ratio, oldRatio, ratioKept, why, same, spotify, spotifyAt })),
  songs: p.fresh.length, changed: p.changed.length, kept: p.kept.length, same: p.rows.length - p.fresh.length,
  ar: p.ar, unknown: p.unknown, older: p.older, artists: p.artists, exportOn: p.exportOn,
};

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "publishing", { whole: true });
  if (!session) return;
  const founder = req.access?.role === "founder";
  try {
    if (req.method === "GET") return res.status(200).json({ ...(await trueUpState()), canSchedule: founder });
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const body = req.body || {}, by = session.user.name || session.user.email || "staff";
    if (body.action === "preview") {
      const out = await previewTrueUp(files(body.files));
      return res.status(200).json({ errors: out.errors, files: out.files, plan: short(out.plan) });
    }
    if (body.action === "apply") {
      const out = await applyTrueUp(files(body.files), { by });
      return res.status(out.error ? 400 : 200).json(out);
    }
    if (body.action === "undo") {
      const out = await undoTrueUp(typeof body.runId === "string" ? body.runId : "");
      return res.status(out.error ? 409 : 200).json(out);
    }
    if (body.action === "schedule") {
      if (!founder) return res.status(403).json({ error: "Only a Founder can change Luminate's schedule date." });
      const out = await setSchedule({ ends: body.ends, copied: body.copied === true, by });
      return res.status(out.error ? 400 : 200).json(out);
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    console.error("trueup route failed:", err);
    return res.status(502).json({ error: err.message || "Something went wrong — nothing was changed." });
  }
}
