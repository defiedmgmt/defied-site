// Staff-only: the split fixes nobody has to think about (lib/split-fixes.js, lib/split-fixes-store.js).
// GET = { auto: { done, held }, writes, sheetUrl } (writes: whether "Fill in" may write, PUB_SHARE_WRITES).
// POST {action:"auto", items} records the even splits the browser just confirmed by themselves (DB only: the
// split itself was saved by the dashboard's own save); {action:"undo", ids} takes them off that list for good;
// {action:"fill", placementId} writes the site's 100% into the sheet's blank Writer Share cell of that song's row.
import { requireStaff, requireSameOrigin } from "../../lib/session";
import { autoState, recordAuto, undoAuto, fillBlankShare, shareWritesOn } from "../../lib/split-fixes-store";

export default async function handler(req, res) {
  const session = await requireStaff(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") return res.status(200).json({ auto: await autoState(), writes: shareWritesOn(), sheetUrl: process.env.GOOGLE_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit` : null });
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body || {};
    const by = session.user.name || session.user.email || "";
    const out = b.action === "auto" ? await recordAuto(b.items, by)
      : b.action === "undo" ? await undoAuto(b.ids)
      : b.action === "fill" ? await fillBlankShare(b.placementId)
      : { error: "Unknown action." };
    if (out.error) return res.status(out.status || 400).json({ error: out.error, off: !!out.off });
    return res.status(200).json(out);
  } catch (err) {
    console.error("split-fixes route failed:", err);
    return res.status(502).json({ error: "Couldn't reach the pub sheet. Try again in a minute." });
  }
}
