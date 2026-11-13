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
// (2026-11-13) The row is found by its Site Sync ID; failing that (119 rows
// didn't carry one: typed in, or matched by Luminate ID since), for a song
// that's gone from the site, by what the page sends with it (luminateId, song,
// row: the row the sheet sync last read it from), never taking a row a live
// song's Site Sync ID claims. Before, Delete said "wasn't found", the row kept
// counting in MASTER and the nightly sync brought the song back.
// (2026-11-13 review) Whichever way it was found, a row another song of the
// same client still reads (its Luminate ID or title: a duplicate card, now
// that the nightly sync stamps such rows for one of the two) is left as it
// is, and said so (`shared`), and an account limited to its own artists never
// looks past the Site Sync ID on another artist's tab.
import {
  getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers, findRowBySyncId, findRowByLuminateId,
  findUnclaimedRowByTitle, rowStillSong, rowCells, liveCardOnRow,
} from "../../lib/sheets";
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
  const { placementId, splits, luminateId, song, row: sheetRow } = req.body || {};
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

    // the songs still on the site, read once, only when a row is looked up by more than its Site Sync ID or one is found
    let cards = null, live = null;
    const liveIds = async () => {
      if (!cards) { cards = await sql`SELECT id, client_id, song, luminate_id FROM placements`; live = new Set(cards.map((p) => p.id)); }
      return live;
    };
    const lum = typeof luminateId === "string" ? luminateId.trim() : "", title = typeof song === "string" ? song : "";

    const results = [];
    for (const split of splits) {
      const name = (split.name || "").trim();
      if (!name) continue;
      const owner = whose(name);
      const tab = findTab(tabs, name, tabsOfOthers(known, owner));
      if (!tab) { results.push({ name, found: false }); continue; }

      const syncId = `${placementId}:${name.toLowerCase()}`;
      let row = await findRowBySyncId(sheets, spreadsheetId, tab.title, syncId);
      // no row with its Site Sync ID, and the song is gone from the site (a request for a live song never looks further):
      // the row its sheet fact names while that row still holds the song (its Luminate ID or title), else the push's own
      // lookups, its Luminate ID then a row with its title, each skipping a row a live song claims; the guard below as ever
      if (!row && (lum || title) && mayUseClient(req, owner?.id) && !(await liveIds()).has(placementId)) {
        row = (await rowStillSong(sheets, spreadsheetId, tab.title, Number(sheetRow), { luminateId: lum, song: title }, live))
          ?? (lum ? await findRowByLuminateId(sheets, spreadsheetId, tab.title, lum, live) : null)
          ?? await findUnclaimedRowByTitle(sheets, spreadsheetId, tab.title, title, live);
      }
      // another song of this client that still reads the row (one more read, only when the client has other songs)
      let others = [];
      if (row && owner) { await liveIds(); others = cards.filter((p) => p.client_id === owner.id && p.id !== placementId); }
      const twin = others.length ? liveCardOnRow(await rowCells(sheets, spreadsheetId, tab.title, row), others) : null;
      if (twin) {
        results.push({ name, tab: tab.title, cleared: false, shared: twin.song || "another song" });
      } else if (row) {
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
