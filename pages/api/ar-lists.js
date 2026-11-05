// A&R's lists (r10): one GET per view, the server works out every number (lib/ar/lists.js). Staff with A&R.
// GET ?view=home|team|mine|watch|songs|sounds|confirm[&person=<userId>]   the view's rows (or Home's trends)
// GET ?item=<row key>                                                    one row's drawer (full series, Luminate history)
// Read-only: no sheet, no ClickUp, no Apify. No money fields, ever.
import { requireAccess } from "../../lib/access";
import { arLists, arItem, VIEWS, displayName } from "../../lib/ar/lists";

export default async function handler(req, res) {
  const session = await requireAccess(req, res, ["ar"]);
  if (!session) return;
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  res.setHeader("Cache-Control", "no-store");
  const user = { id: session.user.id, name: displayName(session.user) };
  try {
    // a Founder may take anyone's entry off (the page shows the button); everyone else only their own
    const founder = req.access?.role === "founder";
    if (req.query.item) return res.status(200).json({ ...(await arItem({ key: String(req.query.item).slice(0, 120), user })), founder });
    const view = VIEWS.includes(String(req.query.view)) ? String(req.query.view) : "team";
    return res.status(200).json({ ...(await arLists({ view, person: String(req.query.person || "").slice(0, 60), user })), founder });
  } catch (err) {
    console.error("ar-lists failed:", err);
    return res.status(503).json({ error: "Couldn't load the A&R lists — try again in a minute." });
  }
}
