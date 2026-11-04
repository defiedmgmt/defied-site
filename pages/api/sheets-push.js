// Writes one row per split-holder into their tab on the pub master sheet
// whenever a song is added/edited on the site. Never touches the sheet's
// formula columns (streams/revenue/admin fee/forecast) — only Song Title,
// Recording Artist, that person's Writer Share %, and a Site Sync ID used to
// find the same row again on a later edit instead of duplicating it. (The
// row's Luminate ID is only read, to find the row: it's never written since
// list B #3.)
import {
  getSheetsClient, getSheetId, listTabs, findTab, loadClientTabNames, tabsOfOthers,
  claimTabForNewCollaborator, findRowBySyncId, findRowByLuminateId, findUnclaimedRowByTitle, writeSongRow, appendSongRow,
} from "../../lib/sheets";
import { requireSameOrigin } from "../../lib/session";
import { requireAccess, limited, mayUseClient } from "../../lib/access";
import { sql } from "../../lib/db";
import { ownerOf } from "../../lib/names";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = await requireAccess(req, res, "publishing", { clients: true });
  if (!session) return;
  if (!requireSameOrigin(req, res)) return;
  const { placementId, song, artist, luminateId, splits, liveIds } = req.body || {};
  if (!placementId || !song || !Array.isArray(splits) || splits.length === 0) {
    return res.status(400).json({ error: "placementId, song, and splits are required." });
  }

  const isStaff = session.user.role === "staff";
  try {
    // whose song this is (saved just before this push): a split under one of
    // that client's own names is theirs, even where another client's tab
    // override reads the same
    const known = await loadClientTabNames();
    const songClient = isStaff
      ? (await sql`SELECT client_id FROM placements WHERE id = ${placementId}`)[0]?.client_id
      : session.user.clientId;
    const whose = (name) => ownerOf(known, name, songClient);
    // staff limited to their own artists (lib/roles.js) push only those artists' songs
    if (isStaff && limited(req) && !mayUseClient(req, songClient)) return res.status(403).json({ error: "That song isn't one of your artists'." });
    // a client session may only ever write their own split (the site's own
    // caller already sends exactly one entry: their own name/percent) — never
    // let a client-controlled request smuggle a write into someone else's tab.
    if (!isStaff && !splits.every((s) => whose((s.name || "").trim())?.id === session.user.clientId)) {
      return res.status(403).json({ error: "Not authorized for that split." });
    }

    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    let tabs = await listTabs(sheets, spreadsheetId);

    const results = [];
    for (const split of splits) {
      const name = (split.name || "").trim();
      const percent = Number(split.percent) || 0;
      if (!name || percent <= 0) continue;

      let tab = findTab(tabs, name, tabsOfOthers(known, whose(name)));
      let created = false;
      if (!tab) {
        // the tab of that exact name is another client's: never write into
        // it, and the sheet won't take a second tab of the same name either
        const n = name.toLowerCase();
        if (tabs.some((t) => t.title.trim().toLowerCase() === n)) {
          throw new Error(`The pub sheet's "${name}" tab is another client's. Give this client their own "Sheet tab name", then save the song again.`);
        }
        tab = await claimTabForNewCollaborator(sheets, spreadsheetId, name, tabs);
        tabs = await listTabs(sheets, spreadsheetId); // refresh — a tab was renamed/created
        created = true;
      }

      const syncId = `${placementId}:${name.toLowerCase()}`;
      // priority: (1) this exact syncId already owns a row — the normal
      // case; (2) the Luminate ID is the one field that identifies the
      // actual song regardless of what the site currently says about it —
      // title/artist/splits can all change, so a shared Luminate ID means
      // "this is obviously the same song" even if the local placement's id
      // changed (deleted and re-added, a stale re-sync) and its old syncId
      // is now sitting on the row unmatched; (3) a real pre-existing row
      // with the same title, where any syncId already there is either
      // blank or points at a placement that no longer exists in the
      // pushing browser's own placement list (liveIds) — rows typed by hand,
      // and ones written back when the site kept songs in each browser's
      // localStorage (two devices' copies of "the same" song could carry
      // different ids), have no other way to be reconciled.
      const existingRow = await findRowBySyncId(sheets, spreadsheetId, tab.title, syncId)
        ?? (luminateId ? await findRowByLuminateId(sheets, spreadsheetId, tab.title, luminateId) : null)
        ?? await findUnclaimedRowByTitle(sheets, spreadsheetId, tab.title, song, liveIds);
      // (the row's Luminate ID cell, M, is never written: list B #3)
      const payload = { song, artist: artist || "", percent, syncId };
      if (existingRow) {
        await writeSongRow(sheets, spreadsheetId, tab.title, existingRow, payload);
      } else {
        await appendSongRow(sheets, spreadsheetId, tab.title, payload);
      }
      results.push({ name, tab: tab.title, tabCreated: created, updated: !!existingRow });
    }

    // every split was skipped (blank name or 0%) — nothing was written
    // anywhere. That's silent data loss from the caller's point of view if
    // it comes back looking like success, so make it a real error instead.
    if (results.length === 0) {
      return res.status(400).json({ error: "Nothing was synced — no split has a name and a percentage above 0%." });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Sheet push failed." });
  }
}
