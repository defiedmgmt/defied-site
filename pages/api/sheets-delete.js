// Called when a song is deleted on the site — clears that placement's row
// out of every split-holder's tab on the pub sheet, so a deleted song
// doesn't keep counting toward anyone's streams/revenue. Only clears the
// site-owned columns (Song Title, Recording Artist, Writer Share %,
// Luminate ID, Site Sync ID); formula columns are never touched.
// r11 todofix: through the formula guard (lib/sheet-writes.js guardedClear):
// the tab read with FORMULA first, nothing cleared when one of those cells
// holds a formula or the row is the Total row (or below), and the tab read
// again after. A refusal is a 409 { error, refused, results }; a formula that
// changed comes back as `alarm`, said loudly.
import { getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, findRowBySyncId } from "../../lib/sheets";
import { guardedClear } from "../../lib/sheet-writes";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, mayUseClient } from "../../lib/access";
import { ownerOf } from "../../lib/names";
import { sql } from "../../lib/db";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireAccess(req, res, "publishing", { clients: true });
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const { placementId, splits } = req.body || {};
  if (!placementId || !Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "placementId and splits are required." });
  }

  // called both when staff delete an entire client (any name allowed) and
  // when a client deletes their own song (their own name only, shared
  // SongManager component) — a client session may only ever clear their own
  // split off the sheet, never smuggle someone else's name in.
  const isStaff = session.user.role === "staff";
  try {
    // the song (and, deleting a whole client, the client) is already gone
    // from the database: a name belongs to whoever still goes by it
    const known = await loadClientTabNames();
    const whose = (name) => ownerOf(known, name, isStaff ? undefined : session.user.clientId);
    // staff limited to their own artists (lib/roles.js): never a song still saved under another artist
    if (isStaff && limited(req)) {
      const [p] = await sql`SELECT client_id FROM placements WHERE id = ${placementId}`;
      if (p && !mayUseClient(req, p.client_id)) return res.status(403).json({ error: "That song isn't one of your artists'." });
    }
    if (!isStaff && !splits.every((s) => whose((s.name || "").trim())?.id === session.user.clientId)) {
      return res.status(403).json({ error: "Not authorized for that split." });
    }

    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const tabs = await listTabs(sheets, spreadsheetId);

    const results = [];
    for (const split of splits) {
      const name = (split.name || "").trim();
      if (!name) continue;
      const tab = findTab(tabs, name, tabsOfOthers(known, whose(name)));
      if (!tab) { results.push({ name, found: false }); continue; }

      const syncId = `${placementId}:${name.toLowerCase()}`;
      const row = await findRowBySyncId(sheets, spreadsheetId, tab.title, syncId);
      if (row) {
        const out = await guardedClear(sheets, spreadsheetId, tab.title, row);
        if (out.alarm) console.error(`sheets-delete: ${out.alarm}`);
        results.push(out.refused ? { name, tab: tab.title, cleared: false, refused: out.refused } : { name, tab: tab.title, cleared: true, ...(out.alarm ? { alarm: out.alarm } : {}) });
      } else {
        results.push({ name, tab: tab.title, cleared: false });
      }
    }

    const refused = results.filter((r) => r.refused), alarms = results.map((r) => r.alarm).filter(Boolean);
    if (refused.length) return res.status(409).json({ error: refused.map((r) => r.refused).join(" "), refused: true, results });
    return res.status(200).json({ ok: true, results, ...(alarms.length ? { alarm: alarms.join(" ") } : {}) });
  } catch (err) {
    const back = err.readBack;
    if (back && !back.ok) console.error(`sheets-delete: ${back.alarm}`);
    return res.status(502).json({ error: err.message || "Sheet delete failed.", ...(back ? { checked: true, ...(back.ok ? {} : { alarm: back.alarm }) } : {}) });
  }
}
