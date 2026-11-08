// Staff-only: the split fixes nobody has to think about (lib/split-fixes.js, lib/split-fixes-store.js).
// GET = { auto: { done, held }, writes, sheetUrl } (writes: whether "Fill in" may write, PUB_SHARE_WRITES).
// POST {action:"auto", items} records the even splits the browser just confirmed by themselves (DB only: the
// split itself was saved by the dashboard's own save); {action:"undo", ids} takes them off that list for good;
// {action:"fill", placementId, share, row} writes the share typed in the dialog (100 if none) into the sheet's blank
// Writer Share cell of that song's row (row: the one the dialog named; refused if the song's row has moved).
// r11 todoedit: {action:"setShare", placementId, share, row, from} "Use the sheet's split" with a share typed other
// than the sheet's: that one cell becomes the typed share (from: the sheet's % the dialog showed, still there);
// {action:"guard", placementId, percent, splits, exact, row, song, liveIds} (or {action:"guard", items: [those]},
// Confirm all's songs at once): To do's pre-check before anything changes, by the push route's own rules (reads
// only; r11 todofix: the guard itself is inside /api/sheets-push, /api/sheets-claim and /api/sheets-delete);
// {action:"guardAfter", placementId, row, sig, cells, percent}: the read-back when a push or a stamp didn't come
// back, on the song's own client's tab (worked out from the placement, never a tab the browser names). Every write
// here reads the tab with FORMULA first and again after (lib/split-fixes-store.js).
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, ownSet } from "../../lib/access";
import { sql } from "../../lib/db";
import { autoState, recordAuto, undoAuto, fillBlankShare, setSheetShare, pushGuard, pushGuards, pushAfter, shareWritesOn } from "../../lib/split-fixes-store";

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
    const many = b.action === "guard" && Array.isArray(b.items);
    const touched = many ? b.items.map((x) => x?.placementId) : ["fill", "setShare", "guard", "guardAfter"].includes(b.action) ? [b.placementId] : b.action === "auto" ? (Array.isArray(b.items) ? b.items.map((x) => x?.id) : []) : Array.isArray(b.ids) ? b.ids : [];
    if (mine && !touched.every((id) => mine.has(id))) return res.status(403).json({ error: "That song isn't one of your artists'." });
    const by = session.user.name || session.user.email || "";
    const out = b.action === "auto" ? await recordAuto(b.items, by)
      : b.action === "undo" ? await undoAuto(b.ids)
      : b.action === "fill" ? await fillBlankShare(b.placementId, { share: b.share, row: b.row })
      : b.action === "setShare" ? await setSheetShare(b.placementId, { share: b.share, row: b.row, from: b.from })
      : many ? await pushGuards(b.items.map((x) => ({ placementId: x?.placementId, percent: x?.percent, splits: x?.splits, exact: x?.exact, row: x?.row, song: x?.song, liveIds: x?.liveIds })))
      : b.action === "guard" ? await pushGuard({ placementId: b.placementId, percent: b.percent, splits: b.splits, exact: b.exact, row: b.row, song: b.song, liveIds: b.liveIds })
      : b.action === "guardAfter" ? await pushAfter({ placementId: b.placementId, row: b.row, sig: b.sig, cells: b.cells, percent: b.percent })
      : { error: "Unknown action." };
    if (out.error) return res.status(out.status || 400).json({ error: out.error, off: !!out.off });
    return res.status(200).json(out);
  } catch (err) {
    console.error("split-fixes route failed:", err);
    // a cell write that failed was read back all the same (it may have landed): a formula that changed is said too
    const back = err?.readBack;
    if (back && !back.ok) console.error(`split-fixes: ${back.alarm}`);
    return res.status(502).json({ error: `Couldn't reach the pub sheet. Try again in a minute.${back && !back.ok ? ` ${back.alarm}` : ""}` });
  }
}
