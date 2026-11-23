// Writes one row per split-holder into their tab on the pub master sheet
// whenever a song is added/edited on the site. Never touches the sheet's
// formula columns (streams/revenue/admin fee/forecast) — only Song Title,
// Recording Artist, that person's Writer Share %, and a Site Sync ID used to
// find the same row again on a later edit instead of duplicating it. (The
// row's Luminate ID is only read, to find the row: it's never written since
// list B #3.)
// r11 todofix: every push goes through the formula guard here, whoever sends it
// (the song editor's Save, To do's Confirm and merge card, a page opened before
// a deploy, a hand-made request): lib/sheet-writes.js guardedPush reads the
// tab with FORMULA before writing and refuses, naming the cell, a formula in
// A, B, D or N, the Total row or below it, or a share that fails
// pushShareProblem (the share saved on the site, two decimals or an exact fraction like a third, and with
// check "confirm" a split of exactly 100%, "merge" at most 100%); then reads
// the tab again and answers with a loud `alarm` if any formula changed.
// A refusal is a 409 { error, refused, written }; a 502 says whether its
// write was read back (checked, alarm).
// (2026-11-13) The one formula write: a formula column of the row being
// written that's blank (Sauceproducedit's C15 lost its streams lookup by hand,
// and it's the next row a song lands on) gets its standard formula back in the
// same guarded write, so the song's streams count; each result says which
// (`restored`), and the log too. A typed value there is never touched.
import { loadClientTabNames } from "../../lib/sheets";
import { pushSongRows } from "../../lib/sheet-push";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, mayUseClient } from "../../lib/access";
import { sql } from "../../lib/db";
import { ownerOf } from "../../lib/names";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireAccess(req, res, "publishing", { clients: true });
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const { placementId, song, artist, luminateId, splits, liveIds, check } = req.body || {};
  if (!placementId || !song || !Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "placementId, song, and splits are required." });
  }

  const isStaff = session.user.role === "staff";
  try {
    // whose song this is (saved just before this push): a split under one of
    // that client's own names is theirs, even where another client's tab
    // override reads the same; its saved split is what each share is checked
    // against (r11 todofix)
    const known = await loadClientTabNames();
    const [saved] = await sql`SELECT client_id, splits FROM placements WHERE id = ${placementId}`;
    const songClient = isStaff ? saved?.client_id : session.user.clientId;
    const whose = (name) => ownerOf(known, name, songClient);
    // staff limited to their own artists (lib/roles.js) push only those artists' songs
    if (isStaff && limited(req) && !mayUseClient(req, songClient)) return res.status(403).json({ error: "That song isn't one of your artists'." });
    // a client session may only ever write their own split (the site's own
    // caller already sends exactly one entry: their own name/percent) — never
    // let a client-controlled request smuggle a write into someone else's tab.
    if (!isStaff && !splits.every((s) => whose((s.name || "").trim())?.id === session.user.clientId)) {
      return res.status(403).json({ error: "Not authorized for that split." });
    }
    // (every caller saves the song first: a push for one the site doesn't have writes nothing)
    if (!saved) return res.status(409).json({ error: "That song isn't saved on the site, so nothing was written to the pub sheet. Reload the page and save it again.", refused: true, written: false });

    // (2026-11-17) the tab lookup, the row write and its answer are lib/sheet-push.js's now (lib/auto-add.js writes a song's row with it too)
    const out = await pushSongRows({ placementId, song, artist, luminateId, splits, liveIds, check, saved, known, whose, by: session.user?.name || session.user?.email || "song push" });
    return res.status(out.status).json(out.body);
  } catch (err) {
    // a write call that failed was read back all the same (it may have landed): its answer goes with the error
    const back = err.readBack;
    if (back && !back.ok) console.error(`sheets-push: ${back.alarm}`);
    return res.status(502).json({ error: err.message || "Sheet push failed.", ...(back ? { checked: true, ...(back.ok ? {} : { alarm: back.alarm }) } : {}) });
  }
}
