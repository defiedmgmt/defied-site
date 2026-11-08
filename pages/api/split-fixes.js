// Staff-only: the split fixes nobody has to think about (lib/split-fixes.js, lib/split-fixes-store.js).
// GET = { auto: { done, held }, writes, sheetUrl } (writes: whether "Fill in" may write, PUB_SHARE_WRITES).
// POST {action:"auto", items} records the even splits the browser just confirmed by themselves (DB only: the
// split itself was saved by the dashboard's own save); {action:"undo", ids} takes them off that list for good;
// {action:"fill", placementId, share, row} writes the share typed in the dialog (100 if none) into the sheet's blank
// Writer Share cell of that song's row (row: the one the dialog named; refused if the song's row has moved).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, ownSet } from "../../lib/access";
import { sql } from "../../lib/db";
import { autoState, recordAuto, undoAuto, fillBlankShare, shareWritesOn } from "../../lib/split-fixes-store";

// an account limited to its own artists (lib/roles.js): the ids of their songs, else null (every song)
const ownSongs = async (req) => (limited(req) ? new Set((await sql`SELECT id FROM placements WHERE client_id = ANY(${[...ownSet(req)]})`).map((r) => r.id)) : null);

export default async function handler(req, res) {
  const session = await requireAccess(req, res, "publishing");
  if (!session) return;
  try {
    const mine = await ownSongs(req);
    const own = (x) => !mine || mine.has(x?.id);
    if (req.method === "GET") return res.status(200).json({ auto: await autoState().then((a) => (mine ? { done: a.done.filter(own), held: a.held.filter((id) => mine.has(id)) } : a)), writes: shareWritesOn(), sheetUrl: process.env.GOOGLE_SHEET_LINK_ID === "none" ? null : process.env.GOOGLE_SHEET_LINK_ID ? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(process.env.GOOGLE_SHEET_LINK_ID)}/edit` : process.env.GOOGLE_SHEET_ID ? `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit` : null });
    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
    if (!requireSameOrigin(req, res)) return;
    const b = req.body || {};
    const touched = b.action === "fill" ? [b.placementId] : b.action === "auto" ? (Array.isArray(b.items) ? b.items.map((x) => x?.id) : []) : Array.isArray(b.ids) ? b.ids : [];
    if (mine && !touched.every((id) => mine.has(id))) return res.status(403).json({ error: "That song isn't one of your artists'." });
    const by = session.user.name || session.user.email || "";
    const out = b.action === "auto" ? await recordAuto(b.items, by)
      : b.action === "undo" ? await undoAuto(b.ids)
      : b.action === "fill" ? await fillBlankShare(b.placementId, { share: b.share, row: b.row })
      : { error: "Unknown action." };
    if (out.error) return res.status(out.status || 400).json({ error: out.error, off: !!out.off });
    return res.status(200).json(out);
  } catch (err) {
    console.error("split-fixes route failed:", err);
    return res.status(502).json({ error: "Couldn't reach the pub sheet. Try again in a minute." });
  }
}
