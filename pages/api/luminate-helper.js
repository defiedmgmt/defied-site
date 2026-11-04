// The Mac helper's door (helper/luminate-helper.mjs on the owner's Mac), and the Luminate page's view of it.
//   With "Authorization: Bearer <token>" (LUMINATE_HELPER_TOKEN; nothing here works without it):
//     GET  -> the helper checking in (the status line's "last seen")
//     POST { files: [{ name, text }] } -> checked and applied like a drop, or held for a person
//     POST { event: "botProblem", step, message } -> the export bot (off by default) says what stopped it
//   Signed-in staff (same-origin):
//     GET  -> helperState(): set up or not, last seen, last upload, files held back
//     POST { action: "apply" | "discard", id, force?, area? } -> a held file
import { requireSameOrigin } from "../../lib/session";
import { requireAccess } from "../../lib/access";
import { helperOn, deviceOf, helperPing, helperUpload, helperState, decideHeld } from "../../lib/luminate-helper";
import { notifyClickUp } from "../../lib/clickup";
import { afterAction } from "../../lib/area-tasks";

// the same size as the drop zone: a portfolio export is ~30-46 KB
export const config = { api: { bodyParser: { sizeLimit: "4mb" } }, maxDuration: 60 };
const MAX_FILES = 12;

async function fromHelper(req, res) {
  // (before anything else: with no token set, the helper's door is shut and nothing is read or written)
  if (!helperOn()) return res.status(503).json({ error: "The Mac helper isn't turned on for this site (LUMINATE_HELPER_TOKEN is not set)." });
  const device = deviceOf(req.headers.authorization);
  if (!device) return res.status(401).json({ error: "That helper token isn't one this site knows. Check the helper's config." });
  const version = String(req.headers["x-helper-version"] || "");
  if (req.method === "GET") return res.status(200).json(await helperPing(device, { version }));
  if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  const body = req.body || {};
  if (body.event === "botProblem") {
    const step = String(body.step || "").slice(0, 80), message = String(body.message || "").slice(0, 400);
    await notifyClickUp(`**Luminate export bot stopped** on ${device}${step ? ` at "${step}"` : ""}: ${message || "something on the page wasn't what it expected"}. Nothing was exported. Export by hand this week. [Open dashboard](https://www.defiedmgmt.com/dashboard)`);
    return res.status(200).json({ ok: true });
  }
  const files = (Array.isArray(body.files) ? body.files : []).slice(0, MAX_FILES);
  if (!files.length) return res.status(400).json({ error: "No files came through." });
  try {
    const out = await helperUpload(files, { device, version });
    // the area tasks follow what came in or was held (CLICKUP_TASK_WRITES only)
    if (out.applied || out.held) await afterAction(["luminate", "publishing", "ar"]);
    return res.status(out.error ? 502 : 200).json(out);
  } catch (err) {
    console.error("luminate helper upload failed:", err);
    return res.status(502).json({ error: err.message || "The upload failed. Nothing was changed." });
  }
}

export default async function handler(req, res) {
  if (req.headers.authorization) return fromHelper(req, res);
  const session = await requireAccess(req, res, "luminate", { whole: true });
  if (!session) return;
  try {
    if (req.method === "GET") return res.status(200).json(await helperState());
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const [status, json] = await decideHeld(req.body || {}, session.user.name || session.user.email || "staff");
    if (status === 200 || status === 502) await afterAction(["luminate", "publishing", "ar"]);
    return res.status(status).json(json);
  } catch (err) {
    console.error("luminate helper route failed:", err);
    return res.status(502).json({ error: err.message || "Something went wrong. Nothing else was changed." });
  }
}
